import { getSupabaseClient } from '@/storage/database/supabase-client';
import { calculateSalary } from '@/lib/payroll-engine';

async function main() {
  const c = getSupabaseClient();
  const month = '2026-09';

  // 1. 模拟 calculate/route.ts 的规则组装
  const { data: ruleRows } = await c.from('salary_rule_config').select('*').eq('enabled', true);
  const { data: tierRows } = await c.from('rule_tier_detail').select('*');
  const byRule = new Map<number, any[]>();
  tierRows?.forEach((t: any) => {
    const arr = byRule.get(t.rule_id) ?? []; arr.push(t); byRule.set(t.rule_id, arr);
  });
  const rules = (ruleRows ?? []).map((r: any) => ({ ...r, tiers: byRule.get(r.rule_id) ?? [] }));

  // 2. stageGroups
  const { data: sg } = await c.from('stage_group').select('*,stage_group_member(stage_name)').eq('enabled', true);
  const stageGroups = sg?.map((g: any) => ({
    group_id: g.group_id, group_name: g.group_name,
    stage_names: g.stage_group_member?.map((m: any) => m.stage_name) ?? [],
  }));

  // 3. metrics
  const { data: metrics } = await c.from('metric_config').select('*');

  // 4. schemes
  const { data: schemes } = await c.from('performance_scheme').select('*');
  const schemeMap = new Map((schemes ?? []).map((s: any) => [s.dept_name, s]));

  // 5. 日数据
  const start = '2026-09-01', end = '2026-10-01';
  const { data: dailyRows } = await c.from('import_daily_data').select('*').gte('date', start).lt('date', end);

  // 6. X2P 员工（带 employee_stage_group）
  const { data: emps } = await c.from('employee').select(
    '*,employee_stage_group(group_id),employee_stage(stage_name,is_primary)'
  ).eq('department', 'X2P').eq('status', 'active');

  for (const emp of (emps ?? [])) {
    const merge_group_ids = (emp as any).employee_stage_group?.map((r: any) => r.group_id) ?? [];
    const employee = { ...emp, merge_group_ids } as any;
    const result = calculateSalary({
      employee, month,
      scheme: schemeMap.get(emp.department ?? '') ?? null,
      rules, dailyRows: (dailyRows ?? []).filter((d: any) => d.employee_id === emp.employee_id),
      metrics: metrics ?? [], stageGroups,
    });

    console.log(`\n=== ${emp.employee_name} (${emp.employee_id}) plan=${emp.commission_plan} groups=[${merge_group_ids}] ===`);
    console.log(`  底薪=${result.base_salary}  绩效=${result.performance_bonus}  日=${result.daily_commission}  月A=${result.monthly_total_commission}  月B=${result.stage_tier_commission}  合计=${result.total}`);
    if (result.stages) {
      for (const s of result.stages as any[]) {
        const hits = s.daily_hits?.length ?? 0;
        console.log(`  → VS "${s.display}"(${s.isMerged?'合并':'独立'})  日命中${hits}天  月B=${s.stage_tier_commission}  月A=${s.monthly_total_commission}  月汇=${s.monthly_total_amount}`);
      }
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
