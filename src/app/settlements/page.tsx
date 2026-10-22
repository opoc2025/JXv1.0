'use client';

import { useCallback, useEffect, useState } from 'react';
import { Calculator, FileDown, Eye, BadgeCheck, Trash2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { SettlementDetailDrawer } from './settlement-detail';
import { exportSettlement, type ExportSettlementRow } from '@/lib/excel';
import { useMonth } from '@/components/month-context';
import { formatTHB } from '@/lib/format';
import type { Settlement, SettlementDetail } from '@/lib/types';

type Row = Settlement & {
  employee: {
    employee_name: string;
    department: string | null;
    default_stage: string;
    commission_plan: 'A' | 'B';
  } | null;
};

interface VerifyItem {
  employee_id: string;
  name: string;
  stage: string;
  daily_rows: number; // 该员工该月该阶段日数据行数
  settled?: boolean;  // 是否已结算
  issue?: string;     // 问题描述
}

interface VerifyReport {
  month: string;
  daily_total: number;    // 日数据总行数
  settled_total: number;  // 结算总行数
  matched: number;        // 匹配的员工数
  missing_settlement: VerifyItem[]; // 有日数据但没结算
  orphan_settlement: VerifyItem[];  // 有结算但没日数据
  no_daily_data: VerifyItem[];      // 在职员工但无任何日数据
}

export default function SettlementsPage() {
  const { month } = useMonth();
  const [rows, setRows] = useState<Row[]>([]);
  const [calculating, setCalculating] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyReport, setVerifyReport] = useState<VerifyReport | null>(null);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [drawerRow, setDrawerRow] = useState<Row | null>(null);
  const [finalizing, setFinalizing] = useState<Row | null>(null);
  const [deptFilter, setDeptFilter] = useState<string>('ALL');

  const deptOptions = Array.from(new Set(rows.map((r) => r.employee?.department).filter(Boolean) as string[]))
    .sort((a,b) => a.localeCompare(b,'zh'));
  const filteredRows = deptFilter === 'ALL'
    ? rows
    : rows.filter((r) => r.employee?.department === deptFilter);

  const load = useCallback(async () => {
    const res = await fetch(`/api/settlements?month=${month}`, { cache: 'no-store' });
    const json = await res.json();
    if (json.success) {
      // 按部门 + 工号排序
      const sorted = (json.data as Row[]).sort((a, b) => {
        const deptA = a.employee?.department ?? 'zzz';
        const deptB = b.employee?.department ?? 'zzz';
        if (deptA !== deptB) return deptA.localeCompare(deptB, 'zh');
        return a.employee_id.localeCompare(b.employee_id);
      });
      setRows(sorted);
    }
  }, [month]);

  useEffect(() => {
    void load();
  }, [load]);

  const runCalculate = async () => {
    setCalculating(true);
    const body: any = { month };
    if (deptFilter !== 'ALL') body.dept = deptFilter;
    const res = await fetch('/api/calculate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    setCalculating(false);
    if (json.success) {
      toast.success(
        `核算完成：计算 ${json.data.calculated} 人，新增 ${json.data.inserted}，更新 ${json.data.updated}${
          json.data.skipped_finalized ? `，跳过已终审 ${json.data.skipped_finalized}` : ''
        }`
      );
      void load();
    } else {
      toast.error(json.error ?? '核算失败');
    }
  };

  const clearMonthData = async () => {
    setClearing(true);
    setConfirmClearOpen(false);
    try {
      // 清结算数据
      const sRes = await fetch(`/api/settlements?month=${month}`, { method: 'DELETE' });
      const sJson = await sRes.json();
      if (!sJson.success) throw new Error(`清结算失败: ${sJson.error}`);

      // 清日数据（同一月份范围）
      const [year, mon] = month.split('-').map(Number);
      const nextMon = mon === 12 ? 1 : mon + 1;
      const nextYear = mon === 12 ? year + 1 : year;
      const rangeStart = `${month}-01`;
      const rangeEnd = `${nextYear}-${String(nextMon).padStart(2, '0')}-01`;
      const dRes = await fetch(
        `/api/import/daily?from=${encodeURIComponent(rangeStart)}&to=${encodeURIComponent(rangeEnd)}`,
        { method: 'DELETE' }
      );
      const dJson = await dRes.json();
      if (!dJson.success) throw new Error(`清日数据失败: ${dJson.error}`);

      toast.success(
        `${month} 结算(${sJson.data?.deleted ?? 0}) + 日数据(${dJson.data?.deleted ?? 0}) 已清空`
      );
      setVerifyReport(null);
      void load();
    } catch (e: any) {
      toast.error(e.message ?? '清空失败');
    }
    setClearing(false);
  };

  const verifyData = async () => {
    setVerifying(true);
    setVerifyReport(null);
    try {
      const [year, mon] = month.split('-').map(Number);
      const nextMon = mon === 12 ? 1 : mon + 1;
      const nextYear = mon === 12 ? year + 1 : year;
      const rangeStart = `${month}-01`;
      const rangeEnd = `${nextYear}-${String(nextMon).padStart(2, '0')}-01`;

      // 并发拉 3 份数据
      const [empsRes, dailyRes, settledRes] = await Promise.all([
        fetch('/api/employees').then((r) => r.json()),
        fetch(`/api/import/daily?month=${month}`).then((r) => r.json()),
        fetch(`/api/settlements?month=${month}`).then((r) => r.json()),
      ]);

      if (!empsRes.success) throw new Error(empsRes.error ?? '拉员工失败');
      if (!dailyRes.success) throw new Error(dailyRes.error ?? '拉日数据失败');
      if (!settledRes.success) throw new Error(settledRes.error ?? '拉结算失败');

      const allEmps = (empsRes.data ?? []) as any[];
      const dailyRows = (dailyRes.data ?? []) as any[];
      const settledRows = (settledRes.data ?? []) as any[];

      const dailySet = new Set(dailyRows.map((d: any) => `${d.employee_id}|${d.stage}`));
      const settledSet = new Set(settledRows.map((s: any) => `${s.employee_id}|${s.stage}`));
      const dailyEmps = new Set(dailyRows.map((d: any) => d.employee_id));

      // 只看在职员工
      const activeEmps = allEmps.filter((e: any) => e.status !== 'inactive');
      const nameMap = new Map(activeEmps.map((e) => [e.employee_id, e.employee_name]));

      const missing_settlement: VerifyItem[] = [];
      const orphan_settlement: VerifyItem[] = [];
      const no_daily_data: VerifyItem[] = [];

      dailySet.forEach((key) => {
        const [eid, stage] = key.split('|');
        if (!settledSet.has(key)) {
          missing_settlement.push({
            employee_id: eid,
            name: nameMap.get(eid) ?? '-',
            stage,
            daily_rows: 0,
            issue: '有日数据但未核算',
          });
        }
      });

      settledSet.forEach((key) => {
        const [eid, stage] = key.split('|');
        if (!dailySet.has(key)) {
          orphan_settlement.push({
            employee_id: eid,
            name: nameMap.get(eid) ?? '-',
            stage,
            daily_rows: 0,
            issue: '有结算但无日数据（上月残留）',
          });
        }
      });

      activeEmps.forEach((e: any) => {
        if (!dailyEmps.has(e.employee_id)) {
          no_daily_data.push({
            employee_id: e.employee_id,
            name: e.employee_name,
            stage: '-',
            daily_rows: 0,
            issue: '在职员工当月无任何日数据',
          });
        }
      });

      const report: VerifyReport = {
        month,
        daily_total: dailyRows.length,
        settled_total: settledRows.length,
        matched: dailySet.size - missing_settlement.length,
        missing_settlement,
        orphan_settlement,
        no_daily_data,
      };
      setVerifyReport(report);
      const totalIssues = missing_settlement.length + orphan_settlement.length + no_daily_data.length;
      if (totalIssues === 0) {
        toast.success(`✅ ${month} 数据完整：${dailySet.size} 员工/阶段 全部匹配结算`);
      } else {
        toast.warning(`发现 ${totalIssues} 个问题项`);
      }
    } catch (e: any) {
      toast.error(e.message ?? '核对失败');
    }
    setVerifying(false);
  };

  const confirmFinalize = async () => {
    if (!finalizing?.settlement_id) return;
    const res = await fetch('/api/settlements', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        settlement_id: finalizing.settlement_id,
        status: 'FINALIZED',
      }),
    });
    if (res.ok) {
      toast.success('已终审');
      void load();
    }
    setFinalizing(null);
  };

  const handleExport = () => {
    const exportRows: ExportSettlementRow[] = filteredRows.map((r) => ({
      employee_id: r.employee_id,
      employee_name: r.employee?.employee_name ?? '',
      department: r.employee?.department ?? null,
      stage: r.stage,
      base_salary: r.base_salary,
      monthly_performance_bonus: r.monthly_performance_bonus,
      daily_commission: r.daily_commission,
      monthly_total_commission: r.monthly_total_commission,
      stage_tier_commission: r.stage_tier_commission,
      progressive_commission: (r as any).progressive_commission ?? 0,
      actual_base_salary: (r as any).actual_base_salary ?? 0,
      full_attendance_bonus: (r as any).full_attendance_bonus ?? 0,
      total_salary: r.total_salary,
      status: r.status,
    }));
    exportSettlement(month, exportRows);
  };

  const colSums = filteredRows.reduce(
    (s, r) => {
      const a = r as any;
      s.base += r.base_salary;
      s.perf += r.monthly_performance_bonus;
      s.actualBase += a.actual_base_salary ?? 0;
      s.bonus += a.full_attendance_bonus ?? 0;
      s.daily += r.daily_commission;
      s.planA += r.monthly_total_commission;
      s.planB += r.stage_tier_commission;
      s.prog += a.progressive_commission ?? 0;
      s.total += r.total_salary;
      return s;
    },
    { base: 0, perf: 0, actualBase: 0, bonus: 0, daily: 0, planA: 0, planB: 0, prog: 0, total: 0 }
  );

  const baseTotal = colSums.actualBase + colSums.perf + colSums.bonus;
  const commTotal = colSums.daily + colSums.planA + colSums.planB + colSums.prog;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">薪酬核算</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {month} · 共 {rows.length} 人已核算
            {deptFilter !== 'ALL' && (
              <span className="ml-2">
                · 筛选 <span className="font-semibold text-foreground">{deptFilter}</span>（{filteredRows.length} 人）
              </span>
            )}
            ，应发合计{' '}
            <span className="font-mono font-semibold text-primary">
              {formatTHB(colSums.total)} ฿
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* 部门筛选 */}
          <select
            value={deptFilter}
            onChange={(e) => setDeptFilter(e.target.value)}
            className="h-9 rounded-md border border-border bg-white px-3 text-[13px] focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            <option value="ALL">全部部门</option>
            {deptOptions.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          <Button
            variant="outline"
            onClick={() => void verifyData()}
            disabled={verifying}
            title="核对日数据 vs 结算 vs 在职员工"
          >
            <CheckCircle2 size={15} className="text-teal-600" />
            {verifying ? '核对中...' : '一键核对'}
          </Button>
          <Button variant="outline" onClick={handleExport} disabled={rows.length === 0}>
            <FileDown size={15} />
            导出薪资汇总表
          </Button>
          <Button onClick={runCalculate} disabled={calculating}>
            <Calculator size={15} />
            {calculating ? '核算中...' : rows.length === 0 ? '一键核算全员薪资' : '重新核算'}
          </Button>
          <Button
            variant="ghost"
            onClick={() => setConfirmClearOpen(true)}
            disabled={clearing}
            className="text-vermilion hover:text-vermilion hover:bg-vermilion/10"
            title={`清空 ${month} 的结算+日数据`}
          >
            <Trash2 size={15} />
            {clearing ? '清空中...' : '清空当月数据'}
          </Button>
        </div>
      </div>

      {/* 核对报告 */}
      {verifyReport && (
        <VerifyReportPanel report={verifyReport} onClose={() => setVerifyReport(null)} />
      )}

      {/* 汇总统计卡片 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <div className="rounded-md border border-border bg-white p-3">
          <div className="text-[12px] text-muted-foreground">基础工资合计</div>
          <div className="mt-1 text-lg font-semibold font-mono text-foreground">
            {formatTHB(baseTotal)} ฿
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            实发底薪 {formatTHB(colSums.actualBase)} + 绩效 {formatTHB(colSums.perf)} + 全勤 {formatTHB(colSums.bonus)}
          </div>
        </div>
        <div className="rounded-md border border-border bg-white p-3">
          <div className="text-[12px] text-muted-foreground">提成合计</div>
          <div className="mt-1 text-lg font-semibold font-mono text-foreground">
            {formatTHB(commTotal)} ฿
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            日提 {formatTHB(colSums.daily)} · 月A {formatTHB(colSums.planA)} · 月B {formatTHB(colSums.planB)} · 累进 {formatTHB(colSums.prog)}
          </div>
        </div>
        <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
          <div className="text-[12px] text-primary/80">应发总工资</div>
          <div className="mt-1 text-lg font-bold font-mono text-primary">
            {formatTHB(colSums.total)} ฿
          </div>
          <div className="mt-1 text-[11px] text-primary/60">
            基础 {formatTHB(baseTotal)} + 提成 {formatTHB(commTotal)}
          </div>
        </div>
        <div className="rounded-md border border-border bg-white p-3">
          <div className="text-[12px] text-muted-foreground">实发底薪</div>
          <div className="mt-1 text-lg font-semibold font-mono">{formatTHB(colSums.actualBase)} ฿</div>
        </div>
        <div className="rounded-md border border-border bg-white p-3">
          <div className="text-[12px] text-muted-foreground">月度绩效</div>
          <div className="mt-1 text-lg font-semibold font-mono">{formatTHB(colSums.perf)} ฿</div>
        </div>
        <div className="rounded-md border border-border bg-white p-3">
          <div className="text-[12px] text-muted-foreground">全勤奖</div>
          <div className="mt-1 text-lg font-semibold font-mono">{formatTHB(colSums.bonus)} ฿</div>
        </div>
      </div>

      <div className="overflow-hidden rounded-md border border-border bg-white">
        <Table>
          <TableHeader>
            <TableRow className="data-table">
              <TableHead className="h-10 px-3">工号</TableHead>
              <TableHead className="h-10 px-3">姓名</TableHead>
              <TableHead className="h-10 px-3">团队</TableHead>
              <TableHead className="h-10 px-3">阶段</TableHead>
              <TableHead className="h-10 px-3 text-right">底薪</TableHead>
              <TableHead className="h-10 px-3 text-right">月度绩效</TableHead>
              <TableHead className="h-10 px-3 text-right">实发底薪</TableHead>
              <TableHead className="h-10 px-3 text-right">全勤奖</TableHead>
              <TableHead className="h-10 px-3 text-right">日提成</TableHead>
              <TableHead className="h-10 px-3 text-right">月度总回款提点</TableHead>
              <TableHead className="h-10 px-3 text-right">分阶段金额提点</TableHead>
              <TableHead className="h-10 px-3 text-right">超额累进提成</TableHead>
              <TableHead className="h-10 px-3 text-right">应发总工资</TableHead>
              <TableHead className="h-10 px-3">状态</TableHead>
              <TableHead className="h-10 px-3 text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredRows.map((r) => (
              <TableRow key={r.employee_id}>
                <TableCell className="px-3 font-mono text-[12.5px]">{r.employee_id}</TableCell>
                <TableCell className="px-3 text-[13px] font-medium">
                  {r.employee?.employee_name ?? '-'}
                </TableCell>
                <TableCell className="px-3 text-[12.5px] text-muted-foreground">
                  {r.employee?.department ?? '-'}
                </TableCell>
                <TableCell className="px-3 font-mono text-[12.5px]">{r.stage}</TableCell>
                <TableCell className="px-3 text-right font-mono text-[12.5px]">
                  {formatTHB(r.base_salary)}
                </TableCell>
                <TableCell className="px-3 text-right font-mono text-[12.5px]">
                  {formatTHB(r.monthly_performance_bonus)}
                </TableCell>
                <TableCell className="px-3 text-right font-mono text-[12.5px]">
                  {formatTHB((r as any).actual_base_salary ?? 0)}
                </TableCell>
                <TableCell className="px-3 text-right font-mono text-[12.5px]">
                  {formatTHB((r as any).full_attendance_bonus ?? 0)}
                </TableCell>
                <TableCell className="px-3 text-right font-mono text-[12.5px]">
                  {formatTHB(r.daily_commission)}
                </TableCell>
                <TableCell className="px-3 text-right font-mono text-[12.5px]">
                  {formatTHB(r.monthly_total_commission)}
                </TableCell>
                <TableCell className="px-3 text-right font-mono text-[12.5px]">
                  {formatTHB(r.stage_tier_commission)}
                </TableCell>
                <TableCell className="px-3 text-right font-mono text-[12.5px]">
                  {formatTHB((r as any).progressive_commission ?? 0)}
                </TableCell>
                <TableCell className="px-3 text-right font-mono text-[13px] font-bold text-primary">
                  {formatTHB(r.total_salary)}
                </TableCell>
                <TableCell className="px-3">
                  {r.status === 'FINALIZED' ? (
                    <Badge className="bg-[#e3efe9] text-primary hover:bg-[#e3efe9]">已终审</Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground">
                      草稿
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="px-3">
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground"
                      onClick={() => setDrawerRow(r)}
                    >
                      <Eye size={14} />
                    </Button>
                    {r.status !== 'FINALIZED' && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-primary"
                        onClick={() => setFinalizing(r)}
                      >
                        <BadgeCheck size={15} />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={12} className="py-14 text-center text-[13px] text-muted-foreground">
                  尚未核算，请确认已导入 {month} 的业务数据后点击「一键核算全员薪资」
                </TableCell>
              </TableRow>
            )}
          </TableBody>
          <TableFooter>
            <TableRow className="bg-muted/50 font-semibold">
              <TableCell className="px-3 text-[12.5px]">合计</TableCell>
              <TableCell className="px-3"></TableCell>
              <TableCell className="px-3"></TableCell>
              <TableCell className="px-3"></TableCell>
              <TableCell className="px-3 text-right font-mono text-[12.5px]">{formatTHB(colSums.base)}</TableCell>
              <TableCell className="px-3 text-right font-mono text-[12.5px]">{formatTHB(colSums.perf)}</TableCell>
              <TableCell className="px-3 text-right font-mono text-[12.5px]">{formatTHB(colSums.actualBase)}</TableCell>
              <TableCell className="px-3 text-right font-mono text-[12.5px]">{formatTHB(colSums.bonus)}</TableCell>
              <TableCell className="px-3 text-right font-mono text-[12.5px]">{formatTHB(colSums.daily)}</TableCell>
              <TableCell className="px-3 text-right font-mono text-[12.5px]">{formatTHB(colSums.planA)}</TableCell>
              <TableCell className="px-3 text-right font-mono text-[12.5px]">{formatTHB(colSums.planB)}</TableCell>
              <TableCell className="px-3 text-right font-mono text-[12.5px]">{formatTHB(colSums.prog)}</TableCell>
              <TableCell className="px-3 text-right font-mono text-[13px] font-bold text-primary">{formatTHB(colSums.total)}</TableCell>
              <TableCell className="px-3"></TableCell>
              <TableCell className="px-3"></TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>

      <SettlementDetailDrawer
        open={!!drawerRow}
        onOpenChange={(v) => !v && setDrawerRow(null)}
        name={drawerRow?.employee?.employee_name ?? ''}
        employeeId={drawerRow?.employee_id ?? ''}
        detail={(drawerRow?.detail ?? null) as SettlementDetail | null}
      />

      <AlertDialog open={!!finalizing} onOpenChange={(v) => !v && setFinalizing(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>终审确认</AlertDialogTitle>
            <AlertDialogDescription>
              确认终审 {finalizing?.employee?.employee_name}（{finalizing?.employee_id}）的薪资为{' '}
              <span className="font-mono font-semibold text-primary">
                {finalizing ? formatTHB(finalizing.total_salary) : ''} ฿
              </span>
              ？终审后重新核算将跳过该员工。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={confirmFinalize}>确认终审</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 清空数据确认 */}
      <AlertDialog open={confirmClearOpen} onOpenChange={setConfirmClearOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>⚠️ 清空 {month} 全部数据？</AlertDialogTitle>
            <AlertDialogDescription>
              将删除 <strong>{month}</strong> 的：
              <ul className="mt-2 ml-4 list-disc space-y-1">
                <li>所有日运营数据（import_daily_data）</li>
                <li>所有结算结果（salary_settlement_result）</li>
              </ul>
              此操作不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void clearMonthData()}
              className="bg-vermilion hover:bg-vermilion/90"
            >
              <Trash2 size={14} className="mr-1" />
              确认清空
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* =============== 核对报告面板 =============== */
function VerifyReportPanel({ report, onClose }: { report: VerifyReport; onClose: () => void }) {
  const totalIssues =
    report.missing_settlement.length + report.orphan_settlement.length + report.no_daily_data.length;
  const ok = totalIssues === 0;

  const ItemRow = ({ item }: { item: VerifyItem }) => (
    <div className="flex items-center justify-between gap-3 border-b border-border/60 py-1.5 text-[12.5px] last:border-0">
      <span className="font-mono text-muted-foreground w-[140px] truncate">{item.employee_id}</span>
      <span className="flex-1 truncate">{item.name}</span>
      <span className="text-muted-foreground w-[80px] text-right">{item.stage}</span>
      <span
        className={`w-[160px] text-right ${
          item.issue?.includes('未核算')
            ? 'text-amber-600'
            : item.issue?.includes('残留')
            ? 'text-slate-400'
            : 'text-vermilion'
        }`}
      >
        {item.issue}
      </span>
    </div>
  );

  return (
    <div className="rounded-md border border-border bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-medium ${
              ok
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-amber-50 text-amber-700'
            }`}
          >
            {ok ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
            {ok ? '数据完整' : `${totalIssues} 个问题`}
          </span>
          <span className="text-sm text-muted-foreground">
            {report.month} · 日数据 {report.daily_total} 行 · 结算 {report.settled_total} 条
          </span>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} className="h-7 text-xs">
          关闭
        </Button>
      </div>

      {ok ? (
        <p className="text-[12.5px] text-emerald-700">
          ✅ {report.month} 的在职员工、日数据、结算三者完全一致。
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-3">
          {/* 有日数据但未核算 */}
          {report.missing_settlement.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50/50 p-3">
              <h4 className="mb-1 text-[12px] font-semibold text-amber-800">
                ⚠ 有日数据但未核算 ({report.missing_settlement.length})
              </h4>
              <p className="mb-2 text-[11.5px] text-muted-foreground">
                日数据已导入但没有对应结算，可能漏跑了核算
              </p>
              <div className="max-h-[180px] overflow-y-auto">
                {report.missing_settlement.map((i) => (
                  <ItemRow key={`${i.employee_id}-${i.stage}`} item={i} />
                ))}
              </div>
            </div>
          )}

          {/* 有结算但无日数据 */}
          {report.orphan_settlement.length > 0 && (
            <div className="rounded-md border border-slate-200 bg-slate-50/50 p-3">
              <h4 className="mb-1 text-[12px] font-semibold text-slate-700">
                • 有结算但无日数据 ({report.orphan_settlement.length})
              </h4>
              <p className="mb-2 text-[11.5px] text-muted-foreground">
                常见于上月残留或手动编辑的结算
              </p>
              <div className="max-h-[180px] overflow-y-auto">
                {report.orphan_settlement.map((i) => (
                  <ItemRow key={`${i.employee_id}-${i.stage}`} item={i} />
                ))}
              </div>
            </div>
          )}

          {/* 在职员工无任何日数据 */}
          {report.no_daily_data.length > 0 && (
            <div className="rounded-md border border-vermilion/30 bg-vermilion-50/30 p-3">
              <h4 className="mb-1 text-[12px] font-semibold text-vermilion">
                ✕ 在职员工无日数据 ({report.no_daily_data.length})
              </h4>
              <p className="mb-2 text-[11.5px] text-muted-foreground">
                检查员工状态/参与阶段，或 Excel 是否漏导
              </p>
              <div className="max-h-[180px] overflow-y-auto">
                {report.no_daily_data.map((i) => (
                  <ItemRow key={i.employee_id} item={i} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
