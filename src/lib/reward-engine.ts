// 奖励引擎（独立模块，和月工资核算无关）
// 数据源：复用现有 import_daily_data（日业务数据）
// 自动算日奖励 + 按 ISO 周汇总算周奖励

import type {
	RuleType,
	RewardType,
	RewardConditionGroup,
	RewardCondition,
	RewardTierMatch,
	WeeklyRewardSettlement,
	SalaryRule as SalaryRuleConfig,
	RuleTier as RuleTierDetail,
	RankScope,
	StageGroup,
} from "./types";

// ===== 排名候选者 =====
interface RankCandidate {
	rowKey: string;          // `${empId}|${stage}|${periodKey}`
	ruleId: number;
	primaryVal: number;      // rank_best_by 指标值
	tiebreakerVal: number;   // rank_tiebreaker 指标值（空=按员工id）
	periodKey: string;
	scopeKey: string;        // 用于 scope 分组
	tierReward: number;
	tierMatches: RewardTierMatch[];
}

// ===== 排名后处理 =====
function computeScopeKey(
	scope: RankScope,
	periodKey: string,
	stage: string,
	deptName: string | null
): string {
	switch (scope) {
		case "DAY_STAGE":
		case "WEEK_STAGE":
			return `${periodKey}|${stage}`;
		case "DAY_DEPT":
		case "WEEK_DEPT":
			return `${periodKey}|${deptName ?? ""}`;
		case "DAY_ALL":
		case "WEEK_ALL":
			return periodKey;
		default:
			return `${periodKey}|${stage}`;
	}
}

function runRanking(
	rankCandidates: RankCandidate[]
): Set<string> {
	const winners = new Set<string>();
	// 按 ruleId 分组
	const byRule = new Map<number, RankCandidate[]>();
	for (const c of rankCandidates) {
		const list = byRule.get(c.ruleId) ?? [];
		list.push(c);
		byRule.set(c.ruleId, list);
	}
	for (const [ruleId, cands] of byRule) {
		// 按 scopeKey 分组
		const byScope = new Map<string, RankCandidate[]>();
		for (const c of cands) {
			const list = byScope.get(c.scopeKey) ?? [];
			list.push(c);
			byScope.set(c.scopeKey, list);
		}
		for (const [, group] of byScope) {
			// 排名：primary desc → tiebreaker desc
			group.sort((a, b) => {
				if (b.primaryVal !== a.primaryVal)
					return b.primaryVal - a.primaryVal;
				return b.tiebreakerVal - a.tiebreakerVal;
			});
			if (group.length > 0) {
				winners.add(`${ruleId}|${group[0].rowKey}`);
			}
		}
	}
	return winners;
}

function mergeRankWinners(
	settlements: WeeklyRewardSettlement[],
	rankCandidates: RankCandidate[],
	winners: Set<string>
): void {
	const settleMap = new Map<string, WeeklyRewardSettlement>();
	for (const s of settlements) {
		const key = `${s.employee_id}|${s.stage}|${s.period_key}`;
		settleMap.set(key, s);
	}
	for (const c of rankCandidates) {
		if (!winners.has(`${c.ruleId}|${c.rowKey}`)) continue;
		const s = settleMap.get(c.rowKey);
		if (!s) continue;
		s.total_reward = round2(s.total_reward + c.tierReward);
		s.tier_detail =
			s.tier_detail && s.tier_detail.length > 0
				? [...s.tier_detail, ...c.tierMatches]
				: c.tierMatches.length > 0
					? c.tierMatches
					: null;
	}
}

// ===== 工具函数 =====

