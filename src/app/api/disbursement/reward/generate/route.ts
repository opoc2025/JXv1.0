import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/storage/database/supabase-client";

/**
 * POST /api/disbursement/reward/generate
 * 从 weekly_reward_settlement 复制快照到 reward_disbursement
 *
 * body: { period_key, period_type: 'WEEKLY'|'MONTHLY', dept? }
 *   WEEKLY:  period_key = '2026-W40' → 该周所有 DAILY + WEEKLY 结算
 *   MONTHLY: period_key = '2026-09' → 该月所有 DAILY 汇总 + WEEKLY 汇总
 */
export async function POST(req: NextRequest) {
	const body = await req.json();
	const { period_key, period_type, dept } = body;
	if (!period_key || !period_type) {
		return NextResponse.json({ error: "period_key + period_type 必填" }, { status: 400 });
	}

	const supabase = getSupabaseClient();

	// 0. 检查该周期是否已归档（已归档禁止重新生成）
	const { data: existingArchived } = await supabase
		.from("reward_disbursement")
		.select("id")
		.eq("period_key", period_key)
		.eq("period_type", period_type)
		.eq("archived", true)
		.limit(1);
	if (existingArchived && existingArchived.length > 0) {
		return NextResponse.json({ error: "该周期已完成发放并归档，无法重新生成快照。如需修改请先反归档。" }, { status: 400 });
	}

	// 1. 查奖励结算
	let dailyQ = supabase.from("weekly_reward_settlement").select("*").eq("period", "DAILY");
	let weeklyQ = supabase.from("weekly_reward_settlement").select("*").eq("period", "WEEKLY");

	if (period_type === "WEEKLY") {
		// WEEKLY: 查该 ISO 周的 7 天日结算 + 当周周结算
		const weekDates = getWeekDates(period_key);
		if (!weekDates) {
			return NextResponse.json({ error: `无效 ISO 周: ${period_key}` }, { status: 400 });
		}
		dailyQ = dailyQ.gte("period_key", weekDates[0]).lte("period_key", weekDates[6]);
		weeklyQ = weeklyQ.eq("period_key", period_key);
	} else {
		// MONTHLY: 查该月所有日 + 所有周
		dailyQ = dailyQ.like("period_key", `${period_key}%`);
		weeklyQ = weeklyQ.like("period_key", `${period_key}%`);
	}

	if (dept) {
		dailyQ = dailyQ.eq("dept_name", dept);
		weeklyQ = weeklyQ.eq("dept_name", dept);
	}

	const [{ data: daily }, { data: weekly }] = await Promise.all([dailyQ, weeklyQ]);

	// 2. 按员工聚合
	const agg = new Map<string, { daily: number; weekly: number }>();
	const empDept = new Map<string, string | null>();

	for (const r of daily || []) {
		const cur = agg.get(r.employee_id) || { daily: 0, weekly: 0 };
		cur.daily += Number(r.total_reward || 0);
		agg.set(r.employee_id, cur);
		if (!empDept.has(r.employee_id)) empDept.set(r.employee_id, r.dept_name);
	}
	for (const r of weekly || []) {
		const cur = agg.get(r.employee_id) || { daily: 0, weekly: 0 };
		cur.weekly += Number(r.total_reward || 0);
		agg.set(r.employee_id, cur);
		if (!empDept.has(r.employee_id)) empDept.set(r.employee_id, r.dept_name);
	}

	// 3. 查未清借款
	const empIds = [...agg.keys()];
	const { data: loans } = await supabase
		.from("loan_record")
		.select("employee_id, amount, repaid_amount")
		.in("employee_id", empIds.length > 0 ? empIds : ["_"])
		.eq("status", "OUTSTANDING");

	const loanMap = new Map<string, number>();
	for (const l of loans || []) {
		const owed = Number(l.amount) - Number(l.repaid_amount || 0);
		loanMap.set(l.employee_id, (loanMap.get(l.employee_id) || 0) + owed);
	}

	// 4. 构建快照
	const snapshots = empIds
		.map((empId) => {
			const a = agg.get(empId)!;
			const dailyTotal = round2(a.daily);
			const weeklyTotal = round2(a.weekly);
			const rewardTotal = round2(dailyTotal + weeklyTotal);
			if (rewardTotal <= 0) return null; // 没有奖励就跳过

			const loanRemaining = round2(loanMap.get(empId) || 0);
			const loanDeduction = round2(Math.min(loanRemaining, rewardTotal));
			const netPay = round2(Math.max(0, rewardTotal - loanDeduction));

			return {
				period_key,
				period_type,
				employee_id: empId,
				dept_name: empDept.get(empId) || null,
				daily_total: dailyTotal,
				weekly_total: weeklyTotal,
				reward_total: rewardTotal,
				loan_deduction: loanDeduction,
				loan_deduction_override: false,
				loan_remaining_before: loanRemaining,
				net_pay: netPay,
				net_pay_override: false,
				status: "PENDING",
			};
		})
		.filter(Boolean);

	if (snapshots.length === 0) {
		return NextResponse.json({ error: "所选期间没有奖励结算数据" }, { status: 400 });
	}

	// 5. Upsert
	const { data: inserted, error: e2 } = await supabase
		.from("reward_disbursement")
		.upsert(snapshots as any, {
			onConflict: "period_key,period_type,employee_id",
			ignoreDuplicates: false,
		})
		.select();

	if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });

	return NextResponse.json({
		ok: true,
		count: inserted?.length || snapshots.length,
		period_key,
		period_type,
	});
}

function round2(v: number) {
	return Math.round(v * 100) / 100;
}

// '2026-W40' → ['2026-09-28', ..., '2026-10-04'] 7 天（本地时区，避免 toISOString 时区偏移）
function getWeekDates(isoWeek: string): string[] | null {
	const m = isoWeek.match(/^(\d{4})-W(\d{1,2})$/);
	if (!m) return null;
	const [, yearStr, weekStr] = m;
	const year = Number(yearStr);
	const week = Number(weekStr);

	// ISO 周：1月4日所在周为第 1 周
	const jan4 = new Date(year, 0, 4);
	const jan4Day = jan4.getDay() || 7; // 0=周日 → 7
	const firstMonday = new Date(jan4);
	firstMonday.setDate(jan4.getDate() - jan4Day + 1);
	const targetMonday = new Date(firstMonday);
	targetMonday.setDate(firstMonday.getDate() + (week - 1) * 7);

	// 用本地时区格式化，不要用 toISOString（UTC 会差一天）
	function localDateStr(d: Date): string {
		const y = d.getFullYear();
		const m = String(d.getMonth() + 1).padStart(2, "0");
		const dd = String(d.getDate()).padStart(2, "0");
		return `${y}-${m}-${dd}`;
	}

	const dates: string[] = [];
	for (let i = 0; i < 7; i++) {
		const d = new Date(targetMonday);
		d.setDate(targetMonday.getDate() + i);
		dates.push(localDateStr(d));
	}
	return dates;
}
