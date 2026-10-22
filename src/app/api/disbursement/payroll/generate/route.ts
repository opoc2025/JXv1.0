import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/storage/database/supabase-client";

/**
 * POST /api/disbursement/payroll/generate
 * 从 salary_settlement_result 复制快照到 payroll_disbursement
 *
 * body: { month, dept? }
 */
export async function POST(req: NextRequest) {
	const body = await req.json();
	const { month, dept } = body;
	if (!month) return NextResponse.json({ error: "month 必填" }, { status: 400 });

	const supabase = getSupabaseClient();

	// 0. 检查该月是否已归档（已归档禁止重新生成）
	const { data: existingArchived } = await supabase
		.from("payroll_disbursement")
		.select("id")
		.eq("period_key", month)
		.eq("archived", true)
		.limit(1);
	if (existingArchived && existingArchived.length > 0) {
		return NextResponse.json({ error: "该月已完成发放并归档，无法重新生成快照。如需修改请先反归档。" }, { status: 400 });
	}

	// 1. 查该月薪酬结算
	let q = supabase
		.from("salary_settlement_result")
		.select("*, employee!inner(employee_id,department)")
		.eq("month", month);
	if (dept) q = q.eq("employee.department", dept);

	const { data: settlements, error: e1 } = await q;
	if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });
	if (!settlements || settlements.length === 0) {
		return NextResponse.json({ error: "所选月份没有薪酬结算，请到薪酬核算先计算" }, { status: 400 });
	}

	// 2. 查每个员工的未清借款
	const empIds = [...new Set(settlements.map((s: any) => s.employee_id))];
	const { data: loans } = await supabase
		.from("loan_record")
		.select("employee_id, amount, repaid_amount")
		.in("employee_id", empIds)
		.eq("status", "OUTSTANDING");

	// 按 employee_id 汇总未清借款
	const loanMap = new Map<string, number>();
	for (const l of loans || []) {
		const owed = Number(l.amount) - Number(l.repaid_amount || 0);
		loanMap.set(l.employee_id, (loanMap.get(l.employee_id) || 0) + owed);
	}

	// 3. 构建快照 — 直接用结算表引擎算好的字段，避免重算误差
	const snapshots = settlements.map((s: any) => {
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
		// ❗ 关键：用引擎算好的 total_salary 作为应发合计，不要自己重算
		const grossTotal = round2(Number(s.total_salary ?? grossSalary + commission));

		// 借款抵扣：默认 min(未清借款, 应发合计)
		const loanRemaining = round2(loanMap.get(s.employee_id) || 0);
		const loanDeduction = round2(Math.min(loanRemaining, grossTotal));
		const netPay = round2(Math.max(0, grossTotal - loanDeduction));

		const emp = s.employee;

		return {
			period_key: month,
			employee_id: s.employee_id,
			dept_name: emp?.department || null,
			base_salary: actualBase,
			performance_bonus: perfBonus,
			full_attendance_bonus: fullAttendance,
			gross_salary: grossSalary,
			commission,
			gross_total: grossTotal,
			loan_deduction: loanDeduction,
			loan_deduction_override: false,
			loan_remaining_before: loanRemaining,
			net_pay: netPay,
			net_pay_override: false,
			status: "PENDING",
		};
	});

	// 4. Upsert 到 payroll_disbursement
	const { data: inserted, error: e2 } = await supabase
		.from("payroll_disbursement")
		.upsert(snapshots, {
			onConflict: "period_key,employee_id",
			ignoreDuplicates: false,
		})
		.select();

	if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });

	return NextResponse.json({
		ok: true,
		count: inserted?.length || snapshots.length,
		period_key: month,
	});
}

function round2(v: number) {
	return Math.round(v * 100) / 100;
}
