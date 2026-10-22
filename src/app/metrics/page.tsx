'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
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
import { MetricDialog } from './metric-dialog';
import type { MetricConfig } from '@/lib/types';

const SCOPE_LABEL: Record<string, string> = {
  PERF: '绩效考核',
  COMMISSION: '提成',
  BOTH: '通用',
};
const PERIOD_LABEL: Record<string, string> = {
  MONTHLY: '月度',
  DAILY: '日',
};

export default function MetricsPage() {
  const [list, setList] = useState<MetricConfig[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<MetricConfig | null>(null);
  const [deleting, setDeleting] = useState<MetricConfig | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/metrics', { cache: 'no-store' });
    const json = await res.json();
    if (json.success) setList(json.data as MetricConfig[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const confirmDelete = async () => {
    if (!deleting) return;
    const res = await fetch(`/api/metrics?id=${deleting.metric_id}`, { method: 'DELETE' });
    if (res.ok) {
      toast.success('指标已删除');
      void load();
    } else {
      toast.error('删除失败，可能已被条件/规则引用');
    }
    setDeleting(null);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">指标库配置</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            自定义指标用于绩效考核达成条件与提成方案指标选择，共 {list.length} 个
          </p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
        >
          <Plus size={15} />
          新增指标
        </Button>
      </div>

      <div className="overflow-hidden rounded-md border border-border bg-white">
        <Table>
          <TableHeader>
            <TableRow className="data-table">
              <TableHead className="h-9 px-4">编码</TableHead>
              <TableHead className="h-9 px-4">指标名称</TableHead>
              <TableHead className="h-9 px-4">适用场景</TableHead>
              <TableHead className="h-9 px-4">周期</TableHead>
              <TableHead className="h-9 px-4">数据来源字段</TableHead>
              <TableHead className="h-9 px-4">单位</TableHead>
              <TableHead className="h-9 px-4">状态</TableHead>
              <TableHead className="h-9 px-4 text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map((m) => (
              <TableRow key={m.metric_code}>
                <TableCell className="px-4 font-mono text-[12.5px] font-medium">{m.metric_code}</TableCell>
                <TableCell className="px-4 text-[13px]">{m.metric_name}</TableCell>
                <TableCell className="px-4 text-[12.5px]">
                  <Badge variant="secondary" className="font-mono text-[11px]">
                    {SCOPE_LABEL[m.scope] ?? m.scope}
                  </Badge>
                </TableCell>
                <TableCell className="px-4 text-[12.5px]">{PERIOD_LABEL[m.period] ?? m.period}</TableCell>
                <TableCell className="px-4 font-mono text-[12px] text-muted-foreground">{m.source_field}</TableCell>
                <TableCell className="px-4 font-mono text-[12.5px]">{m.unit || '-'}</TableCell>
                <TableCell className="px-4">
                  {m.enabled ? (
                    <Badge className="bg-[#e3efe9] text-primary">启用</Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground">停用</Badge>
                  )}
                </TableCell>
                <TableCell className="px-4">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground"
                      onClick={() => {
                        setEditing(m);
                        setDialogOpen(true);
                      }}
                    >
                      <Pencil size={14} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-vermilion"
                      onClick={() => setDeleting(m)}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {list.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-12 text-center text-[13px] text-muted-foreground">
                  暂无指标，请点击「新增指标」
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <MetricDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        metric={editing}
        onSaved={() => {
          setDialogOpen(false);
          void load();
        }}
      />

      <AlertDialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除指标</AlertDialogTitle>
            <AlertDialogDescription>
              确定删除指标「{deleting?.metric_name}」吗？该操作不可撤销，若已被条件或规则引用将无法删除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}