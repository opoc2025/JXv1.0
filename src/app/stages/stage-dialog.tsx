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
import type { StageConfig } from '@/lib/types';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  stage: StageConfig | null;
  onSaved: () => void;
}

export function StageDialog({ open, onOpenChange, stage, onSaved }: Props) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [sortOrder, setSortOrder] = useState('0');
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (open && stage) {
      setCode(stage.stage_code);
      setName(stage.stage_name);
      setSortOrder(String(stage.sort_order ?? 0));
      setEnabled(stage.enabled);
    } else if (open) {
      setCode('');
      setName('');
      setSortOrder('0');
      setEnabled(true);
    }
    setErr('');
  }, [open, stage]);

  const save = async () => {
    const c = code.trim();
    const n = name.trim();
    if (!c || !n) {
      setErr('编码与名称必填');
      return;
    }
    if (!/^[A-Za-z0-9_-]+$/.test(c)) {
      setErr('编码仅允许字母、数字、下划线、短横线');
      return;
    }
    setSaving(true);
    const payload = {
      stage_code: c,
      stage_name: n,
      sort_order: Number(sortOrder) || 0,
      enabled,
    };
    const res = await fetch(stage ? '/api/stages' : '/api/stages', {
      method: stage ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    setSaving(false);
    if (json.success) {
      onSaved();
      onOpenChange(false);
    } else {
      setErr(json.error ?? '保存失败');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{stage ? '编辑阶段' : '新增阶段'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>阶段编码</Label>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={Boolean(stage)}
              placeholder="如 D0、T1、T2"
              className="font-mono"
            />
            {stage && (
              <p className="text-[11.5px] text-muted-foreground">
                编码创建后不可修改（规则与数据均按编码关联）
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>阶段名称</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="如 早期催收"
            />
          </div>
          <div className="space-y-1.5">
            <Label>排序</Label>
            <Input
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              className="w-32"
            />
          </div>
          <div className="flex items-center justify-between rounded-md border border-border bg-[#faf8f3] px-3 py-2">
            <Label className="text-[13px]">启用</Label>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>
          {err && <p className="text-[12.5px] text-vermilion">{err}</p>}
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
