'use client';

import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, Trash2, Users } from 'lucide-react';
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
import { DepartmentDialog } from './department-dialog';
import type { DepartmentConfig } from '@/lib/types';

export default function DepartmentsPage() {
  const [list, setList] = useState<DepartmentConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<DepartmentConfig | null>(null);
  const [deleting, setDeleting] = useState<DepartmentConfig | null>(null);
  const [empCounts, setEmpCounts] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/departments', { cache: 'no-store' });
    const json = await res.json();
    if (json.success) setList(json.data as DepartmentConfig[]);
    setLoading(false);

    const empRes = await fetch('/api/employees', { cache: 'no-store' });
    const empJson = await empRes.json();
    if (empJson.success) {
      const counts: Record<string, number> = {};
      for (const emp of empJson.data as { department?: string | null }[]) {
        if (emp.department) counts[emp.department] = (counts[emp.department] ?? 0) + 1;
      }
      setEmpCounts(counts);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const confirmDelete = async () => {
    if (!deleting) return;
    const res = await fetch(
      `/api/departments?dept_code=${encodeURIComponent(deleting.dept_code)}`,
      { method: 'DELETE' }
    );
    const json = await res.json();
    if (json.success) {
      toast.success('部门已删除');
      void load();
    } else {
      toast.error(json.error ?? '删除失败');
    }
    setDeleting(null);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold">部门管理</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            自定义业务部门，员工、绩效考核方案、提成规则均关联部门；改名时级联同步引用
          </p>
        </div>
        <Button onClick={() => { setEditing(null); setDialogOpen(true); }}>
          <Plus size={15} />
          新增部门
        </Button>
      </div>

      <div className="rounded-md border border-border bg-white">
        <Table>
          <TableHeader>
            <TableRow className="data-table">
              <TableHead className="h-10 px-4">编码</TableHead>
              <TableHead className="h-10 px-4">部门名称</TableHead>
              <TableHead className="h-10 px-4">排序</TableHead>
              <TableHead className="h-10 px-4">关联员工</TableHead>
              <TableHead className="h-10 px-4">状态</TableHead>
              <TableHead className="h-10 px-4 text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={6} className="px-4 py-10 text-center text-muted-foreground">加载中...</TableCell></TableRow>
            ) : list.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="px-4 py-10 text-center text-muted-foreground">暂无部门，请点击右上角「新增部门」</TableCell></TableRow>
            ) : (
              list.map((d) => (
                <TableRow key={d.dept_code}>
                  <TableCell className="px-4 font-mono text-[13px]">{d.dept_code}</TableCell>
                  <TableCell className="px-4 text-[13px]">{d.dept_name}</TableCell>
                  <TableCell className="px-4 font-mono text-[13px]">{d.sort_order}</TableCell>
                  <TableCell className="px-4">
                    <span className="inline-flex items-center gap-1 text-[12.5px] text-muted-foreground">
                      <Users size={13} />
                      {empCounts[d.dept_name] ?? 0} 人
                    </span>
                  </TableCell>
                  <TableCell className="px-4">
                    {d.enabled ? (
                      <Badge className="bg-[#e3efe9] text-primary hover:bg-[#e3efe9]">启用</Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">停用</Badge>
                    )}
                  </TableCell>
                  <TableCell className="px-4">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground"
                        onClick={() => { setEditing(d); setDialogOpen(true); }}>
                        <Pencil size={14} />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-vermilion"
                        onClick={() => setDeleting(d)}>
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <DepartmentDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        dept={editing}
        onSaved={() => void load()}
      />

      <AlertDialog open={Boolean(deleting)} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除部门「{deleting?.dept_code}」？</AlertDialogTitle>
            <AlertDialogDescription>
              删除后无法恢复。若该部门已被员工、提成规则或绩效考核方案引用，系统将拒绝删除。
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
