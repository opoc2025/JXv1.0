import { getSupabaseClient } from '@/storage/database/supabase-client';
const c = getSupabaseClient();

async function main() {
  console.log('===== 1. 所有合并组 =====');
  const { data: groups } = await c.from('stage_group').select('*');
  console.log(groups);

  console.log('\n===== 2. 合并组成员 =====');
  const { data: members } = await c.from('stage_group_member').select('*');
  console.log(members);

  console.log('\n===== 3. employee_stage_group 关联 =====');
  const { data: esg } = await c.from('employee_stage_group').select('*');
  console.log(esg);

  console.log('\n===== 4. 规则中 stage_name 含 X2P 的 =====');
  const { data: rules } = await c.from('salary_rule_config').select('rule_id,rule_name,stage_name,dept_name,rule_type,enabled').ilike('stage_name', '%x2p%');
  console.log(rules);

  console.log('\n===== 5. X2P 部门的员工 =====');
  const { data: emps } = await c.from('employee').select('employee_id,employee_name,department,default_stage,stage_group_id,commission_plan').ilike('department', '%x2p%');
  console.log(emps);

  console.log('\n===== 6. X2P 员工的 employee_stage_group 关联 =====');
  for (const e of emps ?? []) {
    const { data: g } = await c.from('employee_stage_group').select('*').eq('employee_id', e.employee_id);
    console.log(e.employee_id, e.employee_name, '→', g?.length ? g : '(无)');
  }

  console.log('\n===== 7. 规则中 stage_name = X2P组 的完整规则 =====');
  const { data: x2pRules } = await c.from('salary_rule_config').select('rule_id,rule_name,stage_name,dept_name,rule_type,metric,enabled');
  const matched = x2pRules?.filter(r => r.stage_name?.includes('X2P') || r.stage_name?.includes('x2p'));
  console.log('全部规则中 stage_name 带 X2P:', matched);
  console.log('\n全部规则:');
  x2pRules?.forEach(r => console.log(`  ${r.rule_id} ${r.rule_name} | stage=${r.stage_name} | dept=${r.dept_name} | ${r.rule_type}`));
}
main().catch(console.error);
