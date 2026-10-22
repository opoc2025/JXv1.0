import { getSupabaseClient } from '@/storage/database/supabase-client';
import { ok, fail, numify, NUMERIC_TIER, fetchAll } from '@/lib/api-helpers';
import { calculateSalary } from '@/lib/payroll-engine';
import { monthRange } from '@/lib/format';
import type {
  DailyData,
  Employee,
  MetricConfig,
  PerformanceScheme,
  RuleTier,
  SalaryRuleWithTiers,
  Settlement,
  StageGroup,
} from '@/lib/types';

export const dynamic = 'force-dynamic';

interface CalcBody {
  month?: string;
  employee_ids?: string[]; // 不传则全员
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as CalcBody;
  if (!body.month) return fail('month 必填');
  const { month } = body;
  const dept: string | undefined = (body as any).dept; // 可选部门过滤
  const client = getSupabaseClient();

  // 员工（默认只算在职），含参与阶段关联
  let employeeQuery = client
    .from('employee')
    .select(
      'employee_id,employee_name,department,default_stage,commission_plan,has_daily_commission,stage_group_id,status,created_at,' +
        'employee_stage(id,employee_id,stage_name,is_primary,sort_order),' +
        'employee_stage_group(group_id)'
    )
    .eq('status', 'active')
    .order('employee_id', { ascending: true });
  if (dept) employeeQuery = employeeQuery.eq('department', dept);
  if (body.employee_ids && body.employee_ids.length > 0) {
    employeeQuery = employeeQuery.in('employee_id', body.employee_ids);
  }
  const { data: employeeRows, error: empError } = await employeeQuery;
  if (empError) return fail(`查询员工失败: ${empError.message}`, 500);
  // 归一化 employee_stage 别名（PostgREST 以表名作为关联字段）
  const employees = (employeeRows ?? []).map((emp) => {
    const e = { ...(emp as object) } as Record<string, unknown>;
    const rel = (e.employee_stage ?? []) as unknown[];
    delete e.employee_stage;
    return {
      ...(e as object),
      stages: rel as Employee['stages'],
    } as Employee;
  });
  if (employees.length === 0) return fail('没有可核算的在职员工');

  // 规则 + 阶梯
  const { data: ruleRows, error: ruleErr } = await client
    .from('salary_rule_config')
    .select('*');
  if (ruleErr) return fail(`查询规则失败: ${ruleErr.message}`, 500);
  const { data: tierRows, error: tierErr } = await client
    .from('rule_tier_detail')
    .select('*');
  if (tierErr) return fail(`查询阶梯失败: ${tierErr.message}`, 500);

  const tiers = (tierRows ?? []).map((t) =>
    numify(t as Record<string, unknown>, NUMERIC_TIER)
  ) as unknown as RuleTier[];
  const byRule = new Map<number, RuleTier[]>();
  tiers.forEach((t) => {
    const list = byRule.get(t.rule_id) ?? [];
    list.push(t);
    byRule.set(t.rule_id, list);
  });
  const rules = (ruleRows ?? []).map((r) => ({
    ...(r as object),
    tiers: byRule.get((r as { rule_id: number }).rule_id) ?? [],
  })) as SalaryRuleWithTiers[];

  // 日数据（整月）
  const { data: dailyRows, error: dailyErr } = await fetchAll(
    client.from('import_daily_data')
      .select('*')
      .gte('date', monthRange(month).start)
      .lt('date', monthRange(month).endExclusive)
      .order('date')
  );
  if (dailyErr) return fail(`查询日数据失败: ${dailyErr.message}`, 500);
  const dailyAll = dailyRows as DailyData[];

  // 指标库
  const { data: metricRows, error: metricErr } = await client
    .from('metric_config')
    .select('metric_id,metric_code,metric_name,scope,period,source_field,unit,enabled')
    .eq('enabled', true);
  if (metricErr) return fail(`查询指标库失败: ${metricErr.message}`, 500);
  const metrics = (metricRows ?? []) as MetricConfig[];

  // 阶段合并组（全局共享）
  const { data: groupRows, error: gErr } = await client
    .from('stage_group')
    .select('group_id,group_name,description,enabled,stage_group_member(stage_name)')
    .eq('enabled', true);
  if (gErr) return fail(`查询合并组失败: ${gErr.message}`, 500);
  const stageGroups: StageGroup[] = (groupRows ?? []).map((g: any) => ({
    group_id: g.group_id,
    group_name: g.group_name,
    description: g.description,
    stage_names: (g.stage_group_member ?? []).map((m: any) => m.stage_name),
    enabled: g.enabled,
  }));

