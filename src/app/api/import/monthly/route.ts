import { getSupabaseClient } from '@/storage/database/supabase-client';
import { ok, fail, numify, NUMERIC_MONTHLY, batchUpsert } from '@/lib/api-helpers';
import type { MonthlyData } from '@/lib/types';

export const dynamic = 'force-dynamic';

// GET /api/import/monthly?month=2026-10
export async function GET(req: Request) {
  const url = new URL(req.url);
  const month = url.searchParams.get('month');
  if (!month) return fail('month 参数必填');
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('import_monthly_data')
    .select('*')
    .eq('month', month)
    .order('employee_id', { ascending: true });
  if (error) return fail(`查询月度数据失败: ${error.message}`, 500);
  const rows = (data ?? []).map((r) => numify(r as Record<string, unknown>, NUMERIC_MONTHLY));
  return ok(rows as unknown as MonthlyData[]);
}

interface MonthlyInput {
  month: string;
  employee_id: string;
  stage: string;
  monthly_recovery_rate: number | null;
  monthly_total_amount: number | null;
  monthly_recovered_orders?: number;
}

interface ImportBody {
  rows?: MonthlyInput[];
}

export async function POST(req: Request) {
  const body = (await req.json()) as ImportBody;
  if (!body.rows || body.rows.length === 0) return fail('rows 必填且不能为空');
  const client = getSupabaseClient();

  // ========== 前置校验：过滤无效员工 ==========
  const { data: existingEmps } = await client
    .from('employee')
    .select('employee_id');
  const validEmpIds = new Set((existingEmps ?? []).map((e) => e.employee_id));

  const validRows: typeof body.rows = [];
  const skippedByEmp = new Map<string, number>();
  const invalidEmpIds = new Set<string>();

  for (const r of body.rows) {
    if (!validEmpIds.has(r.employee_id)) {
      invalidEmpIds.add(r.employee_id);
      skippedByEmp.set(r.employee_id, (skippedByEmp.get(r.employee_id) ?? 0) + 1);
    } else {
      validRows.push(r);
    }
  }

  if (validRows.length === 0) {
    return fail(
      `所有 ${body.rows.length} 行都因员工不存在被跳过。无效工号: ${[...invalidEmpIds].join(', ')}`,
      400
    );
  }

  const { error } = await batchUpsert(client, 'import_monthly_data', validRows, {
    onConflict: 'month,employee_id,stage',
  });
  if (error) return fail(`写入月度数据失败: ${error.message}`, 500);

  // 构建报告（与日数据格式一致，前端可统一展示）
  const report: Record<string, unknown> = {
    imported: validRows.length,
    skipped: body.rows.length - validRows.length,
  };
  if (invalidEmpIds.size > 0) {
    report.skipped_detail = [...skippedByEmp.entries()].map(([empId, cnt]) => ({
      employee_id: empId,
      rows: cnt,
      reason: 'employee not found',
    }));
  }

  return ok(report);
}
