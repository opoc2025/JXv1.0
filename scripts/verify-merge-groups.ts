// 临时验证脚本：多合并组功能端到端验证
// 运行：npx tsx scripts/verify-merge-groups.ts

import 'dotenv/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { calculateSalary, EngineInput } from '../src/lib/payroll-engine';
import type { Employee, StageGroup, DailyData, SalaryRuleWithTiers, MetricConfig, PerformanceScheme } from '../src/lib/types';

// --- Supabase client ---
function getClient(): SupabaseClient {
  const url = process.env.COZE_SUPABASE_URL!;
  const key = process.env.COZE_SUPABASE_SERVICE_ROLE_KEY || process.env.COZE_SUPABASE_ANON_KEY!;
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

const client = getClient();
const MONTH = '2026-09';

function section(title: string) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('='.repeat(60));
}

// ========================================================
async function main() {
  section('1) stage_group / stage_group_member / employee_stage_group 表数据');

  const { data: sg, error: sgErr } = await client
    .from('stage_group')
    .select('*')
    .order('group_id');
  if (sgErr) console.error('stage_group error:', sgErr.message);
  console.log(`  stage_group 共 ${sg?.length ?? 0} 行:`);
  (sg ?? []).forEach((r: any) => console.log('   ', JSON.stringify(r)));

  const { data: sgm, error: sgmErr } = await client
    .from('stage_group_member')
    .select('*')
    .order('group_id');
  if (sgmErr) console.error('stage_group_member error:', sgmErr.message);
  console.log(`\n  stage_group_member 共 ${sgm?.length ?? 0} 行:`);
  (sgm ?? []).forEach((r: any) => console.log('   ', JSON.stringify(r)));

  const { data: esg, error: esgErr } = await client
    .from('employee_stage_group')
    .select('*');
  if (esgErr) console.error('employee_stage_group error:', esgErr.message);
  console.log(`\n  employee_stage_group 共 ${esg?.length ?? 0} 行:`);
  (esg ?? []).forEach((r: any) => console.log('   ', JSON.stringify(r)));

  // ========================================================
  section('2) 所有员工的 merge_group_ids');

  const { data: allEmps, error: empErr } = await client
    .from('employee')
    .select('employee_id, employee_name, department, default_stage, commission_plan, stage_group_id');
  if (empErr) { console.error('employee error:', empErr.message); return; }

  const { data: allEsg, error: esgErr2 } = await client
    .from('employee_stage_group')
    .select('employee_id, group_id');
  if (esgErr2) console.error('esg error:', esgErr2.message);

  const mergeMap = new Map<string, number[]>();
  (allEsg ?? []).forEach((r: any) => {
    const list = mergeMap.get(r.employee_id) ?? [];
    list.push(r.group_id);
    mergeMap.set(r.employee_id, list);
  });

  console.log(`  员工列表 (${allEmps?.length ?? 0} 人, 仅列出有 legacy stage_group_id 或 merge_group_ids 的):`);
  (allEmps ?? []).forEach((e: any) => {
    const mergeGroupIds = mergeMap.get(e.employee_id) ?? [];
    const legacySgid = e.stage_group_id;
    if (legacySgid != null || mergeGroupIds.length > 0) {
      console.log(`   ${e.employee_id} (${e.employee_name}) dept=${e.department} default=${e.default_stage} | legacy stage_group_id=${legacySgid} | merge_group_ids=[${mergeGroupIds.join(',')}]`);
    }
  });

  // ========================================================
  section('3) Namkhing 员工的完整配置（阶段+合并组关联）');

  const namkhing: any | undefined = (allEmps ?? []).find((e: any) =>
    (e.employee_name ?? '').toLowerCase().includes('namkhing')
  );

  // 外层变量，跨 section 共享
  let empStages: any[] = [];
  let namkhingGroupIds: number[] = [];
  let groupDetails: any[] = [];
  let scheme: any[] = [];
  let fullStageGroups: StageGroup[] = [];

  if (!namkhing) {
    console.log('  未找到 Namkhing 员工');
    return;
  }

  console.log('  员工档案:', JSON.stringify(namkhing));

  // 员工参与阶段
  const { data: empStagesRaw } = await client
    .from('employee_stage')
    .select('stage_name, is_primary, sort_order')
    .eq('employee_id', namkhing.employee_id)
    .order('sort_order');
  empStages = empStagesRaw ?? [];
  console.log(`  参与阶段 (${empStages.length}):`);
  empStages.forEach((r) => console.log('   ', JSON.stringify(r)));

  // 合并组关联
  namkhingGroupIds = mergeMap.get(namkhing.employee_id) ?? [];
  console.log(`\n  merge_group_ids (from employee_stage_group): [${namkhingGroupIds.join(',')}]`);
  console.log(`  legacy stage_group_id: ${namkhing.stage_group_id}`);

  // 同时查询所有合并组（引擎需要完整 stageGroups 数组）
  const { data: allGroupDetails } = await client
    .from('stage_group')
    .select('*, stage_group_member(stage_name)')
    .order('group_id');
  fullStageGroups = (allGroupDetails ?? []).map((g: any) => ({
    group_id: g.group_id,
    group_name: g.group_name,
    description: g.description,
    enabled: g.enabled,
    stage_names: (g.stage_group_member ?? []).map((m: any) => m.stage_name),
  }));
  console.log(`\n  所有合并组:`);
  fullStageGroups.forEach(g => console.log(`   group_id=${g.group_id} name=${g.group_name} stages=[${g.stage_names.join(', ')}]`));

  // 过滤出 Namkhing 关联的（新+旧）
  const allIds = [...new Set([...namkhingGroupIds, ...(namkhing.stage_group_id ? [namkhing.stage_group_id] : [])])];
  groupDetails = allGroupDetails ? allGroupDetails.filter((g: any) => allIds.includes(g.group_id)) : [];
  console.log(`\n  Namkhing 关联的合并组 (新+旧 fallback) [${allIds.join(',')}]:`);
  groupDetails.forEach((g: any) => {
    const stageNames = (g.stage_group_member ?? []).map((m: any) => m.stage_name);
    console.log(`   group_id=${g.group_id} name=${g.group_name} stages=[${stageNames.join(', ')}]`);
  });

  // 部门绩效考核方案
  const { data: schemeRaw } = await client
    .from('performance_scheme')
    .select('*, performance_condition_group(sort_order, performance_condition(metric, operator, threshold_value, sort_order))')
    .eq('dept_name', namkhing.department);
  scheme = schemeRaw ?? [];
  console.log(`\n  部门绩效考核方案:`);
  console.log('   ', JSON.stringify(scheme, null, 2));

  // 2026-09 日数据（前10天预览）
  const { data: dailyPreview } = await client
    .from('import_daily_data')
    .select('date,stage,recovered_orders,recovered_amount,target_recovery_rate')
    .eq('employee_id', namkhing.employee_id)
    .gte('date', `${MONTH}-01`)
    .lt('date', `${MONTH}-10`)
    .order('date');
  console.log(`\n  2026-09 日数据预览 (前10天 ${dailyPreview?.length ?? 0} 行):`);
  (dailyPreview ?? []).forEach((r: any) => console.log('   ', JSON.stringify(r)));

  // ========================================================
  section('4) stage_groups API 返回（模拟 API 逻辑查询）');

  const { data: apiData, error: apiErr } = await client
    .from('stage_group')
    .select('group_id,group_name,description,sort_order,enabled,created_at,stage_group_member(stage_name)')
    .order('sort_order')
    .order('group_name');
  if (apiErr) console.error('api stage_group error:', apiErr.message);
  const apiGroups = (apiData ?? []).map((g: any) => ({
    ...g,
    stage_names: (g.stage_group_member ?? []).map((m: any) => m.stage_name),
  }));
  console.log(`  API 返回 ${apiGroups.length} 个合并组:`);
  apiGroups.forEach((g: any) => console.log('   ', JSON.stringify({
    group_id: g.group_id,
    group_name: g.group_name,
    stage_names: g.stage_names,
  })));

  // ========================================================
  section('5) 直接调用 calculateSalary 引擎（Namkhing, 2026-09）');

  // 构建 Employee 对象
  const stagesList: Employee['stages'] = empStages.map((s) => ({
    employee_id: namkhing.employee_id,
    stage_name: s.stage_name,
    is_primary: s.is_primary,
    sort_order: s.sort_order,
  }));

  // 先取一次日数据（三个场景共用）
  const allDaily = await dailyRowsOf(namkhing.employee_id, MONTH);

  // 场景A: 只有 legacy stage_group_id=1（真实当前 DB 状态）
  console.log('\n  ---- 场景A: 只有 legacy stage_group_id=1（merge_group_ids 未注入）----');
  {
    const empA: Employee = {
      employee_id: namkhing.employee_id,
      employee_name: namkhing.employee_name,
      department: namkhing.department,
      default_stage: namkhing.default_stage,
      commission_plan: namkhing.commission_plan,
      has_daily_commission: true,
      stage_group_id: namkhing.stage_group_id,
      status: namkhing.status ?? 'active',
      stages: stagesList,
    };
    await runEngineWith(empA, fullStageGroups, scheme, allDaily, '场景A');
  }

  // 场景B: 注入 merge_group_ids=[]（空数组，测试引擎是否 fallback）
  console.log('\n  ---- 场景B: 注入 merge_group_ids=[]（空数组）----');
  {
    const empB: any = {
      employee_id: namkhing.employee_id,
      employee_name: namkhing.employee_name,
      department: namkhing.department,
      default_stage: namkhing.default_stage,
      commission_plan: namkhing.commission_plan,
      has_daily_commission: true,
      stage_group_id: namkhing.stage_group_id,
      status: namkhing.status ?? 'active',
      stages: stagesList,
      merge_group_ids: [] as number[],
    };
    await runEngineWith(empB, fullStageGroups, scheme, allDaily, '场景B');
  }

  // 场景C: 注入 merge_group_ids=[1]（显式用 T2组）
  console.log('\n  ---- 场景C: 注入 merge_group_ids=[1]（T2组，含逾4-7+逾8-15+逾16-30）----');
  {
    const empC: any = {
      employee_id: namkhing.employee_id,
      employee_name: namkhing.employee_name,
      department: namkhing.department,
      default_stage: namkhing.default_stage,
      commission_plan: namkhing.commission_plan,
      has_daily_commission: true,
      stage_group_id: namkhing.stage_group_id,
      status: namkhing.status ?? 'active',
      stages: stagesList,
      merge_group_ids: [1],
    };
    await runEngineWith(empC, fullStageGroups, scheme, allDaily, '场景C');
  }

  section('完成');
}

