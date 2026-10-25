'use client';

import { useEffect, useState, useMemo } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  DialogClose,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatTHB } from '@/lib/format';
import { useMonth } from '@/components/month-context';

type EmpInfo = { employee_id: string; employee_name: string; salary_qr_code_url?: string | null };

type PayrollRow = {
  id: number;
  period_key: string;
  employee_id: string;
  dept_name: string | null;
  base_salary: number;
  performance_bonus: number;
  full_attendance_bonus: number;
  gross_salary: number;
  commission: number;
  gross_total: number;
  loan_deduction: number;
  loan_remaining_before: number;
  net_pay: number;
  net_pay_override: boolean;
  status: 'PENDING' | 'PAID' | 'CANCELLED';
  archived: boolean;
};

type RewardRow = {
  id: number;
  period_key: string;
  period_type: 'WEEKLY' | 'MONTHLY';
  employee_id: string;
  dept_name: string | null;
  daily_total: number;
  weekly_total: number;
  reward_total: number;
  loan_deduction: number;
  loan_remaining_before: number;
  net_pay: number;
  net_pay_override: boolean;
  status: 'PENDING' | 'PAID' | 'CANCELLED';
  archived: boolean;
};

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  PENDING: { label: '待发放', cls: 'bg-amber-500/10 text-amber-600' },
  PAID: { label: '已发放', cls: 'bg-emerald-500/10 text-emerald-600' },
  CANCELLED: { label: '已取消', cls: 'bg-muted text-muted-foreground' },
};

