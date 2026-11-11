import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/storage/database/supabase-client";

/**
 * POST /api/disbursement/payroll/refresh
 * 单项更新快照（不重置发放状态和手动覆盖）：
 *   target = SALARY   → 从已终审结算刷新工资数字（底薪/绩效/全勤/提成/工资合计），并插入新终审员工
 *   target = SUBSIDY  → 按补贴登记重汇总当月补贴
 *   target = LOAN     → 按借款记录重算未清余额与抵扣
 *
 * body: { month, dept?, target }
 * 规则：
 *   - 只更新 PENDING 行（已发放 PAID / 已取消 CANCELLED 不动）
 *   - loan_deduction_override / net_pay_override 的行保留手动值
 */
export async function POST(req: NextRequest) {
	const body = await req.json();
	const { month, dept, target } = body;
	if (!month) return NextResponse.json({ error: "month 必填" }, { status: 400 });
	if (!["SALARY", "SUBSIDY", "LOAN"].includes(target)) {
		return NextResponse.json({ error: "target 必须是 SALARY / SUBSIDY / LOAN" }, { status: 400 });
	}

	const supabase = getSupabaseClient();

	// 0. 归档检查
	const { data: archivedRow } = await supabase
		.from("payroll_disbursement")
		.select("id")
		.eq("period_key", month)
		.eq("archived", true)
		.limit(1);
	if (archivedRow && archivedRow.length > 0) {
		return NextResponse.json(
			{ error: "该月已完成发放并归档，无法更新。如需修改请先反归档。" },
			{ status: 400 }
		);
	}

	// 1. 查待发放快照行（只动 PENDING）
	let sq = supabase
		.from("payroll_disbursement")
		.select("*")
		.eq("period_key", month)
		.eq("status", "PENDING");
	if (dept) sq = sq.eq("dept_name", dept);
	const { data: rows, error: e1 } = await sq;
	if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });
	if (!rows || rows.length === 0) {
		return NextResponse.json({ error: "没有可更新的待发放行（已发放/已取消的行不会被更新）" }, { status: 400 });
	}

	const empIds = rows.map((r: any) => r.employee_id);
	const updatedSet = new Set(rows.map((r: any) => r.employee_id));

	// 2. 按 target 拉新数据源
	let salaryMap = new Map<string, any>(); // SALARY
	let subsidyMap = new Map<string, number>(); // SUBSIDY
	let loanMap = new Map<string, number>(); // LOAN
	let newEmployees: any[] = []; // SALARY：结算有但快照没有的员工

	if (target === "SALARY") {
		let q = supabase
			.from("salary_settlement_result")
			.select("*, employee!inner(employee_id,department)")
			.eq("month", month)
			.eq("status", "FINALIZED");
		if (dept) q = q.eq("employee.department", dept);
		const { data: settlements, error } = await q;
		if (error) return NextResponse.json({ error: error.message }, { status: 500 });
		for (const s of settlements || []) {
			const actualBase = Number(s.actual_base_salary ?? s.base_salary ?? 0);
			const perfBonus = Number(s.monthly_performance_bonus ?? 0);
			const fullAttendance = Number(s.full_attendance_bonus ?? 0);
			const commission = round2(
				Number(s.daily_commission || 0) +
					Number(s.monthly_total_commission || 0) +
					Number(s.stage_tier_commission || 0) +
					Number(s.progressive_commission || 0)
			);
			const grossSalary = round2(actualBase + perfBonus + fullAttendance);
			const grossTotal = round2(Number(s.total_salary ?? grossSalary + commission));
			salaryMap.set(s.employee_id, {
				base_salary: actualBase,
				performance_bonus: perfBonus,
				full_attendance_bonus: fullAttendance,
				gross_salary: grossSalary,
				commission,
				gross_total: grossTotal,
			});
			// 新终审员工（快照中还没有）→ 生成完整新行
			if (!updatedSet.has(s.employee_id)) newEmployees.push(s);
		}
	} else if (target === "SUBSIDY") {
		const { data: subsidies, error } = await supabase
			.from("subsidy_record")
			.select("employee_id, amount")
			.eq("month", month)
			.in("employee_id", empIds);
		if (error) return NextResponse.json({ error: error.message }, { status: 500 });
		for (const s of subsidies || []) {
			subsidyMap.set(s.employee_id, round2((subsidyMap.get(s.employee_id) || 0) + Number(s.amount)));
		}
	} else {
		// LOAN
		const { data: loans, error } = await supabase
			.from("loan_record")
			.select("employee_id, amount, repaid_amount")
			.in("employee_id", empIds)
			.eq("status", "OUTSTANDING");
		if (error) return NextResponse.json({ error: error.message }, { status: 500 });
		for (const l of loans || []) {
			const owed = round2(Number(l.amount) - Number(l.repaid_amount || 0));
			loanMap.set(l.employee_id, round2((loanMap.get(l.employee_id) || 0) + owed));
		}
	}

	// 3. 逐行更新 + 重算依赖字段
	const updates: Promise<any>[] = [];
	let updatedCount = 0;

	for (const row of rows) {
		const patch: Record<string, any> = {};

		if (target === "SALARY") {
			const s = salaryMap.get(row.employee_id);
			if (!s) continue; // 该员工没有已终审结算 → 保留旧值
			Object.assign(patch, s);
		} else if (target === "SUBSIDY") {
			patch.subsidy_amount = subsidyMap.get(row.employee_id) || 0;
		} else {
			patch.loan_remaining_before = loanMap.get(row.employee_id) || 0;
		}

		// 重算依赖：补贴/工资变化 → 借款抵扣上限 & 实发；借款变化 → 抵扣 & 实发
		const grossTotal = Number(patch.gross_total ?? row.gross_total ?? 0);
		const subsidy = Number(patch.subsidy_amount ?? row.subsidy_amount ?? 0);
		const loanRemaining = Number(patch.loan_remaining_before ?? row.loan_remaining_before ?? 0);
		const loanDeduction = !row.loan_deduction_override
			? round2(Math.min(loanRemaining, round2(grossTotal + subsidy)))
			: Number(row.loan_deduction ?? 0);
		if (!row.loan_deduction_override) patch.loan_deduction = loanDeduction;
		if (!row.net_pay_override) {
			patch.net_pay = round2(Math.max(0, round2(grossTotal + subsidy) - loanDeduction));
		}

		updatedCount++;
		updates.push(Promise.resolve(supabase.from("payroll_disbursement").update(patch).eq("id", row.id)));
	}

	// 4. SALARY：插入新终审员工（完整快照行）
	if (target === "SALARY" && newEmployees.length > 0) {
		// 新员工需要补贴和借款数据
		const newEmpIds = newEmployees.map((s: any) => s.employee_id);
		const { data: subsidies } = await supabase
			.from("subsidy_record")
			.select("employee_id, amount")
			.eq("month", month)
			.in("employee_id", newEmpIds);
		const subMap = new Map<string, number>();
		for (const s of subsidies || []) {
			subMap.set(s.employee_id, round2((subMap.get(s.employee_id) || 0) + Number(s.amount)));
		}
		const { data: loans } = await supabase
			.from("loan_record")
			.select("employee_id, amount, repaid_amount")
			.in("employee_id", newEmpIds)
			.eq("status", "OUTSTANDING");
		const loanM = new Map<string, number>();
		for (const l of loans || []) {
			const owed = round2(Number(l.amount) - Number(l.repaid_amount || 0));
			loanM.set(l.employee_id, round2((loanM.get(l.employee_id) || 0) + owed));
		}

		const newRows = newEmployees.map((s: any) => {
			const salary = salaryMap.get(s.employee_id);
			const subsidyAmount = subMap.get(s.employee_id) || 0;
			const loanRemaining = loanM.get(s.employee_id) || 0;
			const loanDeduction = round2(Math.min(loanRemaining, round2(salary.gross_total + subsidyAmount)));
			return {
				period_key: month,
				employee_id: s.employee_id,
				dept_name: s.employee?.department || null,
				...salary,
				subsidy_amount: subsidyAmount,
				loan_deduction: loanDeduction,
				loan_deduction_override: false,
				loan_remaining_before: loanRemaining,
				net_pay: round2(Math.max(0, round2(salary.gross_total + subsidyAmount) - loanDeduction)),
				net_pay_override: false,
				status: "PENDING",
			};
		});
		updates.push(
			Promise.resolve(
				supabase.from("payroll_disbursement").upsert(newRows, {
					onConflict: "period_key,employee_id",
					ignoreDuplicates: false,
				})
			)
		);
		updatedCount += newRows.length;
	}

	const results = await Promise.all(updates);
	for (const r of results) {
		if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 });
	}

	return NextResponse.json({ ok: true, updated: updatedCount });
}

function round2(v: number) {
	return Math.round(v * 100) / 100;
}