// --- 辅助：取某员工某月的全部日数据 ---
async function dailyRowsOf(empId: string, month: string): Promise<DailyData[]> {
  const { data } = await client
    .from('import_daily_data')
    .select('*')
    .eq('employee_id', empId)
    .gte('date', `${month}-01`)
    .lt('date', nextMonth(month));
  return (data ?? []).map((r: any) => ({
    id: r.id,
    batch_no: r.batch_no,
    employee_id: r.employee_id,
    stage: r.stage,
    date: r.date,
    recovered_orders: Number(r.recovered_orders) || 0,
    recovered_amount: Number(r.recovered_amount) || 0,
    target_recovery_rate: r.target_recovery_rate != null ? Number(r.target_recovery_rate) : null,
    total_orders: r.total_orders != null ? Number(r.total_orders) : null,
    total_amount: r.total_amount != null ? Number(r.total_amount) : null,
    amount_achievement_rate: r.amount_achievement_rate != null ? Number(r.amount_achievement_rate) : null,
  }));
}

function nextMonth(m: string): string {
  const [y, mo] = m.split('-').map(Number);
  const next = mo === 12 ? { y: y + 1, mo: 1 } : { y, mo: mo + 1 };
  return `${next.y}-${String(next.mo).padStart(2, '0')}`;
}

