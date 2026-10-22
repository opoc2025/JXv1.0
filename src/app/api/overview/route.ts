import { getSupabaseClient } from '@/storage/database/supabase-client';
import { ok, fail } from '@/lib/api-helpers';
import { monthRange } from '@/lib/format';

export const dynamic = 'force-dynamic';

// GET /api/overview?month=2026-10
export async function GET(req: Request) {
  const url = new URL(req.url);
  const month = url.searchParams.get('month');
  if (!month) return fail('month 必填');
  const client = getSupabaseClient();

  const { count: employeeCount, error: empErr } = await client
    .from('employee')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'active');
  if (empErr) return fail(`统计员工失败: ${empErr.message}`, 500);

  const { data: settlements, error: setErr } = await client
    .from('salary_settlement_result')
    .select(
      'employee_id,status,total_salary,base_salary,monthly_performance_bonus,daily_commission,monthly_total_commission,stage_tier_commission'
    )
    .eq('month', month);
  if (setErr) return fail(`统计结算失败: ${setErr.message}`, 500);

  const rows = (settlements ?? []) as unknown as {
    employee_id: string;
    status: string;
    total_salary: number;
    base_salary: number;
    monthly_performance_bonus: number;
    daily_commission: number;
    monthly_total_commission: number;
    stage_tier_commission: number;
  }[];

  const totalSalary = rows.reduce((s, r) => s + Number(r.total_salary), 0);
  const finalizedCount = rows.filter((r) => r.status === 'FINALIZED').length;

  const { data: daily, error: dailyErr } = await client
    .from('import_daily_data')
    .select('recovered_amount')
    .gte('date', monthRange(month).start)
    .lt('date', monthRange(month).endExclusive);
  if (dailyErr) return fail(`统计回款失败: ${dailyErr.message}`, 500);
  const totalRecovered = (daily ?? []).reduce(
    (s, r) => s + Number((r as { recovered_amount: number }).recovered_amount),
    0
  );

  return ok({
    month,
    active_employees: employeeCount ?? 0,
    settled_employees: rows.length,
    finalized_employees: finalizedCount,
    total_salary: Math.round(totalSalary * 100) / 100,
    total_recovered: Math.round(totalRecovered * 100) / 100,
  });
}
