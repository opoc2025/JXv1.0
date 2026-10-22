import { getSupabaseClient } from '@/storage/database/supabase-client';
import { ok, fail } from '@/lib/api-helpers';
import { syncEmployeeStageGroups } from '@/lib/employee-stages';
import type { EmployeeStage } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface UpdateBody {
  employee_name?: string;
  department?: string | null;
  default_stage?: string;
  commission_plan?: 'A' | 'B' | 'NONE';
  has_daily_commission?: boolean;
  stage_group_id?: number | null; // 向后兼容：单合并组
  merge_group_ids?: number[]; // 新：多合并组（优先）
  status?: 'active' | 'resigned';
  // 参与阶段名称列表
  stages?: string[];
}

// 校验阶段名称全部存在且启用，返回合法名称集合或错误串
async function validStageNames(
  client: ReturnType<typeof getSupabaseClient>,
  names: string[]
): Promise<string[] | string> {
  const unique = [...new Set(names.map((n) => String(n ?? '').trim()).filter(Boolean))];
  if (unique.length === 0) return '阶段不能为空';
  const { data, error } = await client
    .from('stage_config')
    .select('stage_name,enabled')
    .in('stage_name', unique);
  if (error) return `校验阶段失败: ${error.message}`;
  const found = data ?? [];
  if (found.length !== unique.length) {
    const missing = unique.filter((n) => !found.some((f) => f.stage_name === n));
    return `阶段不存在: ${missing.join(', ')}`;
  }
  const disabled = found.filter((f) => !f.enabled).map((f) => f.stage_name);
  if (disabled.length > 0) return `阶段已停用: ${disabled.join(', ')}`;
  return unique;
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json()) as UpdateBody;
  const client = getSupabaseClient();

  // 取当前员工
  const { data: existingRows } = await client
    .from('employee')
    .select('employee_id,default_stage')
    .eq('employee_id', id);
  if (!existingRows || existingRows.length === 0) return fail('员工不存在', 404);
  const current = existingRows[0] as { employee_id: string; default_stage: string };
  const primaryStage = body.default_stage?.trim()
    ? body.default_stage.trim()
    : current.default_stage;

  // 校验阶段（若有传入）
  if (body.stages || body.default_stage) {
    const names = [...(body.stages ?? []), primaryStage];
    const validated = await validStageNames(client, names);
    if (typeof validated === 'string') return fail(validated);
  }

  // 更新员工主表（排除只在关联表里的字段）
  const { stages: _s, merge_group_ids: _m, stage_group_id: _sg, ...employeeCols } = body;
  const cols: Record<string, unknown> = { ...employeeCols };
  if (Object.keys(cols).length > 0) {
    const { error } = await client
      .from('employee')
      .update({ ...cols })
      .eq('employee_id', id);
    if (error) return fail(`更新员工失败: ${error.message}`, 500);
  }

  // 同步阶段关联
  if (body.stages || body.default_stage) {
    const stageNames = body.stages ?? null;
    if (stageNames) {
      const unique = [...new Set(stageNames.map((n) => n.trim()).filter(Boolean))];
      if (!unique.includes(primaryStage)) unique.unshift(primaryStage);

      await client.from('employee_stage').delete().eq('employee_id', id);
      const rows: EmployeeStage[] = unique.map((name, idx) => ({
        employee_id: id,
        stage_name: name,
        is_primary: name === primaryStage,
        sort_order: name === primaryStage ? -1 : idx,
      }));
      const { error: linkErr } = await client.from('employee_stage').insert(rows);
      if (linkErr) return fail(`保存员工阶段失败: ${linkErr.message}`, 500);
    } else {
      // 仅改默认阶段：把主标记迁移到新阶段
      await client
        .from('employee_stage')
        .update({ is_primary: false })
        .eq('employee_id', id);
      const { data: linkRows } = await client
        .from('employee_stage')
        .select('id')
        .eq('employee_id', id)
        .eq('stage_name', primaryStage);
      if (linkRows && linkRows.length > 0) {
        const linkId = (linkRows[0] as { id: number }).id;
        await client
          .from('employee_stage')
          .update({ is_primary: true, sort_order: -1 })
          .eq('id', linkId);
      } else {
        await client.from('employee_stage').insert({
          employee_id: id,
          stage_name: primaryStage,
          is_primary: true,
          sort_order: -1,
        });
      }
    }
  }

  // 同步合并组关联（如果传入了 merge_group_ids 或 stage_group_id）
  if (body.merge_group_ids !== undefined || body.stage_group_id !== undefined) {
    const groupIds = body.merge_group_ids ?? (body.stage_group_id ? [body.stage_group_id] : []);
    const gErr = await syncEmployeeStageGroups(client, id, groupIds);
    if (gErr) return fail(gErr, 500);
  }

  const { data: updated } = await client
    .from('employee')
    .select(
      'employee_id,employee_name,department,default_stage,commission_plan,has_daily_commission,stage_group_id,status,created_at,' +
        'employee_stage_group(group_id)'
    )
    .eq('employee_id', id)
    .single();
  return ok(updated);
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const client = getSupabaseClient();
  // employee_stage 通过 ON DELETE CASCADE 自动清理
  const { error } = await client.from('employee').delete().eq('employee_id', id);
  if (error) return fail(`删除员工失败: ${error.message}`, 500);
  return ok({ deleted: id });
}