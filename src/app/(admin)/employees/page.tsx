'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, Pencil, Trash2, Upload, Download } from 'lucide-react';
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
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog';
import { EmployeeDialog } from './employee-dialog';
import { downloadEmployeeTemplate } from '@/lib/excel';
import type { Employee } from '@/lib/types';

export default function EmployeesPage() {
  const [list, setList] = useState<Employee[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [deleting, setDeleting] = useState<Employee | null>(null);
  const [importing, setImporting] = useState(false);
  const [qrOpen, setQrOpen] = useState<string | null>(null);
  const [deptFilter, setDeptFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'active' | 'resigned'>('ALL');
  const fileRef = useRef<HTMLInputElement>(null);

  const deptOptions = Array.from(new Set(list.map((e) => e.department).filter(Boolean) as string[])).sort((a,b) => a.localeCompare(b,'zh'));
  const counts = {
    all: list.length,
    active: list.filter(e => e.status === 'active').length,
    resigned: list.filter(e => e.status === 'resigned').length,
  };
  const filteredList = (() => {
    let out = list;
    if (deptFilter !== 'ALL') out = out.filter((e) => e.department === deptFilter);
    if (statusFilter !== 'ALL') out = out.filter((e) => e.status === statusFilter);
    // 排序：在职优先 → 部门 → 工号
    return out.sort((a, b) => {
      if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
      const da = a.department ?? 'zzz';
      const db = b.department ?? 'zzz';
      if (da !== db) return da.localeCompare(db, 'zh');
      return a.employee_id.localeCompare(b.employee_id);
    });
  })();

  const doImport = async (file: File) => {
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/employees/import', { method: 'POST', body: fd });
      const json = await res.json();
      if (json.success) {
        const d = json.data || {};
        const parts = [`导入成功 ${d.imported} 人`];
        if (d.skipped > 0) parts.push(`跳过 ${d.skipped} 人`);
        if (d.failed > 0) parts.push(`失败 ${d.failed} 人`);
        toast.success(parts.join(' / '), { duration: 5000 });
        if (json.data?.failed_lines?.length) {
          json.data.failed_lines.forEach((m: string) => toast.error(m));
        }
        void load();
      } else {
        toast.error(json.error || '导入失败');
      }
    } catch {
      toast.error('导入失败，请检查文件');
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const load = useCallback(async () => {
    const res = await fetch('/api/employees', { cache: 'no-store' });
    const json = await res.json();
    if (json.success) setList(json.data as Employee[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const confirmDelete = async () => {
    if (!deleting) return;
    const res = await fetch(`/api/employees/${deleting.employee_id}`, { method: 'DELETE' });
    if (res.ok) {
      toast.success('员工已删除');
      void load();
    } else {
      toast.error('删除失败');
    }
    setDeleting(null);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">员工管理</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            维护员工档案与业务阶段归属，共 {list.length} 人
            {deptFilter !== 'ALL' && (
              <span className="ml-2">
                · 当前筛选 <span className="font-semibold text-foreground">{deptFilter}</span>（{filteredList.length} 人）
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* 状态 Tab */}
          <div className="flex rounded-md border border-border bg-muted/10 overflow-hidden">
            {([
              ['ALL', `全部 ${counts.all}`],
              ['active', `在职 ${counts.active}`],
              ['resigned', `离职 ${counts.resigned}`],
            ] as const).map(([v, l]) => (
              <button
                key={v}
                onClick={() => setStatusFilter(v)}
                className={`h-9 px-3 text-[12.5px] transition ${
                  statusFilter === v ? 'bg-primary text-primary-foreground font-medium' : 'bg-transparent hover:bg-muted text-muted-foreground'
                }`}
              >
                {l}
              </button>
            ))}
          </div>
          {/* 部门筛选 */}
          <select
            value={deptFilter}
            onChange={(e) => setDeptFilter(e.target.value)}
            className="h-9 rounded-md border border-border bg-white px-3 text-[13px] focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            <option value="ALL">全部部门</option>
            {deptOptions.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          <Button variant="outline" onClick={() => downloadEmployeeTemplate()}>
            <Download size={15} />
            模板
          </Button>
          <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={importing}>
            <Upload size={15} />
            {importing ? '导入中…' : 'Excel 导入'}
          </Button>
          <Button
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus size={15} />
            新增员工
          </Button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void doImport(f);
          }}
        />
      </div>

      <div className="overflow-hidden rounded-md border border-border bg-white">
        <Table>
          <TableHeader>
            <TableRow className="data-table">
              <TableHead className="h-10 px-4">工号</TableHead>
              <TableHead className="h-10 px-4">姓名</TableHead>
              <TableHead className="h-10 px-4">团队 / 部门</TableHead>
              <TableHead className="h-10 px-4">参与阶段</TableHead>
              <TableHead className="h-10 px-4">提成方案</TableHead>
              <TableHead className="h-10 px-4">收款码</TableHead>
              <TableHead className="h-10 px-4">状态</TableHead>
              <TableHead className="h-10 px-4 text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredList.map((emp) => (
              <TableRow key={emp.employee_id}>
                <TableCell className="px-4 font-mono text-[13px]">{emp.employee_id}</TableCell>
                <TableCell className="px-4 text-[13.5px] font-medium">
                  {emp.employee_name}
                </TableCell>
                <TableCell className="px-4 text-[13px] text-muted-foreground">
                  {emp.department ?? '-'}
                </TableCell>
                <TableCell className="px-4">
                  <div className="flex flex-wrap gap-1">
                    {(emp.stages ?? [{ stage_name: emp.default_stage, is_primary: true }]).map(
                      (s) => (
                        <Badge
                          key={s.stage_name}
                          variant={s.is_primary ? 'default' : 'secondary'}
                          className="font-mono"
                        >
                          {s.stage_name}
                          {s.is_primary && (
                            <span className="ml-1 text-[10px] opacity-80">主</span>
                          )}
                        </Badge>
                      )
                    )}
                  </div>
                </TableCell>
                <TableCell className="px-4 text-[13px]">
                  {emp.commission_plan === 'NONE' ? '无月度提成' : emp.commission_plan === 'A' ? '月度总回款提点' : '分阶段金额提点'}
                </TableCell>
                <TableCell className="px-4">
                  {(emp as any).salary_qr_code_url ? (
                    <button
                      onClick={() => setQrOpen((emp as any).salary_qr_code_url)}
                      className="hover:opacity-70 transition"
                    >
                      <img
                        src={(emp as any).salary_qr_code_url}
                        alt="QR"
                        className="w-9 h-9 rounded border border-border object-contain bg-white"
                      />
                    </button>
                  ) : (
                    <span className="text-muted-foreground text-xs">—</span>
                  )}
                </TableCell>
                <TableCell className="px-4">
                  {emp.status === 'active' ? (
                    <Badge className="bg-[#e3efe9] text-primary hover:bg-[#e3efe9]">在职</Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground">
                      离职
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="px-4">
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground"
                      onClick={() => {
                        setEditing(emp);
                        setDialogOpen(true);
                      }}
                    >
                      <Pencil size={14} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-vermilion"
                      onClick={() => setDeleting(emp)}
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
                  暂无员工，请点击右上角「新增员工」
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <EmployeeDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        employee={editing}
        onSaved={() => {
          toast.success('保存成功');
          void load();
        }}
      />

      <AlertDialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除员工</AlertDialogTitle>
            <AlertDialogDescription>
              确定删除 {deleting?.employee_name}（{deleting?.employee_id}）吗？关联的导入数据与结算记录将一并删除，此操作不可撤销。
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

      {/* QR 大图 */}
      <Dialog open={!!qrOpen} onOpenChange={(v) => !v && setQrOpen(null)}>
        <DialogContent className="sm:max-w-md flex flex-col items-center">
          {qrOpen && <img src={qrOpen} alt="QR" className="max-w-[400px] max-h-[400px]" />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
