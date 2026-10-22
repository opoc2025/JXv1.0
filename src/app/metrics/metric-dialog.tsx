'use client';

import { useEffect, useState } from 'react';
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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { MetricConfig } from '@/lib/types';

const SOURCE_OPTIONS_MONTHLY = [
  { v: 'monthly_recovery_rate', l: '月度回收率 monthly_recovery_rate' },
  { v: 'monthly_total_amount', l: '月度回款金额 monthly_total_amount' },
  { v: 'monthly_recovered_orders', l: '月度订单量 monthly_recovered_orders' },
];
const SOURCE_OPTIONS_DAILY = [
  { v: 'target_recovery_rate', l: '日达成率 target_recovery_rate' },
  { v: 'recovered_amount', l: '日回款金额 recovered_amount' },
  { v: 'recovered_orders', l: '日回收单数 recovered_orders' },
];

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  metric: MetricConfig | null;
  onSaved: () => void;
}

export function MetricDialog({ open, onOpenChange, metric, onSaved }: Props) {
  const [metricCode, setMetricCode] = useState('');
  const [metricName, setMetricName] = useState('');
  const [scope, setScope] = useState<MetricConfig['scope']>('BOTH');
  const [period, setPeriod] = useState<MetricConfig['period']>('MONTHLY');
  const [sourceField, setSourceField] = useState('monthly_recovery_rate');
  const [unit, setUnit] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (metric) {
      setMetricCode(metric.metric_code);
      setMetricName(metric.metric_name);
      setScope(metric.scope);
      setPeriod(metric.period);
      setSourceField(metric.source_field);
      setUnit(metric.unit ?? '');
      setEnabled(metric.enabled);
    } else {
      setMetricCode('');
      setMetricName('');
      setScope('BOTH');
      setPeriod('MONTHLY');
      setSourceField('monthly_recovery_rate');
      setUnit('');
      setEnabled(true);
    }
  }, [metric, open]);

  // 切换周期时自动校正数据来源字段
  const changePeriod = (p: MetricConfig['period']) => {
    setPeriod(p);
    setSourceField(p === 'DAILY' ? 'recovered_orders' : 'monthly_recovery_rate');
  };

  const save = async () => {
    if (!metricCode || !metricName) return;
    setSaving(true);
    const method = metric ? 'PATCH' : 'POST';
    const url = metric
      ? `/api/metrics?id=${metric.metric_id}`
      : '/api/metrics';
    const body: Record<string, unknown> = {
      metric_code: metricCode,
      metric_name: metricName,
      scope,
      period,
      source_field: sourceField,
      unit,
      enabled,
    };
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (res.ok) onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{metric ? '编辑指标' : '新增指标'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 px-1 py-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>指标编码</Label>
              <Input
                value={metricCode}
                disabled={!!metric}
                onChange={(e) => setMetricCode(e.target.value.toUpperCase())}
                placeholder="如 CUSTOM_RATE"
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label>指标名称</Label>
              <Input
                value={metricName}
                onChange={(e) => setMetricName(e.target.value)}
                placeholder="如 订单回收率"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>适用场景</Label>
              <Select value={scope} onValueChange={(v) => setScope(v as MetricConfig['scope'])}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PERF">绩效考核</SelectItem>
                  <SelectItem value="COMMISSION">提成</SelectItem>
                  <SelectItem value="BOTH">通用</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>数据周期</Label>
              <Select value={period} onValueChange={(v) => changePeriod(v as MetricConfig['period'])}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MONTHLY">月度</SelectItem>
                  <SelectItem value="DAILY">日</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>数据来源字段</Label>
            <Select value={sourceField} onValueChange={setSourceField}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(period === 'DAILY' ? SOURCE_OPTIONS_DAILY : SOURCE_OPTIONS_MONTHLY).map((o) => (
                  <SelectItem key={o.v} value={o.v}>
                    {o.l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 items-end gap-3">
            <div className="space-y-1.5">
              <Label>单位</Label>
              <Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="如 % 或 ฿ 或 单" />
            </div>
            <div className="flex items-center gap-2 pb-1.5">
              <Switch id="metric-enabled" checked={enabled} onCheckedChange={setEnabled} />
              <Label htmlFor="metric-enabled" className="text-[13px]">启用</Label>
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