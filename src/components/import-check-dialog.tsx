'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Loader2, CheckCircle2, AlertTriangle, XCircle, ChevronDown, ChevronRight } from 'lucide-react';

interface StageBreakdown {
  stage: string;
  rows: number;
}

interface ImportCheckRow {
  employee_id: string;
  employee_name: string;
  department: string;
  default_stage: string;
  total_rows: number;
  unique_dates: number;
  expected_days: number;
  missing_dates: string[];
  missing_count: number;
  stage_breakdown: StageBreakdown[];
  complete: boolean;
}

interface CheckReport {
  from: string;
  to: string;
  total_days: number;
  total_rows: number;
  employee_count: number;
  with_data: number;
  complete_count: number;
  missing_count: number;
  no_data_count: number;
  rows: ImportCheckRow[];
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  from: string;
  to: string;
  dept?: string;
  employee?: string;
}

/**
 * 数据检查对话框 —— 核算工资/奖励前先看数据导入完整度
 */
export function ImportCheckDialog({ open, onOpenChange, from, to, dept, employee }: Props) {
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<CheckReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setReport(null);
    setExpanded(new Set());

    const params = new URLSearchParams({ from, to });
    if (dept) params.set('dept', dept);
    if (employee) params.set('employee', employee);

    fetch(`/api/import/daily/check?${params}`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (!j.success) throw new Error(j.error ?? '检查失败');
        setReport(j.data);
      })
      .catch((e: any) => {
        if (cancelled) return;
        setError(e.message ?? '检查失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, from, to, dept, employee]);

  function toggle(eid: string) {
    const next = new Set(expanded);
    if (next.has(eid)) next.delete(eid);
    else next.add(eid);
    setExpanded(next);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[85vh] overflow-hidden flex flex-col p-0">
        <DialogHeader className="px-6 py-4 border-b border-border">
          <DialogTitle className="flex items-center gap-2 text-base">
            📊 数据检查
            {report && (
              <span className="text-xs text-muted-foreground font-normal">
                ({report.from} ~ {report.to}，共 {report.total_days} 天)
              </span>
            )}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            检查该区间内每日运营数据的导入完整度，核算工资/奖励前建议先确认
          </DialogDescription>
        </DialogHeader>

        {/* 汇总卡片 */}
        {report && (
          <div className="grid grid-cols-5 gap-3 px-6 py-3 bg-muted/30 border-b border-border">
            <StatCard label="区间天数" value={report.total_days} color="default" />
            <StatCard label="在职员工" value={report.employee_count} color="default" />
            <StatCard label="有数据" value={report.with_data} color="teal" />
            <StatCard label="完全齐全" value={report.complete_count} color="green" icon={<CheckCircle2 size={13} />} />
            <StatCard label="有缺失" value={report.missing_count + report.no_data_count} color="amber" icon={<AlertTriangle size={13} />} />
          </div>
        )}

        {/* 内容区 */}
        <div className="flex-1 overflow-auto">
          {loading && (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Loader2 size={32} className="animate-spin mb-3 text-primary" />
              <span className="text-sm">正在检查数据...</span>
            </div>
          )}

          {error && (
            <div className="flex flex-col items-center justify-center py-16">
              <XCircle size={32} className="text-destructive mb-3" />
              <span className="text-sm text-destructive">{error}</span>
            </div>
          )}

          {report && report.rows.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <AlertTriangle size={32} className="text-amber-500 mb-3" />
              <span className="text-sm">该区间内没有任何员工数据</span>
            </div>
          )}

          {report && report.rows.length > 0 && (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-background z-10">
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="w-8 px-3 py-2"></th>
                  <th className="px-3 py-2 text-left font-medium">工号</th>
                  <th className="px-3 py-2 text-left font-medium">姓名</th>
                  <th className="px-3 py-2 text-left font-medium">部门</th>
                  <th className="px-3 py-2 text-center font-medium">阶段数</th>
                  <th className="px-3 py-2 text-center font-medium">数据行</th>
                  <th className="px-3 py-2 text-center font-medium">覆盖天数</th>
                  <th className="px-3 py-2 text-center font-medium">应/缺</th>
                  <th className="px-3 py-2 text-left font-medium">状态</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => {
                  const isOpen = expanded.has(row.employee_id);
                  return (
                    <>
                      <tr
                        key={row.employee_id}
                        className="border-b border-border/60 hover:bg-muted/40 cursor-pointer"
                        onClick={() => toggle(row.employee_id)}
                      >
                        <td className="px-3 py-2">
                          {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">{row.employee_id}</td>
                        <td className="px-3 py-2">{row.employee_name}</td>
                        <td className="px-3 py-2 text-xs">{row.department}</td>
                        <td className="px-3 py-2 text-center tabular-nums">{row.stage_breakdown.length}</td>
                        <td className="px-3 py-2 text-center tabular-nums">{row.total_rows}</td>
                        <td className="px-3 py-2 text-center tabular-nums">{row.unique_dates}</td>
                        <td className="px-3 py-2 text-center tabular-nums text-xs">
                          <span className="text-muted-foreground">{row.expected_days}</span>
                          <span className="mx-1">/</span>
                          <span className={row.missing_count > 0 ? 'text-amber-500 font-semibold' : 'text-green-500'}>
                            {row.missing_count}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          {row.complete ? (
                            <span className="inline-flex items-center gap-1 text-green-600 text-xs font-medium">
                              <CheckCircle2 size={12} /> 齐全
                            </span>
                          ) : row.total_rows === 0 ? (
                            <span className="inline-flex items-center gap-1 text-destructive text-xs font-medium">
                              <XCircle size={12} /> 无数据
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-amber-500 text-xs font-medium">
                              <AlertTriangle size={12} /> 缺 {row.missing_count} 天
                            </span>
                          )}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr key={`${row.employee_id}-detail`} className="bg-muted/20">
                          <td colSpan={9} className="px-6 py-3">
                            {/* 阶段明细 */}
                            {row.stage_breakdown.length > 0 && (
                              <div className="mb-3">
                                <div className="text-xs text-muted-foreground mb-1.5">📋 各阶段数据量</div>
                                <div className="flex flex-wrap gap-1.5">
                                  {row.stage_breakdown.map((s) => (
                                    <span
                                      key={s.stage}
                                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary/10 text-primary text-xs font-medium"
                                    >
                                      {s.stage}
                                      <span className="opacity-70">× {s.rows}</span>
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                            {/* 缺失日期 */}
                            {row.missing_dates.length > 0 ? (
                              <div>
                                <div className="text-xs text-muted-foreground mb-1.5">
                                  ❌ 缺失 {row.missing_count} 天 ({Math.round((row.missing_count / row.expected_days) * 100)}%)
                                </div>
                                <div className="flex flex-wrap gap-1">
                                  {row.missing_dates.map((d) => (
                                    <span
                                      key={d}
                                      className="px-1.5 py-0.5 rounded border border-destructive/30 bg-destructive/5 text-destructive text-[11px] font-mono"
                                    >
                                      {d.slice(5).replace('-', '/')}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            ) : (
                              <div className="text-xs text-green-600">
                                ✅ 区间内每日数据齐全
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StatCard({
  label,
  value,
  color,
  icon,
}: {
  label: string;
  value: number;
  color: 'default' | 'teal' | 'green' | 'amber';
  icon?: React.ReactNode;
}) {
  const colorMap = {
    default: 'text-foreground',
    teal: 'text-teal-600',
    green: 'text-green-600',
    amber: 'text-amber-500',
  };
  return (
    <div className="flex flex-col items-center justify-center py-1.5 px-2 rounded-md bg-background border border-border">
      <span className="text-[11px] text-muted-foreground mb-0.5">{label}</span>
      <span className={`text-xl font-semibold tabular-nums flex items-center gap-1 ${colorMap[color]}`}>
        {icon}
        {value}
      </span>
    </div>
  );
}
