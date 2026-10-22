import { getSupabaseClient } from '@/storage/database/supabase-client';
import type { EmployeeStage, StageConfig } from '@/lib/types';

// 校验阶段名称全部存在且启用
export async function validateStages(
  client: ReturnType<typeof getSupabaseClient>,
  names: string[]
): Promise<StageConfig[] | string> {
  const unique = [...new Set(names.map((n) => String(n ?? '').trim()).filter(Boolean))];
  if (unique.length === 0) return '阶段不能为空';
  const { data, error } = await client
    .from('stage_config')
    .select('stage_code,stage_name,enabled')
    .in('stage_name', unique);
  if (error) return `校验阶段失败: ${error.message}`;
  const found = data ?? [];
  if (found.length !== unique.length) {
    const missing = unique.filter((n) => !found.some((f) => f.stage_name === n));
    return `阶段不存在: ${missing.join(', ')}`;
  }
  const disabled = found.filter((f) => !f.enabled).map((f) => f.stage_name);
  if (disabled.length > 0) return `阶段已停用: ${disabled.join(', ')}`;
  return found.map((f) => f as StageConfig);
}

// 重建某员工的阶段关联（主阶段 is_primary=true）
export async function syncEmployeeStages(
  client: ReturnType<typeof getSupabaseClient>,
  employeeId: string,
  stageNames: string[],
  primaryStage: string
): Promise<string | null> {
  const unique = [...new Set(stageNames.map((n) => n.trim()).filter(Boolean))];
  if (!unique.includes(primaryStage)) unique.unshift(primaryStage);

  await client.from('employee_stage').delete().eq('employee_id', employeeId);

  const rows: EmployeeStage[] = unique.map((name, idx) => ({
    employee_id: employeeId,
    stage_name: name,
    is_primary: name === primaryStage,
    sort_order: name === primaryStage ? -1 : idx,
  }));
  const { error } = await client.from('employee_stage').insert(rows);
  if (error) return `保存员工阶段失败: ${error.message}`;
  return null;
}

// 重建某员工的合并组关联（多对多）
export async function syncEmployeeStageGroups(
  client: ReturnType<typeof getSupabaseClient>,
  employeeId: string,
  groupIds: number[]
): Promise<string | null> {
  await client.from('employee_stage_group').delete().eq('employee_id', employeeId);
  if (!groupIds || groupIds.length === 0) return null;
  const rows = groupIds.map((gid) => ({ employee_id: employeeId, group_id: gid }));
  const { error } = await client.from('employee_stage_group').insert(rows);
  if (error) return `保存合并组关联失败: ${error.message}`;
  return null;
}