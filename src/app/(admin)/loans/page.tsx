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

type EmpShort = { employee_id: string; employee_name: string; department: string | null };

export default function LoansPage() {
  const [loans, setLoans] = useState<Loan[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [summary, setSummary] = useState<EmpSummary[]>([]);
  const [tab, setTab] = useState<'REGISTER' | 'REPAY' | 'LIST' | 'EVENTS' | 'SUMMARY'>('REGISTER');
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

  useEffect(() => {
    fetchAll();
    fetchEmpList();
  }, [deptFilter, tab]);

  async function fetchEmpList() {
    const r = await fetch('/api/employees');
    const j = await r.json();
    const list: EmpShort[] = (j.data || []).map((e: any) => ({
      employee_id: e.employee_id,
      employee_name: e.employee_name,
      department: e.department,
    }));
    list.sort((a, b) => a.employee_id.localeCompare(b.employee_id));
    setEmpList(list);
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
              <option value="">-- 选择员工 --</option>
              {empList.map((e) => (
                <option key={e.employee_id} value={e.employee_id}>
                  {e.employee_id} · {e.employee_name} {e.department ? `(${e.department})` : ''}
                </option>
              ))}
            </select>
          </div>
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
                <option value="">-- 选择员工 --</option>
                {empList.map((e) => (
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
                <TableHead className="w-48">时间</TableHead>
                <TableHead>工号 / 姓名</TableHead>
                <TableHead className="text-right">借款</TableHead>
                <TableHead className="text-right">已还</TableHead>
                <TableHead className="text-right">未清</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>来源</TableHead>
                <TableHead>备注</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loans.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                    暂无借款记录
                  </TableCell>
                </TableRow>
              )}
              {loans.map((l) => {
                const owed = l.amount - l.repaid_amount;
                const time = l.created_at ? formatDateTime(l.created_at) : l.loan_date;
                return (
                  <TableRow key={l.loan_id}>
                    <TableCell className="text-xs font-mono">
                      <div>{time}</div>
                      <div className="text-muted-foreground">{l.loan_date}</div>
                    </TableCell>
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
    </div>
  );
}
