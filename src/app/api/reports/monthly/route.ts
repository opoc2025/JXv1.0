import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/storage/database/supabase-client";

/**
 * GET /api/reports/monthly
 * 报表数据源：payroll_disbursement + reward_disbursement，只取 archived=true + status=PAID
 *
 * Query params:
 *   month?       '2026-09' → 月度汇总（单月全员工）
 *   from? + to?  '2026-01' + '2026-12' → 区间明细（多月 × 多员工）
 *   employee_id?  员工过滤（单个员工全年/区间）
 *   dept_name?    部门过滤
 *   mode?         'SINGLE' | 'RANGE'  不传则自动推断
 *
 * 返回: { totals, rows: [{ month, employee_id, employee_name, dept_name, base_salary, performance_bonus, full_attendance_bonus, commission, salary_total, reward_total, total_income }] }
 */

function weekToMonth(periodKey: string): string {
	// '2026-W42' → 推算该周周一所属月（简单用 ISO week 第一周）
	// 简化：取年份部分 + W 后面的数字，用 Date 推算
	const m = periodKey.match(/^(\d{4})-W(\d{1,2})$/);
	if (!m) return periodKey.slice(0, 7);
	const year = parseInt(m[1]);
	const week = parseInt(m[2]);
	// ISO week 算法：1月4日所在周是第 1 周
	const jan4 = new Date(Date.UTC(year, 0, 4));
	const jan4Dow = jan4.getUTCDay() || 7; // 1=Monday ... 7=Sunday
	const firstWeekMonday = new Date(Date.UTC(year, 0, 4 - jan4Dow + 1));
	const targetMonday = new Date(firstWeekMonday.getTime() + (week - 1) * 7 * 86400000);
	// 该周周五（实际工作收入期）所属月
	const friday = new Date(targetMonday.getTime() + 4 * 86400000);
	return `${friday.getUTCFullYear()}-${String(friday.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function GET(req: NextRequest) {
	const url = new URL(req.url);
	const month = url.searchParams.get("month");
	const from = url.searchParams.get("from");
	const to = url.searchParams.get("to");
	const employeeId = url.searchParams.get("employee_id");
	const dept = url.searchParams.get("dept_name");

	const supabase = getSupabaseClient();

	const isRange = !!from && !!to;
	const periodKeys: string[] = [];
	if (month) periodKeys.push(month);
	if (isRange) {
		// 生成月份数组
		const [fy, fm] = from.split("-").map(Number);
		const [ty, tm] = to.split("-").map(Number);
		let y = fy, m = fm;
		while (y < ty || (y === ty && m <= tm)) {
			periodKeys.push(`${y}-${String(m).padStart(2, "0")}`);
			m++;
			if (m > 12) { m = 1; y++; }
		}
	}

	if (periodKeys.length === 0) {
		return NextResponse.json({ error: "请提供 month 或 from+to 参数" }, { status: 400 });
	}

	// === 查 payroll_disbursement（工资月结）===
	let pq = supabase
		.from("payroll_disbursement")
		.select("*, employee(employee_id,employee_name)")
		.eq("archived", true)
		.eq("status", "PAID")
		.in("period_key", periodKeys);
	if (employeeId) pq = pq.eq("employee_id", employeeId);
	if (dept) pq = pq.eq("dept_name", dept);

	// === 查 reward_disbursement（奖励：周 + 月）===
	let rq = supabase
		.from("reward_disbursement")
		.select("*, employee(employee_id,employee_name)")
		.eq("archived", true)
		.eq("status", "PAID");
	if (employeeId) rq = rq.eq("employee_id", employeeId);
	if (dept) rq = rq.eq("dept_name", dept);

	const [{ data: payroll }, { data: reward }] = await Promise.all([pq, rq]);
	if (payroll === null && reward === null) {
		return NextResponse.json({ error: "查询失败" }, { status: 500 });
	}

	// === 聚合 ===
	type AggRow = {
		month: string; employee_id: string; employee_name: string; dept_name: string;
		base_salary: number; performance_bonus: number; full_attendance_bonus: number;
		commission: number; salary_total: number; reward_total: number;
	};
	const agg = new Map<string, AggRow>();

	function upsert(month: string, empId: string, empName: string, deptName: string, patch: Partial<Pick<AggRow, 'base_salary' | 'performance_bonus' | 'full_attendance_bonus' | 'commission' | 'reward_total'>>) {
		const key = `${month}|${empId}`;
		const cur = agg.get(key) || {
			month, employee_id: empId, employee_name: empName || '-', dept_name: deptName || '-',
			base_salary: 0, performance_bonus: 0, full_attendance_bonus: 0,
			commission: 0, salary_total: 0, reward_total: 0,
		};
		if (patch.base_salary) cur.base_salary += patch.base_salary;
		if (patch.performance_bonus) cur.performance_bonus += patch.performance_bonus;
		if (patch.full_attendance_bonus) cur.full_attendance_bonus += patch.full_attendance_bonus;
		if (patch.commission) cur.commission += patch.commission;
		if (patch.reward_total) cur.reward_total += patch.reward_total;
		cur.salary_total = cur.base_salary + cur.performance_bonus + cur.full_attendance_bonus + cur.commission;
		agg.set(key, cur);
	}

	// 工资月结
	for (const p of payroll || []) {
		const empName = (p as any).employee?.employee_name || '';
		const m = p.period_key;
		if (!periodKeys.includes(m)) continue; // 额外保险
		upsert(m, p.employee_id, empName, p.dept_name || '', {
			base_salary: Number(p.base_salary || 0),
			performance_bonus: Number(p.performance_bonus || 0),
			full_attendance_bonus: Number(p.full_attendance_bonus || 0),
			commission: Number(p.commission || 0),
		});
	}

	// 奖励（周 → 推算月份）
	for (const r of reward || []) {
		const empName = (r as any).employee?.employee_name || '';
		let m: string;
		if (r.period_type === 'MONTHLY') {
			m = r.period_key;
		} else {
			m = weekToMonth(r.period_key);
		}
		if (!periodKeys.includes(m)) continue;
		upsert(m, r.employee_id, empName, r.dept_name || '', {
			reward_total: Number(r.reward_total || 0),
		});
	}

	// 汇总
	const rows = [...agg.values()]
		.map((r) => ({ ...r, total_income: round2(r.salary_total + r.reward_total) }))
		.sort((a, b) => a.month.localeCompare(b.month) || a.employee_id.localeCompare(b.employee_id));

	const totals = rows.reduce((acc, r) => ({
		employee_count: rows.length,
		base_salary: round2(acc.base_salary + r.base_salary),
		performance_bonus: round2(acc.performance_bonus + r.performance_bonus),
		full_attendance_bonus: round2(acc.full_attendance_bonus + r.full_attendance_bonus),
		commission: round2(acc.commission + r.commission),
		salary_total: round2(acc.salary_total + r.salary_total),
		reward_total: round2(acc.reward_total + r.reward_total),
		total_income: round2(acc.total_income + r.total_income),
	}), {
		employee_count: 0, base_salary: 0, performance_bonus: 0, full_attendance_bonus: 0,
		commission: 0, salary_total: 0, reward_total: 0, total_income: 0,
	});

	return NextResponse.json({ totals, rows });
}

function round2(n: number): number {
	return Math.round(n * 100) / 100;
}
