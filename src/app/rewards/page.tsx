"use client";

import { useEffect, useState, useMemo } from "react";
import { useMonth } from "@/components/month-context";
import { formatTHB } from "@/lib/format";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
	TableFooter,
} from "@/components/ui/table";

type Period = "DAILY" | "WEEKLY";

interface SettlementRow {
	settlement_id: number;
	period: Period;
	period_key: string;
	employee_id: string;
	dept_name: string | null;
	stage: string;
	total_reward: number;
	tier_detail: any;
	status: string;
	created_at: string;
}

// ISO week utilities
function getISOWeek(dateStr: string): { weekIso: string; year: number; week: number; dates: string[] } {
	const d = new Date(dateStr + "T00:00:00");
	const dayNum = d.getDay() || 7; // 1=Mon, 7=Sun
	// 挪到 ISO 周的周四（当前日期 + (4 - dayNum) 天）
	const thu = new Date(d);
	thu.setDate(d.getDate() + 4 - dayNum);
	const yearStart = new Date(thu.getFullYear(), 0, 1);
	const week = Math.ceil(((thu.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
	const weekIso = `${thu.getFullYear()}-W${String(week).padStart(2, "0")}`;
	// 周四 - 3 天 = 周一
	const monday = new Date(thu);
	monday.setDate(thu.getDate() - 3);
	const dates: string[] = [];
	for (let i = 0; i < 7; i++) {
		const dt = new Date(monday);
		dt.setDate(monday.getDate() + i);
		dates.push(
			`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(
				dt.getDate()
			).padStart(2, "0")}`
		);
	}
	return { weekIso, year: thu.getFullYear(), week, dates };
}

function getWeeksInMonth(month: string): { weekIso: string; year: number; week: number; dates: string[] }[] {
	const [y, m] = month.split("-").map(Number);
	const first = new Date(y, m - 1, 1);
	const last = new Date(y, m, 0);
	const weeksMap = new Map<string, { weekIso: string; year: number; week: number; dates: string[] }>();
	for (let day = new Date(first); day <= last; day.setDate(day.getDate() + 1)) {
		const iso = getISOWeek(
			`${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`
		);
		if (!weeksMap.has(iso.weekIso)) weeksMap.set(iso.weekIso, iso);
	}
	return [...weeksMap.values()];
}

const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

export default function RewardsPage() {
	const { month } = useMonth();
	const [tab, setTab] = useState<"calculate" | "list" | "report">("calculate");
	const [periodFilter, setPeriodFilter] = useState<Period | "ALL">("ALL");
	const [deptFilter, setDeptFilter] = useState<string>("ALL");
	const [selectedWeek, setSelectedWeek] = useState<string>(""); // ISO week key, 默认最新
	const [settlements, setSettlements] = useState<SettlementRow[]>([]);
	const [calculating, setCalculating] = useState(false);
	const [calcMsg, setCalcMsg] = useState<string>("");
	const [refreshKey, setRefreshKey] = useState(0);
	const [empDeptMap, setEmpDeptMap] = useState<Record<string, string | null>>(
		{}
	);
	// 核算范围选择
	const [calcScope, setCalcScope] = useState<"MONTH" | "WEEK">("MONTH");
	const [calcWeek, setCalcWeek] = useState<string>("");

	// 算出当前月有哪些周，默认选最新一周
	const weeks = useMemo(() => getWeeksInMonth(month), [month]);
	useEffect(() => {
		if (tab === "report" && weeks.length > 0 && !selectedWeek) {
			setSelectedWeek(weeks[weeks.length - 1].weekIso);
		}
	}, [tab, weeks, selectedWeek]);

	useEffect(() => {
		fetchEmpMap();
		if (tab === "list" || tab === "report") fetchSettlements();
	}, [tab, refreshKey, month, deptFilter]);

	async function fetchEmpMap() {
		const r = await fetch("/api/employees");
		const j = await r.json();
		const m: Record<string, string | null> = {};
		for (const e of j.data ?? []) m[e.employee_id] = e.department;
		setEmpDeptMap(m);
	}

	async function fetchSettlements() {
		const [y, m] = month.split("-");
		const year = Number(y), mon = Number(m);
		// 扩展 from/to 覆盖本月所有 ISO 周的完整 7 天（处理跨月周）
		// 本月第一周的周一（可能在上月）
		const firstOfMonth = new Date(year, mon - 1, 1);
		const firstDayNum = firstOfMonth.getDay() || 7; // 1=Mon, 7=Sun
		const firstMonday = new Date(firstOfMonth);
		firstMonday.setDate(firstOfMonth.getDate() - (firstDayNum - 1));
		// 本月最后一周的周日（可能在下月）
		const lastOfMonth = new Date(year, mon, 0); // 本月最后一天
		const lastDayNum = lastOfMonth.getDay() || 7;
		const lastSunday = new Date(lastOfMonth);
		lastSunday.setDate(lastOfMonth.getDate() + (7 - lastDayNum));
		const fmt = (d: Date) =>
			`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
		const from = fmt(firstMonday);
		const to = fmt(lastSunday);
		const params = new URLSearchParams({ from, to });
		if (deptFilter !== "ALL") params.set("dept", deptFilter);
		const r = await fetch(`/api/reward/calculate?${params}`);
		const j = await r.json();
		setSettlements(j.data ?? []);
	}

	async function handleCalculate() {
		setCalculating(true);
		setCalcMsg("核算中...");
		try {
			let from: string, to: string, scopeLabel: string;
			if (calcScope === "WEEK" && calcWeek) {
				const w = weeks.find((x) => x.weekIso === calcWeek);
				if (!w) {
					setCalcMsg("❌ 请选择要核算的周");
					setCalculating(false);
					return;
				}
				from = w.dates[0];
				to = w.dates[6];
				scopeLabel = `${calcWeek} (${from} ~ ${to})`;
			} else {
				const [y, m] = month.split("-");
				from = `${y}-${m}-01`;
				const lastDay = new Date(Number(y), Number(m), 0).getDate();
				to = `${y}-${m}-${String(lastDay).padStart(2, "0")}`;
				scopeLabel = `${month} 全月`;
			}
			const body: any = { from, to, overwrite: true };
			if (deptFilter !== "ALL") body.dept = deptFilter;
			const r = await fetch("/api/reward/calculate", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});
			const j = await r.json();
			if (j.success) {
				setCalcMsg(
					`✅ ${scopeLabel} 核算完成 | 日 ${j.data.daily_count} 条 (${formatTHB(
						j.data.daily_total
					)}) | 周 ${j.data.weekly_count} 条 (${formatTHB(
						j.data.weekly_total
					)}) | 合计 ${formatTHB(j.data.grand_total)}`
				);
				setRefreshKey((k) => k + 1);
			} else {
				setCalcMsg(`❌ ${j.message ?? "核算失败"}`);
			}
		} catch (e: any) {
			setCalcMsg(`❌ ${e.message ?? String(e)}`);
		} finally {
			setCalculating(false);
		}
	}

	const depts = useMemo(() => {
		const sDepts = new Set(settlements.map((s) => s.dept_name).filter(Boolean));
		const eDepts = new Set(Object.values(empDeptMap).filter(Boolean));
		return Array.from(new Set([...sDepts, ...eDepts])) as string[];
	}, [settlements, empDeptMap]);
	const filtered = settlements.filter((s) => {
		if (periodFilter !== "ALL" && s.period !== periodFilter) return false;
		if (deptFilter !== "ALL" && s.dept_name !== deptFilter) return false;
		return true;
	});

	const dailySum = filtered
		.filter((s) => s.period === "DAILY")
		.reduce((a, b) => a + b.total_reward, 0);
	const weeklySum = filtered
		.filter((s) => s.period === "WEEKLY")
		.reduce((a, b) => a + b.total_reward, 0);
	const grandSum = dailySum + weeklySum;

	// ===== 报表数据（合并同员工同日/同周的多条结算 → 按员工阶段汇总）=====
	// weeks 已在上方定义

	// 部门过滤后的 settlements（报表用）
	const reportSettlements = useMemo(() => {
		if (deptFilter === "ALL") return settlements;
		return settlements.filter((s) => s.dept_name === deptFilter);
	}, [settlements, deptFilter]);

	// 日结算按 (employee_id, period_key=date) 汇总
	const dailyByEmpDate = useMemo(() => {
		const map = new Map<string, number>();
		for (const s of reportSettlements) {
			if (s.period !== "DAILY") continue;
			const k = `${s.employee_id}|${s.period_key}`;
			map.set(k, (map.get(k) ?? 0) + s.total_reward);
		}
		return map;
	}, [reportSettlements]);

	// 周结算按 (employee_id, period_key=weekIso) 汇总
	const weeklyByEmpWeek = useMemo(() => {
		const map = new Map<string, number>();
		for (const s of reportSettlements) {
			if (s.period !== "WEEKLY") continue;
			const k = `${s.employee_id}|${s.period_key}`;
			map.set(k, (map.get(k) ?? 0) + s.total_reward);
		}
		return map;
	}, [reportSettlements]);

	// 每个员工的部门（优先用 settlement 里的 dept_name，fallback empDeptMap）
	const empDeptFinal = useMemo(() => {
		const m: Record<string, string | null> = {};
		for (const s of reportSettlements) {
			if (s.dept_name) m[s.employee_id] = s.dept_name;
		}
		for (const emp of Object.keys(empDeptMap)) {
			if (!m[emp]) m[emp] = empDeptMap[emp];
		}
		return m;
	}, [reportSettlements, empDeptMap]);

	// 报表里要显示的员工（有任何结算的）
	const reportEmps = useMemo(() => {
		const set = new Set<string>();
		reportSettlements.forEach((s) => set.add(s.employee_id));
		return [...set].sort();
	}, [reportSettlements]);

	return (
		<div>
			<div className="mb-4">
				<h1 className="text-[18px] font-bold text-foreground">奖励中心</h1>
				<p className="mt-1 text-[12.5px] text-muted-foreground">
					独立模块 · 日奖励 + 周奖励 · 数据源复用「日业务数据」 · 与月工资无关
				</p>
			</div>

			{/* Tab */}
			<div className="mb-4 flex gap-1 border-b border-border">
				{[
					{ k: "calculate", label: "① 一键核算" },
					{ k: "list", label: "② 结算列表" },
					{ k: "report", label: "③ 奖励报表" },
				].map((t) => (
					<button
						key={t.k}
						onClick={() => setTab(t.k as any)}
						className={`px-4 py-2 text-[13px] transition-colors border-b-2 -mb-px ${
							tab === t.k
								? "border-primary text-primary font-semibold"
								: "border-transparent text-muted-foreground hover:text-foreground"
						}`}
					>
						{t.label}
					</button>
				))}
			</div>

			{/* Tab 1: 核算 */}
			{tab === "calculate" && (
				<div className="space-y-4">
					<div className="rounded-md border border-border bg-white p-5">
						<div className="mb-3 text-[13px] font-semibold">
							🚀 一键核算奖励
						</div>
						<div className="text-[12px] text-muted-foreground mb-4">
							基于日业务数据（「数据导入」导入），自动算日奖励 + 周奖励。
							会覆盖同期间已结算数据。
							<br />
							<span className="text-primary">
								💡 规则到「奖励方案」模块配置；支持按全月或按单周核算
							</span>
						</div>

						{/* 核算范围 */}
						<div className="mb-4 rounded-md border border-border/60 bg-muted/20 p-3">
							<div className="text-[12px] font-medium mb-2">核算范围</div>
							<div className="flex flex-wrap items-center gap-3">
								<span className="text-[12.5px] text-muted-foreground">部门:</span>
								<select
									value={deptFilter}
									onChange={(e) => setDeptFilter(e.target.value)}
									className="rounded-md border border-border bg-background px-2 py-1 text-[12.5px]"
								>
									<option value="ALL">全部部门</option>
									{depts.map((d) => (
										<option key={d} value={d}>{d}</option>
									))}
								</select>
								<div className="h-4 w-px bg-border/60" />
								<label className="flex items-center gap-1.5 text-[12.5px]">
									<input
										type="radio"
										checked={calcScope === "MONTH"}
										onChange={() => setCalcScope("MONTH")}
										className="accent-primary"
									/>
									{month} 全月
								</label>
								<label className="flex items-center gap-1.5 text-[12.5px]">
									<input
										type="radio"
										checked={calcScope === "WEEK"}
										onChange={() => setCalcScope("WEEK")}
										className="accent-primary"
									/>
									指定周:
								</label>
								{calcScope === "WEEK" && (
									<select
										value={calcWeek}
										onChange={(e) => setCalcWeek(e.target.value)}
										className="rounded-md border border-border bg-background px-2 py-1 text-[12.5px]"
									>
										<option value="">-- 选择周 --</option>
										{weeks.map((w) => (
											<option key={w.weekIso} value={w.weekIso}>
												{w.weekIso} ({w.dates[0]} ~ {w.dates[6]})
											</option>
										))}
									</select>
								)}
								<span className="ml-auto text-[11.5px] text-muted-foreground">
									{deptFilter !== "ALL" && `部门: ${deptFilter} | `}
									{calcScope === "MONTH"
										? `覆盖 ${month} 全部日/周结算`
										: calcWeek
										? `覆盖 ${calcWeek}（7天）日结算 + 当周周结算`
										: "请先选择要核算的周"}
								</span>
							</div>
						</div>

						<div className="flex gap-3">
							<button
								onClick={handleCalculate}
								disabled={calculating || (calcScope === "WEEK" && !calcWeek)}
								className="rounded-md bg-primary px-5 py-2 text-[13px] text-white font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors"
							>
								{calculating ? "核算中..." : "🚀 开始核算"}
							</button>
						</div>
						{calcMsg && (
							<div className="mt-3 rounded-md bg-muted/50 border border-border/60 px-3 py-2 text-[12.5px]">
								{calcMsg}
							</div>
						)}
					</div>
				</div>
			)}

			{/* Tab 2: 列表 */}
			{tab === "list" && (
				<div className="space-y-4">
					{/* 汇总卡片 */}
					<div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
						<div className="rounded-md border border-border bg-white p-3">
							<div className="text-[12px] text-muted-foreground">
								日奖励合计
							</div>
							<div className="mt-1 text-lg font-semibold font-mono">
								{formatTHB(dailySum)} ฿
							</div>
						</div>
						<div className="rounded-md border border-border bg-white p-3">
							<div className="text-[12px] text-muted-foreground">
								周奖励合计
							</div>
							<div className="mt-1 text-lg font-semibold font-mono">
								{formatTHB(weeklySum)} ฿
							</div>
						</div>
						<div className="rounded-md border border-primary/30 bg-primary/5 p-3">
							<div className="text-[12px] text-primary/80">
								奖励总计
							</div>
							<div className="mt-1 text-lg font-bold font-mono text-primary">
								{formatTHB(grandSum)} ฿
							</div>
						</div>
					</div>

					{/* 筛选 */}
					<div className="flex gap-3 items-center text-[13px]">
						<span className="text-muted-foreground">周期:</span>
						{(["ALL", "DAILY", "WEEKLY"] as const).map((p) => (
							<button
								key={p}
								onClick={() => setPeriodFilter(p)}
								className={`px-3 py-1 rounded-md border transition-colors ${
									periodFilter === p
										? "border-primary bg-primary/10 text-primary font-semibold"
										: "border-border text-muted-foreground hover:bg-muted"
								}`}
							>
								{p === "ALL" ? "全部" : p === "DAILY" ? "日奖励" : "周奖励"}
							</button>
						))}
						<span className="text-muted-foreground ml-4">部门:</span>
						<select
							value={deptFilter}
							onChange={(e) => setDeptFilter(e.target.value)}
							className="rounded-md border border-border bg-white px-3 py-1 text-[13px]"
						>
							<option value="ALL">全部</option>
							{depts.map((d) => (
								<option key={d} value={d}>
									{d}
								</option>
							))}
						</select>
					</div>

					{/* 表格 */}
					<div className="overflow-hidden rounded-md border border-border bg-white">
						<Table>
							<TableHeader>
								<TableRow className="bg-muted/30 text-[12.5px]">
									<TableHead className="px-3">周期</TableHead>
									<TableHead className="px-3">期间</TableHead>
									<TableHead className="px-3">工号</TableHead>
									<TableHead className="px-3">部门</TableHead>
									<TableHead className="px-3">阶段</TableHead>
									<TableHead className="px-3 text-right">
										奖励金额
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{filtered.length === 0 && (
									<TableRow>
										<TableCell
											colSpan={6}
											className="px-3 py-8 text-center text-muted-foreground text-[13px]"
										>
											暂无结算数据，请先到「奖励方案」配置规则 →
											「一键核算」
										</TableCell>
									</TableRow>
								)}
								{filtered.map((s) => (
									<TableRow
										key={`${s.period}-${s.period_key}-${s.employee_id}-${s.stage}`}
										className="text-[12.5px] hover:bg-muted/20"
									>
										<TableCell className="px-3">
											<span
												className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
													s.period === "DAILY"
														? "bg-blue-500/10 text-blue-600"
														: "bg-emerald-500/10 text-emerald-600"
												}`}
											>
												{s.period === "DAILY" ? "日" : "周"}
											</span>
										</TableCell>
										<TableCell className="px-3 font-mono">
											{s.period_key}
										</TableCell>
										<TableCell className="px-3 font-mono">
											{s.employee_id}
										</TableCell>
										<TableCell className="px-3">
											{s.dept_name ?? empDeptMap[s.employee_id] ?? "—"}
										</TableCell>
										<TableCell className="px-3">{s.stage}</TableCell>
										<TableCell className="px-3 text-right font-mono font-semibold">
											{formatTHB(s.total_reward)}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
							{filtered.length > 0 && (
								<TableFooter>
									<TableRow className="bg-muted/50 text-[12.5px] font-semibold">
										<TableCell className="px-3" colSpan={5}>
											合计
										</TableCell>
										<TableCell className="px-3 text-right font-mono text-primary">
											{formatTHB(grandSum)}
										</TableCell>
									</TableRow>
								</TableFooter>
							)}
						</Table>
					</div>
				</div>
			)}

			{/* Tab 3: 奖励报表（每周一张双层表头表）*/}
			{tab === "report" && (
				<div className="space-y-6">
					{/* 报表筛选栏 */}
					<div className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3 bg-muted/30">
						<span className="text-[13px] font-medium">📊 报表筛选</span>
						<span className="text-muted-foreground text-[12px]">部门:</span>
						<select
							value={deptFilter}
							onChange={(e) => setDeptFilter(e.target.value)}
							className="rounded-md border border-border bg-background px-2 py-1 text-[13px]"
						>
							<option value="ALL">全部部门</option>
							{depts.map((d) => (
								<option key={d} value={d}>{d}</option>
							))}
						</select>
						<span className="text-muted-foreground text-[12px]">周次:</span>
						<select
							value={selectedWeek}
							onChange={(e) => setSelectedWeek(e.target.value)}
							className="rounded-md border border-border bg-background px-2 py-1 text-[13px]"
						>
							{weeks.map((w) => {
								const label = w.dates[0] + " ~ " + w.dates[6];
								const iso = w.weekIso;
								const hasData = settlements.some(
									(s) =>
										(s.period === "WEEKLY" && s.period_key === iso) ||
										(s.period === "DAILY" && w.dates.includes(s.period_key))
								);
								return (
									<option key={iso} value={iso}>
										{iso} ({label}) {hasData ? "✓" : ""}
									</option>
								);
							})}
						</select>
						<span className="text-muted-foreground text-[12px] ml-auto">
							{month} · 共 {weeks.length} 个 ISO 周
						</span>
					</div>

					{settlements.length === 0 ? (
						<div className="rounded-md border border-dashed border-border p-8 text-center text-muted-foreground text-[13px]">
							暂无结算数据，请先到「一键核算」生成数据
						</div>
					) : (
						weeks
							.filter((w) => !selectedWeek || w.weekIso === selectedWeek)
							.map((w) => {
							// 计算本周每个员工的日奖励 + 周奖励
							const weekDailyTotals = new Map<string, number[]>(); // empId → [d1,d2,...d7]
							const weekWeeklyTotals = new Map<string, number>();
							let tableDailySum = 0, tableWeeklySum = 0;

							for (const empId of reportEmps) {
								const dailyRow: number[] = w.dates.map(
									(d) => dailyByEmpDate.get(`${empId}|${d}`) ?? 0
								);
								weekDailyTotals.set(empId, dailyRow);
								const dw = dailyRow.reduce((a, b) => a + b, 0);
								tableDailySum += dw;

								const ww = weeklyByEmpWeek.get(`${empId}|${w.weekIso}`) ?? 0;
								weekWeeklyTotals.set(empId, ww);
								tableWeeklySum += ww;
							}

							const tableGrandSum = tableDailySum + tableWeeklySum;

							// 过滤：只保留本周有任何奖励的员工
							const rows = reportEmps
								.map((empId) => {
									const daily = weekDailyTotals.get(empId)!;
									const weekly = weekWeeklyTotals.get(empId)!;
									const dailyTotal = daily.reduce((a, b) => a + b, 0);
									return { empId, daily, weekly, dailyTotal, grand: dailyTotal + weekly };
								})
								.filter((r) => r.grand > 0);

							if (rows.length === 0) return null;

							return (
								<div
									key={w.weekIso}
									className="overflow-hidden rounded-md border border-border bg-white"
								>
									<Table>
										<TableHeader>
											{/* Row 1: 大表头（跨全部列）*/}
											<TableRow className="bg-primary/5">
												<TableHead
													colSpan={10}
													className="px-3 py-2 text-center text-[13px] font-bold text-primary"
												>
													{month} - 第 {w.week} 周奖励明细
													<span className="ml-2 font-normal text-[11px] text-muted-foreground">
														({w.dates[0]} ~ {w.dates[6]})
													</span>
												</TableHead>
											</TableRow>
											{/* Row 2: 工号 | 日奖励(colSpan=7) | 周奖励 | 合计 */}
											<TableRow className="bg-muted/30 text-[12px]">
												<TableHead
													rowSpan={2}
													className="px-3 align-middle font-semibold w-[200px]"
												>
													工号
												</TableHead>
												<TableHead
													colSpan={7}
													className="px-3 text-center font-semibold border-l border-border"
												>
													日奖励
												</TableHead>
												<TableHead
													rowSpan={2}
													className="px-3 align-middle text-center font-semibold w-[100px]"
												>
													周奖励
												</TableHead>
												<TableHead
													rowSpan={2}
													className="px-3 align-middle text-center font-semibold w-[100px] text-primary"
												>
													合计
												</TableHead>
											</TableRow>
											{/* Row 3: 7 天具体日期 */}
											<TableRow className="bg-muted/20 text-[11px]">
												{w.dates.map((d, i) => (
													<TableHead
														key={d}
														className="px-2 text-center font-mono border-l border-border"
													>
														<div className="font-semibold">
															{WEEKDAY_LABELS[i]}
														</div>
														<div className="text-[10px]">
															{d.slice(5)}
														</div>
													</TableHead>
												))}
											</TableRow>
										</TableHeader>
										<TableBody>
											{rows.map((r) => {
												const dept = empDeptFinal[r.empId] ?? "—";
												return (
													<TableRow
														key={r.empId}
														className="text-[12px] hover:bg-muted/20"
													>
														<TableCell className="px-3 font-mono">
															<div className="font-semibold">
																{r.empId}
															</div>
															<div className="text-[10px] text-muted-foreground">
																{dept}
															</div>
														</TableCell>
														{r.daily.map((v, i) => (
															<TableCell
																key={i}
																className={`px-2 text-right font-mono border-l border-border ${
																	v > 0
																		? "text-emerald-600 font-semibold"
																		: "text-muted-foreground/40"
																}`}
															>
																{v > 0 ? formatTHB(v) : "-"}
															</TableCell>
														))}
														<TableCell className="px-3 text-right font-mono border-l border-border">
															{r.weekly > 0 ? (
																<span className="text-blue-600 font-semibold">
																	{formatTHB(r.weekly)}
																</span>
															) : (
																<span className="text-muted-foreground/40">-</span>
															)}
														</TableCell>
														<TableCell className="px-3 text-right font-mono border-l border-border text-primary font-bold">
															{formatTHB(r.grand)}
														</TableCell>
													</TableRow>
												);
											})}
										</TableBody>
										<TableFooter>
											<TableRow className="bg-muted/50 text-[12px] font-semibold">
												<TableCell className="px-3">
													小计 ({rows.length} 人)
												</TableCell>
												{Array.from({ length: 7 }).map((_, i) => {
													const colSum = rows.reduce(
														(a, row) => a + row.daily[i],
														0
													);
													return (
														<TableCell
															key={i}
															className={`px-2 text-right font-mono border-l border-border ${
																colSum > 0 ? "text-emerald-700" : ""
															}`}
														>
															{colSum > 0 ? formatTHB(colSum) : "-"}
														</TableCell>
													);
												})}
												<TableCell className="px-3 text-right font-mono border-l border-border text-blue-700">
													{formatTHB(tableWeeklySum)}
												</TableCell>
												<TableCell className="px-3 text-right font-mono border-l border-border text-primary">
													{formatTHB(tableGrandSum)}
												</TableCell>
											</TableRow>
										</TableFooter>
									</Table>
								</div>
							);
						})
					)}
				</div>
			)}
		</div>
	);
}
