'use client';

import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, Trash2, Users, Layers } from 'lucide-react';
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
import { StageDialog } from './stage-dialog';
import { GroupDialog } from './group-dialog';
import type { StageConfig, StageGroup } from '@/lib/types';

type Tab = 'stage' | 'group';

export default function StagesPage() {
  const [tab, setTab] = useState<Tab>('stage');

  // --- 阶段 ---
  const [list, setList] = useState<StageConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<StageConfig | null>(null);
  const [deleting, setDeleting] = useState<StageConfig | null>(null);
  const [empCounts, setEmpCounts] = useState<Record<string, number>>({});

  // --- 合并组 ---
  const [groups, setGroups] = useState<StageGroup[]>([]);
  const [groupLoading, setGroupLoading] = useState(false);
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [groupEditing, setGroupEditing] = useState<StageGroup | null>(null);
  const [groupDeleting, setGroupDeleting] = useState<StageGroup | null>(null);

  const loadStages = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/stages', { cache: 'no-store' });
    const json = await res.json();
    if (json.success) setList(json.data as StageConfig[]);
    setLoading(false);

    const empRes = await fetch('/api/employees', { cache: 'no-store' });
    const empJson = await empRes.json();
    if (empJson.success) {
      const counts: Record<string, number> = {};
      for (const emp of empJson.data as { stages?: { stage_name: string }[] }[]) {
        for (const s of emp.stages ?? []) {
          counts[s.stage_name] = (counts[s.stage_name] ?? 0) + 1;
        }
      }
      setEmpCounts(counts);
    }
  }, []);

  const loadGroups = useCallback(async () => {
    setGroupLoading(true);
    const res = await fetch('/api/stage-groups', { cache: 'no-store' });
    const json = await res.json();
    if (json.ok) setGroups(json.data as StageGroup[]);
    setGroupLoading(false);
  }, []);

  useEffect(() => {
    void loadStages();
    void loadGroups();
  }, [loadStages, loadGroups]);

  const confirmDeleteStage = async () => {
    if (!deleting) return;
    const res = await fetch(`/api/stages?stage_code=${encodeURIComponent(deleting.stage_code)}`, {
      method: 'DELETE',
    });
    const json = await res.json();
    if (json.success) toast.success('阶段已删除'), void loadStages();
    else toast.error(json.error ?? '删除失败');
    setDeleting(null);
  };

  const confirmDeleteGroup = async () => {
    if (!groupDeleting) return;
    const res = await fetch(`/api/stage-groups?id=${groupDeleting.group_id}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.ok) toast.success('合并组已删除'), void loadGroups();
    else toast.error(json.message ?? '删除失败');
    setGroupDeleting(null);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold">阶段管理</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            自定义业务阶段 + 合并组（多个阶段合并计算提成）
          </p>
        </div>
        <Button
          onClick={() => {
            if (tab === 'stage') {
              setEditing(null);
              setDialogOpen(true);
            } else {
              setGroupEditing(null);
              setGroupDialogOpen(true);
            }
          }}
        >
          <Plus size={15} />
          {tab === 'stage' ? '新增阶段' : '新增合并组'}
        </Button>
      </div>

      {/* Tab */}
      <div className="inline-flex rounded-md border border-border bg-muted/50 p-0.5">
        <button
          onClick={() => setTab('stage')}
          className={`px-4 py-1.5 text-[13px] rounded-sm transition ${
            tab === 'stage' ? 'bg-white shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          阶段定义
        </button>
        <button
          onClick={() => setTab('group')}
          className={`px-4 py-1.5 text-[13px] rounded-sm transition ${
            tab === 'group' ? 'bg-white shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          合并组
        </button>
      </div>

      {tab === 'stage' ? (
        <div className="rounded-md border border-border bg-white">
          <Table>
            <TableHeader>
              <TableRow className="data-table">
                <TableHead className="h-10 px-4">编码</TableHead>
                <TableHead className="h-10 px-4">阶段名称</TableHead>
                <TableHead className="h-10 px-4">排序</TableHead>
                <TableHead className="h-10 px-4">关联员工</TableHead>
                <TableHead className="h-10 px-4">状态</TableHead>
                <TableHead className="h-10 px-4 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                    加载中...
                  </TableCell>
                </TableRow>
              ) : list.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                    暂无阶段
                  </TableCell>
                </TableRow>
              ) : (
                list.map((s) => (
                  <TableRow key={s.stage_code}>
                    <TableCell className="px-4 font-mono text-[13px]">{s.stage_code}</TableCell>
                    <TableCell className="px-4 text-[13px]">{s.stage_name}</TableCell>
                    <TableCell className="px-4 font-mono text-[13px]">{s.sort_order}</TableCell>
                    <TableCell className="px-4">
                      <span className="inline-flex items-center gap-1 text-[12.5px] text-muted-foreground">
                        <Users size={13} />
                        {empCounts[s.stage_code] ?? 0} 人
                      </span>
                    </TableCell>
                    <TableCell className="px-4">
                      {s.enabled ? (
                        <Badge className="bg-[#e3efe9] text-primary hover:bg-[#e3efe9]">启用</Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">停用</Badge>
                      )}
                    </TableCell>
                    <TableCell className="px-4">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground"
                          onClick={() => { setEditing(s); setDialogOpen(true); }}>
                          <Pencil size={14} />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-vermilion"
                          onClick={() => setDeleting(s)}>
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
      ) : (
        <div className="rounded-md border border-border bg-white">
          <Table>
            <TableHeader>
              <TableRow className="data-table">
                <TableHead className="h-10 px-4">组名</TableHead>
                <TableHead className="h-10 px-4">包含阶段</TableHead>
                <TableHead className="h-10 px-4">说明</TableHead>
                <TableHead className="h-10 px-4">状态</TableHead>
                <TableHead className="h-10 px-4 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groupLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="px-4 py-10 text-center text-muted-foreground">加载中...</TableCell>
                </TableRow>
              ) : groups.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                    <Layers size={16} className="inline mr-1.5" />
                    暂无合并组，新建一个让多个阶段合并计算提成
                  </TableCell>
                </TableRow>
              ) : (
                groups.map((g) => (
                  <TableRow key={g.group_id}>
                    <TableCell className="px-4 font-medium text-[13px]">{g.group_name}</TableCell>
                    <TableCell className="px-4">
                      <div className="flex flex-wrap gap-1">
                        {g.stage_names.map((s) => (
                          <Badge key={s} variant="outline" className="text-[11.5px]">{s}</Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="px-4 text-[12.5px] text-muted-foreground max-w-[200px] truncate">
                      {g.description || '-'}
                    </TableCell>
                    <TableCell className="px-4">
                      {g.enabled !== false ? (
                        <Badge className="bg-[#e3efe9] text-primary hover:bg-[#e3efe9]">启用</Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">停用</Badge>
                      )}
                    </TableCell>
                    <TableCell className="px-4">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground"
                          onClick={() => { setGroupEditing(g); setGroupDialogOpen(true); }}>
                          <Pencil size={14} />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-vermilion"
                          onClick={() => setGroupDeleting(g)}>
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
      )}

      <StageDialog open={dialogOpen} onOpenChange={setDialogOpen} stage={editing} onSaved={() => void loadStages()} />
      <GroupDialog
        open={groupDialogOpen}
        onOpenChange={setGroupDialogOpen}
        group={groupEditing}
        stages={list.map((s) => s.stage_name)}
        onSaved={() => void loadGroups()}
      />

      <AlertDialog open={Boolean(deleting)} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除阶段「{deleting?.stage_code}」？</AlertDialogTitle>
            <AlertDialogDescription>若已被员工、规则或数据引用，系统将拒绝删除。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction className="bg-vermilion hover:bg-vermilion/90" onClick={() => void confirmDeleteStage()}>确认删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(groupDeleting)} onOpenChange={(v) => !v && setGroupDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除合并组「{groupDeleting?.group_name}」？</AlertDialogTitle>
            <AlertDialogDescription>若有员工引用此合并组，系统将拒绝删除。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction className="bg-vermilion hover:bg-vermilion/90" onClick={() => void confirmDeleteGroup()}>确认删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
