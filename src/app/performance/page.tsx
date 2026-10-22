'use client';

import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { SchemeDialog } from './scheme-dialog';
import { formatTHB } from '@/lib/format';
import type { PerformanceCondition, PerformanceScheme } from '@/lib/types';

const OP: Record<string, string> = { GTE: '≥', LTE: '≤', GT: '>', LT: '<' };
function condText(c: PerformanceCondition, mLabel: (code: string) => string): string {
  const th = Number(c.threshold_value);
  return `${mLabel(c.metric)} ${OP[c.operator ?? 'GTE'] ?? '≥'} ${th}`;
}

interface Row {
  dept_code: string;
  dept_name: string;
  scheme: PerformanceScheme | null;
}

export default function PerformancePage() {
  const [list, setList] = useState<Row[]>([]);
  const [editing, setEditing] = useState<Row | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState<Row | null>(null);
  const [metricMap, setMetricMap] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch('/api/metrics?scope=PERF')
      .then((r) => r.json())
      .then((j) => {
        const map: Record<string, string> = {};
        (j.data ?? []).forEach((m: { metric_code: string; metric_name: string }) => {
          map[m.metric_code] = m.metric_name;
        });
        setMetricMap(map);
      })
      .catch(() => {});
  }, []);
  const mLabel = (code: string) => metricMap[code] ?? code;

  const load = useCallback(async () => {
    const res = await fetch('/api/performance-schemes', { cache: 'no-store' });
    const json = await res.json();
    if (json.success) setList(json.data as Row[]);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const confirmDelete = async () => {
    if (!deleting) return;
    const res = await fetch(`/api/performance-schemes?dept_name=${encodeURIComponent(deleting.dept_name)}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.success) {
      toast.success('已删除');
      void load();
    } else {
      toast.error(json.error ?? '删除失败');
    }
    setDeleting(null);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">绩效考核方案</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            一部门一份方案：底薪 + 绩效工资 + 月度门槛；整月判定、与阶段无关；部门内所有员工共享
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-md border border-border bg-white">
        <Table>
          <TableHeader>
            <TableRow className="data-table">
              <TableHead className="h-10">部门</TableHead>
              <TableHead className="h-10 text-right">基本工资</TableHead>
              <TableHead className="h-10 text-right">绩效工资</TableHead>
              <TableHead className="h-10">月度门槛</TableHead>
              <TableHead className="h-10 text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map((row) => {
              const s = row.scheme;
              return (
                <TableRow key={row.dept_name}>
                  <TableCell>
                    <div className="font-medium">{row.dept_name}</div>
                    <div className="font-mono text-[11.5px] text-muted-foreground">{row.dept_code}</div>
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {s ? `${formatTHB(s.base_salary)} ฿` : <span className="text-muted-foreground">-</span>}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {s ? `${formatTHB(s.performance_bonus)} ฿` : <span className="text-muted-foreground">-</span>}
                  </TableCell>
                  <TableCell>
                    {s ? (
                      <div className="flex max-w-[320px] flex-col gap-1.5 py-1">
                        {(s.groups ?? []).map((g, gi) => (
                          <div key={g.group_id ?? gi} className="rounded-sm border border-[#e6e1d5] px-2 py-1">
                            <div className="flex flex-wrap items-center gap-x-1 font-mono text-[12px]">
                              <span className="text-[11px] font-semibold text-emerald-700">G{gi + 1}</span>
                              {g.conditions.map((c, ci) => (
                                <span key={c.condition_id ?? ci} className="flex items-center">
                                  <span className="text-muted-foreground">{mLabel(c.metric)}</span>
                                  <span className="mx-0.5">{OP[c.operator ?? 'GTE'] ?? '≥'}</span>
                                  <span className="font-semibold">{c.threshold_value}</span>
                                  {ci < g.conditions.length - 1 && (
                                    <span className="mx-1 text-[10px] text-gold">且</span>
                                  )}
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}
                        {(s.groups ?? []).length > 1 && (
                          <span className="text-[11px] text-gold">· 任一组（或）满足即达标</span>
                        )}
                      </div>
                    ) : (
                      <Badge variant="outline" className="text-vermilion">未配置</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground"
                        onClick={() => { setEditing(row); setDialogOpen(true); }}
                      >
                        {s ? <Pencil size={14} /> : <Plus size={14} />}
                      </Button>
                      {s && (
                        <Button
                          variant="ghost" size="icon" className="h-8 w-8 text-vermilion"
                          onClick={() => setDeleting(row)}
                        >
                          <Trash2 size={14} />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
            {list.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-[13px] text-muted-foreground">
                  暂无部门，请先在「部门管理」创建
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <SchemeDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        row={editing}
        onSaved={() => {
          toast.success('绩效考核方案已保存');
          setDialogOpen(false);
          void load();
        }}
      />

      <AlertDialog open={Boolean(deleting)} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除「{deleting?.dept_name}」的绩效考核方案？</AlertDialogTitle>
            <AlertDialogDescription>
              删除后该部门员工将无绩效工资。部门本身不会被删除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction className="bg-vermilion hover:bg-vermilion/90" onClick={() => void confirmDelete()}>
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
