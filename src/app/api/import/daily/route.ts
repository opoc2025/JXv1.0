import { getSupabaseClient } from '@/storage/database/supabase-client';
import { ok, fail, numify, NUMERIC_DAILY, batchUpsert } from '@/lib/api-helpers';
import { monthRange } from '@/lib/format';
import type { DailyData } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * 超级日期解析器：处理 Excel 导入可能出现的所有日期格式
 * 1. YYYY-MM-DD / YYYY/MM/DD 标准文本 → 直接用
 * 2. YYYYMMDD 8位数字串 → 拆分
 * 3. Excel 序列号 (number 类型，不管是 1900 还是 1904 系统) → 智能推断
 * 4. Date 对象 / ISO 字符串 → new Date()
 * 5. 形如 "57372-MM-DD" 的错格式 → 识别年份过大，修正 serial
 */
function robustDate(raw: unknown): string {
  if (raw === null || raw === undefined || raw === '') return '';

  // --- Number 类型：先看是不是 YYYYMMDD 8 位数 ---
  // 8 位数字 ≥ 10000000 且 ≤ 99991231 → 当成 YYYYMMDD 处理（比如 20260930）
  // 否则当成 Excel serial（范围一般在 15000~60000 之间）
  if (typeof raw === 'number') {
    if (raw >= 10000000 && raw <= 99991231 && Number.isInteger(raw)) {
      // YYYYMMDD：拆成年月日
      const s = String(raw);
      const y = parseInt(s.slice(0, 4), 10);
      const m = s.slice(4, 6);
      const d = s.slice(6, 8);
      const YEAR_MIN = 2020;
      const YEAR_MAX = 2035;
      if (y >= YEAR_MIN && y <= YEAR_MAX) {
        return `${y}-${m}-${d}`;
      }
      // 年份异常 → fallback
      return `${new Date().getFullYear()}-${m}-${d}`;
    }
    return excelSerialToDate(raw);
  }

  // --- Date 对象 ---
  if (raw instanceof Date && !isNaN(raw.getTime())) {
    return `${raw.getFullYear()}-${String(raw.getMonth() + 1).padStart(2, '0')}-${String(raw.getDate()).padStart(2, '0')}`;
  }

  const s = String(raw).trim();
  if (!s) return '';

  // ========= 所有 YYYY*-MM*-DD* 格式：年份异常就修正 =========
  // 阈值：只接受 2020~2035 为合理年份（最近 15 年 + 未来 9 年）
  // 超出范围的一律 fallback：保留原月日，替换为当前年份
  const YEAR_MIN = 2020;
  const YEAR_MAX = 2035;

  // 57372-06-16：Excel serial 被当年份硬拼（5 位年份）
  const yearTooBig = s.match(/^(\d{4,5})[-\/](\d{1,2})[-\/](\d{1,2})$/);
  if (yearTooBig) {
    const [, yStr, mStr, dStr] = yearTooBig;
    const year = parseInt(yStr, 10);
    const mm = String(parseInt(mStr, 10)).padStart(2, '0');
    const dd = String(parseInt(dStr, 10)).padStart(2, '0');

    if (year > YEAR_MAX || year < YEAR_MIN) {
      // 年份异常 → fallback 当前年份，保留月日
      const thisYear = new Date().getFullYear();
      return `${thisYear}-${mm}-${dd}`;
    }
    // 年份合理 → 标准化（把 "2057-06-16" 变成标准 "2057-06-16"，但年份已检查过了不会到这里）
    return `${year}-${mm}-${dd}`;
  }

  // YYYYMMDD → 拆分后也要检查年份
  if (/^\d{8}$/.test(s)) {
    const y = parseInt(s.slice(0, 4), 10);
    const m = s.slice(4, 6);
    const d = s.slice(6, 8);
    if (y > YEAR_MAX || y < YEAR_MIN) {
      const thisYear = new Date().getFullYear();
      return `${thisYear}-${m}-${d}`;
    }
    return `${y}-${m}-${d}`;
  }

  // 已符合 YYYY-MM-DD / YYYY/MM/DD 标准格式 → 也要查年份
  const stdMatch = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
  if (stdMatch) {
    const [, yStr, mStr, dStr] = stdMatch;
    const y = parseInt(yStr, 10);
    const mm = String(parseInt(mStr, 10)).padStart(2, '0');
    const dd = String(parseInt(dStr, 10)).padStart(2, '0');
    if (y > YEAR_MAX || y < YEAR_MIN) {
      const thisYear = new Date().getFullYear();
      return `${thisYear}-${mm}-${dd}`;
    }
    return `${y}-${mm}-${dd}`;
  }

  // ISO / Date 对象 toString / 其他 → 尝试 Date 解析
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    const y = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    if (y > YEAR_MAX || y < YEAR_MIN) {
      const thisYear = new Date().getFullYear();
      return `${thisYear}-${mm}-${dd}`;
    }
    return `${y}-${mm}-${dd}`;
  }

  return s.replace(/\//g, '-');
}