// --- 辅助：用给定员工对象跑引擎并打印 VirtualStage 构建 ---
async function runEngineWith(
  emp: Employee,
  stageGroups: StageGroup[],
  schemeRaw: any[],
  dailyRows: DailyData[],
  label: string
) {
  // 构建规则/指标/绩效考核方案
  const { data: rulesRaw } = await client.from('salary_rule_config').select('*');
  const { data: tiersRaw } = await client.from('rule_tier_detail').select('*');
  const { data: metricsRaw } = await client.from('metric_config').select('*');

  const rules: SalaryRuleWithTiers[] = (rulesRaw ?? []).map((r: any) => ({
    ...r,
    tiers: (tiersRaw ?? []).filter((t: any) => t.rule_id === r.rule_id).sort((a: any, b: any) => a.sort_order - b.sort_order),
  }));
  const metrics: MetricConfig[] = (metricsRaw ?? []) as any[];
  const perfScheme: PerformanceScheme | null = schemeRaw && schemeRaw.length > 0 ? {
    scheme_id: schemeRaw[0].scheme_id,
    dept_name: schemeRaw[0].dept_name,
    base_salary: Number(schemeRaw[0].base_salary),
    performance_bonus: Number(schemeRaw[0].performance_bonus),
    groups: (schemeRaw[0].performance_condition_group ?? []).map((g: any) => ({
      group_id: g.group_id,
      scheme_id: g.scheme_id,
      sort_order: g.sort_order,
      conditions: (g.performance_condition ?? []).map((c: any) => ({
        condition_id: c.condition_id,
        group_id: c.group_id,
        metric: c.metric,
        operator: c.operator,
        threshold_value: Number(c.threshold_value),
        sort_order: c.sort_order,
      })),
    })),
  } : null;

  // 手动打印引擎的 mergeGroupIds 解析逻辑
  const anyEmp = emp as any;
  let engineMergeGroupIds: number[] = [];
  if (anyEmp.merge_group_ids && Array.isArray(anyEmp.merge_group_ids)) {
    engineMergeGroupIds = anyEmp.merge_group_ids;
    console.log(`  引擎读取 merge_group_ids = [${engineMergeGroupIds.join(',')}]`);
    // 关键检查：空数组会怎么样？
    if (engineMergeGroupIds.length === 0) {
      console.log(`  ⚠️  merge_group_ids 是空数组，但 Array.isArray=TRUE，引擎不会 fallback 到 legacy stage_group_id`);
    }
  } else if (emp.stage_group_id) {
    engineMergeGroupIds = [emp.stage_group_id];
    console.log(`  引擎 fallback 到 legacy stage_group_id = [${engineMergeGroupIds.join(',')}]`);
  } else {
    console.log(`  引擎: 无 merge_group_ids 也无 legacy stage_group_id → 无合并组`);
  }

  const input: EngineInput = {
    employee: emp,
    month: MONTH,
    scheme: perfScheme,
    rules,
    dailyRows,
    metrics,
    stageGroups,
  };

  const result = calculateSalary(input);

  // VirtualStage 构建打印
  const mergeGroups = engineMergeGroupIds
    .map((id) => stageGroups.find((g) => g.group_id === id))
    .filter(Boolean) as StageGroup[];
  const mergedStageNames = new Set<string>();
  mergeGroups.forEach((g) => g.stage_names.forEach((s) => mergedStageNames.add(s)));

  const stageSet = new Set<string>();
  (emp.stages ?? []).forEach((s) => stageSet.add(s.stage_name));
  dailyRows.forEach((d) => stageSet.add(d.stage));

  const virtualStages: { label: string; display: string; sources: string[]; merged: boolean }[] = [];
  for (const g of mergeGroups) {
    virtualStages.push({ label: g.group_name, display: g.stage_names.join('+'), sources: g.stage_names, merged: true });
  }
  for (const s of [...stageSet].sort()) {
    if (!mergedStageNames.has(s)) {
      virtualStages.push({ label: s, display: s, sources: [s], merged: false });
    }
  }

  console.log(`\n  [${label}] VirtualStages:`);
  virtualStages.forEach((vs, i) => {
    console.log(`    VS[${i}]: label="${vs.label}" display="${vs.display}" merged=${vs.merged} sources=[${vs.sources.join(', ')}]`);
  });

  const stages = result.detail?.stages ?? [];
  console.log(`  [${label}] Settlement.stages (${stages.length}):`);
  stages.forEach((s, i) => {
    const tier = s.stage_commission;
    console.log(`    STAGE[${i}]: "${s.stage}" daily=${s.daily_commission} tier=${tier.commission}(${tier.rule_name})`);
  });

  console.log(`  [${label}] 总工资: ${result.total_salary} (底薪=${result.base_salary} 绩效=${result.monthly_performance_bonus} 日提=${result.daily_commission} A=${result.monthly_total_commission} B=${result.stage_tier_commission})`);

  // 验证
  const expectedCount = mergeGroups.length + [...stageSet].filter(s => !mergedStageNames.has(s)).length;
  if (stages.length === expectedCount) {
    console.log(`  ✅ VS 数量匹配: ${stages.length} == ${expectedCount}`);
  } else {
    console.log(`  ❌ VS 数量不匹配: ${stages.length} != ${expectedCount}`);
  }
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
