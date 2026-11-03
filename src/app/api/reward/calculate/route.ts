import { getSupabaseClient } from "@/storage/database/supabase-client";
import { ok, fail, batchUpsert } from "@/lib/api-helpers";
import { calculateRewards } from "@/lib/reward-engine";

export const dynamic = "force-dynamic";

/** 计算 [from, to] 日期范围内涉及的所有 ISO 周（如 2026-W44） */
function collectISOWeeks(from: string, to: string): string[] {
	const start = new Date(from + "T00:00:00");
	const end = new Date(to + "T00:00:00");
	const seen = new Set<string>();
	for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
		// 本地时区安全版 ISO 周计算
		const jan4 = new Date(d.getFullYear(), 0, 4);
		const jan4Day = jan4.getDay() || 7;
		const monday = new Date(jan4);
		monday.setDate(jan4.getDate() - jan4Day + 1);
		const daysDiff = Math.floor((d.getTime() - monday.getTime()) / 86400000);
		const year = daysDiff < 0 ? d.getFullYear() - 1 : d.getFullYear();
		const jan4New = new Date(year, 0, 4);
		const jan4NewDay = jan4New.getDay() || 7;
		const yearMonday = new Date(jan4New);
		yearMonday.setDate(jan4New.getDate() - jan4NewDay + 1);
		const offset = Math.floor((d.getTime() - yearMonday.getTime()) / 86400000);
		const weekNum = Math.floor(offset / 7) + 1;
		seen.add(`${year}-W${String(weekNum).padStart(2, "0")}`);
	}
	return [...seen];
}

/**
 * 一键核算日/周奖励
 * 数据源：import_daily_data（复用现有日业务数据）
 * POST body: { from: '2026-09-01', to: '2026-09-30', overwrite: true }
 * GET ?from=2026-09-01&to=2026-09-30&period=DAILY
 */
