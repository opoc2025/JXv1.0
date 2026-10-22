'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, UploadCloud, Trash2, FileSpreadsheet, CalendarDays, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
  downloadDailyTemplate,
  downloadMonthlyTemplate,
  parseWorkbook,
  type ParsedSheet,
} from '@/lib/excel';
import { useMonth } from '@/components/month-context';
import { formatTHB } from '@/lib/format';

type Cell = string | number | null;

interface BatchInfo {
  batch_no: string;
  rows: number;
  created_at: string;
}

function num(v: Cell): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export default function ImportPage() {
  const { month } = useMonth();
  const dailyFileRef = useRef<HTMLInputElement>(null);
  const monthlyFileRef = useRef<HTMLInputElement>(null);
  const [dailyParsed, setDailyParsed] = useState<ParsedSheet | null>(null);
  const [monthlyParsed, setMonthlyParsed] = useState<ParsedSheet | null>(null);
  const [dailyFileName, setDailyFileName] = useState('');
  const [monthlyFileName, setMonthlyFileName] = useState('');
  const [importing, setImporting] = useState(false);
  const [batches, setBatches] = useState<BatchInfo[]>([]);
  // 当前导入月份（独立于全局月份——导入的数据日期可能跨月，但我们用它标记批次）
  const [importMonth, setImportMonth] = useState(month);
  const [replaceMode, setReplaceMode] = useState(false); // 先删后导
  const [confirmReplaceOpen, setConfirmReplaceOpen] = useState(false); // 替换确认弹窗

  const loadBatches = useCallback(async () => {
    const res = await fetch('/api/batches', { cache: 'no-store' });
    const json = await res.json();
    if (json.success) setBatches(json.data as BatchInfo[]);
  }, []);

  useEffect(() => {
    void loadBatches();
  }, [loadBatches]);

  const onDailyFile = async (file: File) => {
    setDailyFileName(file.name);
    const parsed = await parseWorkbook(file, ['employee_id', 'stage', 'date']);
    setDailyParsed(parsed);
  };

  const onMonthlyFile = async (file: File) => {
    setMonthlyFileName(file.name);
    const parsed = await parseWorkbook(file, ['month', 'employee_id', 'stage']);
    setMonthlyParsed(parsed);
  };

  // 预览统计（导入前就能看到 Excel 里有多少天、多少员工、日期范围）
  const previewStats = useMemo(() => {
    if (!dailyParsed) return null;
    const raw = dailyParsed.rows.map((r) => normalizeDate(r.date)).filter(Boolean);
    const dates = [...new Set(raw)].sort();
    const stages = [...new Set(dailyParsed.rows.map((r) => String(r.stage ?? '').trim()).filter(Boolean))];
    const emps = [...new Set(dailyParsed.rows.map((r) => String(r.employee_id ?? '').trim()).filter(Boolean))];
    return {
      total: dailyParsed.rows.length,
      days: dates.length,
      dateStart: dates[0] ?? '-',
      dateEnd: dates[dates.length - 1] ?? '-',
      stages,
      emps: emps.length,
    };
  }, [dailyParsed]);

  const submitDaily = async () => {
    if (!dailyParsed) return;
    const rows = dailyParsed.rows.map((r) => ({
      employee_id: String(r.employee_id ?? '').trim(),
      stage: String(r.stage ?? '').trim(),
      date: normalizeDate(r.date),
      recovered_orders: num(r.recovered_orders),
      recovered_amount: num(r.recovered_amount),
      target_recovery_rate: r.target_recovery_rate === null || r.target_recovery_rate === undefined ? null : num(r.target_recovery_rate),
      total_orders: r.total_orders === null || r.total_orders === undefined ? null : num(r.total_orders),
      total_amount: r.total_amount === null || r.total_amount === undefined ? null : num(r.total_amount),
      amount_achievement_rate: r.amount_achievement_rate === null || r.amount_achievement_rate === undefined ? null : num(r.amount_achievement_rate),
    }));
    const invalid = rows.filter((r) => !r.employee_id || !r.stage || !r.date);
    if (invalid.length > 0) {
      toast.error(`有 ${invalid.length} 行缺少工号/阶段/日期，请检查`);
      return;
    }

    // 替换模式：先删再导
    if (replaceMode) {
      // 等 AlertDialog 确认后再执行——这里只打开弹窗
      setConfirmReplaceOpen(true);
      // 把要提交的数据临时存一下（用 ref 太麻烦，闭包里直接提交）
      // 简化：替换逻辑在确认回调里做
      pendingDailyImportRef.current = { rows };
      return;
    }

    void doImportDaily(rows);
  };

  const pendingDailyImportRef = useRef<{ rows: any[] } | null>(null);

  const doImportDaily = async (rows: any[]) => {
    setImporting(true);
    const batchNo = `${importMonth}-${Date.now()}`;
    const res = await fetch('/api/import/daily', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ batch_no: batchNo, replace: replaceMode, rows }),
    });
    const json = await res.json();
    setImporting(false);
    if (json.success) {
      const d = json.data;
      let msg = `成功导入 ${d.imported} 条每日明细`;
      if (d.skipped > 0 && d.skipped_detail?.length > 0) {
        msg += `（跳过 ${d.skipped} 行：${d.skipped_detail.map((s: any) => `${s.employee_id}×${s.rows}`).join(', ')}）`;
      } else if (d.skipped > 0) {
        msg += `（跳过 ${d.skipped} 行）`;
      }
      toast.success(msg);
      setDailyParsed(null);
      setDailyFileName('');
      setReplaceMode(false);
      void loadBatches();
    } else {
      toast.error(json.error ?? '导入失败');
    }
  };

  const confirmReplaceAndImport = async () => {
    setConfirmReplaceOpen(false);
    const pending = pendingDailyImportRef.current;
    pendingDailyImportRef.current = null;
    if (!pending) return;

    // 1. 先清当月旧日数据（调后端 API，REST 可直接调用）
    const [year, mon] = importMonth.split('-').map(Number);
    const nextMon = mon === 12 ? 1 : mon + 1;
    const nextYear = mon === 12 ? year + 1 : year;
    const rangeStart = `${importMonth}-01`;
    const rangeEnd = `${nextYear}-${String(nextMon).padStart(2, '0')}-01`;

    const delRes = await fetch(
      `/api/import/daily?from=${encodeURIComponent(rangeStart)}&to=${encodeURIComponent(rangeEnd)}`,
      { method: 'DELETE' }
    );
    const delJson = await delRes.json();
    if (!delJson.success) {
      toast.error(`清理旧数据失败: ${delJson.error}`);
      return;
    }
    toast.success(`已清空 ${rangeStart} ~ ${rangeEnd} 的 ${delJson.data?.deleted ?? 0} 行旧数据`);

    // 2. 再导入新数据
    await doImportDaily(pending.rows);
  };

  const submitMonthly = async () => {
    if (!monthlyParsed) return;
    const rows = monthlyParsed.rows.map((r) => ({
      month: String(r.month ?? '').trim(),
      employee_id: String(r.employee_id ?? '').trim(),
      stage: String(r.stage ?? '').trim(),
      monthly_recovery_rate: r.monthly_recovery_rate === null ? null : num(r.monthly_recovery_rate),
      monthly_total_amount:
        r.monthly_total_amount === null ? null : num(r.monthly_total_amount),
      monthly_recovered_orders:
        r.monthly_recovered_orders === null || r.monthly_recovered_orders === undefined
          ? 0
          : num(r.monthly_recovered_orders),
    }));
    const invalid = rows.filter((r) => !r.month || !r.employee_id || !r.stage);
    if (invalid.length > 0) {
      toast.error(`有 ${invalid.length} 行缺少月份/工号/阶段，请检查`);
      return;
    }
    setImporting(true);
    const res = await fetch('/api/import/monthly', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows }),
    });
    const json = await res.json();
    setImporting(false);
    if (json.success) {
      toast.success(`成功导入 ${json.data.imported} 条月度考核数据`);
      setMonthlyParsed(null);
      setMonthlyFileName('');
    } else {
      toast.error(json.error ?? '导入失败');
    }
  };

  const deleteBatch = async (batchNo: string) => {
    const res = await fetch(`/api/batches?batch_no=${encodeURIComponent(batchNo)}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      toast.success('批次已删除');
      void loadBatches();
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">数据导入</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Excel 文件必须遵循系统模板规范；先下载模板、填写后再上传
        </p>
      </div>

      <Tabs defaultValue="daily" className="w-full">
        <TabsList>
          <TabsTrigger value="daily">每日运营明细</TabsTrigger>
          <TabsTrigger value="monthly">月度考核数据</TabsTrigger>
          <TabsTrigger value="adjustment">薪酬调整</TabsTrigger>
        </TabsList>

        {/* ---------- 每日明细 ---------- */}
        <TabsContent value="daily" className="space-y-4">
          {/* 月份选择 + 替换开关 */}
          <div className="flex flex-wrap items-end gap-4 rounded-md border border-border bg-white p-4">
            <div className="flex items-center gap-2">
              <CalendarDays size={16} className="text-muted-foreground" />
              <Label htmlFor="import-month" className="text-[13px] whitespace-nowrap">
                导入月份标记
              </Label>
              <Input
                id="import-month"
                type="month"
                value={importMonth}
                onChange={(e) => setImportMonth(e.target.value)}
                className="h-9 w-[150px]"
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="replace-mode"
                checked={replaceMode}
                onCheckedChange={(v) => setReplaceMode(Boolean(v))}
              />
              <label htmlFor="replace-mode" className="text-[13px] text-muted-foreground cursor-pointer">
                先删后导（清空该月旧数据）
              </label>
            </div>
            {replaceMode && (
              <span className="text-[11.5px] text-vermilion">
                ⚠ 将删除 {importMonth} 范围内所有日数据，不可恢复
              </span>
            )}
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={downloadDailyTemplate}>
              <Download size={14} />
              下载每日明细模板
            </Button>
            <input
              ref={dailyFileRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onDailyFile(f);
                e.target.value = '';
              }}
            />
            <Button onClick={() => dailyFileRef.current?.click()}>
              <UploadCloud size={15} />
              选择 Excel 上传
            </Button>
          </div>

          {dailyParsed && (
            <div className="space-y-3 rounded-md border border-border bg-white p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-[13.5px] font-medium">
                  <FileSpreadsheet size={16} className="text-gold" />
                  {dailyFileName}
                  <Badge variant="secondary">{dailyParsed.rows.length} 行</Badge>
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={() => setDailyParsed(null)}>
                    取消
                  </Button>
                  <Button onClick={submitDaily} disabled={importing}>
                    {importing ? '导入中...' : '确认导入'}
                  </Button>
                </div>
              </div>
              <PreviewTable
                columns={[
                  'employee_id',
                  'date',
                  'stage',
                  'total_orders',
                  'total_amount',
                  'recovered_amount',
                  'amount_achievement_rate',
                  'recovered_orders',
                  'target_recovery_rate',
                ]}
                rows={dailyParsed.rows}
              />
            </div>
          )}

          {/* 批次历史 */}
          <div className="rounded-md border border-border bg-white">
            <div className="border-b border-border px-4 py-3 text-[13.5px] font-semibold">
              导入批次记录
            </div>
            <Table>
              <TableHeader>
                <TableRow className="data-table">
                  <TableHead className="h-9 px-4">批次号</TableHead>
                  <TableHead className="h-9 px-4">数据行数</TableHead>
                  <TableHead className="h-9 px-4">导入时间</TableHead>
                  <TableHead className="h-9 px-4 text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batches.map((b) => (
                  <TableRow key={b.batch_no}>
                    <TableCell className="px-4 font-mono text-[12.5px]">{b.batch_no}</TableCell>
                    <TableCell className="px-4 text-[13px]">{b.rows}</TableCell>
                    <TableCell className="px-4 text-[12.5px] text-muted-foreground">
                      {b.created_at?.replace('T', ' ').slice(0, 19) ?? '-'}
                    </TableCell>
                    <TableCell className="px-4 text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-vermilion"
                        onClick={() => void deleteBatch(b.batch_no)}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {batches.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-10 text-center text-[12.5px] text-muted-foreground">
                      暂无导入批次
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* ---------- 月度考核 ---------- */}
        <TabsContent value="monthly" className="space-y-4">
          {/* 自动汇总说明卡片 */}
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-4 dark:border-emerald-900/50 dark:bg-emerald-950/30">
            <div className="mb-2 flex items-center gap-2">
              <div className="flex size-6 items-center justify-center rounded-full bg-emerald-500 text-white">
                <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <span className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">
                月度数据已自动汇总
              </span>
              <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
                无需手动导入
              </Badge>
            </div>
            <p className="text-[13px] leading-relaxed text-emerald-900/80 dark:text-emerald-200/80">
              从 <strong>每日运营数据明细</strong> 自动汇总生成月度数据：
              <br />
              • <strong>月度回款金额</strong> = SUM 该员工该阶段当月所有日数据的回款金额
              <br />
              • <strong>月度回收订单数</strong> = SUM 该员工该阶段当月所有日数据的回收订单数
              <br />
              • <strong>月度回收率</strong> = 按金额加权的真实回收率（SUM 回款金额 / SUM 分配金额 × 100）
            </p>
            <p className="mt-2 text-[12px] text-emerald-700/70 dark:text-emerald-300/60">
              导入每日数据后，薪酬核算时系统会自动完成以上汇总并参与绩效和提成计算。
            </p>
          </div>

          {/* 手动覆盖（可选）*/}
          <details className="rounded-md border border-border bg-background">
            <summary className="cursor-pointer px-4 py-2.5 text-[13px] font-medium text-muted-foreground hover:text-foreground">
              手动覆盖月度数据（仅在自动汇总不符合实际业务时使用）
            </summary>
            <div className="border-t border-border p-4">
              <div className="mb-3 rounded-md border border-amber-200 bg-amber-50/60 p-3 text-[12.5px] text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
                ⚠️ 手动导入的月度数据会<strong>覆盖</strong>自动汇总结果，仅用于特殊情况（如财务需要修正汇总口径）。
                通常情况下请直接使用每日数据导入，无需操作此模块。
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={downloadMonthlyTemplate}>
                  <Download size={14} />
                  下载月度考核模板
                </Button>
                <input
                  ref={monthlyFileRef}
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void onMonthlyFile(f);
                    e.target.value = '';
                  }}
                />
                <Button variant="outline" onClick={() => monthlyFileRef.current?.click()}>
                  <UploadCloud size={15} />
                  选择 Excel 上传
                </Button>
              </div>

              {monthlyParsed && (
                <div className="mt-4 space-y-3 rounded-md border border-border bg-white p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-[13.5px] font-medium">
                      <FileSpreadsheet size={16} className="text-gold" />
                      {monthlyFileName}
                      <Badge variant="secondary">{monthlyParsed.rows.length} 行</Badge>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="ghost" onClick={() => setMonthlyParsed(null)}>
                        取消
                      </Button>
                      <Button onClick={submitMonthly} disabled={importing}>
                        {importing ? '导入中...' : '覆盖导入'}
                      </Button>
                    </div>
                  </div>
                  <PreviewTable
                    columns={[
                      'month',
                      'employee_id',
                      'stage',
                      'monthly_recovery_rate',
                      'monthly_total_amount',
                      'monthly_recovered_orders',
                    ]}
                    rows={monthlyParsed.rows}
                  />
                </div>
              )}
            </div>
          </details>
        </TabsContent>

        {/* ---------- 薪酬调整 ---------- */}
        <TabsContent value="adjustment" className="space-y-4">
          <div className="rounded-md border border-border/60 bg-muted/40 p-3 text-[12.5px] text-muted-foreground">
            <strong>薪酬调整 = 实发底薪 + 全勤奖</strong>
            <ul className="mt-2 list-disc pl-5 space-y-0.5">
              <li>每个员工每月可导入一次，系统会<strong>覆盖</strong>同月之前的调整记录</li>
              <li>导入后重新核算，引擎会用<strong>实发底薪</strong>替换方案中的固定底薪</li>
              <li><strong>全勤奖</strong>独立发放（无迟到/请假则填金额，否则填 0）</li>
              <li>未导入的员工保持原有底薪不变（向后兼容）</li>
            </ul>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="month"
              value={importMonth}
              onChange={(e) => setImportMonth(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                const ws = XLSX.utils.aoa_to_sheet([
                  ['工号', '月份', '实发底薪', '全勤奖', '备注'],
                  ['X2P-2609-Ter', importMonth, 6500, 0, '迟到扣款500'],
                  ['X2P-LW-202508-Nee', importMonth, 7000, 500, '全勤'],
                ]);
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, '薪酬调整');
                XLSX.writeFile(wb, `薪酬调整-${importMonth}.xlsx`);
              }}
            >
              <Download size={15} className="mr-1" /> 下载薪酬调整模板
            </Button>
          </div>

          <div className="rounded-md border border-border/60 bg-card/50 p-4 space-y-3">
            <div className="text-[13px] font-semibold">导入薪酬调整 Excel</div>
            <div className="text-[12.5px] text-muted-foreground">
              表头支持中文：<code>工号、月份、实发底薪、全勤奖、备注</code>
            </div>
            <div className="flex items-center gap-2">
              <input
                id="adj-file"
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const buf = await f.arrayBuffer();
                  const wb = XLSX.read(buf, { type: 'buffer' });
                  const sheet = wb.Sheets[wb.SheetNames[0]];
                  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
                  // 标准化表头
                  const HEADER_MAP: Record<string, string> = {
                    工号: 'employee_id', 月份: 'month', 实发底薪: 'actual_base_salary',
                    底薪: 'actual_base_salary', 全勤奖: 'full_attendance_bonus',
                    全勤: 'full_attendance_bonus', 备注: 'remark',
                  };
                  const body = rows.map((r: any) => {
                    const o: any = {};
                    Object.entries(r).forEach(([k, v]) => {
                      const mapped = HEADER_MAP[k.trim()] ?? k.trim();
                      o[mapped] = v;
                    });
                    // 月份补齐
                    if (o.month && !/^\d{4}-\d{2}$/.test(String(o.month))) {
                      const m = /^(\d{4})-(\d{1,2})/.exec(String(o.month));
                      if (m) o.month = `${m[1]}-${m[2].padStart(2, '0')}`;
                    }
                    if (!o.month) o.month = importMonth;
                    // 数字列
                    o.actual_base_salary = Number(o.actual_base_salary ?? 0) || 0;
                    o.full_attendance_bonus = Number(o.full_attendance_bonus ?? 0) || 0;
                    return o;
                  });
                  const res = await fetch('/api/adjustment', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ data: body }),
                  }).then((r) => r.json());
                  if (res.success) {
                    toast.success(
                      `导入成功 ${res.data.success_rows} 行，失败 ${res.data.failures?.length ?? 0} 行`
                    );
                  } else {
                    toast.error(res.error ?? '导入失败');
                  }
                  e.target.value = '';
                }}
              />
              <Button variant="outline" onClick={() => document.getElementById('adj-file')?.click()}>
                <UploadCloud size={15} className="mr-1" /> 选择 Excel 文件上传
              </Button>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* 替换模式确认弹窗 */}
      <AlertDialog open={confirmReplaceOpen} onOpenChange={setConfirmReplaceOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认清空 {importMonth} 日数据？</AlertDialogTitle>
            <AlertDialogDescription>
              将先删除 <strong>{importMonth}</strong> 范围内所有已导入的每日运营数据，
              再导入本次 Excel（共 {dailyParsed?.rows.length ?? 0} 行）。此操作不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void confirmReplaceAndImport()}
              className="bg-vermilion hover:bg-vermilion/90"
            >
              <RotateCcw size={14} className="mr-1" />
              确认清空并导入
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function normalizeDate(v: Cell): string {
  if (v === null) return '';
  // Excel 日期序列号 vs YYYYMMDD 8 位数字智能区分
  // 8 位整数 ≥ 10000000 且 ≤ 99991231 → 当成 YYYYMMDD（比如 20260930）
  // 其他 number → 当成 Excel serial（范围一般在 15000~60000）
  if (typeof v === 'number') {
    if (v >= 10000000 && v <= 99991231 && Number.isInteger(v)) {
      // YYYYMMDD：拆成年月日
      const s = String(v);
      const y = parseInt(s.slice(0, 4), 10);
      const m = s.slice(4, 6);
      const d = s.slice(6, 8);
      if (y >= 2020 && y <= 2035) return `${y}-${m}-${d}`;
    }
    return XLSXDate(v);
  }
  const s = String(v).trim();
  // YYYYMMDD → YYYY-MM-DD（例: "20261011"）
  if (/^\d{8}$/.test(s)) {
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  }
  // 已符合 YYYY-MM-DD / YYYY/MM/DD 的，直接返回
  return s.replace(/\//g, '-');
}

function XLSXDate(serial: number): string {
  // Excel 1900 date system: serial 25569 = 1970-01-01
  // 同时尝试 1904 system（Mac 默认）：serial + 1462
  const candidates = [
    { days: Math.floor(serial - 25569), mode: '1900' },
    { days: Math.floor(serial + 1462 - 25569), mode: '1904' },
  ];
  let best = candidates[0];
  let bestYear = 0;
  for (const c of candidates) {
    if (c.days < 0) continue;
    const d = new Date(c.days * 86400 * 1000);
    const y = d.getUTCFullYear();
    if (y >= 2020 && y <= 2035) { best = c; bestYear = y; break; }
    if (y > bestYear) bestYear = y;
  }
  const d = new Date(best.days * 86400 * 1000);
  const y = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  // 年份异常（比如 serial 被错用成大数字）→ fallback 当前年份
  if (y > 2035 || y < 2020) {
    const thisYear = new Date().getFullYear();
    return `${thisYear}-${mm}-${dd}`;
  }
  return `${y}-${mm}-${dd}`;
}

function PreviewTable({
  columns,
  rows,
}: {
  columns: string[];
  rows: Record<string, Cell>[];
}): React.ReactElement {
  const shown = rows.slice(0, 50);
  return (
    <div className="max-h-[360px] overflow-auto rounded border border-border">
      <Table>
        <TableHeader>
          <TableRow className="data-table">
            {columns.map((c) => (
              <TableHead key={c} className="h-9 whitespace-nowrap px-3">
                {c}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.map((r, i) => (
            <TableRow key={i}>
              {columns.map((c) => {
                const v = r[c];
                const isAmount = c.includes('amount');
                return (
                  <TableCell key={c} className="px-3 font-mono text-[12px]">
                    {v === null || v === undefined ? (
                      <span className="text-muted-foreground">空</span>
                    ) : isAmount ? (
                      formatTHB(Number(v))
                    ) : (
                      String(v)
                    )}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {rows.length > 50 && (
        <div className="border-t border-border bg-paper-soft py-2 text-center text-[12px] text-muted-foreground">
          仅预览前 50 行，实际将导入全部 {rows.length} 行
        </div>
      )}
    </div>
  );
}
