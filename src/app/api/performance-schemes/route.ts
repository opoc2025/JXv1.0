import { getSupabaseClient } from '@/storage/database/supabase-client';
import { ok, fail } from '@/lib/api-helpers';
import type { PerformanceCondition, PerformanceScheme } from '@/lib/types';

export const dynamic = 'force-dynamic';

const GROUP_SELECT =
  'performance_condition_group(group_id,sort_order,' +
  'performance_condition(condition_id,metric,operator,threshold_value,sort_order))';

function normalizeGroups(rawGroups: any[]): PerformanceScheme['groups'] {
  return (rawGroups ?? [])
    .map((g: any) => ({
      group_id: g.group_id,
      sort_order: g.sort_order,
      conditions: (g.performance_condition ?? [])
        .map((c: any): PerformanceCondition => ({
          condition_id: c.condition_id,
          metric: c.metric,
          operator: c.operator,
          threshold_value: Number(c.threshold_value),
          sort_order: c.sort_order,
        }))
        .sort((a: any, b: any) => a.sort_order - b.sort_order),
    }))
    .sort((a: any, b: any) => a.sort_order - b.sort_order);
}

// GET /api/performance-schemes —— 列出所有部门及其绩效考核方案（含部门候选人）
export async function GET() {
  const client = getSupabaseClient();
  // 1) 所有启用的部门
  const { data: depts, error: deptErr } = await client
    .from('department_config')
    .select('dept_code,dept_name,sort_order,enabled')
    .eq('enabled', true)
    .order('sort_order', { ascending: true });
  if (deptErr) return fail(`查询部门失败: ${deptErr.message}`, 500);
  // 2) 所有方案
  const { data: schemes, error: schErr } = await client
    .from('performance_scheme')
    .select('scheme_id,dept_name,base_salary,performance_bonus,' + GROUP_SELECT);
  if (schErr) return fail(`查询绩效考核方案失败: ${schErr.message}`, 500);

  const schemeMap = new Map<string, PerformanceScheme>();
  (schemes ?? []).forEach((s: any) => {
    schemeMap.set(s.dept_name, {
      scheme_id: s.scheme_id,
      dept_name: s.dept_name,
      base_salary: Number(s.base_salary),
      performance_bonus: Number(s.performance_bonus),
      groups: normalizeGroups(s.performance_condition_group),
    });
  });

  const rows = (depts ?? []).map((d: any) => {
    const perf = schemeMap.get(d.dept_name) ?? null;
    return {
      dept_code: d.dept_code,
      dept_name: d.dept_name,
      scheme: perf,
    };
  });
  return ok(rows);
}

// POST /api/performance-schemes —— 创建或更新部门绩效方案（含条件组，事务式重建）
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    dept_name?: string;
    base_salary?: number;
    performance_bonus?: number;
    groups?: { sort_order?: number; conditions: PerformanceCondition[] }[];
  };
  const { dept_name, base_salary, performance_bonus, groups = [] } = body;
  if (!dept_name) return fail('dept_name 必填');
  if (base_salary === undefined || performance_bonus === undefined) {
    return fail('base_salary / performance_bonus 必填');
  }
  if (!Array.isArray(groups) || groups.length === 0) return fail('至少配置一个绩效考核条件组');
  const client = getSupabaseClient();

  // 1) 校验部门存在
  const { data: dept } = await client
    .from('department_config')
    .select('dept_name')
    .eq('dept_name', dept_name)
    .eq('enabled', true)
    .single();
  if (!dept) return fail(`部门「${dept_name}」不存在或已停用`);

  // 2) UPSERT 方案主表
  const schemeReq = await client
    .from('performance_scheme')
    .upsert(
      { dept_name, base_salary: Number(base_salary), performance_bonus: Number(performance_bonus) },
      { onConflict: 'dept_name' }
    )
    .select('scheme_id');
  if (schemeReq.error) return fail(`保存绩效考核方案失败: ${schemeReq.error.message}`, 500);
  const schemeId = schemeReq.data?.[0]?.scheme_id as number;

  // 3) 删旧组（级联删条件）
  const del = await client.from('performance_condition_group').delete().eq('scheme_id', schemeId);
  if (del.error) return fail(`更新门槛条件失败: ${del.error.message}`, 500);

  // 4) 逐个重建条件组及其条件
  let groupOrder = 0;
  for (const g of groups) {
    const gres = await client
      .from('performance_condition_group')
      .insert({ scheme_id: schemeId, sort_order: g.sort_order ?? groupOrder })
      .select('group_id');
    if (gres.error) return fail(`写入条件组失败: ${gres.error.message}`, 500);
    const groupId = gres.data?.[0]?.group_id as number;
    const rows = (g.conditions ?? []).map((c, i) => ({
      group_id: groupId,
      metric: c.metric,
      operator: c.operator ?? 'GTE',
      threshold_value: Number(c.threshold_value),
      sort_order: i,
    }));
    const ins = await client.from('performance_condition').insert(rows);
    if (ins.error) return fail(`写入门槛条件失败: ${ins.error.message}`, 500);
    groupOrder += 1;
  }

  // 5) 回读返回
  const read = await client
    .from('performance_scheme')
    .select('scheme_id,dept_name,base_salary,performance_bonus,' + GROUP_SELECT)
    .eq('scheme_id', schemeId)
    .single();
  const s = read.data as any;
  return ok({
    scheme_id: schemeId,
    dept_name,
    base_salary: Number(s?.base_salary),
    performance_bonus: Number(s?.performance_bonus),
    groups: normalizeGroups(s?.performance_condition_group),
  } as PerformanceScheme);
}

// DELETE /api/performance-schemes?dept_name=xxx —— 删除部门绩效方案（级联删组与条件）
export async function DELETE(req: Request) {
  const dept_name = new URL(req.url).searchParams.get('dept_name');
  if (!dept_name) return fail('dept_name 必填');
  const client = getSupabaseClient();
  const { error } = await client
    .from('performance_scheme')
    .delete()
    .eq('dept_name', dept_name);
  if (error) return fail(`删除绩效考核方案失败: ${error.message}`, 500);
  return ok({ dept_name });
}