export async function POST(req: Request) {
	try {
		const body = await req.json().catch(() => ({}));
		const from: string = body.from ?? "2026-09-01";
		const to: string = body.to ?? "2026-09-30";
		const overwrite: boolean = body.overwrite ?? true;
		const dept: string | undefined = body.dept; // 可选：部门过滤

		const supabase = getSupabaseClient();

		// 1. 读 import_daily_data（复用现有日业务数据）
		const { data: dailyData, error: e1 } = await supabase
			.from("import_daily_data")
			.select("*")
			.gte("date", from)
			.lte("date", to);
		if (e1) return fail(e1.message, 500);
		if (!dailyData || dailyData.length === 0) {
			return fail(
				"所选期间无日业务数据，请先到「数据导入」导入日业务明细",
				400
			);
		}

		// 2. 查员工（部门映射 + dept 过滤）
		let empQuery = supabase.from("employee").select("employee_id, department").eq("status", "active");
		if (dept) empQuery = empQuery.eq("department", dept);
		const { data: emps } = await empQuery;
		const empDeptMap = new Map<string, string | null>();
		for (const e of emps ?? []) empDeptMap.set(e.employee_id, e.department);

		// 3. 查规则（只取 DAILY_REWARD_TIER / WEEKLY_REWARD_TIER）
		const { data: rules } = await supabase
			.from("salary_rule_config")
			.select("*")
			.eq("enabled", true)
			.in("rule_type", ["DAILY_REWARD_TIER", "WEEKLY_REWARD_TIER"]);

		if (!rules || rules.length === 0) {
			return fail(
				"没有配置日/周奖励规则，请先到「奖励方案」模块配置规则",
				400
			);
		}

		const ruleIds = rules.map((r) => r.rule_id);

		// 4. 查阶梯
		const { data: tiers } = await supabase
			.from("rule_tier_detail")
			.select("*")
			.in("rule_id", ruleIds);

		// 5. 查条件组
		const { data: groups } = await supabase
			.from("salary_condition_group")
			.select("*")
			.in("rule_id", ruleIds);

		const groupIds = (groups ?? []).map((g: any) => g.id);

		// 6. 查条件明细
		const { data: conditions } =
			groupIds.length > 0
				? await supabase
						.from("salary_condition")
						.select("*")
						.in("group_id", groupIds)
				: { data: [] };

		// 7. 查合并组配置
		const { data: stageGroups } = await supabase
			.from("stage_group")
			.select("*");

		// 7b. 查合并组成员
		const stageGroupIds = (stageGroups ?? []).map((g: any) => g.group_id);
		const { data: groupMembers } = stageGroupIds.length > 0
			? await supabase.from("stage_group_member").select("*").in("group_id", stageGroupIds)
			: { data: [] };

		// 组装 group_name → stage_names[]
		const stageGroupList: any[] = (stageGroups ?? []).map((g: any) => {
			const members = (groupMembers ?? []).filter((m: any) => m.group_id === g.group_id);
			return {
				group_id: g.group_id,
				group_name: g.group_name,
				stage_names: members.map((m: any) => m.stage_name),
			};
		});

		// 8. 查员工 → 合并组关联
		const { data: empGroupRows } = await supabase
			.from("employee_stage_group")
			.select("employee_id, group_id");
		const groupMap = new Map<number, string>(); // group_id → group_name
		(stageGroups ?? []).forEach((g: any) => groupMap.set(g.group_id, g.group_name));
		const empGroupNames = new Map<string, string[]>();
		for (const row of empGroupRows ?? []) {
			const gname = groupMap.get(row.group_id);
			if (!gname) continue;
			const list = empGroupNames.get(row.employee_id) ?? [];
			list.push(gname);
			empGroupNames.set(row.employee_id, list);
		}

		// 9. 跑引擎（含合并组）
		const result = calculateRewards({
			dailyData: dailyData as any,
			rules: rules as any,
			tiers: tiers ?? [],
			conditionGroups: (groups ?? []) as any,
			conditionDetails: conditions ?? [],
			empDeptMap,
			stageGroups: stageGroupList,
			empGroupNames,
		});

		// 8. 覆盖写入结算表 —— 按日期范围清掉该期间所有旧结算（含孤儿），再 upsert 新结果
		// 原逻辑只清新结果里出现的 key，日数据删除后会留下孤儿结算
		if (overwrite) {
			// 8a. 清日结算：period_key 是日期，直接范围比较
			let dailyDelQuery = supabase
				.from("weekly_reward_settlement")
				.delete()
				.eq("period", "DAILY")
				.gte("period_key", from)
				.lte("period_key", to);
			if (dept) dailyDelQuery = dailyDelQuery.eq("dept_name", dept);
			const dailyDel = await dailyDelQuery;

			// 8b. 清周结算：period_key 是 ISO 周（如 2026-W44）
			// 算出 [from, to] 范围内涉及的所有 ISO 周，逐个精确删
			const isoWeeks = collectISOWeeks(from, to);
			let weeklyDeleted = 0;
			if (isoWeeks.length > 0) {
				// 分批删，每批 50 个 ISO 周
				const BATCH = 50;
				for (let i = 0; i < isoWeeks.length; i += BATCH) {
					const batch = isoWeeks.slice(i, i + BATCH);
					let q = supabase
						.from("weekly_reward_settlement")
						.delete()
						.eq("period", "WEEKLY")
						.eq("period_key", batch[0]);
					for (let j = 1; j < batch.length; j++) {
						q = q.or(`period_key.eq.${batch[j]}`);
					}
					if (dept) q = q.eq("dept_name", dept);
					const r = await q;
					weeklyDeleted += r.count ?? 0;
				}
			}
			// 复用 dailyDel 也没关系，只是给个提示
			void dailyDel;
		}

		const toInsert: any[] = [
			...result.dailySettlements,
			...result.weeklySettlements,
		].map((s) => ({
			period: s.period,
			period_key: s.period_key,
			employee_id: s.employee_id,
			dept_name: s.dept_name,
			stage: s.stage,
			total_reward: s.total_reward,
			tier_detail: s.tier_detail,
			status: "DRAFT",
		}));

		if (toInsert.length > 0) {
			await batchUpsert(
				supabase,
				"weekly_reward_settlement",
				toInsert,
				{ onConflict: "period,period_key,employee_id,stage" }
			);
		}

		const dailyTotal = result.dailySettlements.reduce(
			(s, r) => s + r.total_reward,
			0
		);
		const weeklyTotal = result.weeklySettlements.reduce(
			(s, r) => s + r.total_reward,
			0
		);
		const grandTotal = dailyTotal + weeklyTotal;

		return ok({
			from,
			to,
			daily_count: result.dailySettlements.length,
			weekly_count: result.weeklySettlements.length,
			daily_total: Math.round(dailyTotal * 100) / 100,
			weekly_total: Math.round(weeklyTotal * 100) / 100,
			grand_total: Math.round(grandTotal * 100) / 100,
		});
	} catch (e: any) {
		return fail(e.message ?? String(e), 500);
	}
}