function round2(n: number): number {
	return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ISO 周：周一到周日
export function getISOWeek(dateStr: string): {
	weekIso: string;
	start: string;
	end: string;
} {
	const d = new Date(dateStr + "T00:00:00");
	const day = d.getDay();
	const diffToMonday = day === 0 ? -6 : 1 - day;
	const monday = new Date(d);
	monday.setDate(d.getDate() + diffToMonday);
	monday.setHours(0, 0, 0, 0);
	const sunday = new Date(monday);
	sunday.setDate(monday.getDate() + 6);
	sunday.setHours(23, 59, 59, 999);

	const firstJan = new Date(monday.getFullYear(), 0, 1);
	const weekNum = Math.ceil(
		((monday.getTime() - firstJan.getTime()) / 86400000 +
			firstJan.getDay() +
			1) /
			7
	);
	const weekIso = `${monday.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;

	const fmt = (d: Date) =>
		`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
	return { weekIso, start: fmt(monday), end: fmt(sunday) };
}

// ===== 条件检查 =====

function checkCondition(
	cond: RewardCondition,
	metrics: Record<string, number>
): boolean {
	let val = metrics[cond.metric_code];
	if (val === undefined || val === null) val = 0;
	const threshold = cond.threshold_value;
	switch (cond.operator) {
		case "GTE":
			return val >= threshold;
		case "LTE":
			return val <= threshold;
		case "GT":
			return val > threshold;
		case "LT":
			return val < threshold;
		default:
			return val >= threshold;
	}
}

function checkConditionGroup(
	group: RewardConditionGroup,
	metrics: Record<string, number>
): boolean {
	return group.conditions.every((c) => checkCondition(c, metrics));
}

// ===== 阶梯匹配（整额匹配）=====

function matchTiers(
	rule: SalaryRuleConfig,
	tiers: RuleTierDetail[],
	metricValue: number
): RewardTierMatch[] {
	const matches: RewardTierMatch[] = [];
	const sortedTiers = [...tiers].sort(
		(a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
	);

	for (const tier of sortedTiers) {
		const min = Number(tier.min_val ?? 0);
		const max =
			tier.max_val !== null && tier.max_val !== undefined
				? Number(tier.max_val)
				: null;

		// 左闭右开 [min, max)
		const inRange =
			metricValue >= min && (max === null || metricValue < max);
		if (!inRange) continue;

		let rewardAmount = 0;
		if (tier.reward_type === "FIXED_AMOUNT") {
			rewardAmount = Number(tier.reward_value);
		} else if (
			tier.reward_type === "PERCENTAGE" ||
			tier.reward_type === "UNIT_PRICE"
		) {
			rewardAmount = metricValue * Number(tier.reward_value);
		}

		const rangeText =
			max === null
				? `[${min.toLocaleString()}, ∞)`
				: `[${min.toLocaleString()}, ${max.toLocaleString()})`;

		matches.push({
			tier_detail_id: tier.detail_id!,
			min_val: min,
			max_val: max,
			reward_type: tier.reward_type as RewardType,
			reward_value: Number(tier.reward_value),
			metric_value: round2(metricValue),
			reward_amount: round2(rewardAmount),
			range_text: rangeText,
		});
		break; // 整额匹配：只取第一个命中的区间
	}

	return matches;
}

// ===== 类型定义 =====

// import_daily_data 实际字段
export interface DailyDataRow {
	employee_id: string;
	stage: string;
	date: string;
	recovered_amount?: number | string;
	recovered_orders?: number;
	target_recovery_rate?: number | string;
	amount_achievement_rate?: number | string;
	total_orders?: number;
	total_amount?: number | string;
}

export interface RewardEngineInput {
	dailyData: DailyDataRow[];
	rules: SalaryRuleConfig[];
	tiers: RuleTierDetail[];
	conditionGroups: RewardConditionGroup[];
	conditionDetails: RewardCondition[];
	empDeptMap: Map<string, string | null>;
	// 阶段合并组支持
	stageGroups?: StageGroup[];
	// 员工 → 合并组名列表映射（新）
	empGroupNames?: Map<string, string[]>;
}

export interface RewardEngineOutput {
	dailySettlements: WeeklyRewardSettlement[];
	weeklySettlements: WeeklyRewardSettlement[];
}

// ===== 辅助：字段转数值 =====
function toNum(v: any, def = 0): number {
	if (v === undefined || v === null || v === "") return def;
	const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
	return isNaN(n) ? def : n;
}

// ===== 主引擎 =====

export function calculateRewards(input: RewardEngineInput): RewardEngineOutput {
	const { dailyData, rules, tiers, conditionGroups, conditionDetails,
		empDeptMap, stageGroups = [], empGroupNames = new Map() } = input;

	// 构建合并组名 → 原始阶段集合
	const groupMembersByLabel = new Map<string, Set<string>>(); // T2组 → {逾4-7, 逾8-15, 逾16-30}
	for (const g of stageGroups) {
		groupMembersByLabel.set(g.group_name, new Set(g.stage_names));
	}

	// 构建员工 → 虚拟阶段列表（合并组名 + 独立阶段名）
	// 虚拟阶段 label = 规则匹配用的 stage_name
	const empVirtualStages = new Map<string, string[]>();
	const dailyByEmp = new Map<string, DailyDataRow[]>();
	for (const row of dailyData) {
		const list = dailyByEmp.get(row.employee_id) ?? [];
		list.push(row);
		dailyByEmp.set(row.employee_id, list);
	}
	for (const [empId, rows] of dailyByEmp) {
		const dataStages = new Set(rows.map((r) => r.stage));
		const virtualStages = new Set<string>();

		// 该员工引用的合并组
		const myGroupNames = empGroupNames.get(empId) ?? [];
		const myGroupLabels = new Set<string>();
		for (const gname of myGroupNames) {
			const members = groupMembersByLabel.get(gname);
			if (members) {
				myGroupLabels.add(gname);
				virtualStages.add(gname);
			}
		}

		// 独立阶段（数据里有，且不在任何合并组内）
		for (const s of dataStages) {
			const coveredByMerged = [...myGroupLabels].some((gl) =>
				groupMembersByLabel.get(gl)?.has(s)
			);
			if (!coveredByMerged) {
				virtualStages.add(s);
			}
		}

		empVirtualStages.set(empId, [...virtualStages]);
	}

	// 条件组按 rule_id 索引
	const groupsByRuleId = new Map<number, RewardConditionGroup[]>();
	for (const g of conditionGroups) {
		const gWithConditions: RewardConditionGroup = {
			...g,
			conditions: conditionDetails
				.filter((c) => c.group_id === g.id)
				.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
		};
		const list = groupsByRuleId.get(g.rule_id) ?? [];
		list.push(gWithConditions);
		groupsByRuleId.set(g.rule_id, list);
	}

	// 规则按 dept + stage + type 索引
	const rulesByKey = new Map<string, SalaryRuleConfig[]>();
	for (const r of rules) {
		const key = `${r.dept_name ?? ""}|${r.stage_name}|${r.rule_type}`;
		const list = rulesByKey.get(key) ?? [];
		list.push(r);
		rulesByKey.set(key, list);
	}

	// 阶梯按 rule_id 索引
	const tiersByRuleId = new Map<number, RuleTierDetail[]>();
	for (const t of tiers) {
		const list = tiersByRuleId.get(t.rule_id) ?? [];
		list.push(t);
		tiersByRuleId.set(t.rule_id, list);
	}

	const findMatchingRules = (
		deptName: string | null,
		stage: string,
		ruleType: RuleType
	): SalaryRuleConfig[] => {
		const results: SalaryRuleConfig[] = [];
		const tryKeys = [
			`${deptName ?? ""}|${stage}|${ruleType}`,
			`${deptName ?? ""}|ALL|${ruleType}`,
			`|${stage}|${ruleType}`,
			`|ALL|${ruleType}`,
		];
		for (const k of tryKeys) {
			results.push(...(rulesByKey.get(k) ?? []));
		}
		const seen = new Set<number>();
		return results.filter((r) => {
			if (seen.has(r.rule_id)) return false;
			seen.add(r.rule_id);
			return true;
		});
	};

	// ===== 虚拟阶段的数据聚合 =====
	// 把 (empId, virtualStage, date) 的数据准备好
	// 返回一个迭代器：对每个虚拟阶段，给出聚合后的 DailyDataRow[]

	// 构建：empId → virtualStage → date → DailyDataRow[]（聚合后）
	function getVirtualStageDailyRows(
		empId: string,
		virtualStage: string
	): DailyDataRow[] {
		const allRows = dailyByEmp.get(empId) ?? [];
		const sourceStages = groupMembersByLabel.get(virtualStage);
		const raw: DailyDataRow[] = sourceStages
			? allRows.filter((r) => sourceStages.has(r.stage))
			: allRows.filter((r) => r.stage === virtualStage);

		// 按 date 汇总
		const byDate = new Map<string, DailyDataRow>();
		for (const row of raw) {
			const existing = byDate.get(row.date);
			if (!existing) {
				byDate.set(row.date, { ...row, stage: virtualStage });
			} else {
				// 合并同一虚拟阶段同一天的多行
				existing.recovered_orders =
					(toNum(existing.recovered_orders) || 0) +
					(toNum(row.recovered_orders) || 0);
				existing.recovered_amount = round2(
					toNum(existing.recovered_amount) +
						toNum(row.recovered_amount)
				);
				existing.total_orders =
					(toNum(existing.total_orders) || 0) +
					(toNum(row.total_orders) || 0);
				existing.total_amount = round2(
					toNum(existing.total_amount) +
						toNum(row.total_amount)
				);
				// 比率类：按金额加权平均
				const oldAmt = toNum(existing.recovered_amount);
				const newAmt = toNum(row.recovered_amount);
				const totalAmt = oldAmt + newAmt;
				if (totalAmt > 0) {
					const oldRate = toNum(existing.target_recovery_rate);
					const newRate = toNum(row.target_recovery_rate);
					existing.target_recovery_rate = round2(
						(oldRate * oldAmt + newRate * newAmt) / totalAmt
					);
					const oldARate = toNum(existing.amount_achievement_rate);
					const newARate = toNum(row.amount_achievement_rate);
					existing.amount_achievement_rate = round2(
						(oldARate * oldAmt + newARate * newAmt) / totalAmt
					);
				}
			}
		}
		return [...byDate.values()];
	}

	// ===== 日奖励（按虚拟阶段）=====
	const dailySettlements: WeeklyRewardSettlement[] = [];
	const dailyRankCandidates: RankCandidate[] = [];

	for (const [empId, virtualStages] of empVirtualStages) {
		const deptName = empDeptMap.get(empId) ?? null;
		for (const virtualStage of virtualStages) {
			const rows = getVirtualStageDailyRows(empId, virtualStage);
			if (rows.length === 0) continue;

			// 按日期聚合（虚拟阶段跨多原始阶段后，同一天可能多组行）
			const byDate = new Map<string, DailyDataRow[]>();
			for (const r of rows) {
				const list = byDate.get(r.date) ?? [];
				list.push(r);
				byDate.set(r.date, list);
			}

			for (const [date, dateRows] of byDate) {
				const totalAmount = dateRows.reduce((s, r) => s + toNum(r.recovered_amount), 0);
				const totalOrders = dateRows.reduce((s, r) => s + toNum(r.recovered_orders), 0);
				const totalTargetAmount = dateRows.reduce((s, r) => s + toNum(r.total_amount), 0);
				const totalTargetOrders = dateRows.reduce((s, r) => s + toNum(r.total_orders), 0);
				// ⚠️ 直接从精确汇总数算比率，不依赖 Excel 导入的 target_recovery_rate（有四舍五入误差）
				const orderRate = totalTargetOrders > 0 ? (totalOrders / totalTargetOrders) * 100 : 0;
				const amtRate = totalTargetAmount > 0 ? (totalAmount / totalTargetAmount) * 100 : 0;

				const metrics: Record<string, number> = {
					ORDER_RATE: round2(orderRate),
					AMOUNT_RATE: round2(amtRate),
					RATE: round2(orderRate),
					AMOUNT: round2(totalAmount),
					ORDERS: totalOrders,
					TOTAL_ORDERS: totalTargetOrders,
					TOTAL_AMOUNT: round2(totalTargetAmount),
					TARGET_ORDERS: totalTargetOrders,
					TARGET_AMOUNT: round2(totalTargetAmount),
				};

				const matchingRules = findMatchingRules(deptName, virtualStage, "DAILY_REWARD_TIER");

				let totalReward = 0;
				let allMatches: RewardTierMatch[] = [];
				const rowKey = `${empId}|${virtualStage}|${date}`;

				for (const rule of matchingRules) {
					const groups = groupsByRuleId.get(rule.rule_id) ?? [];
					const ruleTiers = tiersByRuleId.get(rule.rule_id) ?? [];
					if (ruleTiers.length === 0) continue;

					let passed = false;
					if (groups.length === 0) passed = true;
					else passed = groups.some((g) => checkConditionGroup(g, metrics));
					if (!passed) continue;

					const metricKey = (rule.metric as string) || "AMOUNT";
					const metricVal = metrics[metricKey] ?? 0;
					const matches = matchTiers(rule, ruleTiers, metricVal);
					const rewardAmount = matches.reduce((s, m) => s + m.reward_amount, 0);

					if (rule.rank_best_by) {
						const primaryVal = metrics[rule.rank_best_by] ?? 0;
						const tieVal = rule.rank_tiebreaker ? (metrics[rule.rank_tiebreaker] ?? 0) : 0;
						const scope = rule.rank_scope ?? "DAY_STAGE";
						dailyRankCandidates.push({
							rowKey, ruleId: rule.rule_id, primaryVal, tiebreakerVal: tieVal,
							periodKey: date,
							scopeKey: computeScopeKey(scope as RankScope, date, virtualStage, deptName),
							tierReward: rewardAmount, tierMatches: matches,
						});
					} else {
						allMatches.push(...matches);
						totalReward += rewardAmount;
					}
				}

				dailySettlements.push({
					period: "DAILY", period_key: date, employee_id: empId,
					dept_name: deptName, stage: virtualStage,
					total_reward: round2(totalReward),
					tier_detail: allMatches.length > 0 ? allMatches : null,
					status: "DRAFT",
				});
			}
		}
	}

	// === 日奖励排名后处理 ===
	if (dailyRankCandidates.length > 0) {
		const winners = runRanking(dailyRankCandidates);
		mergeRankWinners(dailySettlements, dailyRankCandidates, winners);
	}

	// ===== 周奖励（按虚拟阶段）=====
	const weeklySettlements: WeeklyRewardSettlement[] = [];
	const weeklyRankCandidates: RankCandidate[] = [];

	for (const [empId, virtualStages] of empVirtualStages) {
		const deptName = empDeptMap.get(empId) ?? null;
		for (const virtualStage of virtualStages) {
			const rows = getVirtualStageDailyRows(empId, virtualStage);
			if (rows.length === 0) continue;

			const weeklyByIso = new Map<string, DailyDataRow[]>();
			for (const row of rows) {
				const { weekIso } = getISOWeek(row.date);
				const list = weeklyByIso.get(weekIso) ?? [];
				list.push(row);
				weeklyByIso.set(weekIso, list);
			}

			for (const [weekIso, weekRows] of weeklyByIso) {
				const weekAmount = weekRows.reduce((s, r) => s + toNum(r.recovered_amount), 0);
				const weekOrders = weekRows.reduce((s, r) => s + toNum(r.recovered_orders), 0);
				const weekTargetOrders = weekRows.reduce((s, r) => s + toNum(r.total_orders), 0);
				const weekTargetAmount = weekRows.reduce((s, r) => s + toNum(r.total_amount), 0);
				// ⚠️ 直接从精确汇总数算比率
				const weekOrderRate = weekTargetOrders > 0 ? (weekOrders / weekTargetOrders) * 100 : 0;
				const weekAmtRate = weekTargetAmount > 0 ? (weekAmount / weekTargetAmount) * 100 : 0;

				const metrics: Record<string, number> = {
					WEEK_ORDER_RATE: round2(weekOrderRate),
					WEEK_AMOUNT_RATE: round2(weekAmtRate),
					WEEK_RATE: round2(weekOrderRate),
					WEEK_AMOUNT: round2(weekAmount),
					WEEK_ORDERS: weekOrders,
					WEEK_TOTAL_ORDERS: weekTargetOrders,
					WEEK_TOTAL_AMOUNT: round2(weekTargetAmount),
				};

				const matchingRules = findMatchingRules(deptName, virtualStage, "WEEKLY_REWARD_TIER");

				let totalReward = 0;
				let allMatches: RewardTierMatch[] = [];
				const rowKey = `${empId}|${virtualStage}|${weekIso}`;

				for (const rule of matchingRules) {
					const groups = groupsByRuleId.get(rule.rule_id) ?? [];
					const ruleTiers = tiersByRuleId.get(rule.rule_id) ?? [];
					if (ruleTiers.length === 0) continue;

					let passed = false;
					if (groups.length === 0) passed = true;
					else passed = groups.some((g) => checkConditionGroup(g, metrics));
					if (!passed) continue;

					const metricKey = (rule.metric as string) || "WEEK_AMOUNT";
					const metricVal = metrics[metricKey] ?? 0;
					const matches = matchTiers(rule, ruleTiers, metricVal);
					const rewardAmount = matches.reduce((s, m) => s + m.reward_amount, 0);

					if (rule.rank_best_by) {
						const primaryVal = metrics[rule.rank_best_by] ?? 0;
						const tieVal = rule.rank_tiebreaker ? (metrics[rule.rank_tiebreaker] ?? 0) : 0;
						const scope = rule.rank_scope ?? "WEEK_STAGE";
						weeklyRankCandidates.push({
							rowKey, ruleId: rule.rule_id, primaryVal, tiebreakerVal: tieVal,
							periodKey: weekIso,
							scopeKey: computeScopeKey(scope as RankScope, weekIso, virtualStage, deptName),
							tierReward: rewardAmount, tierMatches: matches,
						});
					} else {
						allMatches.push(...matches);
						totalReward += rewardAmount;
					}
				}

				weeklySettlements.push({
					period: "WEEKLY", period_key: weekIso, employee_id: empId,
					dept_name: deptName, stage: virtualStage,
					total_reward: round2(totalReward),
					tier_detail: allMatches.length > 0 ? allMatches : null,
					status: "DRAFT",
				});
			}
		}
	}

	// === 周奖励排名后处理 ===
	if (weeklyRankCandidates.length > 0) {
		const winners = runRanking(weeklyRankCandidates);
		mergeRankWinners(weeklySettlements, weeklyRankCandidates, winners);
	}

	return { dailySettlements, weeklySettlements };
}
