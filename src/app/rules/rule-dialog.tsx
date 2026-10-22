'use client';

import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
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
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  COMMISSION_RULE_TYPES,
  METRIC_LABEL,
  REWARD_LABEL,
  RULE_TYPE_LABEL,
  metricNeeded,
} from '@/lib/rule-labels';
import type { DepartmentConfig, MetricConfig, RuleTier, SalaryRuleWithTiers, StageConfig, StageGroup } from '@/lib/types';

interface TierForm {
  key: number;
  min_val: string;
  max_val: string;
  reward_type: RuleTier['reward_type'];
  reward_value: string;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  rule: SalaryRuleWithTiers | null;
  onSaved: () => void;
}

let seq = 1;

export function RuleDialog({ open, onOpenChange, rule, onSaved }: Props) {
  const [deptName, setDeptName] = useState<string | null>(null);
  const [stageName, setStageName] = useState('ALL');
  const [ruleType, setRuleType] = useState<SalaryRuleWithTiers['rule_type']>('DAILY_STEP');
  const [metric, setMetric] = useState('RATE');
  const [ruleName, setRuleName] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [tiers, setTiers] = useState<TierForm[]>([]);
  const [saving, setSaving] = useState(false);
  const [commissionMetrics, setCommissionMetrics] = useState<MetricConfig[]>([]);
  const [stages, setStages] = useState<StageConfig[]>([]);
  const [stageGroups, setStageGroups] = useState<StageGroup[]>([]);
  const [depts, setDepts] = useState<DepartmentConfig[]>([]);

  // 拉取启用部门
  useEffect(() => {
    if (!open) return;
    fetch('/api/departments?enabled=true', { cache: 'no-store' })
      .then((r) => r.json())
      .then((json) => { if (json.success) setDepts(json.data as DepartmentConfig[]); })
      .catch(() => {});
  }, [open]);

  // 拉取启用阶段 + 合并组
  useEffect(() => {
    if (!open) return;
    fetch('/api/stages?enabled=true', { cache: 'no-store' })
      .then((r) => r.json())
      .then((json) => {
        if (json.success) setStages(json.data as StageConfig[]);
      })
      .catch(() => {});
    fetch('/api/stage-groups', { cache: 'no-store' })
      .then((r) => r.json())
      .then((json) => {
        if (json.ok) setStageGroups((json.data as StageGroup[]).filter(g => g.enabled !== false));
      })
      .catch(() => {});
  }, [open]);

  useEffect(() => {
    if (rule) {
      setDeptName(rule.dept_name ?? null);
      setStageName(rule.stage_name);
      setRuleType(rule.rule_type);
      setMetric(rule.metric ?? 'RATE');
      setRuleName(rule.rule_name);
      setEnabled(rule.enabled);
      setTiers(
        rule.tiers.map((t) => ({
          key: t.detail_id,
          min_val: String(t.min_val),
          max_val: t.max_val === null ? '' : String(t.max_val),
          reward_type: t.reward_type,
          reward_value: String(t.reward_value),
        }))
      );
    } else {
      setDeptName(null);
      setStageName('ALL');
      setRuleType('DAILY_STEP');
      setMetric('RATE');
      setRuleName('');
      setEnabled(true);
      setTiers([]);
    }
  }, [rule, open]);

  // 拉取提成指标库
  useEffect(() => {
    if (!open) return;
    fetch('/api/metrics?scope=COMMISSION', { cache: 'no-store' })
      .then((r) => r.json())
      .then((json) => {
        if (json.success) setCommissionMetrics((json.data as MetricConfig[]).filter((m) => m.enabled));
      })
      .catch(() => {});
  }, [open]);

  const addTier = () => {
    setTiers([
      ...tiers,
      {
        key: -seq++,
        min_val: '0',
        max_val: '',
        reward_type: 'FIXED_AMOUNT',
        reward_value: '0',
      },
    ]);
  };

  const updateTier = (key: number, patch: Partial<TierForm>) => {
    setTiers(tiers.map((t) => (t.key === key ? { ...t, ...patch } : t)));
  };

  const removeTier = (key: number) => {
    setTiers(tiers.filter((t) => t.key !== key));
  };

  const save = async () => {
    if (!ruleName) return;
    setSaving(true);
    const payload = {
      dept_name: deptName,
      stage_name: stageName,
      rule_type: ruleType,
      metric: metricNeeded(ruleType) ? metric : null,
      rule_name: ruleName,
      enabled,
      tiers: tiers.map((t, i) => ({
        min_val: Number(t.min_val),
        max_val: t.max_val === '' ? null : Number(t.max_val),
        reward_type: t.reward_type,
        reward_value: Number(t.reward_value),
        sort_order: i,
      })),
    };
    const url = rule ? `/api/rules/${rule.rule_id}` : '/api/rules';
    const method = rule ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (res.ok) {
      onOpenChange(false);
      onSaved();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[620px]">
        <DialogHeader>
          <DialogTitle>{rule ? '编辑薪酬规则' : '新增薪酬规则'}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] space-y-4 overflow-y-auto px-1 py-1">
          <div className="space-y-1.5">
            <Label>适用部门（空=全部门通用，优先级低于具体部门）</Label>
            <Select value={deptName ?? '__null__'} onValueChange={(v) => setDeptName(v === '__null__' ? null : v)}>
              <SelectTrigger>
                <SelectValue placeholder="全部部门通用" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__null__">全部部门通用</SelectItem>
                {depts.map((d) => (
                  <SelectItem key={d.dept_code} value={d.dept_name}>
                    {d.dept_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>适用阶段</Label>
              <Select value={stageName} onValueChange={setStageName}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>合并组（多阶段合并计算）</SelectLabel>
                    {stageGroups.length === 0 && (
                      <SelectItem value="_empty_" disabled>
                        暂无合并组
                      </SelectItem>
                    )}
                    {stageGroups.map((g) => (
                      <SelectItem key={g.group_id} value={g.group_name}>
                        {g.group_name}
                        <span className="ml-2 text-muted-foreground">
                          ({g.stage_names.join(' + ')})
                        </span>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                  <SelectGroup>
                    <SelectLabel>独立阶段</SelectLabel>
                    {stages.map((s) => (
                      <SelectItem key={s.stage_name} value={s.stage_name}>
                        {s.stage_name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                  <SelectItem value="ALL">ALL（全部阶段通用）</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>规则类型</Label>
              <Select
                value={ruleType}
                onValueChange={(v) => setRuleType(v as SalaryRuleWithTiers['rule_type'])}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COMMISSION_RULE_TYPES.map((k) => (
                    <SelectItem key={k} value={k}>
                      {RULE_TYPE_LABEL[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {metricNeeded(ruleType) && (
            <div className="space-y-1.5">
              <Label>考核指标（来自指标库，可自定义）</Label>
              <Select value={metric} onValueChange={setMetric}>
                <SelectTrigger className="w-[280px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {commissionMetrics.length > 0 ? (
                    commissionMetrics.map((m) => (
                      <SelectItem key={m.metric_code} value={m.metric_code}>
                        {m.metric_name}（{m.unit || '-'}）
                      </SelectItem>
                    ))
                  ) : (
                    (Object.keys(METRIC_LABEL) as (keyof typeof METRIC_LABEL)[]).map((k) => (
                      <SelectItem key={k} value={k}>
                        {METRIC_LABEL[k]}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="rule-name">规则名称</Label>
            <Input
              id="rule-name"
              value={ruleName}
              onChange={(e) => setRuleName(e.target.value)}
              placeholder="如 D0 月度回收率门槛"
            />
          </div>

          <div className="flex items-center gap-2.5">
            <Switch id="rule-enabled" checked={enabled} onCheckedChange={setEnabled} />
            <Label htmlFor="rule-enabled" className="text-[13px]">
              启用该规则
            </Label>
          </div>

          {/* 阶梯编辑器 */}
          <div className="space-y-2 rounded-md border border-border bg-paper-soft p-3">
            <div className="flex items-center justify-between">
              <Label className="text-[12.5px]">阶梯明细（区间左闭右开 [min, max)）</Label>
              <Button variant="outline" size="sm" onClick={addTier}>
                <Plus size={13} />
                添加阶梯
              </Button>
            </div>

            {ruleType === 'MONTHLY_PROGRESSIVE_TIER' && (
              <div className="rounded border border-emerald-400/40 bg-emerald-50/50 px-3 py-1.5 text-[11.5px] text-emerald-800">
                💡 累进模式说明：每个阶梯只对 <span className="font-mono">[min, max)</span> 区间的金额部分计提；
                <span className="font-semibold">最低档的 min_val 即基本任务门槛</span>，该值以下不提；
                超过部分逐档累进（如 40k = 10k×5% + 10k×10%）。建议只使用「提点比例 (PERCENTAGE)」。
              </div>
            )}

            <div className="space-y-2">
              {tiers.map((t) => (
                <div key={t.key} className="flex items-center gap-2">
                  <Input
                    value={t.min_val}
                    onChange={(e) => updateTier(t.key, { min_val: e.target.value })}
                    className="h-8 w-[110px] font-mono text-[12.5px]"
                    placeholder="下限"
                  />
                  <span className="text-[11px] text-muted-foreground">至</span>
                  <Input
                    value={t.max_val}
                    onChange={(e) => updateTier(t.key, { max_val: e.target.value })}
                    className="h-8 w-[110px] font-mono text-[12.5px]"
                    placeholder="上限(空=∞)"
                  />
                  <Select
                    value={t.reward_type}
                    onValueChange={(v) =>
                      updateTier(t.key, { reward_type: v as RuleTier['reward_type'] })
                    }
                  >
                    <SelectTrigger className="h-8 w-[150px] text-[12.5px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(REWARD_LABEL) as (keyof typeof REWARD_LABEL)[]).map((k) => (
                        <SelectItem key={k} value={k}>
                          {REWARD_LABEL[k]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    value={t.reward_value}
                    onChange={(e) => updateTier(t.key, { reward_value: e.target.value })}
                    className="h-8 w-[100px] font-mono text-[12.5px]"
                    placeholder="数值"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-vermilion"
                    onClick={() => removeTier(t.key)}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              ))}
              {tiers.length === 0 && (
                <div className="py-3 text-center text-[12px] text-muted-foreground">
                  尚未添加阶梯
                </div>
              )}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? '保存中...' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
