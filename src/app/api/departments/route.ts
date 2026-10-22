import { getSupabaseClient } from '@/storage/database/supabase-client';
import { ok, fail } from '@/lib/api-helpers';
import type { DepartmentConfig } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface DeptBody {
  dept_code?: string;
  dept_name?: string;
  sort_order?: number;
  enabled?: boolean;
}

// GET /api/departments?enabled=true
export async function GET(req: Request) {
  const url = new URL(req.url);
  const onlyEnabled = url.searchParams.get('enabled') === 'true';
  const client = getSupabaseClient();

  let query = client
    .from('department_config')
    .select('dept_id,dept_code,dept_name,sort_order,enabled,created_at,updated_at')
    .order('sort_order', { ascending: true })
    .order('dept_id', { ascending: true });
  if (onlyEnabled) query = query.eq('enabled', true);

  const { data, error } = await query;
  if (error) return fail(`查询部门失败: ${error.message}`, 500);
  return ok((data ?? []) as DepartmentConfig[]);
}

// POST /api/departments
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as DeptBody;
  const code = (body.dept_code ?? '').trim();
  const name = (body.dept_name ?? '').trim();
  if (!code || !name) return fail('dept_code 与 dept_name 必填');
  if (!/^[A-Za-z0-9_-]+$/.test(code)) {
    return fail('部门编码仅允许字母、数字、下划线、短横线');
  }
  const client = getSupabaseClient();
  const dept: DepartmentConfig = {
    dept_code: code,
    dept_name: name,
    sort_order: Number(body.sort_order ?? 0) || 0,
    enabled: body.enabled ?? true,
  };
  const { data, error } = await client
    .from('department_config')
    .insert(dept)
    .select('dept_id,dept_code,dept_name,sort_order,enabled,created_at,updated_at')
    .single();
  if (error) {
    if (error.code === '23505') return fail('部门编码或名称已存在');
    return fail(`创建部门失败: ${error.message}`, 500);
  }
  return ok(data as DepartmentConfig);
}

// PATCH /api/departments —— 按 dept_code 定位（编码不可改；名称变更时级联同步引用）
export async function PATCH(req: Request) {
  const body = (await req.json().catch(() => ({}))) as DeptBody;
  const code = (body.dept_code ?? '').trim();
  if (!code) return fail('dept_code 必填');
  const client = getSupabaseClient();

  const { data: curRows } = await client
    .from('department_config')
    .select('dept_code,dept_name')
    .eq('dept_code', code);
  if (!curRows || curRows.length === 0) return fail('部门不存在', 404);
  const oldName = (curRows[0] as { dept_name: string }).dept_name;
  const newName = body.dept_name !== undefined ? String(body.dept_name).trim() : oldName;
  if (!newName) return fail('部门名称不能为空');

  const cols: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.dept_name !== undefined) cols.dept_name = newName;
  if (body.sort_order !== undefined) cols.sort_order = Number(body.sort_order) || 0;
  if (body.enabled !== undefined) cols.enabled = Boolean(body.enabled);

  const { data, error } = await client
    .from('department_config')
    .update(cols)
    .eq('dept_code', code)
    .select('dept_id,dept_code,dept_name,sort_order,enabled,created_at,updated_at')
    .single();
  if (error) return fail(`更新部门失败: ${error.message}`, 500);
  if (!data) return fail('部门不存在');

  // 级联同步所有引用
  if (newName !== oldName) {
    await Promise.all([
      client.from('employee').update({ department: newName }).eq('department', oldName),
      client.from('salary_rule_config').update({ dept_name: newName }).eq('dept_name', oldName),
      client.from('performance_scheme').update({ dept_name: newName }).eq('dept_name', oldName),
    ]);
  }

  return ok(data as DepartmentConfig);
}

// DELETE /api/departments?dept_code=xx —— 已被引用时拒绝
export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('dept_code');
  if (!code) return fail('dept_code 必填');
  const client = getSupabaseClient();

  const { data: deptRows } = await client
    .from('department_config')
    .select('dept_code,dept_name')
    .eq('dept_code', code);
  if (!deptRows || deptRows.length === 0) return fail('部门不存在', 404);
  const deptName = (deptRows[0] as { dept_name: string }).dept_name;

  const { count: empCount } = await client
    .from('employee')
    .select('*', { count: 'exact', head: true })
    .eq('department', deptName);
  if ((empCount ?? 0) > 0) {
    return fail(`部门 ${deptName} 已被 ${empCount} 名员工关联，请先调整员工部门后再删除`);
  }
  const { count: ruleCount } = await client
    .from('salary_rule_config')
    .select('*', { count: 'exact', head: true })
    .eq('dept_name', deptName);
  if ((ruleCount ?? 0) > 0) {
    return fail(`部门 ${deptName} 已被 ${ruleCount} 条提成规则引用，请先删除规则`);
  }
  const { count: schemeCount } = await client
    .from('performance_scheme')
    .select('*', { count: 'exact', head: true })
    .eq('dept_name', deptName);
  if ((schemeCount ?? 0) > 0) {
    return fail(`部门 ${deptName} 已被绩效考核方案引用，请先删除方案`);
  }

  const { error } = await client.from('department_config').delete().eq('dept_code', code);
  if (error) return fail(`删除部门失败: ${error.message}`, 500);
  return ok({ dept_code: code, dept_name: deptName });
}
