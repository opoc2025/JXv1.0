'use client';

import { useEffect, useState } from 'react';
import { Check, ChevronDown, Plus, Trash2, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import type { CompareOp, MetricConfig, PerformanceScheme } from '@/lib/types';

interface Row {
  dept_code: string;
  dept_name: string;
  scheme: PerformanceScheme | null;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  row: Row | null;
  onSaved: () => void;
}

interface CondDraft {
  metric: string;
  operator: CompareOp | null;
  threshold_value: string;
}
interface GroupDraft {
  sort_order: number;
  conditions: CondDraft[];
}

const OP_OPTIONS: { value: CompareOp; label: string }[] = [
  { value: 'GTE', label: '≥' },
  { value: 'LTE', label: '≤' },
  { value: 'GT', label: '>' },
  { value: 'LT', label: '<' },
];

export function SchemeDialog({ open, onOpenChange, row, onSaved }: Props) {
  const [baseSalary, setBaseSalary] = useState('0');
  const [performanceBonus, setPerformanceBonus] = useState('0');
  const [groups, setGroups] = useState<GroupDraft[]>([
    { sort_order: 0, conditions: [{ metric: 'RATE', operator: 'GTE', threshold_value: '40' }] },
  ]);
  const [metrics, setMetrics] = useState<MetricConfig[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      fetch('/api/metrics?scope=PERF')
        .then((r) => r.json())
        .then((j) => setMetrics(j.data ?? []))
        .catch(() => {});
    }
  }, [open]);

  useEffect(() => {
    if (row) {
      const s = row.scheme;
      setBaseSalary(s ? String(s.base_salary) : '0');
      setPerformanceBonus(s ? String(s.performance_bonus) : '0');
      if (s && s.groups && s.groups.length > 0) {
        setGroups(
          s.groups.map((g, gi) => ({
            sort_order: gi,
            conditions:
              g.conditions.length > 0
                ? g.conditions.map((c) => ({
                    metric: c.metric,
                    operator: c.operator ?? 'GTE',
                    threshold_value: String(c.threshold_value),
                  }))
                : [{ metric: 'RATE', operator: 'GTE', threshold_value: '' }],
          }))
        );
      } else {
        setGroups([
          { sort_order: 0, conditions: [{ metric: 'RATE', operator: 'GTE', threshold_value: '40' }] },
        ]);
      }
    }
  }, [row, open]);

  const updateCond = (gi: number, i: number, patch: Partial<CondDraft>) => {
    setGroups((prev) =>
      prev.map((g, gid) =>
        gid === gi ? { ...g, conditions: g.conditions.map((c, idx) => (idx === i ? { ...c, ...patch } : c)) } : g
      )
    );
  };
  const addCond = (gi: number) => {
    setGroups((prev) =>
      prev.map((g, gid) =>
        gid === gi ? { ...g, conditions: [...g.conditions, { metric: 'RATE', operator: 'GTE', threshold_value: '' }] } : g
      )
    );
  };
  const removeCond = (gi: number, i: number) => {
    setGroups((prev) =>
      prev.map((g, gid) =>
        gid === gi ? { ...g, conditions: g.conditions.filter((_, idx) => idx !== i) } : g
      )
    );
  };
  const addGroup = () => {
    setGroups((prev) => [
      ...prev,
      { sort_order: prev.length, conditions: [{ metric: 'RATE', operator: 'GTE', threshold_value: '' }] },
    ]);
  };
  const removeGroup = (gi: number) => {
    setGroups((prev) => prev.filter((_, idx) => idx !== gi));
  };
  const cloneGroup = (gi: number) => {
    setGroups((prev) => [...prev, JSON.parse(JSON.stringify(prev[gi]))]);
  };

  const metricLabel = (code: string) =>
    metrics.find((m) => m.metric_code === code)?.metric_name ?? code;

  const save = async () => {
    if (!row) return;
    const groupsPayload = groups
      .map((g, gi) => ({
        sort_order: gi,
        conditions: g.conditions.filter((c) => c.threshold_value !== '' && c.threshold_value !== undefined),
      }))
      .filter((g) => g.conditions.length > 0);
    if (groupsPayload.length === 0) {
      window.alert('请至少配置一组考核门槛条件');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/performance-schemes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dept_name: row.dept_name,
          base_salary: Number(baseSalary),
          performance_bonus: Number(performanceBonus),
          groups: groupsPayload,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      onSaved();
    } catch (e) {
      window.alert(`保存失败: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>
            绩效考核方案 · {row?.dept_name}
            <span className="ml-2 font-mono text-[12px] text-muted-foreground">
              {row?.dept_code}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>基本工资（底薪，每月固定发放）</Label>
              <Input
                type="number"
                value={baseSalary}
                onChange={(e) => setBaseSalary(e.target.value)}
                placeholder="如 7000"
              />
            </div>
            <div className="space-y-1.5">
              <Label>绩效工资（达标后发放）</Label>
              <Input
                type="number"
                value={performanceBonus}
                onChange={(e) => setPerformanceBonus(e.target.value)}
                placeholder="如 3000"
              />
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <Label>考核门槛（多条件组）</Label>
              <Button type="button" variant="outline" size="sm" onClick={addGroup}>
                <Plus className="mr-1 h-3.5 w-3.5" /> 添加条件组（或）
              </Button>
            </div>

            <div className="space-y-3">
              {groups.map((g, gi) => (
                <div key={gi} className="rounded-md border border-[#e6e1d5] bg-[#faf8f3] p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[12px] font-semibold text-emerald-700">
                      条件组 {gi + 1}
                      <span className="ml-2 font-normal text-[11px] text-muted-foreground">
                        （组内同时满足 AND）
                      </span>
                    </span>
                    <div className="flex items-center gap-1">
                      <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => cloneGroup(gi)}>
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                      {groups.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-vermilion"
                          onClick={() => removeGroup(gi)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2">
                    {g.conditions.map((c, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button
                              type="button"
                              variant="outline"
                              className="h-9 w-[150px] justify-between gap-1 border-border bg-background px-3 text-sm font-normal hover:bg-accent"
                            >
                              <span className="truncate text-left">
                                {metricLabel(c.metric)}
                              </span>
                              <ChevronDown className="size-3.5 shrink-0 opacity-50" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent
                            align="start"
                            className="w-[220px] p-0"
                            onOpenAutoFocus={(e) => e.preventDefault()}
                          >
                            <Command>
                              <CommandInput placeholder="搜索指标..." />
                              <CommandList>
                                <CommandEmpty>未找到匹配指标</CommandEmpty>
                                <CommandGroup heading="月度指标">
                                  {metrics
                                    .filter((m) => m.period === 'MONTHLY')
                                    .map((m) => (
                                      <CommandItem
                                        key={m.metric_code}
                                        value={m.metric_name + ' ' + m.metric_code}
                                        onSelect={() => updateCond(gi, i, { metric: m.metric_code })}
                                        className="text-sm"
                                      >
                                        <Check
                                          className={`mr-2 size-4 ${
                                            c.metric === m.metric_code ? 'opacity-100' : 'opacity-0'
                                          }`}
                                        />
                                        {m.metric_name}
                                        <span className="ml-auto text-[10.5px] text-muted-foreground">
                                          {m.unit}
                                        </span>
                                      </CommandItem>
                                    ))}
                                </CommandGroup>
                                <CommandGroup heading="日度指标">
                                  {metrics
                                    .filter((m) => m.period === 'DAILY')
                                    .map((m) => (
                                      <CommandItem
                                        key={m.metric_code}
                                        value={m.metric_name + ' ' + m.metric_code}
                                        onSelect={() => updateCond(gi, i, { metric: m.metric_code })}
                                        className="text-sm"
                                      >
                                        <Check
                                          className={`mr-2 size-4 ${
                                            c.metric === m.metric_code ? 'opacity-100' : 'opacity-0'
                                          }`}
                                        />
                                        {m.metric_name}
                                        <span className="ml-auto text-[10.5px] text-muted-foreground">
                                          {m.unit}
                                        </span>
                                      </CommandItem>
                                    ))}
                                </CommandGroup>
                              </CommandList>
                            </Command>
                          </PopoverContent>
                        </Popover>
                        <Select
                          value={c.operator ?? 'GTE'}
                          onValueChange={(v) => updateCond(gi, i, { operator: v as CompareOp })}
                        >
                          <SelectTrigger className="w-[68px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {OP_OPTIONS.map((o) => (
                              <SelectItem key={o.value} value={o.value}>
                                {o.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Input
                          type="number"
                          value={c.threshold_value}
                          onChange={(e) => updateCond(gi, i, { threshold_value: e.target.value })}
                          placeholder="门槛值"
                          className="flex-1"
                        />
                        {g.conditions.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-vermilion"
                            onClick={() => removeCond(gi, i)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>

                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="mt-2 h-7 px-2 text-[12px] text-emerald-700"
                    onClick={() => addCond(gi)}
                  >
                    <Plus className="mr-1 h-3.5 w-3.5" /> 组内添加条件（且）
                  </Button>
                </div>
              ))}
            </div>

            <p className="mt-2 text-[11.5px] text-muted-foreground">
              逻辑：每个「条件组」内需全部满足（AND）；「或」任一组达标即发放全额绩效工资。指标可在「指标库」自定义。
            </p>
          </div>

          <p className="rounded-md border border-amber-300/50 bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-800">
            示例：第①组 = 订单回收率 ≥40 且 回款金额 ≥600；第②组 = 订单回收率 ≥45 且 回款金额 &lt;600。任一组达标即发绩效。
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? '保存中…' : '保存方案'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}