/** Excel serial → YYYY-MM-DD（自动识别 1900 / 1904 日期系统） */
function excelSerialToDate(serial: number): string {
  const { year, month, day } = excelSerialDecode(serial);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function excelSerialDecode(serial: number): { year: number; month: number; day: number } {
  // 1900 date system（Windows 默认）：serial 1 = 1900-01-01，但 Excel 有著名的 1900 闰年 bug
  // 正确公式：serial 1 = 1899-12-30 (Excel 用这个作为 epoch)
  // 1904 date system（Mac 默认）：serial 0 = 1904-01-02，比 1900 少 1462 天
  //
  // 策略：同时试两种，选年份在合理范围（2000-2100）的那个
  const candidates = [
    // 方案 A: 1900 system, epoch = 1899-12-30, 25569 = 1970-01-01
    { days: Math.floor(serial - 25569), mode: '1900' },
    // 方案 B: 1904 system → 转 1900: serial + 1462
    { days: Math.floor(serial + 1462 - 25569), mode: '1904' },
  ];

  let best = candidates[0];
  let bestYear = 0;
  for (const c of candidates) {
    if (c.days < 0) continue;
    const d = new Date(c.days * 86400 * 1000);
    const y = d.getUTCFullYear();
    if (y >= 2000 && y <= 2100) {
      best = c;
      bestYear = y;
      break;
    }
    if (y > bestYear) bestYear = y;
  }

  const d = new Date(best.days * 86400 * 1000);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

// GET /api/import/daily?month=2026-10
export async function GET(req: Request) {
  const url = new URL(req.url);
  const month = url.searchParams.get('month');
  if (!month) return fail('month 参数必填');
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('import_daily_data')
    .select('*')
    .gte('date', monthRange(month).start)
    .lt('date', monthRange(month).endExclusive)
    .order('date', { ascending: true });
  if (error) return fail(`查询日数据失败: ${error.message}`, 500);
  const rows = (data ?? []).map((r) => numify(r as Record<string, unknown>, NUMERIC_DAILY));
  return ok(rows as unknown as DailyData[]);
}

interface DailyInput {
  employee_id: string;
  stage: string;
  date: string;
  recovered_orders: number;
  recovered_amount: number;
  target_recovery_rate: number | null;
  total_orders?: number | null;
  total_amount?: number | null;
  amount_achievement_rate?: number | null;
}

interface ImportBody {
  batch_no?: string;
  rows?: DailyInput[];
}

export async function POST(req: Request) {
  const body = (await req.json()) as ImportBody;
  if (!body.batch_no || !body.rows || body.rows.length === 0) {
    return fail('batch_no 与 rows 必填且不能为空');
  }
  const client = getSupabaseClient();

  // ========== 前置校验：过滤无效员工 ==========
  const { data: existingEmps } = await client
    .from('employee')
    .select('employee_id');
  const validEmpIds = new Set((existingEmps ?? []).map((e) => e.employee_id));

  const validRows: typeof body.rows = [];
  const skippedByEmp = new Map<string, number>(); // 无效工号 → 跳过行数
  const invalidEmpIds = new Set<string>();

  for (const r of body.rows) {
    if (!validEmpIds.has(r.employee_id)) {
      invalidEmpIds.add(r.employee_id);
      skippedByEmp.set(r.employee_id, (skippedByEmp.get(r.employee_id) ?? 0) + 1);
    } else {
      validRows.push(r);
    }
  }

  if (validRows.length === 0) {
    return fail(
      `所有 ${body.rows.length} 行都因员工不存在被跳过。无效工号: ${[...invalidEmpIds].join(', ')}`,
      400
    );
  }

  // ========== 预处理日期 ==========
  const rows = validRows.map((r) => ({
    batch_no: body.batch_no,
    employee_id: r.employee_id,
    stage: r.stage,
    date: robustDate(r.date),
    recovered_orders: r.recovered_orders,
    recovered_amount: r.recovered_amount,
    target_recovery_rate: r.target_recovery_rate,
    total_orders: r.total_orders ?? null,
    total_amount: r.total_amount ?? null,
    amount_achievement_rate: r.amount_achievement_rate ?? null,
  }));

  // ========== 导入策略 ==========
  // 统一使用 upsert，唯一键 = (employee_id, stage, date)
  // 新行自动插入，已存在的行覆盖更新——仅影响本次文件涉及的唯一键，
  // 不会触碰其他日期或其他员工的旧数据。

  const { data, error } = await batchUpsert(client, 'import_daily_data', rows, {
    onConflict: 'employee_id,stage,date',
  });
  if (error) return fail(`写入日数据失败: ${error.message}`, 500);

  // 构建报告
  const report: Record<string, unknown> = {
    imported: rows.length,
    batch_no: body.batch_no,
    skipped: body.rows.length - rows.length,
  };
  if (invalidEmpIds.size > 0) {
    report.skipped_detail = [...skippedByEmp.entries()].map(([empId, cnt]) => ({
      employee_id: empId,
      rows: cnt,
      reason: 'employee not found',
    }));
  }

  return ok(report);
}

// DELETE /api/import/daily?from=2026-09-01&to=2026-10-01
// 删除日期范围 [from, to) 内的所有日数据
export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const batchNo = url.searchParams.get('batch_no');
  const client = getSupabaseClient();

  // 优先按 batch_no 删除
  if (batchNo) {
    const { count, error } = await client
      .from('import_daily_data')
      .delete({ count: 'exact' })
      .eq('batch_no', batchNo);
    if (error) return fail(`按批次删除失败: ${error.message}`, 500);
    return ok({ deleted: count ?? 0, by: 'batch_no', batch_no: batchNo });
  }

  // 按日期范围删除
  if (!from || !to) return fail('参数 from 和 to 必填（或 batch_no）');
  const { count, error } = await client
    .from('import_daily_data')
    .delete({ count: 'exact' })
    .gte('date', from)
    .lt('date', to);
  if (error) return fail(`按日期删除失败: ${error.message}`, 500);
  return ok({ deleted: count ?? 0, by: 'date_range', from, to });
}