/** 查询结算列表 */
export async function GET(req: Request) {
	try {
		const url = new URL(req.url);
		const period = url.searchParams.get("period");
		const from = url.searchParams.get("from");
		const to = url.searchParams.get("to");
		const dept = url.searchParams.get("dept");
		const supabase = getSupabaseClient();

		let q = supabase
			.from("weekly_reward_settlement")
			.select("*")
			.order("period_key", { ascending: false });

		if (period) q = q.eq("period", period);
		if (dept) q = q.eq("dept_name", dept);

		// ⚠️ 周结算 period_key 是 ISO 周 "2026-W39"，不能直接用日期字符串比较
		// 日结算：period_key 是日期 "2026-09-15"，正常过滤
		// 周结算：单独查询，用 SQL SUBSTRING 提取年份+周号范围过滤
		if (from && to) {
			const { data: dailyRows, error: e1 } = await (period === "WEEKLY"
				? Promise.resolve({ data: [], error: null })
				: supabase
						.from("weekly_reward_settlement")
						.select("*")
						.eq("period", "DAILY")
						.gte("period_key", from)
						.lte("period_key", to)
						.order("period_key", { ascending: false }));

			const { data: weeklyRows, error: e2 } = await (period === "DAILY"
				? Promise.resolve({ data: [], error: null })
				: supabase
						.from("weekly_reward_settlement")
						.select("*")
						.eq("period", "WEEKLY"));

			if (e1) return fail(e1.message, 500);
			if (e2) return fail(e2.message, 500);

			// 周结算：过滤掉完全在 from/to 之外的 ISO 周
			// 方法：用 ISO 周的周一日期和周日日期与 from/to 比较
			const inRange = (weekKey: string) => {
				const m = weekKey.match(/^(\d{4})-W(\d{2})$/);
				if (!m) return false;
				const year = Number(m[1]);
				const week = Number(m[2]);
				// 算 ISO 周的周一
				const jan4 = new Date(year, 0, 4);
				const jan4Day = jan4.getDay() || 7; // 1=Mon, 7=Sun
				const monday = new Date(jan4);
				monday.setDate(jan4.getDate() - jan4Day + 1 + (week - 1) * 7);
				const mondayStr = monday.toISOString().slice(0, 10);
				const sunday = new Date(monday);
				sunday.setDate(monday.getDate() + 6);
				const sundayStr = sunday.toISOString().slice(0, 10);
				// 只要 ISO 周和 [from, to] 有重叠就包含
				return sundayStr >= from && mondayStr <= to;
			};
			const filteredWeekly = (weeklyRows ?? []).filter((r: any) => inRange(r.period_key));

			let all = [...(dailyRows ?? []), ...filteredWeekly];
			if (dept) all = all.filter((r: any) => r.dept_name === dept);
			all.sort((a, b) => (a.period_key < b.period_key ? 1 : -1));
			return ok(all);
		}

		const { data, error } = await q;
		if (error) return fail(error.message, 500);
		return ok(data);
	} catch (e: any) {
		return fail(e.message ?? String(e), 500);
	}
}
