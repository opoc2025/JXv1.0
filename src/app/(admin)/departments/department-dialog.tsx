'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { DepartmentConfig } from '@/lib/types';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  dept: DepartmentConfig | null;
  onSaved: () => void;
}

export function DepartmentDialog({ open, onOpenChange, dept, onSaved }: Props) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [sort, setSort] = useState('0');
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      if (dept) {
        setCode(dept.dept_code);
        setName(dept.dept_name);
        setSort(String(dept.sort_order));
        setEnabled(dept.enabled);
      } else {
        setCode(''); setName(''); setSort('0'); setEnabled(true);
      }
    }
  }, [dept, open]);

  const save = async () => {
    if (!code || !name) return;
    setSaving(true);
    try {
      const method = dept ? 'PATCH' : 'POST';
      const payload = {
        dept_code: code,
        dept_name: name,
        sort_order: Number(sort) || 0,
        enabled,
      };
      const res = await fetch('/api/departments', {
        method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? '保存失败');
      toast.success(dept ? '部门已更新' : '部门已创建');
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>{dept ? '编辑部门' : '新增部门'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label>部门编码 {dept ? '(不可改)' : ''}</Label>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={!!dept}
              placeholder="如 DEPT_A"
              className={dept ? 'opacity-60' : ''}
            />
          </div>
          <div className="space-y-1.5">
            <Label>部门名称</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="如 催收一部" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>排序</Label>
              <Input type="number" value={sort} onChange={(e) => setSort(e.target.value)} />
            </div>
            <div className="flex items-center gap-2 pt-5">
              <Switch id="dept-enabled" checked={enabled} onCheckedChange={setEnabled} />
              <Label htmlFor="dept-enabled" className="text-[13px]">启用该部门</Label>
            </div>
          </div>
          {dept && (
            <p className="rounded-md border border-amber-300/50 bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-800">
              改名时系统会自动级联同步所有引用该部门的员工、提成规则和绩效考核方案。
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={save} disabled={saving}>{saving ? '保存中...' : '保存'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
