'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatTHB } from '@/lib/format';
import * as XLSX from 'xlsx';

interface ReportRow {
  month: string;
  employee_id: string;
  employee_name: string;
  dept_name: string;
  base_salary: number;
  performance_bonus: number;
  full_attendance_bonus: number;
  commission: number;
  salary_total: number;
  reward_total: number;
  total_income: number;
}

interface ReportResponse {
  totals: {
    employee_count: number;
    base_salary: number;
    performance_bonus: number;
    full_attendance_bonus: number;
    commission: number;
    salary_total: number;
    reward_total: number;
    total_income: number;
  };
  rows: ReportRow[];
}

const MONTHS = ['2026-01','2026-02','2026-03','2026-04','2026-05','2026-06','2026-07','2026-08','2026-09','2026-10','2026-11','2026-12'];

export default function ReportsPage() {
  const [mode, setMode] = useState<'SINGLE' | 'RANGE' | 'EMPLOYEE'>('SINGLE');
  const [month, setMonth] = useState('2026-09');
  const [from, setFrom] = useState('2026-07');
  const [to, setTo] = useState('2026-09');
  const [dept, setDept] = useState('ALL');
  const [employeeId, setEmployeeId] = useState('');
  const [employees, setEmployees] = useState<{ employee_id: string; employee_name: string; department: string | null }[]>([]);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ReportResponse | null>(null);
  const [err, setErr] = useState('');

  // 加载员工列表（下拉）
  useEffect(() => {
    fetch('/api/employees').then(r => r.json()).then(j => setEmployees(j.data || [])).catch(() => {});
  }, []);

  // 加载部门列表
  const depts = useMemo(() => {
    const s = new Set<string>();
    for (const e of employees) if (e.department) s.add(e.department);
    return ['ALL', ...[...s].sort()];
  }, [employees]);

  async function load() {
    setLoading(true); setErr('');
    const params = new URLSearchParams();
    if (mode === 'SINGLE') params.set('month', month);
    else {
      params.set('from', from);
      params.set('to', to);
    }
    if (mode === 'EMPLOYEE' && employeeId) params.set('employee_id', employeeId);
    const d = dept !== 'ALL' ? dept : '';
    if (d) params.set('dept_name', d);

    try {
      const r = await fetch(`/api/reports/monthly?${params.toString()}`);
      const j = await r.json();
      if (!r.ok) { setErr(j.error || '查询失败'); setData(null); }
      else setData(j);
    } catch (e) {
      setErr('网络错误');
    } finally {
      setLoading(false);
    }
  }

  function exportExcel() {
    if (!data || data.rows.length === 0) return;
    const sheetRows = data.rows.map((r) => ({
      月份: r.month,
      工号: r.employee_id,
      姓名: r.employee_name,
      部门: r.dept_name,
      底薪: r.base_salary,
      绩效: r.performance_bonus,
      全勤: r.full_attendance_bonus,
      提成: r.commission,
      工资合计: r.salary_total,
      奖励合计: r.reward_total,
      月收入: r.total_income,
    }));
    sheetRows.push({
      月份: '合计', 工号: '', 姓名: '', 部门: '',
      底薪: data.totals.base_salary,
      绩效: data.totals.performance_bonus,
      全勤: data.totals.full_attendance_bonus,
      提成: data.totals.commission,
      工资合计: data.totals.salary_total,
      奖励合计: data.totals.reward_total,
      月收入: data.totals.total_income,
    });
    const ws = XLSX.utils.json_to_sheet(sheetRows);
    ws['!cols'] = [{ wch: 10 }, { wch: 22 }, { wch: 14 }, { wch: 10 }, ...Array(7).fill({ wch: 10 })];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '收入报表');
    const fname = mode === 'SINGLE'
      ? `收入报表_${month}.xlsx`
      : `收入报表_${from}-${to}.xlsx`;
    XLSX.writeFile(wb, fname);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">📊 收入报表</h1>
          <p className="text-xs text-muted-foreground">数据源：已归档的工资/奖励发放快照 · 只统计已实发</p>
        </div>
        <Button size="sm" variant="outline" onClick={exportExcel} disabled={!data || data.rows.length === 0}>
          📥 导出 Excel
        </Button>
      </div>

      {/* 筛选栏 */}
      <div className="rounded-md border border-border/60 bg-muted/10 p-3 space-y-3">
        {/* 模式切换 */}
        <div className="flex gap-1">
          {([['SINGLE', '单月汇总'], ['RANGE', '区间明细'], ['EMPLOYEE', '员工全年']] as const).map(([v, l]) => (
            <button
              key={v}
              onClick={() => setMode(v)}
              className={`px-3 py-1 rounded text-xs border transition ${
                mode === v ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border hover:bg-muted'
              }`}
            >
              {l}
            </button>
          ))}
        </div>

        {/* 条件 */}
        <div className="flex flex-wrap gap-3 items-end">
          {mode === 'SINGLE' && (
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground">月份</label>
              <select value={month} onChange={(e) => setMonth(e.target.value)} className="h-8 rounded border border-border bg-background px-2 text-xs">
                {MONTHS.map(m => <option key={m}>{m}</option>)}
              </select>
            </div>
          )}
          {mode === 'RANGE' && (
            <>
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">起始月</label>
                <select value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 rounded border border-border bg-background px-2 text-xs">
                  {MONTHS.map(m => <option key={m}>{m}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground">结束月</label>
                <select value={to} onChange={(e) => setTo(e.target.value)} className="h-8 rounded border border-border bg-background px-2 text-xs">
                  {MONTHS.map(m => <option key={m}>{m}</option>)}
                </select>
              </div>
            </>
          )}
          {mode === 'EMPLOYEE' && (
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground">员工</label>
              <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className="h-8 rounded border border-border bg-background px-2 text-xs min-w-[200px]">
                <option value="">全部</option>
                {employees.map(e => (
                  <option key={e.employee_id} value={e.employee_id}>
                    {e.employee_id} · {e.employee_name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-1">
            <label className="text-[11px] text-muted-foreground">部门</label>
            <select value={dept} onChange={(e) => setDept(e.target.value)} className="h-8 rounded border border-border bg-background px-2 text-xs min-w-[120px]">
              {depts.map(d => <option key={d}>{d}</option>)}
            </select>
          </div>

          <Button size="sm" onClick={load} disabled={loading}>
            {loading ? '查询中...' : '🔍 查询'}
          </Button>
        </div>
      </div>

      {/* 汇总卡片 */}
      {data && data.rows.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="员工人次" value={`${data.totals.employee_count}`} hint="统计行数" />
          <StatCard label="工资合计" value={formatTHB(data.totals.salary_total)} hint="底薪+绩效+全勤+提成" />
          <StatCard label="奖励合计" value={formatTHB(data.totals.reward_total)} hint="周/月奖励合计" />
          <StatCard label="总收入" value={formatTHB(data.totals.total_income)} hint="工资+奖励" highlight />
        </div>
      )}

      {/* 表格 */}
      <div className="rounded-md border border-border/60 overflow-hidden bg-background">
        {err && <div className="p-4 text-sm text-destructive text-center">{err}</div>}
        {!data && !err && <div className="p-12 text-center text-sm text-muted-foreground">← 设置条件后点「查询」</div>}
        {data && data.rows.length === 0 && !err && (
          <div className="p-12 text-center text-sm text-muted-foreground">
            没有找到已归档的发放数据
          </div>
        )}
        {data && data.rows.length > 0 && (
          <table className="w-full text-[12.5px]">
            <thead className="bg-muted/50">
              <tr className="border-b border-border/60">
                <Th>月份</Th>
                <Th>工号</Th>
                <Th>姓名</Th>
                <Th>部门</Th>
                <Th className="text-right">底薪</Th>
                <Th className="text-right">绩效</Th>
                <Th className="text-right">全勤</Th>
                <Th className="text-right">提成</Th>
                <Th className="text-right font-semibold">工资合计</Th>
                <Th className="text-right font-semibold">奖励</Th>
                <Th className="text-right font-bold text-gold">月收入</Th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r, i) => (
                <tr key={`${r.month}-${r.employee_id}`} className={i % 2 ? 'bg-muted/20' : ''}>
                  <Td>{r.month}</Td>
                  <Td className="font-mono">{r.employee_id}</Td>
                  <Td>{r.employee_name}</Td>
                  <Td>{r.dept_name}</Td>
                  <Td className="text-right tabular-nums">{formatTHB(r.base_salary)}</Td>
                  <Td className="text-right tabular-nums">{formatTHB(r.performance_bonus)}</Td>
                  <Td className="text-right tabular-nums">{formatTHB(r.full_attendance_bonus)}</Td>
                  <Td className="text-right tabular-nums">{formatTHB(r.commission)}</Td>
                  <Td className="text-right tabular-nums">{formatTHB(r.salary_total)}</Td>
                  <Td className="text-right tabular-nums">{formatTHB(r.reward_total)}</Td>
                  <Td className="text-right tabular-nums font-semibold text-gold">{formatTHB(r.total_income)}</Td>
                </tr>
              ))}
              <tr className="bg-muted/50 border-t border-border font-semibold">
                <Td colSpan={4}>合计 {data.totals.employee_count} 人次</Td>
                <Td className="text-right tabular-nums">{formatTHB(data.totals.base_salary)}</Td>
                <Td className="text-right tabular-nums">{formatTHB(data.totals.performance_bonus)}</Td>
                <Td className="text-right tabular-nums">{formatTHB(data.totals.full_attendance_bonus)}</Td>
                <Td className="text-right tabular-nums">{formatTHB(data.totals.commission)}</Td>
                <Td className="text-right tabular-nums">{formatTHB(data.totals.salary_total)}</Td>
                <Td className="text-right tabular-nums">{formatTHB(data.totals.reward_total)}</Td>
                <Td className="text-right tabular-nums text-gold">{formatTHB(data.totals.total_income)}</Td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-[11.5px] font-medium text-muted-foreground ${className}`}>{children}</th>;
}
function Td({ children, className = '', colSpan }: { children: React.ReactNode; className?: string; colSpan?: number }) {
  return <td className={`px-3 py-1.5 border-b border-border/20 ${className}`} colSpan={colSpan}>{children}</td>;
}
function StatCard({ label, value, hint, highlight }: { label: string; value: string; hint?: string; highlight?: boolean }) {
  return (
    <div className={`rounded-md border p-3 ${highlight ? 'border-gold/40 bg-gold/5' : 'border-border/60 bg-background'}`}>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold mt-1 ${highlight ? 'text-gold' : ''}`}>{value}</div>
      {hint && <div className="text-[10.5px] text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}
