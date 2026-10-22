import { getSupabaseClient } from '@/storage/database/supabase-client';
import { ok, fail } from '@/lib/api-helpers';
import type { StageConfig } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface StageBody {
  stage_code?: string;
  stage_name?: string;
  sort_order?: number;
  enabled?: boolean;
}

// GET /api/stages?enabled=true —— 默认返回全部；?enabled=true 仅启用
export async function GET(req: Request) {
  const url = new URL(req.url);
  const onlyEnabled = url.searchParams.get('enabled') === 'true';
  const client = getSupabaseClient();

  let query = client
    .from('stage_config')
    .select(
      'stage_id,stage_code,stage_name,sort_order,enabled,created_at,updated_at'
    )
    .order('sort_order', { ascending: true })
    .order('stage_id', { ascending: true });
  if (onlyEnabled) query = query.eq('enabled', true);

  const { data, error } = await query;
  if (error) return fail(`查询阶段失败: ${error.message}`, 500);
  return ok((data ?? []) as StageConfig[]);
}

// POST /api/stages —— 新建阶段
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as StageBody;
  const code = (body.stage_code ?? '').trim();
  const name = (body.stage_name ?? '').trim();
  if (!code || !name) return fail('stage_code 与 stage_name 必填');
  if (!/^[A-Za-z0-9_-]+$/.test(code)) {
    return fail('阶段编码仅允许字母、数字、下划线、短横线');
  }
  const client = getSupabaseClient();
  const stage: StageConfig = {
    stage_code: code,
    stage_name: name,
    sort_order: Number(body.sort_order ?? 0) || 0,
    enabled: body.enabled ?? true,
  };
  const { data, error } = await client
    .from('stage_config')
    .insert(stage)
    .select('stage_id,stage_code,stage_name,sort_order,enabled,created_at,updated_at')
    .single();
  if (error) {
    if (error.code === '23505') return fail('阶段编码已存在');
    return fail(`创建阶段失败: ${error.message}`, 500);
  }
  return ok(data as StageConfig);
}

// PATCH /api/stages —— 更新（按 stage_code 定位；编码本身不允许改）
export async function PATCH(req: Request) {
  const body = (await req.json().catch(() => ({}))) as StageBody;
  const code = (body.stage_code ?? '').trim();
  if (!code) return fail('stage_code 必填');
  const client = getSupabaseClient();

  // 取当前名称（引用统一用阶段名称，改名需级联同步引用处）
  const { data: curRows } = await client
    .from('stage_config')
    .select('stage_code,stage_name')
    .eq('stage_code', code);
  if (!curRows || curRows.length === 0) return fail('阶段不存在', 404);
  const oldName = (curRows[0] as { stage_name: string }).stage_name;
  const newName = body.stage_name !== undefined
    ? String(body.stage_name).trim()
    : oldName;
  if (!newName) return fail('阶段名称不能为空');

  const cols: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.stage_name !== undefined) {
    cols.stage_name = newName;
  }
  if (body.sort_order !== undefined) cols.sort_order = Number(body.sort_order) || 0;
  if (body.enabled !== undefined) cols.enabled = Boolean(body.enabled);

  const { data, error } = await client
    .from('stage_config')
    .update(cols)
    .eq('stage_code', code)
    .select('stage_id,stage_code,stage_name,sort_order,enabled,created_at,updated_at')
    .single();
  if (error) return fail(`更新阶段失败: ${error.message}`, 500);
  if (!data) return fail('阶段不存在');

  // 若名称变更，级联同步所有引用该阶段的记录
  if (newName !== oldName) {
    await Promise.all([
      client.from('employee').update({ default_stage: newName }).eq('default_stage', oldName),
      client.from('employee_stage').update({ stage_name: newName }).eq('stage_name', oldName),
      client.from('salary_rule_config').update({ stage_name: newName }).eq('stage_name', oldName),
      client.from('import_daily_data').update({ stage: newName }).eq('stage', oldName),
      client.from('import_monthly_data').update({ stage: newName }).eq('stage', oldName),
    ]);
  }

  return ok(data as StageConfig);
}

// DELETE /api/stages?stage_code=xx —— 已被员工/规则/数据引用时拒绝删除
export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('stage_code');
  if (!code) return fail('stage_code 必填');
  const client = getSupabaseClient();

  // 依据编码取阶段名称（引用统一用名称）
  const { data: stageRows } = await client
    .from('stage_config')
    .select('stage_code,stage_name')
    .eq('stage_code', code);
  if (!stageRows || stageRows.length === 0) return fail('阶段不存在', 404);
  const stageName = (stageRows[0] as { stage_name: string }).stage_name;

  const { count: empStageCount } = await client
    .from('employee_stage')
    .select('*', { count: 'exact', head: true })
    .eq('stage_name', stageName);
  if ((empStageCount ?? 0) > 0) {
    return fail(`阶段 ${stageName} 已被 ${empStageCount} 名员工关联，请先调整员工阶段后再删除`);
  }
  const { count: empDefaultCount } = await client
    .from('employee')
    .select('*', { count: 'exact', head: true })
    .eq('default_stage', stageName);
  if ((empDefaultCount ?? 0) > 0) {
    return fail(`阶段 ${stageName} 已被 ${empDefaultCount} 名员工设为主阶段，请先调整后再删除`);
  }
  const { count: ruleCount } = await client
    .from('salary_rule_config')
    .select('*', { count: 'exact', head: true })
    .eq('stage_name', stageName);
  if ((ruleCount ?? 0) > 0) {
    return fail(`阶段 ${stageName} 已被 ${ruleCount} 条提成规则引用，请先删除规则`);
  }
  const { count: dailyCount } = await client
    .from('import_daily_data')
    .select('*', { count: 'exact', head: true })
    .eq('stage', stageName);
  if ((dailyCount ?? 0) > 0) {
    return fail(`阶段 ${stageName} 已存在导入的业务数据，无法删除`);
  }

  const { error } = await client.from('stage_config').delete().eq('stage_code', code);
  if (error) return fail(`删除阶段失败: ${error.message}`, 500);
  return ok({ stage_code: code, stage_name: stageName });
}
