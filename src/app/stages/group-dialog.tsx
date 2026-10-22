'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { StageGroup } from '@/lib/types';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  group: StageGroup | null; // null = 新建
  stages: string[]; // 现有阶段名列表
  onSaved: () => void;
}

export function GroupDialog({ open, onOpenChange, group, stages, onSaved }: Props) {
  const [groupName, setGroupName] = useState('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [sortOrder, setSortOrder] = useState(0);
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      if (group) {
        setGroupName(group.group_name);
        setDescription(group.description ?? '');
        setSelected(group.stage_names);
        setSortOrder(0);
        setEnabled(group.enabled !== false);
      } else {
        setGroupName('');
        setDescription('');
        setSelected([]);
        setSortOrder(0);
        setEnabled(true);
      }
    }
  }, [open, group]);

  const toggle = (s: string) => {
    setSelected((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]);
  };

  const handleSave = async () => {
    if (!groupName.trim()) return toast.error('组名必填');
    if (selected.length < 2) return toast.error('至少选择 2 个阶段才能合并');
    setSaving(true);
    const body = {
      group_name: groupName.trim(),
      description: description.trim() || null,
      stage_names: selected,
      sort_order: sortOrder,
      enabled,
      ...(group ? { group_id: group.group_id } : {}),
    };
    try {
      const res = await fetch('/api/stage-groups', {
        method: group ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success(group ? '合并组已更新' : '合并组已创建');
        onOpenChange(false);
        onSaved();
      } else {
        toast.error(json.message ?? '保存失败');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{group ? '编辑合并组' : '新建合并组'}</DialogTitle>
          <DialogDescription>
            选择 2 个或以上阶段，员工配置此组合后，日提成/月B 按组内总额合并匹配一条规则
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[12.5px] text-muted-foreground">合并组名</label>
              <input
                className="mt-1 h-9 w-full rounded-md border border-border bg-white px-3 text-[13px] focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder="如 逾4-7+逾8-15"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
              />
            </div>
            <div>
              <label className="text-[12.5px] text-muted-foreground">排序</label>
              <input
                type="number"
                className="mt-1 h-9 w-full rounded-md border border-border bg-white px-3 text-[13px] focus:outline-none focus:ring-2 focus:ring-primary/30"
                value={sortOrder}
                onChange={(e) => setSortOrder(Number(e.target.value))}
              />
            </div>
          </div>

          <div>
            <label className="text-[12.5px] text-muted-foreground">说明（可选）</label>
            <input
              className="mt-1 h-9 w-full rounded-md border border-border bg-white px-3 text-[13px] focus:outline-none focus:ring-2 focus:ring-primary/30"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div>
            <label className="text-[12.5px] text-muted-foreground">
              包含阶段 <span className="font-medium text-foreground">({selected.length} 个)</span>
            </label>
            <div className="mt-2 flex flex-wrap gap-2 rounded-md border border-border bg-muted/20 p-3 max-h-[180px] overflow-y-auto">
              {stages.map((s) => (
                <label key={s} className="flex items-center gap-1.5 cursor-pointer text-[12.5px] select-none">
                  <input type="checkbox" checked={selected.includes(s)} onChange={() => toggle(s)} />
                  {s}
                </label>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 text-[12.5px]">
            <input type="checkbox" id="grp-enabled" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            <label htmlFor="grp-enabled" className="cursor-pointer">启用</label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? '保存中...' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
