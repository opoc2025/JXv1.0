'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatTHB } from '@/lib/format';

type Loan = {
  loan_id: number;
  employee_id: string;
  loan_date: string;
  amount: number;
  repaid_amount: number;
  status: 'OUTSTANDING' | 'CLEARED';
  remark: string | null;
  source: string;
  created_at?: string;
  employee_name?: string;
};

type EventItem = {
  type: 'LOAN' | 'REPAY';
  loan_id: number | null;
  employee_id: string;
  employee_name?: string;
  timestamp: string;
  amount: number;
  source: string;
  remark: string | null;
};

type EmpSummary = {
  employee_id: string;
  employee_name: string;
  department: string | null;
  total_loan: number;
  total_repaid: number;
  total_outstanding: number;
  outstanding_count: number;
  cleared_count: number;
};

const SOURCE_LABELS: Record<string, string> = {
  MANUAL: '手工',
  PAYROLL_MONTHLY: '月工资冲减',
  REWARD_DISBURSEMENT: '奖励冲减',
  REWARD_WEEKLY: '周奖励冲减',
  REVERT: '冲减回滚',
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso.slice(0, 10);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

type EmpShort = { employee_id: string; employee_name: string; department: string | null; salary_qr_code_url: string | null };

type SubsidyCategory = {
  category_id: number;
  category_name: string;
  sort_order: number;
  enabled: boolean;
};

type Subsidy = {
  subsidy_id: number;
  employee_id: string;
  month: string;
  category_id: number;
  amount: number;
  remark: string | null;
  created_at?: string;
  employee_name?: string;
  employee_department?: string | null;
  category_name?: string;
};

export default function LoansPage() {
  const [loans, setLoans] = useState<Loan[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [summary, setSummary] = useState<EmpSummary[]>([]);
  const [tab, setTab] = useState<'REGISTER' | 'REPAY' | 'LIST' | 'EVENTS' | 'SUMMARY' | 'SUB_REG' | 'SUB_LIST'>('REGISTER');
  const [deptFilter, setDeptFilter] = useState('ALL');
  const [empList, setEmpList] = useState<EmpShort[]>([]);

  const [regEmpId, setRegEmpId] = useState('');
  const [regDate, setRegDate] = useState('');
  const [regAmount, setRegAmount] = useState('');
  const [regRemark, setRegRemark] = useState('');

  const [repEmpId, setRepEmpId] = useState('');
  const [repDate, setRepDate] = useState(new Date().toISOString().slice(0, 10));
  const [repAmount, setRepAmount] = useState('');
  const [repRemark, setRepRemark] = useState('');

  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Loan | null>(null);
  const [deleting, setDeleting] = useState(false);

  // ===== 补贴 =====
  const [subsidies, setSubsidies] = useState<Subsidy[]>([]);
  const [subCategories, setSubCategories] = useState<SubsidyCategory[]>([]);
  const [subMonthFilter, setSubMonthFilter] = useState(new Date().toISOString().slice(0, 7));

  const [subRegEmpId, setSubRegEmpId] = useState('');
  const [subRegMonth, setSubRegMonth] = useState(new Date().toISOString().slice(0, 7));
  const [subRegCatId, setSubRegCatId] = useState('');
  const [subRegAmount, setSubRegAmount] = useState('');
  const [subRegRemark, setSubRegRemark] = useState('');

  const [newCatName, setNewCatName] = useState('');
  const [deleteSubTarget, setDeleteSubTarget] = useState<Subsidy | null>(null);
  const [deletingSub, setDeletingSub] = useState(false);
  const [qrOpen, setQrOpen] = useState<EmpShort | null>(null);

  useEffect(() => {
    fetchAll();
    fetchEmpList();
    fetchSubCategories();
  }, [deptFilter, tab, subMonthFilter]);

  async function fetchEmpList() {
    const r = await fetch('/api/employees');
    const j = await r.json();
    const list: EmpShort[] = (j.data || []).map((e: any) => ({
      employee_id: e.employee_id,
      employee_name: e.employee_name,
      department: e.department,
      salary_qr_code_url: e.salary_qr_code_url ?? null,
    }));
    list.sort((a, b) => a.employee_id.localeCompare(b.employee_id));
    setEmpList(list);
  }

  async function fetchSubCategories() {
    const r = await fetch('/api/subsidy-categories');
    const j = await r.json();
    setSubCategories(j.data || []);
  }

  async function fetchAll() {
    const dept = deptFilter !== 'ALL' ? `&dept=${encodeURIComponent(deptFilter)}` : '';

    if (tab === 'LIST') {
      const r = await fetch(`/api/loans?${dept}`);
      const j = await r.json();
      setLoans(j.data || []);
    } else if (tab === 'EVENTS') {
      const r = await fetch(`/api/loans?sort=event${dept}`);
      const j = await r.json();
      setEvents(j.data || []);
    } else if (tab === 'SUMMARY') {
      const r = await fetch(`/api/loans?mode=summary${dept}`);
      const j = await r.json();
      setSummary(j.data || []);
    } else if (tab === 'SUB_LIST') {
      const m = subMonthFilter ? `&month=${subMonthFilter}` : '';
      const r = await fetch(`/api/subsidies?${m}${dept}`);
      const j = await r.json();
      setSubsidies(
        (j.data || []).map((s: any) => ({
          ...s,
          employee_name: s.employee?.employee_name,
          employee_department: s.employee?.department,
          category_name: s.subsidy_category?.category_name,
        }))
      );
    }
  }

  async function handleRegister() {
    setMsg(null);
    if (!regEmpId || !regDate || !regAmount) {
      setMsg({ type: 'err', text: '工号、日期、金额必填' });
      return;
    }
    const r = await fetch('/api/loans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employee_id: regEmpId,
        loan_date: regDate,
        amount: Number(regAmount),
        remark: regRemark,
      }),
    });
    const j = await r.json();
    if (!r.ok) {
      setMsg({ type: 'err', text: j.error || '失败' });
      return;
    }
    setMsg({ type: 'ok', text: '登记成功' });
    setRegAmount('');
    setRegRemark('');
    fetchAll();
  }

  async function handleRepay() {
    setMsg(null);
    if (!repEmpId || !repDate || !repAmount) {
      setMsg({ type: 'err', text: '工号、日期、金额必填' });
      return;
    }
    const r = await fetch('/api/loans/repay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employee_id: repEmpId,
        repay_date: repDate,
        amount: Number(repAmount),
        remark: repRemark,
      }),
    });
    const j = await r.json();
    if (!r.ok) {
      setMsg({ type: 'err', text: j.error || '失败' });
      return;
    }
    setMsg({
      type: 'ok',
      text: `还款成功：冲减 ${formatTHB(j.repay_amount)}（写了 ${j.logs_written} 条日志）`,
    });
    setRepAmount('');
    setRepRemark('');
    fetchAll();
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    const r = await fetch(`/api/loans?loan_id=${deleteTarget.loan_id}`, { method: 'DELETE' });
    const j = await r.json();
    setDeleting(false);
    if (!r.ok) {
      setMsg({ type: 'err', text: j.error || '删除失败' });
      return;
    }
    setMsg({ type: 'ok', text: `已删除借款记录 #${deleteTarget.loan_id}（${formatTHB(deleteTarget.amount)}）` });
    setDeleteTarget(null);
    fetchAll();
  }

  // ===== 补贴操作 =====
  async function handleSubRegister() {
    setMsg(null);
    if (!subRegEmpId || !subRegMonth || !subRegCatId || !subRegAmount) {
      setMsg({ type: 'err', text: '员工、月份、类目、金额必填' });
      return;
    }
    const r = await fetch('/api/subsidies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employee_id: subRegEmpId,
        month: subRegMonth,
        category_id: Number(subRegCatId),
        amount: Number(subRegAmount),
        remark: subRegRemark,
      }),
    });
    const j = await r.json();
    if (!r.ok) {
      setMsg({ type: 'err', text: j.error || '失败' });
      return;
    }
    setMsg({ type: 'ok', text: `补贴登记成功：${formatTHB(Number(subRegAmount))}（${subRegMonth}）` });
    setSubRegAmount('');
    setSubRegRemark('');
    fetchAll();
  }

  async function handleAddCategory() {
    setMsg(null);
    if (!newCatName.trim()) {
      setMsg({ type: 'err', text: '类目名称必填' });
      return;
    }
    const r = await fetch('/api/subsidy-categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category_name: newCatName, sort_order: subCategories.length + 1 }),
    });
    const j = await r.json();
    if (!r.ok) {
      setMsg({ type: 'err', text: j.error || '失败' });
      return;
    }
    setMsg({ type: 'ok', text: `类目「${newCatName.trim()}」已创建` });
    setNewCatName('');
    fetchSubCategories();
  }

  async function handleDeleteSubsidy() {
    if (!deleteSubTarget) return;
    setDeletingSub(true);
    const r = await fetch(`/api/subsidies?subsidy_id=${deleteSubTarget.subsidy_id}`, { method: 'DELETE' });
    const j = await r.json();
    setDeletingSub(false);
    if (!r.ok) {
      setMsg({ type: 'err', text: j.error || '删除失败' });
      return;
    }
    setMsg({ type: 'ok', text: `已删除补贴记录 #${deleteSubTarget.subsidy_id}（${formatTHB(deleteSubTarget.amount)}）` });
    setDeleteSubTarget(null);
    fetchAll();
  }

  // ===== 部门筛选联动 =====
  // 各表单员工下拉只显示当前部门（ALL = 全部）的员工
  const filteredEmpList =
    deptFilter === 'ALL' ? empList : empList.filter((e) => e.department === deptFilter);

  // 切换部门后，已选员工若不属于该部门则清空（避免表单与筛选不一致）
  useEffect(() => {
    if (deptFilter === 'ALL') return;
    const inDept = (id: string) => empList.some((e) => e.employee_id === id && e.department === deptFilter);
    if (regEmpId && !inDept(regEmpId)) setRegEmpId('');
    if (repEmpId && !inDept(repEmpId)) setRepEmpId('');
    if (subRegEmpId && !inDept(subRegEmpId)) setSubRegEmpId('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deptFilter, empList]);

  // 汇总数字
  const totalOutstanding = summary.reduce((s, r) => s + r.total_outstanding, 0);
  const totalLoanAll = summary.reduce((s, r) => s + r.total_loan, 0);
  const totalRepaidAll = summary.reduce((s, r) => s + r.total_repaid, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">借款管理</h1>
          <p className="text-xs text-muted-foreground">
            未清借款合计:{' '}
            <span className="text-destructive font-semibold">
              {formatTHB(totalOutstanding)}
            </span>
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <span className="text-xs text-muted-foreground">部门:</span>
          <select
            value={deptFilter}
            onChange={(e) => setDeptFilter(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1 text-xs"
          >
            <option value="ALL">全部</option>
            {[...new Set(empList.filter(e => e.department).map(e => e.department!))].map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {[
          { key: 'REGISTER', label: '📝 借款登记' },
          { key: 'REPAY', label: '💸 还款登记' },
          { key: 'LIST', label: '📋 借款列表' },
          { key: 'EVENTS', label: '📜 事件流' },
          { key: 'SUMMARY', label: '📊 员工汇总' },
          { key: 'SUB_REG', label: '🎁 补贴登记' },
          { key: 'SUB_LIST', label: '📋 补贴列表' },
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
        <div className={`rounded-md px-3 py-2 text-xs ${
          msg.type === 'ok' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-destructive/10 text-destructive'
        }`}>
          {msg.text}
        </div>
      )}

      {tab === 'REGISTER' && (
        <div className="rounded-md border border-border p-4 space-y-3 max-w-md">
          <div>
            <label className="text-xs text-muted-foreground">员工</label>
            <select
              value={regEmpId}
              onChange={(e) => setRegEmpId(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            >
              <option value="">-- 选择员工{deptFilter !== 'ALL' ? `（${deptFilter}）` : ''} --</option>
              {filteredEmpList.map((e) => (
                <option key={e.employee_id} value={e.employee_id}>
                  {e.employee_id} · {e.employee_name} {e.department ? `(${e.department})` : ''}
                </option>
              ))}
            </select>
          </div>
          {(() => {
            const emp = empList.find((e) => e.employee_id === regEmpId);
            if (!emp) return null;
            if (!emp.salary_qr_code_url) {
              return (
                <div className="text-[11px] text-muted-foreground rounded-md bg-muted/40 px-3 py-2">
                  该员工未上传工资卡二维码
                </div>
              );
            }
            return (
              <div className="flex items-center gap-3 rounded-md border border-border bg-muted/20 px-3 py-2">
                <button
                  type="button"
                  onClick={() => setQrOpen(emp)}
                  className="shrink-0 hover:opacity-70 transition-opacity"
                  title="点击放大二维码"
                >
                  <img
                    src={emp.salary_qr_code_url}
                    alt="工资卡二维码"
                    className="w-16 h-16 rounded border border-border object-cover"
                  />
                </button>
                <div className="text-xs text-muted-foreground">
                  <div className="font-medium text-foreground">{emp.employee_name} 的工资卡二维码</div>
                  <div>点击图片可放大查看</div>
                </div>
              </div>
            );
          })()}
          <div>
            <label className="text-xs text-muted-foreground">借款日期</label>
            <Input type="date" value={regDate} onChange={(e) => setRegDate(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">金额 (฿)</label>
            <Input type="number" value={regAmount} onChange={(e) => setRegAmount(e.target.value)} placeholder="0.00" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">备注</label>
            <Input value={regRemark} onChange={(e) => setRegRemark(e.target.value)} placeholder="可选" />
          </div>
          <Button onClick={handleRegister}>登记借款</Button>
        </div>
      )}

      {tab === 'REPAY' && (
        <>
          <div className="rounded-md border border-border p-4 space-y-3 max-w-md">
            <div>
              <label className="text-xs text-muted-foreground">员工</label>
              <select
                value={repEmpId}
                onChange={(e) => setRepEmpId(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              >
                <option value="">-- 选择员工{deptFilter !== 'ALL' ? `（${deptFilter}）` : ''} --</option>
                {filteredEmpList.map((e) => (
                  <option key={e.employee_id} value={e.employee_id}>
                    {e.employee_id} · {e.employee_name} {e.department ? `(${e.department})` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">还款日期</label>
              <Input type="date" value={repDate} onChange={(e) => setRepDate(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">还款金额 (฿)</label>
              <Input type="number" value={repAmount} onChange={(e) => setRepAmount(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">备注</label>
              <Input value={repRemark} onChange={(e) => setRepRemark(e.target.value)} />
            </div>
            <Button onClick={handleRepay}>还款</Button>
          </div>
        </>
      )}

      {tab === 'LIST' && (
        <div className="rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-40">登记时间</TableHead>
                <TableHead className="w-24">借款时间</TableHead>
                <TableHead>工号 / 姓名</TableHead>
                <TableHead className="text-right">借款</TableHead>
                <TableHead className="text-right">已还</TableHead>
                <TableHead className="text-right">未清</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>来源</TableHead>
                <TableHead>备注</TableHead>
                <TableHead className="w-16">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loans.length === 0 && (
                <TableRow>
                  <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                    暂无借款记录
                  </TableCell>
                </TableRow>
              )}
              {loans.map((l) => {
                const owed = l.amount - l.repaid_amount;
                const time = l.created_at ? formatDateTime(l.created_at) : '-';
                return (
                  <TableRow key={l.loan_id}>
                    <TableCell className="text-xs font-mono">{time}</TableCell>
                    <TableCell className="text-xs font-mono text-muted-foreground">{l.loan_date}</TableCell>
                    <TableCell>
                      <div className="font-mono text-xs">{l.employee_id}</div>
                      <div className="text-xs text-muted-foreground">{l.employee_name}</div>
                    </TableCell>
                    <TableCell className="text-right text-xs">{formatTHB(l.amount)}</TableCell>
                    <TableCell className="text-right text-xs text-emerald-600">{formatTHB(l.repaid_amount)}</TableCell>
                    <TableCell className={`text-right text-xs font-medium ${owed > 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                      {formatTHB(owed)}
                    </TableCell>
                    <TableCell>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] ${
                        l.status === 'OUTSTANDING' ? 'bg-amber-500/10 text-amber-600' : 'bg-emerald-500/10 text-emerald-600'
                      }`}>
                        {l.status === 'OUTSTANDING' ? '未清' : '已清'}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{SOURCE_LABELS[l.source] || l.source}</TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[150px] truncate">{l.remark || '-'}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                        onClick={() => setDeleteTarget(l)}
                      >
                        删除
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {tab === 'EVENTS' && (
        <div className="rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-44">时间（精准到秒）</TableHead>
                <TableHead>类型</TableHead>
                <TableHead>工号 / 姓名</TableHead>
                <TableHead className="text-right">金额</TableHead>
                <TableHead>来源</TableHead>
                <TableHead>备注</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    暂无事件记录
                  </TableCell>
                </TableRow>
              )}
              {events.map((e, idx) => (
                <TableRow key={`${e.type}-${e.loan_id}-${idx}`}>
                  <TableCell className="text-xs font-mono">{formatDateTime(e.timestamp)}</TableCell>
                  <TableCell>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      e.type === 'LOAN' ? 'bg-destructive/10 text-destructive' : 'bg-emerald-500/10 text-emerald-600'
                    }`}>
                      {e.type === 'LOAN' ? '📥 借款' : '💸 还款'}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="font-mono text-xs">{e.employee_id}</div>
                    <div className="text-xs text-muted-foreground">{e.employee_name}</div>
                  </TableCell>
                  <TableCell className={`text-right text-xs font-medium ${
                    e.type === 'LOAN' ? 'text-destructive' : 'text-emerald-600'
                  }`}>
                    {e.type === 'LOAN' ? '+' : '-'}{formatTHB(e.amount)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{SOURCE_LABELS[e.source] || e.source}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[180px] truncate">{e.remark || '-'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {tab === 'SUMMARY' && (
        <>
          {/* 汇总卡片 */}
          <div className="grid grid-cols-4 gap-3">
            <div className="rounded-lg border border-border p-3">
              <div className="text-[11px] text-muted-foreground">员工数</div>
              <div className="mt-1 text-lg font-semibold">{summary.length}</div>
            </div>
            <div className="rounded-lg border border-border p-3">
              <div className="text-[11px] text-muted-foreground">借款合计</div>
              <div className="mt-1 text-lg font-semibold text-destructive">{formatTHB(totalLoanAll)}</div>
            </div>
            <div className="rounded-lg border border-border p-3">
              <div className="text-[11px] text-muted-foreground">已还合计</div>
              <div className="mt-1 text-lg font-semibold text-emerald-600">{formatTHB(totalRepaidAll)}</div>
            </div>
            <div className="rounded-lg border border-border p-3">
              <div className="text-[11px] text-muted-foreground">未清合计</div>
              <div className="mt-1 text-lg font-semibold text-destructive">{formatTHB(totalOutstanding)}</div>
            </div>
          </div>

          {/* 汇总表 */}
          <div className="rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>工号</TableHead>
                  <TableHead>姓名</TableHead>
                  <TableHead>部门</TableHead>
                  <TableHead className="text-right">借款笔数</TableHead>
                  <TableHead className="text-right">已清</TableHead>
                  <TableHead className="text-right">未清</TableHead>
                  <TableHead className="text-right">借款合计</TableHead>
                  <TableHead className="text-right">已还合计</TableHead>
                  <TableHead className="text-right font-semibold">未清余额</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                      暂无借款数据
                    </TableCell>
                  </TableRow>
                )}
                {summary.map((s) => (
                  <TableRow key={s.employee_id}>
                    <TableCell className="font-mono text-xs">{s.employee_id}</TableCell>
                    <TableCell className="text-sm font-medium">{s.employee_name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{s.department || '-'}</TableCell>
                    <TableCell className="text-right text-xs">{s.outstanding_count + s.cleared_count}</TableCell>
                    <TableCell className="text-right text-xs text-emerald-600">{s.cleared_count}</TableCell>
                    <TableCell className="text-right text-xs text-amber-600">{s.outstanding_count}</TableCell>
                    <TableCell className="text-right text-xs">{formatTHB(s.total_loan)}</TableCell>
                    <TableCell className="text-right text-xs text-emerald-600">{formatTHB(s.total_repaid)}</TableCell>
                    <TableCell className={`text-right text-sm font-semibold ${
                      s.total_outstanding > 0 ? 'text-destructive' : 'text-muted-foreground'
                    }`}>
                      {formatTHB(s.total_outstanding)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {tab === 'SUB_REG' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* 补贴登记表单 */}
          <div className="rounded-md border border-border p-4 space-y-3">
            <h3 className="text-sm font-medium">登记补贴</h3>
            <div>
              <label className="text-xs text-muted-foreground">员工</label>
              <select
                value={subRegEmpId}
                onChange={(e) => setSubRegEmpId(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              >
                <option value="">-- 选择员工{deptFilter !== 'ALL' ? `（${deptFilter}）` : ''} --</option>
                {filteredEmpList.map((e) => (
                  <option key={e.employee_id} value={e.employee_id}>
                    {e.employee_id} · {e.employee_name} {e.department ? `(${e.department})` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">补贴月份（发放时计入该月工资）</label>
              <Input type="month" value={subRegMonth} onChange={(e) => setSubRegMonth(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">补贴类目</label>
              <select
                value={subRegCatId}
                onChange={(e) => setSubRegCatId(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              >
                <option value="">-- 选择类目 --</option>
                {subCategories.filter((c) => c.enabled).map((c) => (
                  <option key={c.category_id} value={c.category_id}>
                    {c.category_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">金额 (฿)</label>
              <Input type="number" value={subRegAmount} onChange={(e) => setSubRegAmount(e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">备注</label>
              <Input value={subRegRemark} onChange={(e) => setSubRegRemark(e.target.value)} placeholder="可选" />
            </div>
            <Button onClick={handleSubRegister}>登记补贴</Button>
          </div>

          {/* 类目管理 */}
          <div className="rounded-md border border-border p-4 space-y-3">
            <h3 className="text-sm font-medium">补贴类目管理</h3>
            <div className="flex gap-2">
              <Input
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                placeholder="新类目名称，如：餐费补贴"
                onKeyDown={(e) => e.key === 'Enter' && handleAddCategory()}
              />
              <Button variant="outline" onClick={handleAddCategory}>新增</Button>
            </div>
            <div className="rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>类目名称</TableHead>
                    <TableHead className="w-20">状态</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {subCategories.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={2} className="text-center text-muted-foreground py-6 text-xs">
                        暂无类目
                      </TableCell>
                    </TableRow>
                  )}
                  {subCategories.map((c) => (
                    <TableRow key={c.category_id}>
                      <TableCell className="text-sm">{c.category_name}</TableCell>
                      <TableCell>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] ${
                          c.enabled ? 'bg-emerald-500/10 text-emerald-600' : 'bg-muted text-muted-foreground'
                        }`}>
                          {c.enabled ? '启用' : '停用'}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="text-[11px] text-muted-foreground">
              类目被补贴记录引用后不可删除；如需停用可在数据库将 enabled 设为 false。
            </p>
          </div>
        </div>
      )}

      {tab === 'SUB_LIST' && (
        <>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">月份:</span>
            <Input
              type="month"
              value={subMonthFilter}
              onChange={(e) => setSubMonthFilter(e.target.value)}
              className="w-36 text-xs"
            />
            <span className="text-xs text-muted-foreground ml-4">
              当月补贴合计:{' '}
              <span className="text-emerald-600 font-semibold">
                {formatTHB(subsidies.reduce((s, r) => s + Number(r.amount), 0))}
              </span>
              <span className="ml-1">({subsidies.length} 条)</span>
            </span>
          </div>
          <div className="rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">补贴月份</TableHead>
                  <TableHead className="w-40">登记时间</TableHead>
                  <TableHead>工号 / 姓名</TableHead>
                  <TableHead>类目</TableHead>
                  <TableHead className="text-right">金额</TableHead>
                  <TableHead>备注</TableHead>
                  <TableHead className="w-16">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {subsidies.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                      该月份暂无补贴记录
                    </TableCell>
                  </TableRow>
                )}
                {subsidies.map((s) => (
                  <TableRow key={s.subsidy_id}>
                    <TableCell className="text-xs font-mono">{s.month}</TableCell>
                    <TableCell className="text-xs font-mono text-muted-foreground">
                      {s.created_at ? formatDateTime(s.created_at) : '-'}
                    </TableCell>
                    <TableCell>
                      <div className="font-mono text-xs">{s.employee_id}</div>
                      <div className="text-xs text-muted-foreground">{s.employee_name}</div>
                    </TableCell>
                    <TableCell>
                      <span className="rounded-full bg-sky-500/10 text-sky-600 px-2 py-0.5 text-[10px]">
                        {s.category_name || `#${s.category_id}`}
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-xs font-medium text-emerald-600">
                      +{formatTHB(Number(s.amount))}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">{s.remark || '-'}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                        onClick={() => setDeleteSubTarget(s)}
                      >
                        删除
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {/* 删除二次确认 */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除这条借款记录？</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <div>
                  将删除借款 <span className="font-mono">#{deleteTarget?.loan_id}</span>：
                  <span className="font-medium text-foreground">{deleteTarget?.employee_id}</span>
                  （{deleteTarget?.employee_name}）·{' '}
                  <span className="font-semibold text-destructive">{formatTHB(deleteTarget?.amount || 0)}</span>
                </div>
                {deleteTarget && deleteTarget.repaid_amount > 0 && (
                  <div className="text-destructive">
                    ⚠️ 该借款已有还款记录 {formatTHB(deleteTarget.repaid_amount)}，删除后关联的还款明细将一并删除，且不可恢复。
                  </div>
                )}
                <div>删除后不可恢复，请谨慎操作。</div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                handleDelete();
              }}
            >
              {deleting ? '删除中…' : '确认删除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 补贴删除二次确认 */}
      <AlertDialog open={!!deleteSubTarget} onOpenChange={(v) => !v && setDeleteSubTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除这条补贴记录？</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <div>
                  将删除补贴 <span className="font-mono">#{deleteSubTarget?.subsidy_id}</span>：
                  <span className="font-medium text-foreground">{deleteSubTarget?.employee_id}</span>
                  （{deleteSubTarget?.employee_name}）· {deleteSubTarget?.month} ·{' '}
                  <span className="text-sky-600">{deleteSubTarget?.category_name}</span> ·{' '}
                  <span className="font-semibold text-emerald-600">{formatTHB(Number(deleteSubTarget?.amount || 0))}</span>
                </div>
                <div>
                  ⚠️ 如果该月工资发放快照已生成，需重新生成快照才会反映此次删除。
                </div>
                <div>删除后不可恢复，请谨慎操作。</div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingSub}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={deletingSub}
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                handleDeleteSubsidy();
              }}
            >
              {deletingSub ? '删除中…' : '确认删除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 工资卡二维码放大 */}
      <Dialog open={!!qrOpen} onOpenChange={(o) => !o && setQrOpen(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {qrOpen?.employee_name}（{qrOpen?.employee_id}）工资卡二维码
            </DialogTitle>
          </DialogHeader>
          <div className="flex justify-center">
            {qrOpen?.salary_qr_code_url && (
              <img
                src={qrOpen.salary_qr_code_url}
                alt="工资卡二维码"
                className="max-w-full w-72 h-72 object-contain rounded-md border border-border"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
