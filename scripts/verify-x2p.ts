import { getSupabaseClient } from '@/storage/database/supabase-client';
import { calculateSalary, buildEngineInput } from '@/lib/payroll-engine';

async function main() {
  const c = getSupabaseClient();
  const month = '2026-09';

  // 拉 X2P 员工
  const { data: emps } = await c.from('employee').select(
    'employee_id,employee_name,department,default_stage,commission_plan,has_daily_commission,stage_group_id,status,' +
    'employee_stage_group(group_id),employee_stage(stage_name,is_primary)'
  ).eq('department', 'X2P').eq('status', 'active');

  // 拉 stageGroups
  const { data: sg } = await c.from('stage_group').select('*,stage_group_member(stage_name)').eq('enabled', true);
  const stageGroups = sg?.map((g: any) => ({
    group_id: g.group_id,
    group_name: g.group_name,
    stage_names: g.stage_group_member?.map((m: any) => m.stage_name) ?? [],
  }));

  // 拉方案
  const { data: schemes } = await c.from('performance_scheme').select('*');
  const schemeMap = new Map((schemes ?? []).map((s: any) => [s.dept_name, s]));

  // 拉规则
  const { data: rulesRaw } = await c.from('salary_rule_config').select('*,rule_tier_detail(*)').eq('enabled', true);

  // 拉 metrics
  const { data: metrics } = await c.from('metric_config').select('*');

  // 拉日数据（全月）
  const startDate = new Date('2026-09-01').toISOString().slice(0,10);
  const endDate = new Date('2026-10-01').toISOString().slice(0,10);
  const { data: dailyRows } = await c.from('import_daily_data').select('*').gte('date', startDate).lt('date', endDate);

  console.log('stageGroups:', stageGroups);
  console.log('\nX2P 员工数:', emps?.length);

  for (const emp of (emps ?? [])) {
    const merge_group_ids = (emp as any).employee_stage_group?.map((r: any) => r.group_id) ?? [];
    const employee = { ...emp, merge_group_ids } as any;
    const dept = emp.department ?? '';
    
    const result = calculateSalary({
      employee,
      month,
      scheme: schemeMap.get(dept) ?? null,
      rules: rulesRaw ?? [],
      dailyRows: (dailyRows ?? []).filter((d: any) => d.employee_id === emp.employee_id),
      metrics: metrics ?? [],
      stageGroups,
    });

    console.log(`\n${emp.employee_name} (${emp.employee_id})  dept=${dept}  plan=${emp.commission_plan}  groups=[${merge_group_ids}]`);
    console.log(`  底薪=${result.base_salary}  绩效=${result.performance_bonus}`);
    console.log(`  日提成=${result.daily_commission}  月A=${result.monthly_total_commission}  月B=${result.stage_tier_commission}`);
    console.log(`  合计=${result.total}`);
    if (result.stages) {
      for (const s of result.stages as any[]) {
        console.log(`    → 阶段 "${s.display}"(${s.isMerged?'合并':'独立'})  d=${s.daily_hits?.length ?? 0}天  月B=${s.stage_tier_commission}  月A=${s.monthly_total_commission}`);
      }
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
