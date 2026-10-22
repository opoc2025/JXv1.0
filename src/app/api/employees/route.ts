import { getSupabaseClient } from '@/storage/database/supabase-client';
import { ok, fail } from '@/lib/api-helpers';
import { validateStages, syncEmployeeStages, syncEmployeeStageGroups } from '@/lib/employee-stages';
import type { Employee, EmployeeStage } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface EmployeeBody {
  employee_id?: string;
  employee_name?: string;
  department?: string | null;
  default_stage?: string;
  commission_plan?: 'A' | 'B' | 'NONE';
  has_daily_commission?: boolean;
  stage_group_id?: number | null; // 向后兼容：单合并组
  merge_group_ids?: number[]; // 新：多合并组（优先）
  status?: 'active' | 'resigned';
  salary_qr_code_url?: string | null;
  // 参与阶段名称列表
  stages?: string[];
}

// GET /api/employees
export async function GET() {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('employee')
    .select(
      'employee_id,employee_name,department,default_stage,commission_plan,has_daily_commission,stage_group_id,status,created_at,salary_qr_code_url,employee_stage_group(group_id)'
    )
    .order('employee_id', { ascending: true });
  if (error) return fail(`查询员工失败: ${error.message}`, 500);

  const { data: stageRows, error: stageErr } = await client
    .from('employee_stage')
    .select('id,employee_id,stage_name,is_primary,sort_order')
    .order('sort_order', { ascending: true });
  if (stageErr) return fail(`查询员工阶段失败: ${stageErr.message}`, 500);

  const stageMap = new Map<string, EmployeeStage[]>();
  (stageRows ?? []).forEach((s) => {
    const list = stageMap.get(s.employee_id) ?? [];
    list.push(s as EmployeeStage);
    stageMap.set(s.employee_id, list);
  });

  const employees = (data ?? []).map((e) => ({
    ...(e as Employee),
    stages: stageMap.get((e as Employee).employee_id) ?? [
      {
        employee_id: (e as Employee).employee_id,
        stage_name: (e as Employee).default_stage,
        is_primary: true,
        sort_order: -1,
      },
    ],
  }));
  return ok(employees);
}

// POST /api/employees
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as EmployeeBody;
  const id = (body.employee_id ?? '').trim();
  const name = (body.employee_name ?? '').trim();
  if (!id || !name) return fail('employee_id 与 employee_name 必填');
  const defaultStage = (body.default_stage ?? '').trim();
  if (!defaultStage) return fail('默认阶段必填');

  const client = getSupabaseClient();
  const stageNames = body.stages ?? [defaultStage];
  const validate = await validateStages(client, [defaultStage, ...stageNames]);
  if (typeof validate === 'string') return fail(validate);

  const employee = {
    employee_id: id,
    employee_name: name,
    department: body.department ?? null,
    default_stage: defaultStage,
    commission_plan: body.commission_plan ?? 'A',
    has_daily_commission: body.has_daily_commission ?? true,
    stage_group_id: body.stage_group_id ?? null,
    status: body.status ?? 'active',
    salary_qr_code_url: body.salary_qr_code_url ?? null,
  };
  const { error } = await client.from('employee').insert(employee);
  if (error) {
    if (error.code === '23505') return fail('员工工号已存在');
    return fail(`创建员工失败: ${error.message}`, 500);
  }

  const syncErr = await syncEmployeeStages(client, id, stageNames, defaultStage);
  if (syncErr) return fail(syncErr, 500);

  // 同步合并组关联（优先 merge_group_ids，fallback stage_group_id）
  const groupIds = body.merge_group_ids ?? (body.stage_group_id ? [body.stage_group_id] : []);
  await syncEmployeeStageGroups(client, id, groupIds);

  return ok(employee);
}
