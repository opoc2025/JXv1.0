import { getSupabaseClient } from '@/storage/database/supabase-client';
import { ok, fail, batchUpsert, numify } from '@/lib/api-helpers';
import * as XLSX from 'xlsx';

export const dynamic = 'force-dynamic';

// 表头映射（兼容中英）
const HEADER_MAP: Record<string, string> = {
  工号: 'employee_id',
  employee_id: 'employee_id',
  EmployeeId: 'employee_id',
  月份: 'month',
  month: 'month',
  实发底薪: 'actual_base_salary',
  底薪: 'actual_base_salary',
  actual_base_salary: 'actual_base_salary',
  base: 'actual_base_salary',
  全勤奖: 'full_attendance_bonus',
  全勤: 'full_attendance_bonus',
  full_attendance_bonus: 'full_attendance_bonus',
  attendance_bonus: 'full_attendance_bonus',
  备注: 'remark',
  remark: 'remark',
  note: 'remark',
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const month = searchParams.get('month') ?? '';
  const batch_id = searchParams.get('batch_id');
  const client = getSupabaseClient();

  let q = client.from('salary_adjustment').select('*');
  if (month) q = q.eq('month', month);
  if (batch_id) q = q.eq('batch_id', batch_id);
  const { data, error } = await q.order('month', { ascending: false }).order('employee_id');
  if (error) return fail(error.message, 500);
  return ok({ rows: data });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const batch_id = searchParams.get('batch_id');
  const id_str = searchParams.get('id');
  const client = getSupabaseClient();

  if (batch_id) {
    const { error } = await client.from('salary_adjustment').delete().eq('batch_id', Number(batch_id));
    if (error) return fail(error.message, 500);
    return ok({ deleted: 0 });
  }
  if (id_str) {
    const { error } = await client.from('salary_adjustment').delete().eq('id', Number(id_str));
    if (error) return fail(error.message, 500);
    return ok({ deleted: 1 });
  }
  return fail('需要 batch_id 或 id', 400);
}

export async function POST(request: Request) {
  const client = getSupabaseClient();
  const contentType = request.headers.get('content-type') ?? '';

  let rows: any[] = [];
  let total = 0;
  let success = 0;
  const failures: { row: number; employee_id?: string; reason: string }[] = [];
  const validEmployeeIds = new Set<string>();
  const batch_id = 0; // 暂不建 import_batch 表，用 0

  try {
    if (contentType.includes('application/json')) {
      // JSON body
      const body = await request.json();
      const data = Array.isArray(body) ? body : body.data ?? [];
      rows = data;
    } else {
      // multipart Excel
      const form = await request.formData();
      const file = form.get('file') as File | null;
      if (!file) return fail('缺少 file', 400);
      const buf = Buffer.from(await file.arrayBuffer());
      const wb = XLSX.read(buf, { type: 'buffer' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json<any>(sheet, { defval: '' });
      rows = raw.map((r) => {
        const o: Record<string, any> = {};
        Object.entries(r).forEach(([k, v]) => {
          const mapped = HEADER_MAP[k.trim()] ?? k.trim().toLowerCase();
          o[mapped] = v;
        });
        return o;
      });
    }

    total = rows.length;
    // 查有效工号
    const { data: empRows } = await client.from('employee').select('employee_id');
    (empRows ?? []).forEach((r: any) => validEmployeeIds.add(r.employee_id));

    const toInsert: any[] = [];
    rows.forEach((r, idx) => {
      const employee_id = String(r.employee_id ?? '').trim();
      const month = String(r.month ?? '').trim();
      if (!employee_id) {
        failures.push({ row: idx + 2, reason: '缺工号' });
        return;
      }
      if (!validEmployeeIds.has(employee_id)) {
        failures.push({ row: idx + 2, employee_id, reason: `工号不存在` });
        return;
      }
      const m = /^(\d{4})-(\d{1,2})$/.exec(month);
      const monthNorm = m ? `${m[1]}-${m[2].padStart(2, '0')}` : '';
      if (!monthNorm) {
        failures.push({ row: idx + 2, employee_id, reason: '月份格式错误(需要 YYYY-MM)' });
        return;
      }
      numify(r, ['actual_base_salary', 'actual_base', 'base', '实发底薪', '底薪']);
      numify(r, ['full_attendance_bonus', 'attendance_bonus', '全勤奖', '全勤']);
      toInsert.push({
        month: monthNorm,
        employee_id,
        actual_base_salary: r.actual_base_salary ?? r.actual_base ?? r.base ?? r['实发底薪'] ?? r['底薪'] ?? 0,
        full_attendance_bonus: r.full_attendance_bonus ?? r.attendance_bonus ?? r['全勤奖'] ?? r['全勤'] ?? 0,
        remark: r.remark ?? r['备注'] ?? r.note ?? null,
        batch_id,
      });
    });

    if (toInsert.length > 0) {
      const { error: upsertErr } = await batchUpsert(client, 'salary_adjustment', toInsert, {
        onConflict: 'month,employee_id',
      });
      if (upsertErr) return fail(`写入失败: ${upsertErr.message ?? upsertErr}`, 500);
      success = toInsert.length;
    }
  } catch (e: any) {
    return fail(`导入失败: ${e?.message ?? e}`, 500);
  }

  return ok({
    batch_id,
    total_rows: total,
    success_rows: success,
    failures,
  });
}
