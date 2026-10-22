import { NextResponse } from 'next/server';

export function ok<T>(data: T): NextResponse {
  return NextResponse.json({ success: true, data });
}

export function fail(message: string, status = 400): NextResponse {
  return NextResponse.json({ success: false, error: message }, { status });
}

// numeric 列经 PostgREST 返回为字符串，统一转 number
type AnyRecord = Record<string, unknown>;

export function numify(row: AnyRecord, keys: string[]): AnyRecord {
  const out: AnyRecord = { ...row };
  for (const k of keys) {
    if (out[k] !== null && out[k] !== undefined) out[k] = Number(out[k]);
  }
  return out;
}

export const NUMERIC_TIER = ['min_val', 'max_val', 'reward_value'];
export const NUMERIC_DAILY = ['recovered_amount', 'target_recovery_rate', 'total_amount', 'amount_achievement_rate'];
export const NUMERIC_MONTHLY = ['monthly_recovery_rate', 'monthly_total_amount'];
export const NUMERIC_SETTLEMENT = [
  'base_salary',
  'monthly_performance_bonus',
  'daily_commission',
  'monthly_total_commission',
  'stage_tier_commission',
  'progressive_commission',
  'actual_base_salary',
  'full_attendance_bonus',
  'total_salary',
];

/**
 * Supabase PostgREST 单次 upsert 默认 limit = 1000
 * 分批 upsert，每批 BATCH_SIZE 行，避免被截断
 */
const BATCH_SIZE = 500;

export async function batchUpsert(
  client: { from: (table: string) => any },
  table: string,
  rows: any[],
  opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}
): Promise<{ data: any[] | null; error: any }> {
  if (rows.length === 0) return { data: [], error: null };

  const allData: any[] = [];
  let firstError: any = null;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    const { data, error } = await client
      .from(table)
      .upsert(chunk, {
        onConflict: opts.onConflict,
        ignoreDuplicates: opts.ignoreDuplicates,
      });
    if (error) {
      firstError = error;
      break;
    }
    if (data) allData.push(...data);
  }

  return firstError ? { data: null, error: firstError } : { data: allData, error: null };
}

/**
 * Supabase PostgREST 默认单次 select limit = 1000
 * 自动分页拉取全量数据
 * 用法: fetchAll(client.from('table').select('*').eq(...).order(...))
 */
export async function fetchAll<T = any>(
  queryBuilder: { range: (from: number, to: number) => any }
): Promise<{ data: T[] | null; error: any }> {
  const PAGE = 1000;
  let offset = 0;
  const all: T[] = [];
  let firstError: any = null;

  while (true) {
    const { data, error } = await queryBuilder.range(offset, offset + PAGE - 1);
    if (error) { firstError = error; break; }
    if (!data || data.length === 0) break;
    all.push(...(data as T[]));
    if (data.length < PAGE) break;
    offset += PAGE;
  }

  return firstError ? { data: null, error: firstError } : { data: all, error: null };
}
