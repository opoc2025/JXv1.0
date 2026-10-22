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
import { RuleDialog } from './rule-dialog';
import {
  COMMISSION_RULE_TYPES,
  RULE_TYPE_LABEL,
  REWARD_LABEL,
} from '@/lib/rule-labels';
import type { SalaryRuleWithTiers } from '@/lib/types';

// 提成指标显示名：优先指标库可读名称，其次内置标签
const METRIC_LABEL_ANY: Record<string, string> = {
  RATE: '订单达成率 (%)',
  ORDERS: '订单数 (单)',
  AMOUNT: '回款金额 (฿)',
  DAILY_RATE: '订单达成率',
  DAILY_ORDERS: '日回收单数',
  DAILY_AMOUNT: '日回款金额',
  AMOUNT_RATE: '金额达成率',
};

function metricName(code: string | null): string {
  if (!code) return '';
  return METRIC_LABEL_ANY[code] ?? code;
}

function formatTierValue(r: {
  reward_type: keyof typeof REWARD_LABEL;
  reward_value: number;
}): string {
  const v = r.reward_value;
  if (r.reward_type === 'PERCENTAGE') return `${v * 100}%`;
  if (r.reward_type === 'UNIT_PRICE') return `${v} ฿/单`;
  return `${v} ฿`;
}

export default function RulesPage() {
  const [list, setList] = useState<SalaryRuleWithTiers[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SalaryRuleWithTiers | null>(null);
  const [deleting, setDeleting] = useState<SalaryRuleWithTiers | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/rules?withTiers=true', { cache: 'no-store' });
    const json = await res.json();
    if (json.success) {
      const all = json.data as SalaryRuleWithTiers[];
      setList(all.filter((r) => COMMISSION_RULE_TYPES.includes(r.rule_type)));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const confirmDelete = async () => {
    if (!deleting) return;
    const res = await fetch(`/api/rules/${deleting.rule_id}`, { method: 'DELETE' });
    if (res.ok) {
      toast.success('规则已删除');
      void load();
    }
    setDeleting(null);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">提成方案配置</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            日达成阶梯、月度总回款提点、分阶段金额提点规则，共 {list.length} 条
          </p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
        >
          <Plus size={15} />
          新增规则
        </Button>
      </div>

      <div className="space-y-3">
        {list.map((rule) => (
          <div
            key={rule.rule_id}
            className="overflow-hidden rounded-md border border-border bg-white"
          >
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-3">
              {rule.dept_name && (
                <Badge variant="outline" className="font-mono text-[11px]">
                  {rule.dept_name}
                </Badge>
              )}
              <Badge variant="secondary" className="font-mono">
                {rule.stage_name}
              </Badge>
                <span className="text-[14px] font-semibold">{rule.rule_name}</span>
                <span className="text-[12px] text-muted-foreground">
                  {RULE_TYPE_LABEL[rule.rule_type]}
                  {rule.metric ? ` · ${metricName(rule.metric)}` : ''}
                </span>
              </div>
              <div className="flex items-center gap-1">
                {!rule.enabled && (
                  <Badge variant="outline" className="mr-2 text-muted-foreground">
                    已停用
                  </Badge>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground"
                  onClick={() => {
                    setEditing(rule);
                    setDialogOpen(true);
                  }}
                >
                  <Pencil size={14} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-vermilion"
                  onClick={() => setDeleting(rule)}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            </div>
            {rule.tiers.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow className="data-table">
                    <TableHead className="h-9 px-4">区间下限</TableHead>
                    <TableHead className="h-9 px-4">区间上限</TableHead>
                    <TableHead className="h-9 px-4">奖励类型</TableHead>
                    <TableHead className="h-9 px-4">奖励数值</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...rule.tiers]
                    .sort((a, b) => a.sort_order - b.sort_order)
                    .map((t) => (
                      <TableRow key={t.detail_id}>
                        <TableCell className="px-4 font-mono text-[12.5px]">
                          {t.min_val}
                        </TableCell>
                        <TableCell className="px-4 font-mono text-[12.5px]">
                          {t.max_val === null ? '∞' : t.max_val}
                        </TableCell>
                        <TableCell className="px-4 text-[12.5px]">
                          {REWARD_LABEL[t.reward_type]}
                        </TableCell>
                        <TableCell className="px-4 font-mono text-[12.5px] font-medium">
                          {formatTierValue(t)}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            )}
          </div>
        ))}
        {list.length === 0 && (
          <div className="rounded-md border border-dashed border-border bg-white py-14 text-center text-[13px] text-muted-foreground">
            暂无规则，请点击「新增规则」
          </div>
        )}
      </div>

      <RuleDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        rule={editing}
        onSaved={() => {
          toast.success('保存成功');
          void load();
        }}
      />

      <AlertDialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除规则</AlertDialogTitle>
            <AlertDialogDescription>
              确定删除规则「{deleting?.rule_name}」吗？其下所有阶梯明细将一并删除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-vermilion hover:bg-vermilion/90"
              onClick={confirmDelete}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
