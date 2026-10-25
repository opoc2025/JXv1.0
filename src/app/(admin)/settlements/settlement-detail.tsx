'use client';

import { useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { formatPct, formatRate, formatTHB } from '@/lib/format';
import type { SettlementDetail } from '@/lib/types';

/* ============ 工具 ============ */
function metricLabel(m: string): string {
  const map: Record<string, string> = {
    AMOUNT: '月度回款金额',
    ORDERS: '月度订单量',
    ORDER_RATE: '订单回收率',
    RATE: '金额回收率',
    DAILY_RATE: '日达成率',
    DAILY_ORDERS: '日回收单数',
    DAILY_AMOUNT: '日回款金额',
  };
  return map[m] ?? m;
}

function metricValueText(m: string, v: number | null): string {
  if (v === null) return '—';
  if (m.includes('AMOUNT')) return formatTHB(v);
  if (m.includes('ORDERS')) return `${v} 单`;
  if (m.includes('RATE')) return formatRate(v);
  return `${v}`;
}

function rewardLabel(type: string, value: number): string {
  if (type === 'UNIT_PRICE') return `${value} ฿/单`;
  if (type === 'PERCENTAGE') return `${(value * 100).toFixed(2)}% 提成`;
  if (type === 'FIXED_AMOUNT') return `固定 ${formatTHB(value)} ฿`;
  return `${type} ${value}`;
}

/* ============ 主组件 ============ */
interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  name: string;
  employeeId: string;
  detail: SettlementDetail | null;
}