export default function DisbursementPage() {
  const { month } = useMonth();
  const [tab, setTab] = useState<'PAYROLL' | 'REWARD'>('PAYROLL');
  const [archivedView, setArchivedView] = useState(false);
  const [deptFilter, setDeptFilter] = useState('ALL');
  const [depts, setDepts] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // === Payroll state ===
  const [payrollPeriod, setPayrollPeriod] = useState(month);
  const [payrollRows, setPayrollRows] = useState<PayrollRow[]>([]);
  const [empMap, setEmpMap] = useState<Map<string, EmpInfo>>(new Map());

  // === Reward state ===
  const [rewardPeriodType, setRewardPeriodType] = useState<'WEEKLY' | 'MONTHLY'>('WEEKLY');
  const [rewardPeriodKey, setRewardPeriodKey] = useState('');
  const [rewardRows, setRewardRows] = useState<RewardRow[]>([]);
  const [availableWeeks, setAvailableWeeks] = useState<string[]>([]);

  // === Remark（多条历史记录）===
  const [remarks, setRemarks] = useState<{ id: number; content: string; created_at: string; archived: boolean }[]>([]);
  const [remarkInput, setRemarkInput] = useState('');

  // === Archived 全局标记（独立于当前视图，用于控制 banner + 按钮）===
  const [hasArchived, setHasArchived] = useState(false);

  // === Dialogs ===
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ kind: 'ACTION' | 'CLEAR'; payload: any } | null>(null);
  const [qrOpen, setQrOpen] = useState<string | null>(null);

  // Load depts + employees + weeks on mount
  useEffect(() => {
    loadDepts();
    loadEmployees();
    loadWeeks();
  }, []);

  // Auto set default reward period
  useEffect(() => {
    if (rewardPeriodType === 'WEEKLY' && !rewardPeriodKey && availableWeeks.length > 0) {
      setRewardPeriodKey(availableWeeks[availableWeeks.length - 1]); // 最新一周
    } else if (rewardPeriodType === 'MONTHLY' && !rewardPeriodKey) {
      setRewardPeriodKey(month);
    }
  }, [rewardPeriodType, availableWeeks, month]);

  // Reload data when tab / period / dept / archived changes
  useEffect(() => {
    if (tab === 'PAYROLL' && payrollPeriod) { loadPayroll(); checkHasArchived(); }
    if (tab === 'REWARD' && rewardPeriodKey) { loadReward(); checkHasArchived(); }
  }, [tab, payrollPeriod, rewardPeriodKey, rewardPeriodType, deptFilter, archivedView]);

  // 独立查：当前周期是否存在已归档行（不管 archivedView）
  async function checkHasArchived() {
    const table = tab === 'PAYROLL' ? 'payroll_disbursement' : 'reward_disbursement';
    const periodKey = tab === 'PAYROLL' ? payrollPeriod : rewardPeriodKey;
    const periodType = tab === 'PAYROLL' ? undefined : rewardPeriodType;
    if (!periodKey) { setHasArchived(false); return; }
    const params = new URLSearchParams();
    params.set('period_key', periodKey);
    if (periodType) params.set('period_type', periodType);
    params.set('archived', 'true');
    params.set('_limit', '1');
    // 用已有的 list API 传 archived=true
    const endpoint = tab === 'PAYROLL' ? '/api/disbursement/payroll' : '/api/disbursement/reward';
    const r = await fetch(`${endpoint}?${params.toString()}`);
    const j = await r.json();
    setHasArchived((j.data || []).length > 0);
  }

  async function loadDepts() {
    const r = await fetch('/api/employees');
    const j = await r.json();
    const set = new Set<string>();
    for (const e of j.data || []) if (e.department) set.add(e.department);
    setDepts([...set]);
  }

  async function loadEmployees() {
    const r = await fetch('/api/employees');
    const j = await r.json();
    const m = new Map<string, EmpInfo>();
    for (const e of j.data || []) m.set(e.employee_id, e);
    setEmpMap(m);
  }

  async function loadWeeks() {
    // 从 weekly_reward_settlement (已有的周奖励结算) 查可用的 ISO 周
    const r = await fetch('/api/reward/calculate?period=WEEKLY');
    const j = await r.json();
    const allPeriods: string[] = [];
    if (j.data) {
      for (const row of j.data) {
        if (row.period_key) allPeriods.push(row.period_key);
      }
    }
    const weeks = [...new Set(allPeriods)].sort() as string[];
    setAvailableWeeks(weeks);
  }

  async function loadPayroll() {
    const dept = deptFilter !== 'ALL' ? `&dept=${encodeURIComponent(deptFilter)}` : '';
    const r = await fetch(
      `/api/disbursement/payroll?period_key=${payrollPeriod}${dept}&archived=${archivedView}`
    );
    const j = await r.json();
    setPayrollRows(j.data || []);
    loadRemark(payrollPeriod, 'PAYROLL');
  }

  async function loadReward() {
    const dept = deptFilter !== 'ALL' ? `&dept=${encodeURIComponent(deptFilter)}` : '';
    const r = await fetch(
      `/api/disbursement/reward?period_key=${rewardPeriodKey}&period_type=${rewardPeriodType}${dept}&archived=${archivedView}`
    );
    const j = await r.json();
    setRewardRows(j.data || []);
    loadRemark(rewardPeriodKey, 'REWARD');
  }

  async function loadRemark(pk: string, pt: string) {
    const r = await fetch(`/api/disbursement/remark?period_key=${pk}&period_type=${pt}`);
    const j = await r.json();
    setRemarks(j.data || []);
  }

  async function saveRemark() {
    const pk = tab === 'PAYROLL' ? payrollPeriod : rewardPeriodKey;
    const pt = tab === 'PAYROLL' ? 'PAYROLL' : rewardPeriodType;
    if (!remarkInput.trim() || !pk) return;
    if (hasArchived) { toast.error('该周期已归档，无法添加备注'); return; }
    const r = await fetch('/api/disbursement/remark', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ period_key: pk, period_type: pt, content: remarkInput.trim() }),
    });
    const j = await r.json();
    if (!r.ok) { toast.error(j.error || '保存失败'); return; }
    setRemarkInput('');
    toast.success('备注已添加');
    loadRemark(pk, pt);
  }

  // ============ Generate ============
  async function handleGenerate() {
    setMsg(null);
    const endpoint = tab === 'PAYROLL' ? '/api/disbursement/payroll/generate' : '/api/disbursement/reward/generate';
    const body: any = tab === 'PAYROLL'
      ? { month: payrollPeriod }
      : { period_key: rewardPeriodKey, period_type: rewardPeriodType };
    if (deptFilter !== 'ALL') body.dept = deptFilter;

    const r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!r.ok) {
      setMsg({ type: 'err', text: j.error || '生成失败' });
      return;
    }
    setMsg({ type: 'ok', text: `快照已生成: ${j.count} 行` });
    tab === 'PAYROLL' ? loadPayroll() : loadReward();
  }

  // ============ Confirm / Archive ============
  function handleAction(ids: number[], action: 'PAID' | 'CANCELLED' | 'ARCHIVE' | 'UNARCHIVE') {
    if (ids.length === 0) return;
    openConfirmAction(ids, action);
  }

  function openConfirmAction(ids: number[], action: 'PAID' | 'CANCELLED' | 'ARCHIVE' | 'UNARCHIVE') {
    setConfirmAction({ kind: 'ACTION', payload: { ids, action } });
    setConfirmOpen(true);
  }

  async function handleActionConfirmed() {
    if (!confirmAction || confirmAction.kind !== 'ACTION') return;
    const { ids, action } = confirmAction.payload;
    setConfirmOpen(false);
    setConfirmAction(null);

    setMsg(null);
    const table = tab === 'PAYROLL' ? 'payroll_disbursement' : 'reward_disbursement';
    const r = await fetch('/api/disbursement/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ table, ids, action }),
    });
    const j = await r.json();
    if (!r.ok) {
      setMsg({ type: 'err', text: j.error || '操作失败' });
      return;
    }
    setMsg({
      type: 'ok',
      text: `更新 ${j.updated} 行${
        j.loan_repay_logs > 0 ? `，自动冲减 ${j.loan_repay_logs} 笔借款` : ''
      }`,
    });
    tab === 'PAYROLL' ? loadPayroll() : loadReward();
  }

  // ============ Clear ============
  function handleClear() {
    const table = tab === 'PAYROLL' ? 'payroll_disbursement' : 'reward_disbursement';
    const period_key = tab === 'PAYROLL' ? payrollPeriod : rewardPeriodKey;
    const period_type = tab === 'PAYROLL' ? undefined : rewardPeriodType;

    if (!period_key) {
      setMsg({ type: 'err', text: '请先选择周期' });
      return;
    }

    // 统计当前视图要删的数量
    const rows = tab === 'PAYROLL' ? payrollRows : rewardRows;
    const currentPeriod = rows.filter((r: any) =>
      r.period_key === period_key && !r.archived
    );
    if (currentPeriod.length === 0) {
      setMsg({ type: 'err', text: '当前周期没有未归档快照' });
      return;
    }

    setConfirmAction({
      kind: 'CLEAR',
      payload: { table, period_key, period_type, also_paid: true, count: currentPeriod.length },
    });
    setConfirmOpen(true);
  }

  async function handleClearConfirmed() {
    if (!confirmAction || confirmAction.kind !== 'CLEAR') return;
    const { table, period_key, period_type, also_paid } = confirmAction.payload;
    setConfirmOpen(false);
    setConfirmAction(null);

    const r = await fetch('/api/disbursement/clear', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ table, period_key, period_type, also_paid }),
    });
    const j = await r.json();
    if (!r.ok) {
      setMsg({ type: 'err', text: j.error || '清除失败' });
      return;
    }
    setMsg({ type: 'ok', text: `已清除 ${j.deleted} 行快照` });
    setSelected(new Set());
    tab === 'PAYROLL' ? loadPayroll() : loadReward();
  }

  // ============ 整体归档 / 反归档 ============
  function getCurrentRows() {
    return tab === 'PAYROLL' ? payrollRows : rewardRows;
  }
  function archiveAllPaid() {
    const ids = getCurrentRows()
      .filter((r: any) => r.status === 'PAID' && !r.archived)
      .map((r: any) => r.id);
    if (ids.length === 0) {
      toast.error('没有已发放的行可归档');
      return;
    }
    openConfirmAction(ids, 'ARCHIVE');
  }
  function unarchiveAll() {
    const ids = getCurrentRows()
      .filter((r: any) => r.archived)
      .map((r: any) => r.id);
    if (ids.length === 0) {
      toast.error('没有已归档的行可反归档');
      return;
    }
    openConfirmAction(ids, 'UNARCHIVE');
  }

  // ============ Modify ============
  async function handleModify(rowId: number, field: 'net_pay' | 'loan_deduction', value: number) {
    const table = tab === 'PAYROLL' ? 'payroll_disbursement' : 'reward_disbursement';
    await fetch('/api/disbursement/modify', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ table, id: rowId, [field]: value }),
    });
    tab === 'PAYROLL' ? loadPayroll() : loadReward();
  }

  // ============ Selection ============
  const [selected, setSelected] = useState<Set<number>>(new Set());
  function toggleSel(id: number, row?: any) {
    // 只有已归档的行不能勾选；其他（PENDING / PAID / CANCELLED）都能勾选
    if (row?.archived) return;
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function selAllOnlyPending() {
    // 全选 = 选所有「非归档」行（PAID 也要能选，因为要取消发放）
    const rows = tab === 'PAYROLL' ? payrollRows : rewardRows;
    const visible = rows.filter((r: any) => !archivedView ? !r.archived : true);
    const visibleIds = visible.map((r: any) => r.id);
    const allSelected = visibleIds.every((id: number) => selected.has(id));
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(visibleIds));
  }

  // ============ Totals ============
  const totals = useMemo(() => {
    const rows = tab === 'PAYROLL' ? payrollRows : rewardRows;
    const countArchived = rows.filter((r: any) => r.archived).length;
    const filtered = rows.filter((r: any) => !archivedView ? !r.archived : true);
    const pending = filtered.filter((r: any) => r.status === 'PENDING');
    const totalNet = pending.reduce((s: number, r: any) => s + Number(r.net_pay), 0);
    const totalGross = pending.reduce((s: number, r: any) => s + Number(tab === 'PAYROLL' ? r.gross_total : r.reward_total), 0);
    const totalLoan = pending.reduce((s: number, r: any) => s + Number(r.loan_deduction), 0);
    const countPaid = filtered.filter((r: any) => r.status === 'PAID').length;
    const countPending = pending.length;
    return { totalNet, totalGross, totalLoan, countPaid, countPending, countTotal: filtered.length, countArchived };
  }, [tab, payrollRows, rewardRows, archivedView]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">发放管理</h1>
          <p className="text-xs text-muted-foreground">
            {tab === 'PAYROLL' ? `月份: ${payrollPeriod}` : `周期: ${rewardPeriodKey}`}
            {' | '}
            待发放 {totals.countPending} 人 / 已发放 {totals.countPaid} 人
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={archivedView}
              onChange={(e) => setArchivedView(e.target.checked)}
              className="accent-primary"
            />
            包含归档
          </label>
          <span className="text-xs text-muted-foreground">部门:</span>
          <select
            value={deptFilter}
            onChange={(e) => setDeptFilter(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1 text-xs"
          >
            <option value="ALL">全部</option>
            {depts.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {[
          { key: 'PAYROLL', label: '💰 工资发放' },
          { key: 'REWARD', label: '🎁 奖励发放' },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key as any)}
            className={`px-3 py-2 text-xs border-b-2 transition-colors ${
              tab === t.key
                ? 'border-primary text-primary font-medium'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {msg && (
        <div
          className={`rounded-md px-3 py-2 text-xs ${
            msg.type === 'ok' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-destructive/10 text-destructive'
          }`}
        >
          {msg.text}
        </div>
      )}

      {/* Controls: period + generate */}
      <div className="rounded-md border border-border/60 bg-muted/10 p-3 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          {tab === 'PAYROLL' ? (
            <>
              <span className="text-xs text-muted-foreground">月份:</span>
              <Input
                type="month"
                value={payrollPeriod}
                onChange={(e) => setPayrollPeriod(e.target.value)}
                className="w-40 h-8 text-xs"
              />
            </>
          ) : (
            <>
              <span className="text-xs text-muted-foreground">周期类型:</span>
              <select
                value={rewardPeriodType}
                onChange={(e) => {
                  setRewardPeriodType(e.target.value as any);
                  if (e.target.value === 'MONTHLY') setRewardPeriodKey(month);
                  else if (availableWeeks.length > 0)
                    setRewardPeriodKey(availableWeeks[availableWeeks.length - 1]);
                }}
                className="rounded-md border border-border bg-background px-2 py-1 text-xs"
              >
                <option value="WEEKLY">按周</option>
                <option value="MONTHLY">按月</option>
              </select>
              <span className="text-xs text-muted-foreground">周期:</span>
              {rewardPeriodType === 'WEEKLY' ? (
                <select
                  value={rewardPeriodKey}
                  onChange={(e) => setRewardPeriodKey(e.target.value)}
                  className="rounded-md border border-border bg-background px-2 py-1 text-xs"
                >
                  {availableWeeks.length === 0 && (
                    <option value="">-- 先去奖励中心核算 --</option>
                  )}
                  {availableWeeks.map((w) => (
                    <option key={w} value={w}>{w}</option>
                  ))}
                </select>
              ) : (
                <Input
                  type="month"
                  value={rewardPeriodKey}
                  onChange={(e) => setRewardPeriodKey(e.target.value)}
                  className="w-40 h-8 text-xs"
                />
              )}
            </>
          )}

          <Button
            size="sm"
            onClick={handleGenerate}
            disabled={hasArchived}
            title={hasArchived ? '该周期已归档，请先反归档' : '从结算中心生成快照'}
          >
            🔄 从结算生成快照
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={handleClear}
            disabled={hasArchived}
            title={hasArchived ? '该周期已归档，无法清除' : '清除当前周期未归档快照'}
          >
            🗑️ 清除未归档
          </Button>
        </div>

        {/* Action bar */}
        <div className="flex items-center gap-2 border-t border-border/40 pt-2">
          <span className="text-xs text-muted-foreground">
            已选 {selected.size} / {totals.countPending} 待发放 / {totals.countPaid} 已发放 / {totals.countTotal} 总
          </span>
          <div className="ml-auto flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={selected.size === 0}
              onClick={() => handleAction([...selected], 'PAID')}
            >
              ✅ 确认发放
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={selected.size === 0}
              onClick={() => handleAction([...selected], 'CANCELLED')}
            >
              ↩️ 取消发放
            </Button>
            {!archivedView ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={archiveAllPaid}
                disabled={totals.countPaid === 0}
              >
                📦 归档全部已发放
              </Button>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                onClick={unarchiveAll}
                disabled={getCurrentRows().filter((r: any) => r.archived).length === 0}
              >
                ↪️ 反归档全部
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* ============ PAYROLL TABLE ============ */}
      {tab === 'PAYROLL' && (
        <div className="rounded-md border border-border overflow-auto">
          <Table>
            <TableHeader className="bg-muted/30">
              <TableRow>
                <TableHead className="w-8">
                  <input
                    type="checkbox"
                    title="全选待发放行"
                    onChange={() => selAllOnlyPending()}
                    className="accent-primary cursor-pointer"
                  />
                </TableHead>
                <TableHead>工号</TableHead>
                <TableHead>姓名</TableHead>
                <TableHead className="text-right">底薪</TableHead>
                <TableHead className="text-right">绩效</TableHead>
                <TableHead className="text-right">全勤</TableHead>
                <TableHead className="text-right">基础工资</TableHead>
                <TableHead className="text-right">提成</TableHead>
                <TableHead className="text-right">工资合计</TableHead>
                <TableHead className="text-right">借款抵扣</TableHead>
                <TableHead className="text-right">实发</TableHead>
                <TableHead className="w-16 text-center">工资卡</TableHead>
                <TableHead className="w-16 text-center">状态</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* 空态：完全没数据 */}
              {payrollRows.length === 0 && !hasArchived && (
                <TableRow>
                  <TableCell colSpan={13} className="text-center text-muted-foreground py-8">
                    还没有快照 → 点上方「🔄 从结算生成快照」
                  </TableCell>
                </TableRow>
              )}
              {/* 空态：有归档但当前视图没查到（包含归档关闭时） */}
              {payrollRows.length === 0 && hasArchived && (
                <TableRow>
                  <TableCell colSpan={13} className="bg-green-500/5 text-center py-4">
                    <span className="inline-flex items-center gap-2 text-sm text-green-700">
                      ✅ 该周期已生成快照并发放归档完成，无法生成新快照。如需修改请先点「↪️ 反归档全部」。
                    </span>
                  </TableCell>
                </TableRow>
              )}
              {/* 有数据但全部是归档（包含归档开启时） */}
              {payrollRows.length > 0 && hasArchived && totals.countPending === 0 && totals.countPaid === 0 && (
                <TableRow>
                  <TableCell colSpan={13} className="bg-green-500/5 text-center py-4">
                    <span className="inline-flex items-center gap-2 text-sm text-green-700">
                      ✅ 该周期已生成快照并发放归档完成，无法生成新快照。如需修改请先点「↪️ 反归档全部」。
                    </span>
                  </TableCell>
                </TableRow>
              )}
              {payrollRows.map((r) => {
                const emp = empMap.get(r.employee_id);
                const selectedRow = selected.has(r.id);
                return (
                  <TableRow key={r.id} className={r.archived ? 'opacity-50' : ''}>
                    <TableCell>
                      <input
                        type="checkbox"
                        checked={selectedRow}
                        onChange={() => toggleSel(r.id, r)}
                        disabled={r.archived}
                        className="accent-primary cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                      />
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.employee_id}</TableCell>
                    <TableCell>{emp?.employee_name || '-'}</TableCell>
                    <TableCell className="text-right text-xs">{formatTHB(r.base_salary)}</TableCell>
                    <TableCell className="text-right text-xs">{formatTHB(r.performance_bonus)}</TableCell>
                    <TableCell className="text-right text-xs">{formatTHB(r.full_attendance_bonus)}</TableCell>
                    <TableCell className="text-right text-xs font-medium">{formatTHB(r.gross_salary)}</TableCell>
                    <TableCell className="text-right text-xs">{formatTHB(r.commission)}</TableCell>
                    <TableCell className="text-right text-xs font-medium">{formatTHB(r.gross_total)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Input
                          type="number"
                          step="0.01"
                          value={r.loan_deduction}
                          onChange={(e) =>
                            handleModify(r.id, 'loan_deduction', Number(e.target.value))
                          }
                          disabled={r.status === 'PAID'}
                          className={`w-24 h-7 text-xs text-right ${
                            r.loan_deduction > 0 ? 'text-destructive font-semibold' : ''
                          }`}
                        />
                      </div>
                      {r.loan_remaining_before > 0 && (
                        <div className="text-[10px] text-muted-foreground text-right">
                          未清: {formatTHB(r.loan_remaining_before)}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Input
                          type="number"
                          step="0.01"
                          value={r.net_pay}
                          onChange={(e) =>
                            handleModify(r.id, 'net_pay', Number(e.target.value))
                          }
                          disabled={r.status === 'PAID'}
                          className={`w-24 h-7 text-xs text-right font-bold ${
                            (r as any).net_pay_override ? 'text-red-600 !bg-red-50' : 'text-emerald-600'
                          }`}
                        />
                      </div>
                      {(r as any).net_pay_override && (
                        <div className="text-[10px] text-red-500 text-right font-semibold">已改</div>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {emp?.salary_qr_code_url ? (
                        <button
                          onClick={() => setQrOpen(emp.salary_qr_code_url!)}
                          className="hover:opacity-70"
                        >
                          <img
                            src={emp.salary_qr_code_url}
                            alt="QR"
                            className="w-8 h-8 rounded border border-border object-cover"
                          />
                        </button>
                      ) : (
                        <span className="text-xs text-muted-foreground">❌</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] ${
                          STATUS_LABEL[r.status].cls
                        }`}
                      >
                        {STATUS_LABEL[r.status].label}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
            {/* Footer totals */}
            {payrollRows.length > 0 && (
              <TableHeader className="bg-muted/40 border-t border-border">
                <TableRow>
                  <TableHead colSpan={3} className="text-xs font-semibold">
                    待发放合计 ({totals.countPending} 人)
                  </TableHead>
                  <TableHead colSpan={4} />
                  <TableHead className="text-right text-xs font-semibold">
                    {formatTHB(totals.totalGross)}
                  </TableHead>
                  <TableHead className="text-right text-xs font-semibold text-destructive">
                    -{formatTHB(totals.totalLoan)}
                  </TableHead>
                  <TableHead className="text-right text-xs font-bold text-emerald-600">
                    {formatTHB(totals.totalNet)}
                  </TableHead>
                  <TableHead colSpan={3} />
                </TableRow>
              </TableHeader>
            )}
          </Table>
        </div>
      )}

      {/* ============ REWARD TABLE ============ */}
      {tab === 'REWARD' && (
        <div className="rounded-md border border-border overflow-auto">
          <Table>
            <TableHeader className="bg-muted/30">
              <TableRow>
                <TableHead className="w-8">
                  <input
                    type="checkbox"
                    title="全选待发放行"
                    onChange={() => selAllOnlyPending()}
                    className="accent-primary cursor-pointer"
                  />
                </TableHead>
                <TableHead>工号</TableHead>
                <TableHead>姓名</TableHead>
                <TableHead className="text-right">日奖励</TableHead>
                <TableHead className="text-right">周奖励</TableHead>
                <TableHead className="text-right">奖励合计</TableHead>
                <TableHead className="text-right">借款抵扣</TableHead>
                <TableHead className="text-right">实发</TableHead>
                <TableHead className="w-16 text-center">工资卡</TableHead>
                <TableHead className="w-16 text-center">状态</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* 空态：完全没数据 */}
              {rewardRows.length === 0 && !hasArchived && (
                <TableRow>
                  <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                    还没有快照 → 点上方「🔄 从结算生成快照」
                  </TableCell>
                </TableRow>
              )}
              {/* 空态：有归档但当前视图没查到（包含归档关闭时） */}
              {rewardRows.length === 0 && hasArchived && (
                <TableRow>
                  <TableCell colSpan={10} className="bg-green-500/5 text-center py-4">
                    <span className="inline-flex items-center gap-2 text-sm text-green-700">
                      ✅ 该周期已生成快照并发放归档完成，无法生成新快照。如需修改请先点「↪️ 反归档全部」。
                    </span>
                  </TableCell>
                </TableRow>
              )}
              {/* 有数据但全部是归档（包含归档开启时） */}
              {rewardRows.length > 0 && hasArchived && totals.countPending === 0 && totals.countPaid === 0 && (
                <TableRow>
                  <TableCell colSpan={10} className="bg-green-500/5 text-center py-4">
                    <span className="inline-flex items-center gap-2 text-sm text-green-700">
                      ✅ 该周期已生成快照并发放归档完成，无法生成新快照。如需修改请先点「↪️ 反归档全部」。
                    </span>
                  </TableCell>
                </TableRow>
              )}
              {rewardRows.map((r) => {
                const emp = empMap.get(r.employee_id);
                return (
                  <TableRow key={r.id} className={r.archived ? 'opacity-50' : ''}>
                    <TableCell>
                      <input
                        type="checkbox"
                        checked={selected.has(r.id)}
                        onChange={() => toggleSel(r.id, r)}
                        disabled={r.archived}
                        className="accent-primary cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                      />
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.employee_id}</TableCell>
                    <TableCell>{emp?.employee_name || '-'}</TableCell>
                    <TableCell className="text-right text-xs">{formatTHB(r.daily_total)}</TableCell>
                    <TableCell className="text-right text-xs">{formatTHB(r.weekly_total)}</TableCell>
                    <TableCell className="text-right text-xs font-medium">{formatTHB(r.reward_total)}</TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        step="0.01"
                        value={r.loan_deduction}
                        onChange={(e) => handleModify(r.id, 'loan_deduction', Number(e.target.value))}
                        disabled={r.status === 'PAID'}
                        className={`w-24 h-7 text-xs text-right ${
                          r.loan_deduction > 0 ? 'text-destructive font-semibold' : ''
                        }`}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        step="0.01"
                        value={r.net_pay}
                        onChange={(e) => handleModify(r.id, 'net_pay', Number(e.target.value))}
                        disabled={r.status === 'PAID'}
                        className={`w-24 h-7 text-xs text-right font-bold ${
                          (r as any).net_pay_override ? 'text-red-600 !bg-red-50' : 'text-emerald-600'
                        }`}
                      />
                    </TableCell>
                    <TableCell className="text-center">
                      {emp?.salary_qr_code_url ? (
                        <button onClick={() => setQrOpen(emp.salary_qr_code_url!)}>
                          <img
                            src={emp.salary_qr_code_url}
                            alt="QR"
                            className="w-8 h-8 rounded border border-border object-cover hover:opacity-70"
                          />
                        </button>
                      ) : (
                        <span className="text-xs text-muted-foreground">❌</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] ${STATUS_LABEL[r.status].cls}`}>
                        {STATUS_LABEL[r.status].label}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
            {rewardRows.length > 0 && (
              <TableHeader className="bg-muted/40 border-t border-border">
                <TableRow>
                  <TableHead colSpan={3} className="text-xs font-semibold">
                    待发放合计 ({totals.countPending} 人)
                  </TableHead>
                  <TableHead />
                  <TableHead />
                  <TableHead className="text-right text-xs font-semibold">
                    {formatTHB(totals.totalGross)}
                  </TableHead>
                  <TableHead className="text-right text-xs font-semibold text-destructive">
                    -{formatTHB(totals.totalLoan)}
                  </TableHead>
                  <TableHead className="text-right text-xs font-bold text-emerald-600">
                    {formatTHB(totals.totalNet)}
                  </TableHead>
                  <TableHead colSpan={2} />
                </TableRow>
              </TableHeader>
            )}
          </Table>
        </div>
      )}

      {/* Remark（多条历史记录）*/}
      <div className="rounded-md border border-border/60 bg-muted/10 p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium">
            📝 批次备注（{tab === 'PAYROLL' ? payrollPeriod : rewardPeriodKey}）
            {hasArchived && <span className="ml-2 text-[11px] text-muted-foreground">· 已归档，只读</span>}
          </div>
          <span className="text-[11px] text-muted-foreground">共 {remarks.length} 条</span>
        </div>

        {/* 历史记录（倒序） */}
        {remarks.length === 0 ? (
          <div className="text-center text-[11px] text-muted-foreground py-3 border border-dashed border-border rounded">
            暂无备注
          </div>
        ) : (
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {remarks.map((r) => (
              <div
                key={r.id}
                className={`rounded border px-2.5 py-1.5 text-[12px] leading-relaxed ${
                  r.archived ? 'bg-muted/30 border-border/50 text-muted-foreground' : 'bg-background border-border'
                }`}
              >
                <div className="whitespace-pre-wrap">{r.content}</div>
                <div className="mt-1 text-[10.5px] text-muted-foreground">
                  {new Date(r.created_at).toLocaleString('zh-CN', { hour12: false })}
                  {r.archived && <span className="ml-2 text-[10px] text-gold">已归档</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 新增输入（归档后禁用） */}
        <div className="space-y-2">
          <textarea
            value={remarkInput}
            onChange={(e) => setRemarkInput(e.target.value)}
            rows={2}
            disabled={hasArchived}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs resize-none font-mono disabled:opacity-50 disabled:cursor-not-allowed"
            placeholder={hasArchived ? '该周期已归档，无法添加备注' : '添加新备注...（每次保存追加一条）'}
          />
          <div className="flex justify-end">
            <Button size="sm" onClick={saveRemark} disabled={hasArchived || !remarkInput.trim()}>
              添加备注
            </Button>
          </div>
        </div>
      </div>

      {/* QR Dialog */}
      <Dialog open={!!qrOpen} onOpenChange={(o) => !o && setQrOpen(null)}>
        <DialogContent className="sm:max-w-md flex flex-col items-center">
          {qrOpen && <img src={qrOpen} alt="QR" className="max-w-[400px] max-h-[400px]" />}
        </DialogContent>
      </Dialog>

      {/* Confirm Alert */}
      <AlertDialog open={confirmOpen} onOpenChange={(o) => !o && setConfirmOpen(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction?.kind === 'CLEAR'
                ? '清除未归档快照'
                : ((confirmAction?.payload as any)?.action
                    ? ({ PAID: '确认发放', CANCELLED: '取消发放', ARCHIVE: '归档', UNARCHIVE: '反归档' } as any)[(confirmAction?.payload as any).action]
                    : '确认操作')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction?.kind === 'CLEAR' && confirmAction?.payload
                ? `将清除周期 ${(confirmAction.payload as any).period_key} 的 ${(confirmAction.payload as any).count} 行未归档快照（包括已发放/待发放），此操作不可恢复。`
                : (() => {
                    const p = confirmAction?.payload as any;
                    const action = p?.action || '';
                    const count = p?.ids?.length ?? 0;
                    const map: Record<string, string> = {
                      PAID: `确认发放 ${count} 行？系统会自动冲减对应员工的未清借款（如果有抵扣金额）。`,
                      CANCELLED: `取消发放 ${count} 行？如果这些行已发放（PAID），系统会自动回滚已冲减的借款。`,
                      ARCHIVE: `归档 ${count} 行？归档后默认不显示。`,
                      UNARCHIVE: `反归档 ${count} 行？`,
                    };
                    return map[action] || '确认此操作？';
                  })()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setConfirmOpen(false); setConfirmAction(null); }}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmAction?.kind === 'CLEAR') handleClearConfirmed();
                else handleActionConfirmed();
              }}
              className={confirmAction?.kind === 'CLEAR' ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : ''}
            >
              {confirmAction?.kind === 'CLEAR' ? '清除' : '确认'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
