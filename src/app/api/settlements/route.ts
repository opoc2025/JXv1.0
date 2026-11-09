import { getSupabaseClient } from '@/storage/database/supabase-client';
import { ok, fail, numify, NUMERIC_SETTLEMENT } from '@/lib/api-helpers';
import type { Settlement } from '@/lib/types';

export const dynamic = 'force-dynamic';

// GET /api/settlements?month=2026-10
export async function GET(req: Request) {
  const url = new URL(req.url);
  const month = url.searchParams.get('month');
  if (!month) return fail('month 必填');
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('salary_settlement_result')
    .select('*, employee(employee_name, department, default_stage, commission_plan)')
    .eq('month', month)
    .order('employee_id', { ascending: true });
  if (error) return fail(`查询结算结果失败: ${error.message}`, 500);
  const rows = (data ?? []).map((r) => {
    const { employee, ...rest } = r as Record<string, unknown> & {
      employee: Record<string, unknown> | null;
    };
    return {
      ...numify(rest, NUMERIC_SETTLEMENT),
      employee,
    };
  });
  return ok(rows as (Settlement & { employee: Record<string, unknown> | null })[]);
}

interface PatchBody {
  settlement_id?: number;
  ids?: number[]; // 批量终审
  status?: 'DRAFT' | 'FINALIZED';
}

export async function PATCH(req: Request) {
  const body = (await req.json()) as PatchBody;
  if (!body.settlement_id && !(body.ids?.length)) return fail('settlement_id 或 ids 必填');
  const client = getSupabaseClient();
  const cols: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.status) cols.status = body.status;
  let query = client.from('salary_settlement_result').update(cols);
  query = body.ids?.length
    ? query.in('settlement_id', body.ids)
    : query.eq('settlement_id', body.settlement_id);
  const { data, error } = await query.select();
  if (error) return fail(`更新结算状态失败: ${error.message}`, 500);
  return ok(body.ids?.length ? { updated: data.length } : data[0]);
}

// DELETE /api/settlements?settlement_id=123（单条）
// DELETE /api/settlements?month=2026-10（整月）
export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const settlementId = url.searchParams.get('settlement_id');
  const client = getSupabaseClient();
  if (settlementId) {
    const { data, error } = await client
      .from('salary_settlement_result')
      .delete()
      .eq('settlement_id', Number(settlementId))
      .select();
    if (error) return fail(`删除结算记录失败: ${error.message}`, 500);
    if (!data?.length) return fail('结算记录不存在', 404);
    return ok({ deleted: data.length });
  }
  const month = url.searchParams.get('month');
  if (!month) return fail('month 或 settlement_id 必填');
  const { count, error } = await client
    .from('salary_settlement_result')
    .delete({ count: 'exact' })
    .eq('month', month);
  if (error) return fail(`删除结算数据失败: ${error.message}`, 500);
  return ok({ deleted: count ?? 0 });
}
