"use client";

import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, Gift, Calendar } from "lucide-react";
import { toast } from "sonner";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { REWARD_RULE_TYPES, RULE_TYPE_LABEL } from "@/lib/rule-labels";
import { RewardPlanDialog } from "./reward-plan-dialog";

interface RuleRow {
	rule_id: number;
	rule_name: string;
	dept_name: string | null;
	stage_name: string;
	rule_type: string;
	metric: string | null;
	enabled: boolean;
	rule_tier_detail: any[];
	salary_condition_group: any[];
}

export default function RewardPlansPage() {
	const [rules, setRules] = useState<RuleRow[]>([]);
	const [loading, setLoading] = useState(true);
	const [dialogOpen, setDialogOpen] = useState(false);
	const [editing, setEditing] = useState<RuleRow | null>(null);

	useEffect(() => {
		fetchRules();
	}, []);

	async function fetchRules() {
		setLoading(true);
		const r = await fetch("/api/rules?withTiers=true");
		const j = await r.json();
		const all: RuleRow[] = j.data ?? [];
		// 只保留奖励规则类型
		const filtered = all.filter((r) =>
			REWARD_RULE_TYPES.includes(r.rule_type as any)
		);
		setRules(filtered);
		setLoading(false);
	}

	async function handleDelete(ruleId: number) {
		if (!confirm("确认删除此奖励方案？关联的阶梯和条件组也会一起删除")) return;
		const r = await fetch(`/api/rules/${ruleId}`, { method: "DELETE" });
		const j = await r.json();
		if (j.success) {
			toast.success("删除成功");
			fetchRules();
		} else {
			toast.error(j.message ?? "删除失败");
		}
	}

	return (
		<div>
			<div className="flex items-center justify-between mb-4">
				<div>
					<h1 className="text-[18px] font-bold text-foreground flex items-center gap-2">
						<Gift className="w-5 h-5 text-primary" /> 奖励方案
					</h1>
					<p className="mt-1 text-[12.5px] text-muted-foreground">
						日奖励阶梯 + 周奖励阶梯 · 独立模块 · 引擎按 ISO
						周自动汇总
					</p>
				</div>
				<button
					onClick={() => {
						setEditing(null);
						setDialogOpen(true);
					}}
					className="rounded-md bg-primary px-4 py-2 text-[13px] text-white font-semibold hover:bg-primary/90 transition-colors flex items-center gap-2"
				>
					<Plus className="w-4 h-4" /> 新建奖励方案
				</button>
			</div>

			{/* 指标说明 */}
			<div className="mb-4 rounded-md border border-border bg-white p-4 text-[12px] text-muted-foreground leading-relaxed">
				<div className="font-semibold text-foreground mb-1">📖 奖励方案说明</div>
				<strong>日奖励指标</strong>：直接从「日业务数据」当日行读取
				（订单回收率、金额回收率、回款金额、回款订单数、分配订单总数、分配金额等）
				<br />
				<strong>周奖励指标</strong>：引擎自动按 ISO
				周（周一到周日）汇总7天数据（金额求和、回收率加权平均）
				<br />
				<strong>阶梯匹配</strong>：整额匹配（落在哪个区间按哪个算一次）
				<br />
				<strong>条件组</strong>：组内全部满足（AND）、组间任一满足（OR）。
				无条件组则直接检查阶梯。
			</div>

			<div className="overflow-hidden rounded-md border border-border bg-white">
				<Table>
					<TableHeader>
						<TableRow className="bg-muted/30 text-[12.5px]">
							<TableHead className="px-3">方案名称</TableHead>
							<TableHead className="px-3">周期</TableHead>
							<TableHead className="px-3">部门</TableHead>
							<TableHead className="px-3">阶段</TableHead>
							<TableHead className="px-3">匹配指标</TableHead>
							<TableHead className="px-3">条件组</TableHead>
							<TableHead className="px-3">阶梯</TableHead>
							<TableHead className="px-3">状态</TableHead>
							<TableHead className="px-3 text-right">操作</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{loading && (
							<TableRow>
								<TableCell
									colSpan={9}
									className="px-3 py-8 text-center text-muted-foreground"
								>
									加载中...
								</TableCell>
							</TableRow>
						)}
						{!loading && rules.length === 0 && (
							<TableRow>
								<TableCell
									colSpan={9}
									className="px-3 py-8 text-center text-muted-foreground"
								>
									暂无奖励方案，点击右上角新建
								</TableCell>
							</TableRow>
						)}
						{rules.map((r) => {
							const tierCount = r.rule_tier_detail?.length ?? 0;
							const condCount =
								r.salary_condition_group?.reduce(
									(s: number, g: any) => s + (g?.conditions?.length ?? 0),
									0
								) ?? 0;
							return (
								<TableRow
									key={r.rule_id}
									className="text-[12.5px] hover:bg-muted/20"
								>
									<TableCell className="px-3 font-semibold">
										{r.rule_name}
									</TableCell>
									<TableCell className="px-3">
										<span
											className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-semibold ${
												r.rule_type === "DAILY_REWARD_TIER"
													? "bg-blue-500/10 text-blue-600"
													: "bg-emerald-500/10 text-emerald-600"
											}`}
										>
											{r.rule_type === "DAILY_REWARD_TIER" ? (
												<Calendar className="w-3 h-3" />
											) : (
												<Gift className="w-3 h-3" />
											)}
											{RULE_TYPE_LABEL[r.rule_type as keyof typeof RULE_TYPE_LABEL]}
										</span>
									</TableCell>
									<TableCell className="px-3">
										{r.dept_name ?? "全局"}
									</TableCell>
									<TableCell className="px-3">{r.stage_name}</TableCell>
									<TableCell className="px-3 font-mono text-[11px]">
										{r.metric ?? "—"}
									</TableCell>
									<TableCell className="px-3 text-muted-foreground">
										{r.salary_condition_group?.length ?? 0} 组 /{" "}
										{condCount} 条件
									</TableCell>
									<TableCell className="px-3 text-muted-foreground">
										{tierCount} 档
									</TableCell>
									<TableCell className="px-3">
										{r.enabled ? (
											<span className="rounded px-2 py-0.5 text-[11px] font-semibold bg-green-500/10 text-green-600">
												启用
											</span>
										) : (
											<span className="rounded px-2 py-0.5 text-[11px] font-semibold bg-muted text-muted-foreground">
												停用
											</span>
										)}
									</TableCell>
									<TableCell className="px-3 text-right">
										<div className="flex justify-end gap-1">
											<button
												onClick={() => {
													setEditing(r);
													setDialogOpen(true);
												}}
												className="rounded p-1 hover:bg-muted transition-colors"
												title="编辑"
											>
												<Pencil className="w-4 h-4" />
											</button>
											<button
												onClick={() => handleDelete(r.rule_id)}
												className="rounded p-1 hover:bg-red-500/10 text-red-500 transition-colors"
												title="删除"
											>
												<Trash2 className="w-4 h-4" />
											</button>
										</div>
									</TableCell>
								</TableRow>
							);
						})}
					</TableBody>
				</Table>
			</div>

			<RewardPlanDialog
				open={dialogOpen}
				onClose={() => setDialogOpen(false)}
				onSaved={() => {
					fetchRules();
					setDialogOpen(false);
				}}
				initial={editing}
			/>
		</div>
	);
}