export function SettlementDetailDrawer({ open, onOpenChange, name, employeeId, detail }: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[680px] overflow-y-auto sm:max-w-[680px]">
        <SheetHeader>
          <SheetTitle>
            {name}{' '}
            <span className="ml-2 font-mono text-[12.5px] text-muted-foreground">
              {employeeId}
            </span>
          </SheetTitle>
        </SheetHeader>

        {!detail ? (
          <div className="py-10 text-center text-[13px] text-muted-foreground">
            无明细数据
          </div>
        ) : (
          <div className="mt-5 space-y-5 px-4">
            <PerformanceSection scheme={detail.scheme} monthlySummary={detail.monthly_summary} />
            <CommissionOverviewSection detail={detail} />
            <MonthlySummarySection monthlySummary={detail.monthly_summary} />
            <MonthlyPlanASection data={detail.monthly_total} />
            {detail.monthly_progressive && (
              <ProgressiveSection data={detail.monthly_progressive} />
            )}
            <StageGroupsSection stages={detail.stages} />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/* ============ 绩效考核方案 ============ */
function PerformanceSection({
  scheme,
  monthlySummary,
}: {
  scheme: SettlementDetail['scheme'];
  monthlySummary: SettlementDetail['monthly_summary'];
}) {
  // 把所有 monthly_summary 合并成一个查值 Map
  const summaryMap = new Map<string, { amount: number; orders: number; rate: number | null }>();
  monthlySummary.forEach((m) => summaryMap.set(m.stage, {
    amount: m.monthly_total_amount,
    orders: m.monthly_recovered_orders,
    rate: m.monthly_recovery_rate,
  }));
  // 全阶段合计（多阶段员工看总数据）
  const totalAmount = monthlySummary.reduce((s, m) => s + m.monthly_total_amount, 0);
  const totalOrders = monthlySummary.reduce((s, m) => s + m.monthly_recovered_orders, 0);
  const totalRate = monthlySummary.length > 0
    ? round2(monthlySummary.reduce((s, m) => s + (m.monthly_recovery_rate ?? 0), 0) / monthlySummary.length)
    : null;

  return (
    <section className="rounded-md border border-border bg-paper-soft p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[13px] font-semibold">① 绩效考核方案</div>
          <div className="mt-0.5 text-[11.5px] text-muted-foreground">
            部门：{scheme.dept_name} · 底薪 {formatTHB(scheme.base_salary)} ฿ + 绩效工资 {formatTHB(scheme.performance_bonus)} ฿
          </div>
        </div>
        {scheme.passed ? (
          <Badge className="bg-[#e3efe9] text-primary hover:bg-[#e3efe9]">
            ✓ 月度达标 → 发绩效
          </Badge>
        ) : (
          <Badge variant="outline" className="text-vermilion">
            ✗ 未达标 → 绩效 0
          </Badge>
        )}
      </div>

      {/* 合计完成数字 */}
      {monthlySummary.length > 0 && (
        <div className="mt-3 grid grid-cols-3 gap-2 text-[12px]">
          <div className="rounded border border-border bg-white px-3 py-1.5">
            <div className="text-muted-foreground">全阶段月回款合计</div>
            <div className="mt-0.5 font-mono font-semibold">{formatTHB(totalAmount)} ฿</div>
          </div>
          <div className="rounded border border-border bg-white px-3 py-1.5">
            <div className="text-muted-foreground">全阶段月订单合计</div>
            <div className="mt-0.5 font-mono font-semibold">{totalOrders} 单</div>
          </div>
          <div className="rounded border border-border bg-white px-3 py-1.5">
            <div className="text-muted-foreground">全阶段平均回收率</div>
            <div className="mt-0.5 font-mono font-semibold">{totalRate ?? '—'}%</div>
          </div>
        </div>
      )}

      {/* 条件组 */}
      <div className="mt-3 border-t border-border pt-3">
        <div className="mb-2 text-[12px] font-medium text-muted-foreground">
          考核门槛（任一组全部条件满足即达标）
        </div>
        <div className="space-y-2">
          {scheme.groups.map((g, gi) => (
            <GroupCard key={g.group_id ?? gi} group={g} />
          ))}
        </div>
      </div>

      {/* 实发金额对比 */}
      <div className="mt-3 border-t border-border pt-3 space-y-1 text-[12.5px]">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">
            原底薪 {formatTHB(scheme.base_salary)}
            {scheme.actual_base_salary !== scheme.base_salary && (
              <> → <span className="font-mono text-emerald-500">实发 {formatTHB(scheme.actual_base_salary)}</span></>
            )}
          </span>
          <span className="font-mono text-primary">
            {scheme.actual_base_salary !== scheme.base_salary
              ? `考勤调整 ${formatTHB(scheme.actual_base_salary - scheme.base_salary)}`
              : '无考勤调整'}
          </span>
        </div>
        {scheme.full_attendance_bonus !== 0 && (
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">全勤奖</span>
            <span className="font-mono text-emerald-500">+ {formatTHB(scheme.full_attendance_bonus)}</span>
          </div>
        )}
        <div className="flex items-center justify-between pt-1 border-t border-border">
          <span className="text-muted-foreground">
            调整后底薪 {formatTHB(scheme.actual_base_salary)} + 绩效{' '}
            <span className={scheme.passed ? 'text-primary font-semibold' : 'text-vermilion'}>
              {formatTHB(scheme.bonus)}
            </span>
            {scheme.full_attendance_bonus !== 0 && ` + 全勤 ${formatTHB(scheme.full_attendance_bonus)}`}
          </span>
          <span className="font-mono">
            = {formatTHB(scheme.actual_base_salary + scheme.bonus + scheme.full_attendance_bonus)}
          </span>
        </div>
      </div>
    </section>
  );
}

function GroupCard({ group }: { group: SettlementDetail['scheme']['groups'][number] }) {
  return (
    <div className="overflow-hidden rounded border border-border bg-white">
      <div className="flex items-center justify-between border-b border-border bg-paper-soft px-3 py-1.5">
        <span className="text-[11px] font-semibold text-emerald-700">
          条件组 G{group.sort_order + 1}（组内条件 AND）
        </span>
        {group.passed ? (
          <Badge className="bg-[#e3efe9] text-primary hover:bg-[#e3efe9]">✓ 组达标</Badge>
        ) : (
          <Badge variant="outline" className="text-vermilion">✗ 未达</Badge>
        )}
      </div>
      <div className="divide-y divide-border">
        {group.conditions.map((cc, ci) => {
          const diff = cc.metric_value !== null
            ? cc.metric_value >= cc.threshold_value ? '超额' : '差'
            : '';
          return (
            <div
              key={cc.condition_id ?? ci}
              className="flex items-center justify-between gap-3 px-3 py-1.5 text-[12.5px]"
            >
              <span className="text-muted-foreground">
                {metricLabel(cc.metric)}{' '}
                <span className="font-mono text-foreground">{cc.range_text}</span>
              </span>
              <span className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground">
                  实际{' '}
                  <span className="font-mono text-foreground">
                    {metricValueText(cc.metric, cc.metric_value)}
                  </span>
                  {cc.metric_value !== null && (
                    <span className={`ml-1 text-[10px] ${cc.passed ? 'text-emerald-600' : 'text-vermilion'}`}>
                      （{diff} {cc.passed
                        ? formatTHB(cc.metric_value - cc.threshold_value).replace(' ฿', '')
                        : cc.threshold_value - cc.metric_value}
                      {cc.metric.includes('RATE') ? '%' : cc.metric.includes('AMOUNT') ? ' ฿' : ' 单'}）
                    </span>
                  )}
                </span>
                {cc.passed ? (
                  <Badge className="bg-[#e3efe9] text-primary hover:bg-[#e3efe9]">✓</Badge>
                ) : (
                  <Badge variant="outline" className="text-vermilion">✗</Badge>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ============ 月度汇总 ============ */
function MonthlySummarySection({ monthlySummary }: { monthlySummary: SettlementDetail['monthly_summary'] }) {
  if (monthlySummary.length === 0) return null;
  return (
    <section className="rounded-md border border-border bg-paper-soft p-4">
      <div className="mb-2 text-[13px] font-semibold">② 月度业务数据汇总</div>
      <Table>
        <TableHeader>
          <TableRow className="data-table">
            <TableHead className="h-8 px-3">参与阶段</TableHead>
            <TableHead className="h-8 px-3 text-right">月回款 (฿)</TableHead>
            <TableHead className="h-8 px-3 text-right">月订单</TableHead>
            <TableHead className="h-8 px-3 text-right">回款率</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {monthlySummary.map((m, i) => (
            <TableRow key={`${m.stage}-${i}`}>
              <TableCell className="px-3 font-mono text-[12px]">{m.stage}</TableCell>
              <TableCell className="px-3 text-right font-mono text-[12px]">
                {formatTHB(m.monthly_total_amount)}
              </TableCell>
              <TableCell className="px-3 text-right font-mono text-[12px]">
                {m.monthly_recovered_orders} 单
              </TableCell>
              <TableCell className="px-3 text-right font-mono text-[12px]">
                {m.monthly_recovery_rate ?? '—'}%
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="mt-2 text-[11px] text-muted-foreground">
        以上数据由引擎自动从日运营明细汇总得出
      </div>
    </section>
  );
}

/* ============ 月度总回款提点 ============ */
function MonthlyPlanASection({ data }: { data: SettlementDetail['monthly_total'] }) {
  const hit = data.commission > 0;
  const title = data.rule_name || '月度总回款提点';
  return (
    <section className="rounded-md border border-border bg-paper-soft p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[13px] font-semibold">
            ③ {title}（整月汇总匹配一次）
          </div>
          <div className="mt-0.5 text-[11.5px] text-muted-foreground">
            {hit ? `命中规则` : '未配置或未命中'}
          </div>
        </div>
        {hit ? (
          <Badge className="bg-[#e3efe9] text-primary hover:bg-[#e3efe9]">✓ 命中</Badge>
        ) : (
          <Badge variant="outline">未命中</Badge>
        )}
      </div>
      <div className="mt-2 grid grid-cols-4 gap-2 text-[12.5px]">
        <InfoBox label="整月总回款" value={formatTHB(data.total_amount) + ' ฿'} />
        <InfoBox label="命中阶梯" value={data.range_text ?? '-'} />
        <InfoBox label="提点比例" value={data.percentage !== null ? formatPct(data.percentage) : '-'} />
        <InfoBox
          label="提成金额"
          value={formatTHB(data.commission) + ' ฿'}
          highlight={hit}
        />
      </div>
      {hit && (
        <div className="mt-2 border-t border-border pt-2 text-[12px] text-muted-foreground">
          计算方式：{formatTHB(data.total_amount)} × {formatPct(data.percentage)} ={' '}
          <span className="font-mono font-semibold text-primary">
            {formatTHB(data.commission)} ฿
          </span>
        </div>
      )}
    </section>
  );
}

/* ============ 月度超额累进提成 ============ */
function ProgressiveSection({ data }: { data: NonNullable<SettlementDetail['monthly_progressive']> }) {
  const hit = data.commission > 0;
  return (
    <section className="rounded-md border border-primary/30 bg-primary/[0.03] p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[13px] font-semibold">
            📈 {data.rule_name || '月度超额累进提成'}
          </div>
          <div className="mt-0.5 text-[11.5px] text-muted-foreground">
            基本任务 <span className="font-mono text-foreground">{formatTHB(data.base_amount)}</span> ฿，
            本月回款 <span className="font-mono text-foreground">{formatTHB(data.total_amount)}</span> ฿
          </div>
        </div>
        {hit ? (
          <Badge className="bg-[#e3efe9] text-primary hover:bg-[#e3efe9]">
            ✓ 超任务 {(data.total_amount - data.base_amount) > 0
              ? formatTHB(data.total_amount - data.base_amount)
              : '0'} ฿
          </Badge>
        ) : (
          <Badge variant="outline">未超任务</Badge>
        )}
      </div>

      {/* 累进明细表 */}
      <Table className="mt-3">
        <TableHeader>
          <TableRow className="data-table">
            <TableHead className="h-8 px-3">阶梯区间</TableHead>
            <TableHead className="h-8 px-3 text-right">该档金额</TableHead>
            <TableHead className="h-8 px-3 text-right">提点比例</TableHead>
            <TableHead className="h-8 px-3 text-right">该档提成</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.tier_breakdown.map((b, i) => {
            const maxStr = b.max === null ? '∞' : formatTHB(b.max);
            return (
              <TableRow key={i}>
                <TableCell className="px-3 font-mono text-[12px]">
                  [{formatTHB(b.min)}, {maxStr})
                </TableCell>
                <TableCell className={`px-3 text-right font-mono text-[12px] ${b.portion > 0 ? '' : 'text-muted-foreground'}`}>
                  {b.portion > 0 ? formatTHB(b.portion) : '—'}
                </TableCell>
                <TableCell className="px-3 text-right font-mono text-[12px]">
                  {(b.percentage * 100).toFixed(0)}%
                </TableCell>
                <TableCell className={`px-3 text-right font-mono text-[12px] font-medium ${b.commission > 0 ? 'text-primary' : 'text-muted-foreground'}`}>
                  {b.commission > 0 ? formatTHB(b.commission) : '—'}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <div className="mt-2 flex items-center justify-between border-t border-border pt-2 text-[12px]">
        <span className="text-muted-foreground">
          计算方式 = 各区间金额 × 对应提点比例，逐档累加
        </span>
        <span>
          累进合计：<span className="font-mono font-bold text-primary">{formatTHB(data.commission)}</span> ฿
        </span>
      </div>
    </section>
  );
}

/* ============ 生效提成方式总览 ============ */
function CommissionOverviewSection({ detail }: { detail: SettlementDetail }) {
  // 哪些阶段有任意提成命中（日>0 或 月B>0）
  const activeStages = detail.stages.filter(
    (s) => s.daily_commission > 0 || s.stage_commission.commission > 0
  );
  const inactiveStages = detail.stages.filter(
    (s) => s.daily_commission === 0 && s.stage_commission.commission === 0
  );
  const dailyTotal = detail.stages.reduce((s, x) => s + x.daily_commission, 0);
  const stageBTotal = detail.stages.reduce((s, x) => s + x.stage_commission.commission, 0);
  const planATotal = detail.monthly_total.commission;
  const progressiveTotal = detail.monthly_progressive?.commission ?? 0;
  const grandTotal = dailyTotal + stageBTotal + planATotal + progressiveTotal;

  // 方案 A 状态
  const planAHit = planATotal > 0;
  // 方案 B 命中的阶段数
  const planBHits = detail.stages.filter((s) => s.stage_commission.commission > 0).length;
  // 日提成命中的阶段数
  const dailyHits = detail.stages.filter((s) => s.daily_commission > 0).length;

  return (
    <section className="rounded-md border border-primary/30 bg-primary/[0.04] p-4">
      <div className="text-[13px] font-semibold">② 本月生效提成方式汇总</div>

      {/* 4 种提成方式状态 */}
      <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
        <CommissionModeCard
          label="日达成提成"
          hit={dailyHits > 0}
          amount={dailyTotal}
          sub={dailyHits > 0 ? `覆盖 ${dailyHits} 个阶段${dailyHits !== activeStages.length ? '' : ''}` : '未命中任何规则'}
        />
        <CommissionModeCard
          label="方案 B · 分阶段金额提点"
          hit={planBHits > 0}
          amount={stageBTotal}
          sub={planBHits > 0 ? `${planBHits} 个阶段命中` : '未配置或未命中'}
        />
        <CommissionModeCard
          label="方案 A · 整月总回款提点"
          hit={planAHit}
          amount={planATotal}
          sub={planAHit ? `命中阶梯 ${detail.monthly_total.range_text ?? '-'}` : '未配置或未命中'}
        />
        <CommissionModeCard
          label="月度超额累进提成"
          hit={progressiveTotal > 0}
          amount={progressiveTotal}
          sub={detail.monthly_progressive
            ? `任务 ${formatTHB(detail.monthly_progressive.base_amount)}，超任务累进`
            : '未配置或未命中'}
        />
        <div className="rounded border border-primary/40 bg-white px-3 py-2">
          <div className="text-muted-foreground">提成合计</div>
          <div className="mt-0.5 font-mono font-bold text-primary">{formatTHB(grandTotal)} ฿</div>
          <div className="text-[10.5px] text-muted-foreground mt-0.5">
            {activeStages.length} 个阶段生效 · {inactiveStages.length} 个阶段无提成
          </div>
        </div>
      </div>
    </section>
  );
}

function CommissionModeCard({ label, hit, amount, sub }: { label: string; hit: boolean; amount: number; sub: string }) {
  return (
    <div className={`rounded border px-3 py-2 ${hit ? 'border-emerald-400/50 bg-white' : 'border-border bg-white opacity-70'}`}>
      <div className="flex items-center justify-between">
        <div className="text-[11.5px] text-muted-foreground">{label}</div>
        {hit ? (
          <Badge className="h-[18px] bg-[#e3efe9] text-primary px-1.5 text-[10px]">✓</Badge>
        ) : (
          <Badge variant="outline" className="h-[18px] px-1.5 text-[10px]">—</Badge>
        )}
      </div>
      <div className={`mt-0.5 font-mono font-bold ${hit ? 'text-foreground' : 'text-muted-foreground'}`}>
        {hit ? formatTHB(amount) + ' ฿' : '0 ฿'}
      </div>
      <div className="text-[10.5px] text-muted-foreground mt-0.5">{sub}</div>
    </div>
  );
}

/* ============ 阶段结算（合并组 + 独立 + 未生效折叠） ============ */
function StageGroupsSection({ stages }: { stages: SettlementDetail['stages'] }) {
  // 分组：生效的（有任意提成） vs 未生效的（日=0 且 月B=0）
  const active = stages.filter((s) => s.daily_commission > 0 || s.stage_commission.commission > 0);
  const inactive = stages.filter((s) => s.daily_commission === 0 && s.stage_commission.commission === 0);

  return (
    <section className="space-y-3">
      <div className="text-[13px] font-semibold">④ 各阶段提成明细</div>

      {/* 生效的阶段 */}
      {active.length > 0 ? (
        active.map((s) => <StageSection key={s.stage} stage={s} />)
      ) : (
        <div className="rounded-md border border-dashed border-border bg-white/50 p-4 text-center text-[12px] text-muted-foreground">
          本月无生效提成的阶段
        </div>
      )}

      {/* 未生效的阶段（折叠） */}
      {inactive.length > 0 && <InactiveStagesFold stages={inactive} />}
    </section>
  );
}

function InactiveStagesFold({ stages }: { stages: SettlementDetail['stages'] }) {
  const [open, setOpen] = useState(false);
  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      className="rounded-md border border-dashed border-border bg-paper-soft/50"
    >
      <summary className="flex cursor-pointer items-center justify-between px-4 py-2 text-[12px] text-muted-foreground hover:text-foreground">
        <span>
          {open ? '▼' : '▶'} 展开 {stages.length} 个未生效阶段
          <span className="ml-1">（无日提成 · 无月B 提成）</span>
        </span>
      </summary>
      <div className="divide-y divide-border/60 border-t border-border/60 bg-white">
        {stages.map((s) => (
          <div key={s.stage} className="flex items-center gap-2 px-4 py-2 text-[12px]">
            {s.is_merged ? (
              <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 text-[10px]">合并组</Badge>
            ) : null}
            <span className="font-mono text-muted-foreground">{s.stage}</span>
            {s.source_stages && (
              <span className="text-[10.5px] text-muted-foreground">
                （含 {s.source_stages.join(' + ')}）
              </span>
            )}
            <span className="ml-auto text-[10.5px] text-muted-foreground">
              未配置 {s.is_merged ? '合并组' : '阶段'}提成规则
            </span>
          </div>
        ))}
      </div>
    </details>
  );
}

/* ============ 阶段结算 ============ */
function StageSection({ stage }: { stage: SettlementDetail['stages'][number] }) {
  const dailyTotal = stage.daily_hits.reduce((s, h) => s + h.commission, 0);
  const hitRules = [...new Set(stage.daily_hits.map((h) => `${h.rule_id}|${h.rule_name}`))];
  const stageGrand = stage.stage_commission.commission + dailyTotal;

  return (
    <section className="space-y-3">
      {/* 头部：合并组 Badge + 独立阶段标识 */}
      <div className="flex items-center gap-2">
        {stage.is_merged ? (
          <Badge className="bg-gradient-to-r from-emerald-100 to-teal-100 text-emerald-800 hover:from-emerald-100 hover:to-teal-100 text-[11px]">
            🔀 合并组
          </Badge>
        ) : (
          <Badge variant="outline" className="text-[11px] text-muted-foreground">独立阶段</Badge>
        )}
        <Badge variant="secondary" className="font-mono text-[11px]">
          {stage.stage}
        </Badge>
        <span className="text-[13px] font-semibold">阶段结算</span>
        {stageGrand > 0 && (
          <span className="ml-auto font-mono text-[12px]">
            本阶段提成合计{' '}
            <span className="font-bold text-primary">{formatTHB(stageGrand)}</span> ฿
          </span>
        )}
      </div>

      {/* 合并组额外说明 */}
      {stage.is_merged && stage.source_stages && (
        <div className="rounded border border-emerald-400/40 bg-emerald-50/50 px-3 py-1.5 text-[11.5px] text-emerald-800">
          该合并组包含原始阶段：
          <span className="font-mono ml-1">
            {stage.source_stages.join(' + ')}
          </span>
          ，引擎按日汇总组内所有阶段的数据后匹配一条规则
        </div>
      )}

      {/* 分阶段金额提点 */}
      <div className="rounded-md border border-border p-3">
        <div className="flex items-center justify-between">
          <div className="text-[13px] font-medium">
            {stage.stage_commission.rule_name || `${stage.stage} 阶段金额提点`}
            {stage.stage_commission.rule_id && (
              <span className="ml-2 text-[10.5px] text-muted-foreground font-normal">
                (STAGE_AMOUNT_TIER · {stage.is_merged ? '合并组按总额匹配' : '独立匹配'})
              </span>
            )}
          </div>
          {stage.stage_commission.commission > 0 ? (
            <Badge className="bg-[#e3efe9] text-primary hover:bg-[#e3efe9]">✓ 命中</Badge>
          ) : (
            <Badge variant="outline">未命中</Badge>
          )}
        </div>
        <div className="mt-2 grid grid-cols-4 gap-2 text-[12.5px]">
          <InfoBox label="阶段月回款" value={formatTHB(stage.stage_commission.total_amount) + ' ฿'} />
          <InfoBox label="命中阶梯" value={stage.stage_commission.range_text ?? '-'} />
          <InfoBox label="提点比例" value={stage.stage_commission.percentage !== null ? formatPct(stage.stage_commission.percentage) : '-'} />
          <InfoBox label="提成金额" value={formatTHB(stage.stage_commission.commission) + ' ฿'} highlight={stage.stage_commission.commission > 0} />
        </div>
      </div>

      {/* 日达成提成 */}
      <DailyHitsSection stage={stage} />
    </section>
  );
}

/* ============ 日提成明细表 ============ */
function DailyHitsSection({ stage }: { stage: SettlementDetail['stages'][number] }) {
  const hits = stage.daily_hits ?? [];
  const dailyTotal = hits.reduce((s, h) => s + h.commission, 0);

  if (hits.length === 0) {
    return (
      <div className="rounded-md border border-border bg-paper-soft p-4 text-center text-[12px] text-muted-foreground">
        {`${stage.stage} 阶段无日达成提成记录（本月 ${hits.length} 天命中规则）`}
      </div>
    );
  }

  // 按 rule_id 分组
  const byRule = new Map<number, { rule_id: number; rule_name: string; hits: typeof hits; total: number }>();
  hits.forEach((h) => {
    const g = byRule.get(h.rule_id) ?? { rule_id: h.rule_id, rule_name: h.rule_name, hits: [], total: 0 };
    g.hits.push(h);
    g.total += h.commission;
    byRule.set(h.rule_id, g);
  });

  return (
    <div className="rounded-md border border-border">
      <div className="flex items-center justify-between border-b border-border bg-paper-soft px-3 py-2.5">
        <span className="text-[13px] font-medium">
          日达成提成（{hits.length} 天命中）
        </span>
        <span className="font-mono text-[12.5px]">
          合计 <span className="font-bold text-primary">{formatTHB(dailyTotal)}</span> ฿
        </span>
      </div>

      <div className="divide-y divide-border">
        {[...byRule.values()].map((group) => (
          <div key={group.rule_id}>
            <div className="flex items-center justify-between bg-white px-3 py-1.5 text-[11.5px] border-b border-border/60">
              <span className="font-semibold text-emerald-700">
                📋 {group.rule_name} · {group.hits.length} 天
              </span>
              <span className="font-mono text-muted-foreground">
                小计 {formatTHB(group.total)} ฿
              </span>
            </div>

            <Table>
              <TableHeader>
                <TableRow className="data-table">
                  <TableHead className="h-8 px-3">日期</TableHead>
                  <TableHead className="h-8 px-3 text-right">指标值</TableHead>
                  <TableHead className="h-8 px-3">命中阶梯</TableHead>
                  <TableHead className="h-8 px-3 text-right">当日数据</TableHead>
                  <TableHead className="h-8 px-3">计算方式</TableHead>
                  <TableHead className="h-8 px-3 text-right">提成</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {group.hits.map((h, i) => {
                  const calcText = buildCalcText(h);
                  return (
                    <TableRow key={`${h.date}-${h.rule_id}-${i}`}>
                      <TableCell className="px-3 font-mono text-[12px]">{h.date}</TableCell>
                      <TableCell className="px-3 text-right font-mono text-[12px]">
                        {h.metric_value}
                      </TableCell>
                      <TableCell className="px-3 font-mono text-[12px]">{h.range_text}</TableCell>
                      <TableCell className="px-3 text-right font-mono text-[11px] text-muted-foreground">
                        {h.orders}单 · {formatTHB(h.amount)}
                      </TableCell>
                      <TableCell className="px-3 text-right font-mono text-[11px] text-muted-foreground">
                        {calcText}
                      </TableCell>
                      <TableCell className={`px-3 text-right font-mono text-[12px] font-medium ${h.commission > 0 ? 'text-primary' : 'text-muted-foreground'}`}>
                        {formatTHB(h.commission)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ))}
      </div>
    </div>
  );
}

function buildCalcText(h: {
  reward_type: string;
  reward_value: number;
  orders?: number;
  amount?: number;
  commission: number;
}): string {
  if (h.reward_type === 'UNIT_PRICE') {
    return `${h.reward_value} × ${h.orders ?? '?'}`;
  }
  if (h.reward_type === 'PERCENTAGE') {
    return `${(h.reward_value * 100).toFixed(2)}% × ${formatTHB(h.amount ?? 0)}`;
  }
  if (h.reward_type === 'FIXED_AMOUNT') {
    return `固定 ${formatTHB(h.reward_value)}`;
  }
  return '-';
}

function InfoBox({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded border ${highlight ? 'border-primary/40 bg-primary/5' : 'border-border bg-white'} px-3 py-2`}>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={`mt-0.5 font-mono font-semibold ${highlight ? 'text-primary' : 'text-foreground'}`}>
        {value}
      </div>
    </div>
  );
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
