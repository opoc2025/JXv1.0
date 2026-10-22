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
  settlement_id: number;
  status?: 'DRAFT' | 'FINALIZED';
}

export async function PATCH(req: Request) {
  const body = (await req.json()) as PatchBody;
  if (!body.settlement_id) return fail('settlement_id 必填');
  const client = getSupabaseClient();
  const cols: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.status) cols.status = body.status;
  const { data, error } = await client
    .from('salary_settlement_result')
    .update(cols)
    .eq('settlement_id', body.settlement_id)
    .select();
  if (error) return fail(`更新结算状态失败: ${error.message}`, 500);
  return ok(data[0]);
}

// DELETE /api/settlements?month=2026-10
export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const month = url.searchParams.get('month');
  if (!month) return fail('month 必填');
  const client = getSupabaseClient();
  const { count, error } = await client
    .from('salary_settlement_result')
    .delete({ count: 'exact' })
    .eq('month', month);
  if (error) return fail(`删除结算数据失败: ${error.message}`, 500);
  return ok({ deleted: count ?? 0 });
}
