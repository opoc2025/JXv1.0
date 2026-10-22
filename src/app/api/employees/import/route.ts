import { NextRequest } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { ok, fail } from '@/lib/api-helpers';
import { parseWorkbook } from '@/lib/excel';
import { validateStages, syncEmployeeStages } from '@/lib/employee-stages';

export const dynamic = 'force-dynamic';

const HEADERS = ['employee_id', 'employee_name', 'department', 'default_stage', 'stages', 'commission_plan', 'status'];

// POST /api/employees/import（表单 file 字段上传 Excel）
export async function POST(req: NextRequest) {
  let file: File | null = null;
  try {
    const form = await req.formData();
    file = form.get('file') as unknown as File;
  } catch {
    return fail('请通过 multipart/form-data 上传文件，字段名为 file');
  }
  if (!file || !file.name) return fail('未收到文件');

  const client = getSupabaseClient();
  const { rows, errors } = await parseWorkbook(file, HEADERS);
  if (errors.length > 0) return fail(errors.join('；'), 400);
  if (rows.length === 0) return fail('文件中没有有效数据行');

  const created: any[] = [];
  const skips: string[] = [];
  const rejects: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const line = i + 3; // 模板有 1 行说明 + 1 行表头
    const id = String(r.employee_id ?? '').trim();
    const name = String(r.employee_name ?? '').trim();
    if (!id) { rejects.push(`第${line}行缺少 employee_id`); continue; }
    if (!name) { rejects.push(`第${line}行缺少 employee_name`); continue; }
    const defaultStage = String(r.default_stage ?? '').trim();
    if (!defaultStage) { rejects.push(`第${line}行缺少 default_stage`); continue; }

    const stagesRaw = r.stages === null || r.stages === undefined
      ? defaultStage
      : String(r.stages);
    const stageNames = stagesRaw.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
    if (stageNames.length === 0) stageNames.push(defaultStage);

    const planRaw = String(r.commission_plan ?? 'A').trim().toUpperCase();
    let plan: 'A' | 'B' | 'NONE' = 'A';
    if (planRaw === 'B') plan = 'B';
    else if (planRaw === 'NONE' || planRaw === '无' || planRaw === '0') plan = 'NONE';
    else plan = 'A';
    const status = String(r.status ?? 'active').trim().toLowerCase();

    const validate = await validateStages(client, [defaultStage, ...stageNames]);
    if (typeof validate === 'string') { rejects.push(`第${line}行(${id})${validate}`); continue; }

    // 已存在则跳过（避免覆盖已有档案）
    const { data: exist } = await client.from('employee').select('employee_id').eq('employee_id', id).maybeSingle();
    if (exist) { skips.push(`${id}`); continue; }

    const employee = {
      employee_id: id,
      employee_name: name,
      department: r.department === null || r.department === undefined || String(r.department).trim() === '' ? null : String(r.department).trim(),
      default_stage: defaultStage,
      commission_plan: plan,
      status: status === 'inactive' ? 'resigned' : 'active',
    };
    const { error } = await client.from('employee').insert(employee);
    if (error) {
      if (error.code === '23505') { skips.push(`${id}`); continue; }
      rejects.push(`第${line}行(${id})创建失败: ${error.message}`);
      continue;
    }
    const syncErr = await syncEmployeeStages(client, id, stageNames, defaultStage);
    if (syncErr) { rejects.push(`第${line}行(${id})阶段保存失败: ${syncErr}`); continue; }
    created.push(employee);
  }

  return ok({
    imported: created.length,
    skipped: skips.length,
    failed: rejects.length,
    failed_lines: rejects,
    skipped_ids: skips,
  });
}