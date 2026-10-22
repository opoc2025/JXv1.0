import { createClient } from '@supabase/supabase-js';
import { calculateRewards } from './src/lib/reward-engine.ts';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const sb = createClient(process.env.COZE_SUPABASE_URL, process.env.COZE_SUPABASE_SERVICE_ROLE_KEY);
const EMP = 'ST-2603-LW-Julalux';

// 引擎需要的全部参数
const { data: dailyData } = await sb.from('import_daily_data').select('*')
  .eq('employee_id', EMP).eq('stage', 'D0')
  .gte('date','2026-09-01').lte('date','2026-09-30');
const { data: emps } = await sb.from('employee').select('employee_id,department').eq('employee_id', EMP);
const empDeptMap = new Map([[EMP, emps[0].department]]);
const { data: rules } = await sb.from('salary_rule_config').select('*').eq('enabled',true).eq('rule_type','WEEKLY_REWARD_TIER');
const { data: tiers } = await sb.from('rule_tier_detail').select('*').in('rule_id', rules.map(r=>r.rule_id));
const { data: groups } = await sb.from('salary_condition_group').select('*').in('rule_id', rules.map(r=>r.rule_id));
const { data: conds } = groups.length ? await sb.from('salary_condition').select('*').in('group_id', groups.map(g=>g.id)) : { data: [] };

console.log('=== 输入参数 ===');
console.log('周奖励规则:', rules.map(r=>r.rule_id+' '+r.rule_name+' stage='+r.stage_name+' metric='+r.metric));
console.log('条件组:', groups.map(g=>g.id+' rule='+g.rule_id));
console.log('条件明细:', conds.map(c=>c.metric_code+' '+c.operator+' '+c.threshold_value));

// 直接算 Julalux 的周指标
function getISOWeek(dateStr) {
  const d = new Date(dateStr+'T00:00:00');
  const dayNum = d.getDay() || 7;
  d.setDate(d.getDate() + 4 - dayNum);
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart.getTime())/86400000 + 1)/7);
  return d.getFullYear()+'-W'+String(week).padStart(2,'0');
}

const weekly = {};
for (const row of dailyData) {
  const w = getISOWeek(row.date);
  if (!weekly[w]) weekly[w] = { amount:0, orders:0, total_orders:0, total_amount:0, rate_w:0, arate_w:0 };
  weekly[w].amount += Number(row.recovered_amount)||0;
  weekly[w].orders += Number(row.recovered_orders)||0;
  weekly[w].total_orders += Number(row.total_orders)||0;
  weekly[w].total_amount += Number(row.total_amount)||0;
  weekly[w].rate_w += (Number(row.target_recovery_rate)||0) * (Number(row.recovered_amount)||0);
  weekly[w].arate_w += (Number(row.amount_achievement_rate)||0) * (Number(row.recovered_amount)||0);
}
console.log('\n=== Julalux 每周指标（人工算）===');
for (const [w, v] of Object.entries(weekly)) {
  const orderRate = v.amount > 0 ? (v.rate_w / v.amount) * 100 : 0;
  const amtRate = v.amount > 0 ? (v.arate_w / v.amount) * 100 : 0;
  console.log(w, 'WEEK_TOTAL_ORDERS='+v.total_orders, 'WEEK_ORDER_RATE='+orderRate.toFixed(1)+'%', 'WEEK_AMOUNT='+v.amount);
  // 模拟规则 90 条件
  const condPass = v.total_orders >= 150;
  console.log('  规则90条件 WEEK_TOTAL_ORDERS>=150:', condPass ? '✅ 过' : '❌ 没过');
  if (condPass) {
    const tierPass = orderRate >= 45;
    console.log('  阶梯 WEEK_ORDER_RATE>=45:', tierPass ? '✅ 命中' : '❌ 不命中');
  }
}

// 跑引擎
console.log('\n=== 引擎跑出来的结算 ===');
const result = calculateRewards({
  dailyData, rules, tiers: tiers||[], conditionGroups: groups||[], conditionDetails: conds||[],
  empDeptMap, stageGroups: [], empGroupNames: new Map()
});
console.log('周结算:', result.weeklySettlements.filter(s=>s.employee_id===EMP));
