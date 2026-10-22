import { getSupabaseClient } from '@/storage/database/supabase-client';
import { ok, fail } from '@/lib/api-helpers';
import type { MetricConfig } from '@/lib/types';

export const dynamic = 'force-dynamic';

const SCOPE_LABEL: Record<string, string> = { PERF: '绩效考核', COMMISSION: '提成', BOTH: '通用' };
const PERIOD_LABEL: Record<string, string> = { MONTHLY: '月度', DAILY: '日' };

function decorate(rows: any[]) {
  return (rows ?? []).map((m) => ({
    ...m,
    metric_name: m.metric_name,
    scope_label: SCOPE_LABEL[m.scope] ?? m.scope,
    period_label: PERIOD_LABEL[m.period] ?? m.period,
  }));
}

// GET /api/metrics?scope=PERF|COMMISSION|ALL
export async function GET(req: Request) {
  const scope = new URL(req.url).searchParams.get('scope') ?? 'ALL';
  const client = getSupabaseClient();
  let q = client.from('metric_config').select('*').order('metric_id', { ascending: true });
  if (scope === 'PERF') q = q.or('scope.eq.PERF,scope.eq.BOTH');
  else if (scope === 'COMMISSION') q = q.or('scope.eq.COMMISSION,scope.eq.BOTH');
  const { data, error } = await q;
  if (error) return fail(`查询指标库失败: ${error.message}`, 500);
  return ok(decorate(data));
}

// POST /api/metrics —— 新增自定义指标
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Partial<MetricConfig>;
  const { metric_code, metric_name, scope, period, source_field, unit } = body;
  if (!metric_code || !metric_name || !source_field) return fail('metric_code / metric_name / source_field 必填');
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('metric_config')
    .insert({
      metric_code,
      metric_name,
      scope: scope ?? 'BOTH',
      period: period ?? 'MONTHLY',
      source_field,
      unit: unit ?? '',
      enabled: true,
    })
    .select('*')
    .single();
  if (error) return fail(`新增指标失败: ${error.message}`, 500);
  return ok(data);
}

// PATCH /api/metrics/:id —— 更新指标
export async function PATCH(req: Request) {
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return fail('metric id 必填');
  const body = (await req.json().catch(() => ({}))) as Partial<MetricConfig>;
  const patch: Record<string, any> = {};
  if (body.metric_name !== undefined) patch.metric_name = body.metric_name;
  if (body.scope !== undefined) patch.scope = body.scope;
  if (body.period !== undefined) patch.period = body.period;
  if (body.source_field !== undefined) patch.source_field = body.source_field;
  if (body.unit !== undefined) patch.unit = body.unit;
  if (body.enabled !== undefined) patch.enabled = body.enabled;
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('metric_config')
    .update(patch)
    .eq('metric_id', id)
    .select('*')
    .single();
  if (error) return fail(`更新指标失败: ${error.message}`, 500);
  return ok(data);
}

// DELETE /api/metrics?code=xxx —— 删除指标（被引用时可能受限）
export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return fail('metric id 必填');
  const client = getSupabaseClient();
  const { error } = await client.from('metric_config').delete().eq('metric_id', id);
  if (error) return fail(`删除指标失败: ${error.message}`, 500);
  return ok({ metric_id: id });
}