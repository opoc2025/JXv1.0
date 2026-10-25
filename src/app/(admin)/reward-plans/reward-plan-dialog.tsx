"use client";

import { useEffect, useState } from "react";
import { X, Plus, Trash2 } from "lucide-react";
import { REWARD_RULE_TYPES, RULE_TYPE_LABEL, REWARD_LABEL } from "@/lib/rule-labels";

interface Condition {
	id?: number;
	metric_code: string;
	operator: string;
	threshold_value: number;
	sort_order: number;
}

interface ConditionGroup {
	id?: number;
	sort_order: number;
	conditions: Condition[];
}

interface Tier {
	detail_id?: number;
	min_val: number;
	max_val: number | null;
	reward_type: string;
	reward_value: number;
	sort_order: number;
}

interface Initial {
	rule_id: number;
	rule_name: string;
	dept_name: string | null;
	stage_name: string;
	rule_type: string;
	metric: string | null;
	enabled: boolean;
	// 排名择优
	rank_scope?: string | null;
	rank_best_by?: string | null;
	rank_tiebreaker?: string | null;
	rule_tier_detail: any[];
	salary_condition_group: any[];
}

// 日奖励可用指标
const DAILY_METRICS = [
	{ code: "ORDER_RATE", label: "订单回收率 (%)" },
	{ code: "AMOUNT_RATE", label: "金额回收率 (%)" },
	{ code: "AMOUNT", label: "回款金额 (฿)" },
	{ code: "ORDERS", label: "回款订单数" },
	{ code: "TOTAL_ORDERS", label: "分配订单总数 (门槛)" },
	{ code: "TOTAL_AMOUNT", label: "分配订单金额 (门槛)" },
];

// 周奖励可用指标
const WEEKLY_METRICS = [
	{ code: "WEEK_ORDER_RATE", label: "周订单回收率 (%)" },
	{ code: "WEEK_AMOUNT_RATE", label: "周金额回收率 (%)" },
	{ code: "WEEK_AMOUNT", label: "周回款金额 (฿)" },
	{ code: "WEEK_ORDERS", label: "周回款订单数" },
	{ code: "WEEK_TOTAL_ORDERS", label: "周分配订单总数 (门槛)" },
	{ code: "WEEK_TOTAL_AMOUNT", label: "周分配订单金额 (门槛)" },
];

// 条件可用指标（和阶梯指标共用，但也用于门槛判断）
const ALL_METRICS = [...DAILY_METRICS, ...WEEKLY_METRICS];

const OPERATORS = [
	{ v: "GTE", l: "≥" },
	{ v: "GT", l: ">" },
	{ v: "LTE", l: "≤" },
	{ v: "LT", l: "<" },
];

const REWARD_TYPES = Object.entries(REWARD_LABEL).map(([v, l]) => ({ v, l }));

