import { createClient } from '@supabase/supabase-js';
import { calculateRewards } from './src/lib/reward-engine.ts';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const sb = createClient(process.env.COZE_SUPABASE_URL, process.env.COZE_SUPABASE_SERVICE_ROLE_KEY);

const { data: dailyData } = await sb.from('import_daily_data').select('*').gte('date','2026-09-01').lte('date','2026-09-30');
const { data: emps } = await sb.from('employee').select('employee_id, department');
const empDeptMap = new Map(emps.map(e => [e.employee_id, e.department]));

const { data: rules } = await sb.from('salary_rule_config').select('*').eq('enabled',true).in('rule_type',['DAILY_REWARD_TIER','WEEKLY_REWARD_TIER']);
const ruleIds = rules.map(r => r.rule_id);
const { data: tiers } = await sb.from('rule_tier_detail').select('*').in('rule_id', ruleIds);
const { data: groups } = await sb.from('salary_condition_group').select('*').in('rule_id', ruleIds);
const groupIds = groups.map(g => g.id);
const { data: conds } = groupIds.length > 0 ? await sb.from('salary_condition').select('*').in('group_id', groupIds) : { data: [] };

const { data: stageGroups } = await sb.from('stage_group').select('*');
const sgIds = stageGroups.map(g => g.group_id);
const { data: members } = await sb.from('stage_group_member').select('*').in('group_id', sgIds);
const stageGroupList = stageGroups.map(g => ({
  group_id: g.group_id, group_name: g.group_name,
  stage_names: members.filter(m => m.group_id === g.group_id).map(m => m.stage_name),
}));

const { data: empGroupRows } = await sb.from('employee_stage_group').select('employee_id, group_id');
const gm = new Map(stageGroups.map(g => [g.group_id, g.group_name]));
const empGroupNames = new Map();
for (const row of empGroupRows) {
  const gname = gm.get(row.group_id);
  if (!gname) continue;
  const list = empGroupNames.get(row.employee_id) || [];
  list.push(gname);
  empGroupNames.set(row.employee_id, list);
}

const targetGroups = ['T2组','T3组','X2P-总'];
console.log('=== 员工虚拟阶段 ===');
for (const [empId, groupNames] of empGroupNames) {
  const relevantGroups = groupNames.filter(g => targetGroups.includes(g));
  if (relevantGroups.length === 0) continue;
  const empRows = dailyData.filter(r => r.employee_id === empId);
  const dataStages = [...new Set(empRows.map(r => r.stage))];
  console.log(`\n员工 ${empId} dept=${empDeptMap.get(empId)}`);
  console.log(`  绑定合并组:`, groupNames);
  console.log(`  日数据原始阶段:`, dataStages);
  for (const gname of relevantGroups) {
    const sg = stageGroupList.find(s => s.group_name === gname);
    const overlap = dataStages.filter(s => sg.stage_names.includes(s));
    console.log(`  ${gname} 组成员[${sg.stage_names}] → 数据重叠:`, overlap);
  }
}

// 打印规则匹配
console.log('\n=== 规则详情 ===');
rules.forEach(r => {
  const relevant = targetGroups.includes(r.stage_name);
  if (relevant) console.log(`  规则 ${r.rule_id} ${r.rule_name}: dept=${r.dept_name} stage=${r.stage_name} type=${r.rule_type}`);
});

console.log('\n=== 跑引擎 ===');
const result = calculateRewards({
  dailyData, rules, tiers: tiers||[], conditionGroups: groups||[], conditionDetails: conds||[],
  empDeptMap, stageGroups: stageGroupList, empGroupNames
});
const mergedDaily = result.dailySettlements.filter(s => targetGroups.includes(s.stage));
const mergedWeekly = result.weeklySettlements.filter(s => targetGroups.includes(s.stage));
console.log('合并组日结算:', mergedDaily.length);
mergedDaily.slice(0,5).forEach(s => console.log(' ', s.employee_id, s.stage, s.period_key, s.total_reward));
console.log('合并组周结算:', mergedWeekly.length);
mergedWeekly.slice(0,5).forEach(s => console.log(' ', s.employee_id, s.stage, s.period_key, s.total_reward));
console.log('\n普通日结算数:', result.dailySettlements.filter(s => !targetGroups.includes(s.stage)).length);