  // 绩效考核方案（含多条件组，按部门匹配）
  const { data: schemeRows, error: schemeErr } = await client
    .from('performance_scheme')
    .select(
      'scheme_id,dept_name,base_salary,performance_bonus,' +
        'performance_condition_group(group_id,sort_order,' +
        'performance_condition(condition_id,metric,operator,threshold_value,sort_order))'
    );
  if (schemeErr) return fail(`查询绩效考核方案失败: ${schemeErr.message}`, 500);
  const schemeMap = new Map<string, PerformanceScheme>();
  (schemeRows ?? []).forEach((s) => {
    const row = s as any;
    const rawGroups = row.performance_condition_group ?? [];
    const scheme: PerformanceScheme = {
      scheme_id: row.scheme_id,
      dept_name: row.dept_name,
      base_salary: Number(row.base_salary),
      performance_bonus: Number(row.performance_bonus),
      groups: rawGroups
        .map((g: any) => ({
          group_id: g.group_id,
          sort_order: g.sort_order,
          conditions: (g.performance_condition ?? [])
            .map((c: any) => ({
              condition_id: c.condition_id,
              metric: c.metric,
              operator: c.operator,
              threshold_value: Number(c.threshold_value),
              sort_order: c.sort_order,
            }))
            .sort((a: any, b: any) => a.sort_order - b.sort_order),
        }))
        .sort((a: any, b: any) => a.sort_order - b.sort_order),
    };
    schemeMap.set(scheme.dept_name, scheme);
  });

  // 薪酬调整（实发底薪 + 全勤奖）
  const { data: adjRows, error: adjErr } = await client
    .from('salary_adjustment')
    .select('employee_id,actual_base_salary,full_attendance_bonus')
    .eq('month', month);
  if (adjErr) return fail(`查询薪酬调整失败: ${adjErr.message}`, 500);
  const adjMap = new Map<string, { actual_base_salary: number; full_attendance_bonus: number }>();
  (adjRows ?? []).forEach((r: any) => {
    adjMap.set(r.employee_id, {
      actual_base_salary: Number(r.actual_base_salary ?? 0),
      full_attendance_bonus: Number(r.full_attendance_bonus ?? 0),
    });
  });

  // 逐人计算：scheme 按 employee.department 匹配
  // 把 employee_stage_group 关联转成 merge_group_ids 数组
  const results: Settlement[] = employees.map((emp: any) => {
    const merge_group_ids: number[] = (emp.employee_stage_group ?? []).map((r: any) => r.group_id);
    return calculateSalary({
      employee: { ...emp, merge_group_ids } as Employee,
      month,
      scheme: schemeMap.get(emp.department ?? '') ?? null,
      rules,
      dailyRows: dailyAll.filter((d) => d.employee_id === emp.employee_id),
      metrics,
      stageGroups,
      adjustment: adjMap.get(emp.employee_id) ?? null,
    });
  });

  // 写入结算表（草稿覆盖草稿；已终审的行保留不覆盖）
  const { data: existing, error: exErr } = await client
    .from('salary_settlement_result')
    .select('settlement_id,employee_id,status')
    .eq('month', month);
  if (exErr) return fail(`查询历史结算失败: ${exErr.message}`, 500);
  const existingMap = new Map<string, { id: number; status: string }>();
  (existing ?? []).forEach((r) => {
    const row = r as { settlement_id: number; employee_id: string; status: string };
    existingMap.set(row.employee_id, { id: row.settlement_id, status: row.status });
  });

  const toInsert: Settlement[] = [];
  const toUpdate: Settlement[] = [];
  for (const r of results) {
    const ex = existingMap.get(r.employee_id);
    if (ex && ex.status === 'FINALIZED') continue;
    if (ex) toUpdate.push({ ...r, settlement_id: ex.id });
    else toInsert.push(r);
  }

  if (toInsert.length > 0) {
    const { error } = await client.from('salary_settlement_result').insert(toInsert);
    if (error) return fail(`写入结算结果失败: ${error.message}`, 500);
  }
  for (const r of toUpdate) {
    const { settlement_id, ...cols } = r;
    const { error } = await client
      .from('salary_settlement_result')
      .update({ ...cols, updated_at: new Date().toISOString() })
      .eq('settlement_id', settlement_id);
    if (error) return fail(`更新结算结果失败: ${error.message}`, 500);
  }

  return ok({
    calculated: results.length,
    inserted: toInsert.length,
    updated: toUpdate.length,
    skipped_finalized: results.length - toInsert.length - toUpdate.length,
    results,
  });
}