export function RewardPlanDialog({
	open,
	onClose,
	onSaved,
	initial,
}: {
	open: boolean;
	onClose: () => void;
	onSaved: () => void;
	initial: Initial | null;
}) {
	const [ruleName, setRuleName] = useState("");
	const [ruleType, setRuleType] = useState<string>("DAILY_REWARD_TIER");
	const [deptName, setDeptName] = useState("");
	const [stageName, setStageName] = useState("ALL");
	const [metric, setMetric] = useState("AMOUNT");
	const [enabled, setEnabled] = useState(true);
	const [tiers, setTiers] = useState<Tier[]>([]);
	const [groups, setGroups] = useState<ConditionGroup[]>([]);
	// 排名择优
	const [enableRanking, setEnableRanking] = useState(false);
	const [rankScope, setRankScope] = useState<string>("DAY_STAGE");
	const [rankBestBy, setRankBestBy] = useState<string>("ORDERS");
	const [rankTiebreaker, setRankTiebreaker] = useState<string>("AMOUNT");
	const [depts, setDepts] = useState<string[]>([]);
	const [stages, setStages] = useState<string[]>([]);
	const [stageGroups, setStageGroups] = useState<{ group_id: number; group_name: string; stage_names: string[]; enabled?: boolean }[]>([]);
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		if (!open) return;
		// 加载部门 + 阶段 + 合并组
		fetch("/api/employees")
			.then((r) => r.json())
			.then((j) => {
				const ds = Array.from(
					new Set((j.data ?? []).map((e: any) => e.department).filter(Boolean))
				) as string[];
				setDepts(ds);
			});
		fetch("/api/stages")
			.then((r) => r.json())
			.then((j) => {
				const ss = (j.data ?? []).map((s: any) => s.stage_name);
				setStages(ss);
			});
		fetch("/api/stage-groups")
			.then((r) => r.json())
			.then((j) => {
				setStageGroups((j.data ?? []).filter((g: any) => g.enabled !== false));
			});

		if (initial) {
			setRuleName(initial.rule_name);
			setRuleType(initial.rule_type);
			setDeptName(initial.dept_name ?? "");
			setStageName(initial.stage_name);
			setMetric(initial.metric ?? "AMOUNT");
			setEnabled(initial.enabled);
			// 排名择优
			const hasRank = !!initial.rank_best_by;
			setEnableRanking(hasRank);
			setRankScope(initial.rank_scope ?? (initial.rule_type === "WEEKLY_REWARD_TIER" ? "WEEK_STAGE" : "DAY_STAGE"));
			setRankBestBy(initial.rank_best_by ?? (initial.rule_type === "WEEKLY_REWARD_TIER" ? "WEEK_ORDERS" : "ORDERS"));
			setRankTiebreaker(initial.rank_tiebreaker ?? (initial.rule_type === "WEEKLY_REWARD_TIER" ? "WEEK_AMOUNT" : "AMOUNT"));
			setTiers(
				(initial.rule_tier_detail ?? []).map((t: any) => ({
					detail_id: t.detail_id,
					min_val: Number(t.min_val ?? 0),
					max_val: t.max_val !== null && t.max_val !== undefined ? Number(t.max_val) : null,
					reward_type: t.reward_type,
					reward_value: Number(t.reward_value),
					sort_order: t.sort_order ?? 0,
				}))
			);
			setGroups(
				(initial.salary_condition_group ?? []).map((g: any) => ({
					id: g.id,
					sort_order: g.sort_order ?? 0,
					conditions:
						g.conditions?.map((c: any) => ({
							id: c.id,
							metric_code: c.metric_code,
							operator: c.operator ?? "GTE",
							threshold_value: Number(c.threshold_value),
							sort_order: c.sort_order ?? 0,
						})) ?? [],
				}))
			);
		} else {
			setRuleName("");
			setRuleType("DAILY_REWARD_TIER");
			setDeptName("");
			setStageName("ALL");
			setMetric("AMOUNT");
			setEnabled(true);
			setEnableRanking(false);
			setRankScope("DAY_STAGE");
			setRankBestBy("ORDERS");
			setRankTiebreaker("AMOUNT");
			setTiers([{ min_val: 0, max_val: null, reward_type: "FIXED_AMOUNT", reward_value: 0, sort_order: 0 }]);
			setGroups([]);
		}
	}, [open, initial]);

	const metricOptions = ruleType === "DAILY_REWARD_TIER" ? DAILY_METRICS : WEEKLY_METRICS;

	function addTier() {
		const last = tiers[tiers.length - 1];
		setTiers([
			...tiers,
			{
				min_val: last ? (last.max_val ?? last.min_val) : 0,
				max_val: null,
				reward_type: "FIXED_AMOUNT",
				reward_value: 0,
				sort_order: tiers.length,
			},
		]);
	}

	function updateTier(i: number, field: keyof Tier, val: any) {
		const next = [...tiers];
		(next[i] as any)[field] = val;
		setTiers(next);
	}

	function removeTier(i: number) {
		setTiers(tiers.filter((_, idx) => idx !== i));
	}

	function addGroup() {
		setGroups([...groups, { sort_order: groups.length, conditions: [] }]);
	}

	function removeGroup(gi: number) {
		setGroups(groups.filter((_, i) => i !== gi));
	}

	function addCondition(gi: number) {
		const next = [...groups];
		next[gi].conditions.push({
			metric_code: metricOptions[0].code,
			operator: "GTE",
			threshold_value: 0,
			sort_order: next[gi].conditions.length,
		});
		setGroups(next);
	}

	function updateCondition(gi: number, ci: number, field: keyof Condition, val: any) {
		const next = [...groups];
		(next[gi].conditions[ci] as any)[field] = val;
		setGroups(next);
	}

	function removeCondition(gi: number, ci: number) {
		const next = [...groups];
		next[gi].conditions.splice(ci, 1);
		setGroups(next);
	}

	async function handleSave() {
		setSaving(true);
		try {
			// 一次性发完整 payload（主表 + tiers + conditions + rank）
			const fullPayload = {
				rule_name: ruleName,
				dept_name: deptName || null,
				stage_name: stageName,
				rule_type: ruleType,
				metric,
				enabled,
				rank_scope: enableRanking ? rankScope : null,
				rank_best_by: enableRanking ? rankBestBy : null,
				rank_tiebreaker: enableRanking ? rankTiebreaker : null,
				tiers: tiers.map((t, i) => ({ ...t, sort_order: i })),
				conditions: groups.map((g, gi) => ({
					sort_order: gi,
					conditions: g.conditions.map((c, ci) => ({
						metric_code: c.metric_code,
						operator: c.operator,
						threshold_value: c.threshold_value,
						sort_order: ci,
					})),
				})),
			};

			const url = initial ? `/api/rules/${initial.rule_id}` : "/api/rules";
			const method = initial ? "PUT" : "POST";
			const r = await fetch(url, {
				method,
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(fullPayload),
			});
			const j = await r.json();
			if (!j.success) throw new Error(j.message ?? "保存失败");

			onSaved();
		} catch (e: any) {
			alert(`保存失败: ${e.message}`);
		} finally {
			setSaving(false);
		}
	}

	if (!open) return null;

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
			<div className="max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-lg bg-white shadow-xl flex flex-col">
				<div className="flex items-center justify-between border-b border-border px-5 py-3">
					<div>
						<div className="text-[15px] font-bold">
							{initial ? "编辑" : "新建"}奖励方案
						</div>
						<div className="text-[11px] text-muted-foreground mt-0.5">
							周期: {ruleType === "DAILY_REWARD_TIER" ? "日奖励" : "周奖励"} ·
							条件组（组间 OR，组内 AND）· 阶梯整额匹配
						</div>
					</div>
					<button
						onClick={onClose}
						className="rounded p-1 hover:bg-muted"
					>
						<X className="w-4 h-4" />
					</button>
				</div>

				<div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
					{/* 基础信息 */}
					<section>
						<div className="text-[13px] font-semibold mb-2">
							① 基础信息
						</div>
						<div className="grid grid-cols-2 gap-3 text-[12.5px]">
							<div>
								<label className="text-muted-foreground">
									方案名称
								</label>
								<input
									value={ruleName}
									onChange={(e) => setRuleName(e.target.value)}
									className="w-full mt-1 rounded border border-border px-2 py-1.5"
									placeholder="如：X2P日回收奖励"
								/>
							</div>
							<div>
								<label className="text-muted-foreground">奖励周期</label>
								<select
									value={ruleType}
									onChange={(e) => {
										setRuleType(e.target.value);
										setMetric(
											e.target.value === "DAILY_REWARD_TIER"
												? "AMOUNT"
												: "WEEK_AMOUNT"
										);
									}}
									className="w-full mt-1 rounded border border-border px-2 py-1.5"
								>
									{REWARD_RULE_TYPES.map((t) => (
										<option key={t} value={t}>
											{RULE_TYPE_LABEL[t as keyof typeof RULE_TYPE_LABEL]}
										</option>
									))}
								</select>
							</div>
							<div>
								<label className="text-muted-foreground">适用部门</label>
								<select
									value={deptName}
									onChange={(e) => setDeptName(e.target.value)}
									className="w-full mt-1 rounded border border-border px-2 py-1.5"
								>
									<option value="">全部部门（空）</option>
									{depts.map((d) => (
										<option key={d} value={d}>
											{d}
										</option>
									))}
								</select>
							</div>
							<div>
								<label className="text-muted-foreground">适用阶段</label>
								<select
									value={stageName}
									onChange={(e) => setStageName(e.target.value)}
									className="w-full mt-1 rounded border border-border px-2 py-1.5"
								>
									<option value="ALL">ALL（全部阶段通用）</option>
									{stageGroups.length > 0 && (
										<optgroup label="合并组">
											{stageGroups.map((g) => (
												<option key={g.group_id} value={g.group_name}>
													{g.group_name} ({g.stage_names.join(' + ')})
												</option>
											))}
										</optgroup>
									)}
									<optgroup label="独立阶段">
										{stages.map((s) => (
											<option key={s} value={s}>
												{s}
											</option>
										))}
									</optgroup>
								</select>
							</div>
							<div>
								<label className="text-muted-foreground">匹配阶梯的指标</label>
								<select
									value={metric}
									onChange={(e) => setMetric(e.target.value)}
									className="w-full mt-1 rounded border border-border px-2 py-1.5"
								>
									{metricOptions.map((m) => (
										<option key={m.code} value={m.code}>
											{m.label}
										</option>
									))}
								</select>
							</div>
							<div>
								<label className="text-muted-foreground">状态</label>
								<label className="flex items-center gap-2 mt-1.5">
									<input
										type="checkbox"
										checked={enabled}
										onChange={(e) => setEnabled(e.target.checked)}
									/>
									启用
								</label>
							</div>
						</div>
					</section>

					{/* 条件组 */}
					<section>
						<div className="flex items-center justify-between mb-2">
							<div className="text-[13px] font-semibold">
								② 条件组（可选，组间 OR，任一满足即匹配）
							</div>
							<button
								onClick={addGroup}
								className="rounded border border-border px-2 py-1 text-[11px] hover:bg-muted flex items-center gap-1"
							>
								<Plus className="w-3 h-3" /> 添加条件组
							</button>
						</div>
						{groups.length === 0 && (
							<div className="rounded border border-border bg-muted/20 p-3 text-[12px] text-muted-foreground">
								无条件组 → 直接用指标值匹配阶梯
							</div>
						)}
						{groups.map((g, gi) => (
							<div
								key={gi}
								className="rounded border border-border p-3 mb-2 bg-muted/10"
							>
								<div className="flex items-center justify-between mb-2">
									<div className="text-[12px] font-semibold">
										条件组 {gi + 1}（全部满足 AND）
									</div>
									<div className="flex gap-2">
										<button
											onClick={() => addCondition(gi)}
											className="rounded border border-border px-2 py-0.5 text-[11px] hover:bg-white flex items-center gap-1"
										>
											<Plus className="w-3 h-3" /> 加条件
										</button>
										<button
											onClick={() => removeGroup(gi)}
											className="rounded border border-red-300 text-red-500 px-2 py-0.5 text-[11px] hover:bg-red-50"
										>
											删除组
										</button>
									</div>
								</div>
								{g.conditions.map((c, ci) => (
									<div
										key={ci}
										className="grid grid-cols-[1fr_80px_120px_32px] gap-2 items-end text-[12px] mb-1"
									>
										<select
											value={c.metric_code}
											onChange={(e) =>
												updateCondition(gi, ci, "metric_code", e.target.value)
											}
											className="rounded border border-border px-2 py-1"
										>
											{ALL_METRICS.map((m) => (
												<option key={m.code} value={m.code}>
													{m.label}
												</option>
											))}
										</select>
										<select
											value={c.operator}
											onChange={(e) =>
												updateCondition(gi, ci, "operator", e.target.value)
											}
											className="rounded border border-border px-2 py-1"
										>
											{OPERATORS.map((o) => (
												<option key={o.v} value={o.v}>
													{o.l}
												</option>
											))}
										</select>
										<input
											type="number"
											value={c.threshold_value}
											onChange={(e) =>
												updateCondition(gi, ci, "threshold_value", Number(e.target.value))
											}
											className="rounded border border-border px-2 py-1"
											placeholder="门槛值"
										/>
										<button
											onClick={() => removeCondition(gi, ci)}
											className="rounded p-1 text-red-500 hover:bg-red-50"
										>
											<Trash2 className="w-3 h-3" />
										</button>
									</div>
								))}
								{g.conditions.length === 0 && (
									<div className="text-[11px] text-muted-foreground italic">
										空组 = 直接匹配
									</div>
								)}
							</div>
						))}
					</section>

					{/* 阶梯 */}
					<section>
						<div className="flex items-center justify-between mb-2">
							<div className="text-[13px] font-semibold">
								③ 阶梯（按「匹配阶梯的指标」整额匹配）
							</div>
							<button
								onClick={addTier}
								className="rounded border border-border px-2 py-1 text-[11px] hover:bg-muted flex items-center gap-1"
							>
								<Plus className="w-3 h-3" /> 加一档
							</button>
						</div>
						<div className="overflow-hidden rounded border border-border">
							<table className="w-full text-[12px]">
								<thead className="bg-muted/30">
									<tr>
										<th className="px-2 py-1.5 text-left">下限 min</th>
										<th className="px-2 py-1.5 text-left">上限 max (空=∞)</th>
										<th className="px-2 py-1.5 text-left">奖励类型</th>
										<th className="px-2 py-1.5 text-left">奖励值</th>
										<th className="px-2 py-1.5 w-8"></th>
									</tr>
								</thead>
								<tbody>
									{tiers.map((t, i) => (
										<tr key={i} className="border-t border-border">
											<td className="px-1 py-1">
												<input
													type="number"
													value={t.min_val}
													onChange={(e) => updateTier(i, "min_val", Number(e.target.value))}
													className="w-full rounded border border-border px-1.5 py-0.5"
												/>
											</td>
											<td className="px-1 py-1">
												<input
													type="number"
													value={t.max_val ?? ""}
													placeholder="∞"
													onChange={(e) =>
														updateTier(
															i,
															"max_val",
															e.target.value === "" ? null : Number(e.target.value)
														)
													}
													className="w-full rounded border border-border px-1.5 py-0.5"
												/>
											</td>
											<td className="px-1 py-1">
												<select
													value={t.reward_type}
													onChange={(e) => updateTier(i, "reward_type", e.target.value)}
													className="w-full rounded border border-border px-1.5 py-0.5"
												>
													{REWARD_TYPES.map((r) => (
														<option key={r.v} value={r.v}>
															{r.l}
														</option>
													))}
												</select>
											</td>
											<td className="px-1 py-1">
												<input
													type="number"
													value={t.reward_value}
													onChange={(e) => updateTier(i, "reward_value", Number(e.target.value))}
													className="w-full rounded border border-border px-1.5 py-0.5"
												/>
											</td>
											<td className="px-1 py-1 text-center">
												<button
													onClick={() => removeTier(i)}
													className="rounded p-1 text-red-500 hover:bg-red-50"
												>
													<Trash2 className="w-3 h-3" />
												</button>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</section>

					{/* 排名择优 */}
					<section>
						<div className="text-[13px] font-semibold mb-2">
							④ 排名择优（可选：每个分组只给最优者发奖）
						</div>
						<div className="rounded border border-border p-3 text-[12.5px] space-y-3 bg-muted/5">
							<label className="flex items-center gap-2 cursor-pointer">
								<input
									type="checkbox"
									checked={enableRanking}
									onChange={(e) => setEnableRanking(e.target.checked)}
								/>
								<span>
									启用排名择优 — 满足条件组后，在指定分组内按指标排序，只给第 1 名发奖
								</span>
							</label>
							{enableRanking && (
								<div className="grid grid-cols-3 gap-3 pt-2 border-t border-border">
									<div>
										<label className="text-muted-foreground">择优范围</label>
										<select
											value={rankScope}
											onChange={(e) => setRankScope(e.target.value)}
											className="w-full mt-1 rounded border border-border px-2 py-1.5"
										>
											{ruleType === "DAILY_REWARD_TIER" ? (
												<>
													<option value="DAY_STAGE">同天同阶段</option>
													<option value="DAY_DEPT">同天同部门</option>
													<option value="DAY_ALL">同天全公司</option>
												</>
											) : (
												<>
													<option value="WEEK_STAGE">同周同阶段</option>
													<option value="WEEK_DEPT">同周同部门</option>
													<option value="WEEK_ALL">同周全公司</option>
												</>
											)}
										</select>
									</div>
									<div>
										<label className="text-muted-foreground">主排名指标（降序）</label>
										<select
											value={rankBestBy}
											onChange={(e) => setRankBestBy(e.target.value)}
											className="w-full mt-1 rounded border border-border px-2 py-1.5"
										>
											{metricOptions.map((m) => (
												<option key={m.code} value={m.code}>
													{m.label}
												</option>
											))}
										</select>
									</div>
									<div>
										<label className="text-muted-foreground">平票比较指标（降序）</label>
										<select
											value={rankTiebreaker}
											onChange={(e) => setRankTiebreaker(e.target.value)}
											className="w-full mt-1 rounded border border-border px-2 py-1.5"
										>
											{metricOptions.map((m) => (
												<option key={m.code} value={m.code}>
													{m.label}
												</option>
											))}
										</select>
									</div>
								</div>
							)}
						</div>
					</section>
				</div>

				<div className="flex justify-end gap-2 border-t border-border px-5 py-3">
					<button
						onClick={onClose}
						className="rounded border border-border px-4 py-1.5 text-[12.5px] hover:bg-muted"
					>
						取消
					</button>
					<button
						onClick={handleSave}
						disabled={saving || !ruleName || tiers.length === 0}
						className="rounded bg-primary px-4 py-1.5 text-[12.5px] text-white font-semibold hover:bg-primary/90 disabled:opacity-50"
					>
						{saving ? "保存中..." : "保存"}
					</button>
				</div>
			</div>
		</div>
	);
}
