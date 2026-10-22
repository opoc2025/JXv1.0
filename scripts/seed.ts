/* eslint-disable no-console */
// 种子数据：部门 + 阶段 + 员工 A-E + 按部门的绩效方案 + 带部门归属的提成规则 + 2026-10 示例业务数据
// 运行：pnpm tsx scripts/seed.ts
import { getSupabaseClient } from '../src/storage/database/supabase-client';

const MONTH = '2026-10';

async function main(): Promise<void> {
  const client = getSupabaseClient();

  // ---------- 清理示例业务数据（幂等重建）----------
  // 只清业务数据表，保护用户自己维护的基础数据：
  //   ✅ 清: settlement / daily / monthly / tiers / conditions / schemes / rules / employee_stage
  //   🛡️ 保护: department_config / stage_config / employee / metric_config（用户可能已导入自己的数据）
  const cleanAll = async (table: string, pkCol: string, isInt: boolean) => {
    const val = isInt ? -1 : '__NONE__';
    const { error } = await client.from(table).delete().neq(pkCol, val);
    if (error) throw new Error(`清 ${table} 失败: ${error.message}`);
  };
  await cleanAll('salary_settlement_result', 'settlement_id', true);
  await cleanAll('import_daily_data', 'id', true);
  await cleanAll('import_monthly_data', 'id', true);
  await cleanAll('rule_tier_detail', 'detail_id', true);
  await cleanAll('performance_condition', 'condition_id', true);
  await cleanAll('performance_condition_group', 'group_id', true);
  await cleanAll('performance_scheme', 'scheme_id', true);
  await cleanAll('salary_rule_config', 'rule_id', true);
  await cleanAll('employee_stage', 'id', true);
  console.log('Cleared sample business data (preserved dept/stage/employee/metric)');

  // ---------- 部门配置 ----------
  const depts = [
    { dept_code: 'DEPT_A', dept_name: '催收一组', sort_order: 0, enabled: true },
    { dept_code: 'DEPT_B', dept_name: '催收二组', sort_order: 1, enabled: true },
    { dept_code: 'DEPT_C', dept_name: '跨阶段专员', sort_order: 2, enabled: true },
  ];
  const { error: deptErr } = await client
    .from('department_config')
    .upsert(depts, { onConflict: 'dept_code' });
  if (deptErr) throw deptErr;
  console.log(`Seeded ${depts.length} 个部门`);

  const DEPT_A = '催收一组';
  const DEPT_B = '催收二组';
  const DEPT_C = '跨阶段专员';

  // ---------- 阶段配置（自定义业务阶段）----------
  const stages = [
    { stage_code: 'D0', stage_name: '早期催收', sort_order: 0, enabled: true },
    { stage_code: 'T1', stage_name: '中期催收', sort_order: 1, enabled: true },
    { stage_code: 'T2', stage_name: '后期催收', sort_order: 2, enabled: true },
  ];
  const { error: stageErr } = await client
    .from('stage_config')
    .upsert(stages, { onConflict: 'stage_code' });
  if (stageErr) throw stageErr;
  console.log(`Seeded ${stages.length} 个阶段`);

  const STAGE_EARLY = '早期催收';
  const STAGE_MID = '中期催收';
  const STAGE_LATE = '后期催收';

  // ---------- 员工 ----------
  const employees = [
    { employee_id: 'E001', employee_name: '员工A', department: DEPT_A, default_stage: STAGE_EARLY, commission_plan: 'A', status: 'active' },
    { employee_id: 'E002', employee_name: '员工B', department: DEPT_A, default_stage: STAGE_MID, commission_plan: 'A', status: 'active' },
    { employee_id: 'E003', employee_name: '员工C', department: DEPT_B, default_stage: STAGE_LATE, commission_plan: 'A', status: 'active' },
    { employee_id: 'E004', employee_name: '员工D', department: DEPT_B, default_stage: STAGE_MID, commission_plan: 'A', status: 'active' },
    { employee_id: 'E005', employee_name: '员工E', department: DEPT_C, default_stage: STAGE_EARLY, commission_plan: 'B', status: 'active' },
  ];
  await upsert(client, 'employee', employees, 'employee_id');

  // ---------- 员工-阶段关联（E005 跨三阶段，其余按主阶段）----------
  await client.from('employee_stage').delete().in('employee_id', employees.map((e) => e.employee_id));
  const empStageRows: {
    employee_id: string; stage_name: string; is_primary: boolean; sort_order: number;
  }[] = [];
  employees.forEach((e) => {
    empStageRows.push({ employee_id: e.employee_id, stage_name: e.default_stage, is_primary: true, sort_order: -1 });
  });
  empStageRows.push({ employee_id: 'E005', stage_name: STAGE_MID, is_primary: false, sort_order: 1 });
  empStageRows.push({ employee_id: 'E005', stage_name: STAGE_LATE, is_primary: false, sort_order: 2 });
  const { error: linkErr } = await client.from('employee_stage').insert(empStageRows);
  if (linkErr) throw linkErr;
  console.log(`Seeded ${empStageRows.length} 条员工阶段关联`);
  // ---------- 指标配置库 ----------
  const metrics: {
    metric_code: string; metric_name: string; scope: string; period: string; source_field: string; unit: string;
  }[] = [
    { metric_code: 'RATE', metric_name: '金额回款率', scope: 'BOTH', period: 'MONTHLY', source_field: 'monthly_recovery_rate', unit: '%' },
    { metric_code: 'ORDER_RATE', metric_name: '订单回收率', scope: 'PERF', period: 'MONTHLY', source_field: 'monthly_recovery_rate', unit: '%' },
    { metric_code: 'AMOUNT', metric_name: '月度回款金额', scope: 'BOTH', period: 'MONTHLY', source_field: 'monthly_total_amount', unit: '฿' },
    { metric_code: 'ORDERS', metric_name: '月度订单量', scope: 'BOTH', period: 'MONTHLY', source_field: 'monthly_recovered_orders', unit: '单' },
    { metric_code: 'DAILY_RATE', metric_name: '日达成率', scope: 'COMMISSION', period: 'DAILY', source_field: 'target_recovery_rate', unit: '%' },
    { metric_code: 'DAILY_ORDERS', metric_name: '日回收单数', scope: 'COMMISSION', period: 'DAILY', source_field: 'recovered_orders', unit: '单' },
    { metric_code: 'DAILY_AMOUNT', metric_name: '日回款金额', scope: 'COMMISSION', period: 'DAILY', source_field: 'recovered_amount', unit: '฿' },
  ];
  const { error: metricErr } = await client.from('metric_config').upsert(metrics, { onConflict: 'metric_code' });
  if (metricErr) throw metricErr;
  console.log(`Seeded ${metrics.length} 个指标配置`);

  // ---------- 绩效考核方案（按部门：一部门一份；整月判定、与阶段无关）----------
  const schemePlans: {
    dept_name: string;
    base_salary: number;
    performance_bonus: number;
    groups: { conditions: { metric: string; operator?: string; threshold_value: number }[] }[];
  }[] = [
    // 催收一组：底薪 8000 + 绩效 3000；组1【回款率≥40 且 订单≥600】或 组2【回款率≥45】
    {
      dept_name: DEPT_A, base_salary: 8000, performance_bonus: 3000,
      groups: [
        { conditions: [{ metric: 'RATE', threshold_value: 40 }, { metric: 'ORDERS', threshold_value: 600 }] },
        { conditions: [{ metric: 'RATE', operator: 'GTE', threshold_value: 45 }] },
      ],
    },
    // 催收二组：底薪 10000 + 绩效 3000；组【回款率≥45 或 回款金额≥7万】
    {
      dept_name: DEPT_B, base_salary: 10000, performance_bonus: 3000,
      groups: [
        { conditions: [{ metric: 'RATE', threshold_value: 45 }] },
        { conditions: [{ metric: 'AMOUNT', threshold_value: 70000 }] },
      ],
    },
    // 跨阶段专员：底薪 10000 + 绩效 3000；组【回款率≥45】（整月跨阶段汇总判定）
    {
      dept_name: DEPT_C, base_salary: 10000, performance_bonus: 3000,
      groups: [{ conditions: [{ metric: 'RATE', threshold_value: 45 }] }],
    },
  ];

  for (const p of schemePlans) {
    const { data, error } = await client
      .from('performance_scheme')
      .upsert(
        { dept_name: p.dept_name, base_salary: p.base_salary, performance_bonus: p.performance_bonus },
        { onConflict: 'dept_name' }
      )
      .select('scheme_id');
    if (error) throw error;
    const schemeId = (data?.[0] as { scheme_id: number }).scheme_id;
    // 删旧组（cascade 删条件）再重建
    await client.from('performance_condition_group').delete().eq('scheme_id', schemeId);
    for (let gi = 0; gi < p.groups.length; gi++) {
      const { data: gd, error: gerr } = await client
        .from('performance_condition_group')
        .insert({ scheme_id: schemeId, sort_order: gi })
        .select('group_id');
      if (gerr) throw gerr;
      const groupId = (gd?.[0] as { group_id: number }).group_id;
      const rows = p.groups[gi].conditions.map((c, ci) => ({
        group_id: groupId,
        metric: c.metric,
        operator: c.operator ?? 'GTE',
        threshold_value: c.threshold_value,
        sort_order: ci,
      }));
      const { error: condErr } = await client.from('performance_condition').insert(rows);
      if (condErr) throw condErr;
    }
  }
  console.log(`Seeded ${schemePlans.length} 部门绩效考核方案`);

  // ---------- 提成方案规则（带部门归属）----------
  const rules: {
    dept_name: string | null;
    stage_name: string;
    rule_type: string;
    metric: string | null;
    rule_name: string;
    tiers: { min: number; max: number | null; rt: string; v: number }[];
  }[] = [
    // 催收一组专属：早期催收 日达成率阶梯（单价/单）——用日度指标 DAILY_RATE
    {
      dept_name: DEPT_A, stage_name: STAGE_EARLY, rule_type: 'DAILY_STEP', metric: 'DAILY_RATE',
      rule_name: '催收一组·早期催收 日达成率阶梯',
      tiers: [
        { min: 0, max: 40, rt: 'UNIT_PRICE', v: 0 },
        { min: 40, max: 50, rt: 'UNIT_PRICE', v: 10 },
        { min: 50, max: null, rt: 'UNIT_PRICE', v: 20 },
      ],
    },
    // 全部门通用：中期催收 日回收单数阶梯——用日度指标 DAILY_ORDERS
    {
      dept_name: null, stage_name: STAGE_MID, rule_type: 'DAILY_STEP', metric: 'DAILY_ORDERS',
      rule_name: '中期催收 日回收单数阶梯（全部门通用）',
      tiers: [
        { min: 1, max: 3, rt: 'UNIT_PRICE', v: 10 },
        { min: 3, max: 5, rt: 'UNIT_PRICE', v: 20 },
        { min: 5, max: null, rt: 'UNIT_PRICE', v: 30 },
      ],
    },
    // 全部门通用：后期催收 日回款金额阶梯（固定奖金）——用日度指标 DAILY_AMOUNT
    {
      dept_name: null, stage_name: STAGE_LATE, rule_type: 'DAILY_STEP', metric: 'DAILY_AMOUNT',
      rule_name: '后期催收 日回款金额阶梯奖金（全部门通用）',
      tiers: [
        { min: 2000, max: 5000, rt: 'FIXED_AMOUNT', v: 50 },
        { min: 5000, max: 10000, rt: 'FIXED_AMOUNT', v: 100 },
        { min: 10000, max: null, rt: 'FIXED_AMOUNT', v: 200 },
      ],
    },

    // 方案 A：月度总回款提点（ALL 通用，全部门共享）
    {
      dept_name: null, stage_name: 'ALL', rule_type: 'MONTHLY_TOTAL_TIER', metric: null,
      rule_name: '月度总回款阶梯提点（全部门·ALL）',
      tiers: [
        { min: 0, max: 20000, rt: 'PERCENTAGE', v: 0 },
        { min: 20000, max: 30000, rt: 'PERCENTAGE', v: 0.05 },
        { min: 30000, max: 60000, rt: 'PERCENTAGE', v: 0.08 },
        { min: 60000, max: null, rt: 'PERCENTAGE', v: 0.12 },
      ],
    },

    // 方案 B：分阶段金额提点（全部门通用）
    {
      dept_name: null, stage_name: STAGE_EARLY, rule_type: 'STAGE_AMOUNT_TIER', metric: null,
      rule_name: '早期催收 分阶段金额提点',
      tiers: [
        { min: 0, max: 30000, rt: 'PERCENTAGE', v: 0.03 },
        { min: 30000, max: null, rt: 'PERCENTAGE', v: 0.06 },
      ],
    },
    {
      dept_name: null, stage_name: STAGE_MID, rule_type: 'STAGE_AMOUNT_TIER', metric: null,
      rule_name: '中期催收 分阶段金额提点',
      tiers: [
        { min: 0, max: 100000, rt: 'PERCENTAGE', v: 0.04 },
        { min: 100000, max: null, rt: 'PERCENTAGE', v: 0.08 },
      ],
    },
    {
      dept_name: null, stage_name: STAGE_LATE, rule_type: 'STAGE_AMOUNT_TIER', metric: null,
      rule_name: '后期催收 分阶段金额提点',
      tiers: [
        { min: 0, max: 50000, rt: 'PERCENTAGE', v: 0.05 },
        { min: 50000, max: null, rt: 'PERCENTAGE', v: 0.1 },
      ],
    },
  ];

  // 幂等：按 (dept_name, stage_name, rule_type, rule_name) 查已有
  const { data: existingRules } = await client
    .from('salary_rule_config')
    .select('rule_id, dept_name, stage_name, rule_type, rule_name');
  const existingMap = new Map<string, number>();
  (existingRules ?? []).forEach((r) => {
    const row = r as { rule_id: number; dept_name: string | null; stage_name: string; rule_type: string; rule_name: string };
    existingMap.set(`${row.dept_name ?? ''}|${row.stage_name}|${row.rule_type}|${row.rule_name}`, row.rule_id);
  });

  for (const r of rules) {
    const key = `${r.dept_name ?? ''}|${r.stage_name}|${r.rule_type}|${r.rule_name}`;
    let ruleId = existingMap.get(key);
    if (!ruleId) {
      const { data, error } = await client
        .from('salary_rule_config')
        .insert({
          dept_name: r.dept_name, stage_name: r.stage_name, rule_type: r.rule_type,
          metric: r.metric, rule_name: r.rule_name, enabled: true,
        })
        .select();
      if (error) throw error;
      ruleId = (data[0] as { rule_id: number }).rule_id;
    }
    await client.from('rule_tier_detail').delete().eq('rule_id', ruleId);
    const tierRows = r.tiers.map((t, i) => ({
      rule_id: ruleId,
      min_val: t.min, max_val: t.max, reward_type: t.rt, reward_value: t.v, sort_order: i,
    }));
    const { error: tierErr } = await client.from('rule_tier_detail').insert(tierRows);
    if (tierErr) throw tierErr;
  }

  // ---------- 每日数据（10 个工作日）----------
  const dates = ['01','02','03','06','07','08','09','10','13','14'].map((d) => `${MONTH}-${d}`);

  interface DailySeed {
    employee_id: string; stage: string; date: string;
    orders: number; amount: number; rate: number | null;
    totalOrders: number | null; totalAmount: number | null; amountRate: number | null;
  }
  const daily: DailySeed[] = [];

  // 催收一组·E001：早期催收，日达成率 38-52
  const aRate = [42, 45, 38, 48, 51, 44, 39, 47, 53, 41];
  dates.forEach((d, i) => daily.push({
    employee_id: 'E001', stage: STAGE_EARLY, date: d,
    orders: 10 + (i % 4), amount: 2500 + i * 300, rate: aRate[i],
    totalOrders: Math.round((10 + (i % 4)) / (aRate[i] / 100)),
    totalAmount: Math.round((2500 + i * 300) / ((aRate[i] + 8) / 100)),
    amountRate: aRate[i] + 8,
  }));

  // 催收一组·E002：中期催收，日单数 2-6
  const bOrders = [2, 4, 3, 5, 2, 6, 4, 3, 5, 4];
  dates.forEach((d, i) => daily.push({
    employee_id: 'E002', stage: STAGE_MID, date: d,
    orders: bOrders[i], amount: 6000 + i * 800, rate: null,
    totalOrders: null, totalAmount: null, amountRate: null,
  }));

  // 催收二组·E003：后期催收，日金额 1500-12000
  const cAmount = [1800, 3200, 5600, 2400, 8900, 11000, 4200, 6800, 2600, 9500];
  dates.forEach((d, i) => daily.push({
    employee_id: 'E003', stage: STAGE_LATE, date: d,
    orders: 2, amount: cAmount[i], rate: null,
    totalOrders: null, totalAmount: cAmount[i] * 1.4, amountRate: Math.round(100 / 1.4),
  }));

  // 催收二组·E004：中期催收，高回款
  dates.forEach((d, i) => daily.push({
    employee_id: 'E004', stage: STAGE_MID, date: d,
    orders: 5 + (i % 2), amount: 7000 + i * 200, rate: null,
    totalOrders: null, totalAmount: null, amountRate: null,
  }));

  // 跨阶段专员·E005：跨 早期/中期/后期（方案 B）
  dates.forEach((d, i) => {
    daily.push({
      employee_id: 'E005', stage: STAGE_EARLY, date: d,
      orders: 8, amount: 2000 + i * 150, rate: [35, 42, 46][i % 3],
      totalOrders: Math.round(8 / ([35, 42, 46][i % 3] / 100)),
      totalAmount: Math.round((2000 + i * 150) / 0.5), amountRate: 50,
    });
    daily.push({
      employee_id: 'E005', stage: STAGE_MID, date: d,
      orders: 3, amount: 5000 + i * 300, rate: null,
      totalOrders: null, totalAmount: null, amountRate: null,
    });
    if (i < 6) daily.push({
      employee_id: 'E005', stage: STAGE_LATE, date: d,
      orders: 1, amount: 3000 + i * 400, rate: null,
      totalOrders: null, totalAmount: null, amountRate: null,
    });
  });

  await client.from('import_daily_data').delete().eq('batch_no', 'SEED-2026-10');
  const dailyRows = daily.map((d) => ({
    batch_no: 'SEED-2026-10',
    employee_id: d.employee_id, stage: d.stage, date: d.date,
    recovered_orders: d.orders, recovered_amount: d.amount,
    target_recovery_rate: d.rate,
    total_orders: d.totalOrders, total_amount: d.totalAmount, amount_achievement_rate: d.amountRate,
  }));
  const { error: dailyErr } = await client.from('import_daily_data').upsert(dailyRows, { onConflict: 'employee_id,stage,date' });
  if (dailyErr) throw dailyErr;

  // ---------- 月度数据 ----------
  function sum(id: string, stage: string): number {
    return daily.filter((d) => d.employee_id === id && d.stage === stage).reduce((s, d) => s + d.amount, 0);
  }
  function sumOrders(id: string, stage: string): number {
    return daily.filter((d) => d.employee_id === id && d.stage === stage).reduce((s, d) => s + d.orders, 0);
  }
  const monthly = [
    { month: MONTH, employee_id: 'E001', stage: STAGE_EARLY, monthly_recovery_rate: 45, monthly_total_amount: sum('E001', STAGE_EARLY), monthly_recovered_orders: sumOrders('E001', STAGE_EARLY) },
    { month: MONTH, employee_id: 'E002', stage: STAGE_MID, monthly_recovery_rate: null, monthly_total_amount: sum('E002', STAGE_MID), monthly_recovered_orders: sumOrders('E002', STAGE_MID) },
    { month: MONTH, employee_id: 'E003', stage: STAGE_LATE, monthly_recovery_rate: null, monthly_total_amount: sum('E003', STAGE_LATE), monthly_recovered_orders: sumOrders('E003', STAGE_LATE) },
    { month: MONTH, employee_id: 'E004', stage: STAGE_MID, monthly_recovery_rate: null, monthly_total_amount: sum('E004', STAGE_MID), monthly_recovered_orders: sumOrders('E004', STAGE_MID) },
    { month: MONTH, employee_id: 'E005', stage: STAGE_EARLY, monthly_recovery_rate: 41, monthly_total_amount: sum('E005', STAGE_EARLY), monthly_recovered_orders: sumOrders('E005', STAGE_EARLY) },
    { month: MONTH, employee_id: 'E005', stage: STAGE_MID, monthly_recovery_rate: 52, monthly_total_amount: sum('E005', STAGE_MID), monthly_recovered_orders: sumOrders('E005', STAGE_MID) },
    { month: MONTH, employee_id: 'E005', stage: STAGE_LATE, monthly_recovery_rate: null, monthly_total_amount: sum('E005', STAGE_LATE), monthly_recovered_orders: sumOrders('E005', STAGE_LATE) },
  ];
  const { error: monthlyErr } = await client.from('import_monthly_data').upsert(monthly, { onConflict: 'month,employee_id,stage' });
  if (monthlyErr) throw monthlyErr;

  // ---------- 清理旧结算以便重算 ----------
  await client.from('salary_settlement_result').delete().eq('month', MONTH);
  await client.from('salary_rule_config').delete().in('rule_type', ['BASE_SALARY', 'MONTHLY_THRESHOLD']);

  console.log('Seed done.');
  console.log('daily rows:', dailyRows.length, 'monthly rows:', monthly.length);
}

async function upsert(
  client: ReturnType<typeof getSupabaseClient>,
  table: string,
  rows: Record<string, unknown>[],
  _conflict: string
): Promise<void> {
  const { error } = await client.from(table).upsert(rows);
  if (error) throw error;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
