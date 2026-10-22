import type {
  CompareOp,
  DailyData,
  DailyRuleHit,
  Employee,
  MetricConfig,
  MonthlyData,
  PerformanceCondition,
  PerformanceScheme,
  RuleTier,
  SalaryRuleWithTiers,
  Settlement,
  SettlementDetail,
  StageGroup,
  StageSettlement,
} from './types';

// 比较符判定
export function compareOp(value: number, operator: CompareOp | null | undefined, threshold: number): boolean {
  switch (operator) {
    case 'LTE': return value <= threshold;
    case 'GT': return value > threshold;
    case 'LT': return value < threshold;
    case 'GTE':
    default: return value >= threshold;
  }
}

/**
 * 从日运营数据自动汇总月度数据（按员工 + 阶段分组）
 * - monthly_total_amount = SUM(recovered_amount)
 * - monthly_recovered_orders = SUM(recovered_orders)
 * - monthly_recovery_rate = 加权平均：SUM(recovered_amount) / SUM(total_amount) * 100
 *   （没有 total_amount 时用 recovered_amount 近似，全空则 null）
 */
export function aggregateDailyToMonthly(
  dailyRows: DailyData[]
): MonthlyData[] {
  const byKey = new Map<string, {
    employee_id: string;
    stage: string;
    amount: number;
    orders: number;
    targetAmount: number; // 加权分母
  }>();

  for (const d of dailyRows) {
    const key = `${d.employee_id}__${d.stage}`;
    const cur = byKey.get(key) ?? {
      employee_id: d.employee_id,
      stage: d.stage,
      amount: 0,
      orders: 0,
      targetAmount: 0,
    };
    cur.amount += Number(d.recovered_amount) || 0;
    cur.orders += Number(d.recovered_orders) || 0;
    // total_amount 优先，没有的话用 recovered_amount 做近似权重
    cur.targetAmount += Number(d.total_amount) || Number(d.recovered_amount) || 0;
    byKey.set(key, cur);
  }

  return [...byKey.values()].map((r) => {
    let rate: number | null = null;
    if (r.targetAmount > 0) {
      rate = round2((r.amount / r.targetAmount) * 100);
    }
    return {
      month: '', // 调用方会填
      employee_id: r.employee_id,
      stage: r.stage,
      monthly_total_amount: round2(r.amount),
      monthly_recovered_orders: r.orders,
      monthly_recovery_rate: rate,
    } as MonthlyData;
  });
}

// 从月度 / 日度行解析任意指标（按指标库 source_field）
// 当 forceRow 指定时，优先使用（DAILY_STEP 场景强制取日数据）
function metricValueOf(
  metric: MetricConfig | undefined,
  monthlyRow: MonthlyData | undefined,
  dailyRow: DailyData | undefined,
  forceRow?: 'DAILY' | 'MONTHLY'
): number | null {
  if (!metric || !metric.source_field) return null;
  const row = forceRow
    ? forceRow === 'DAILY' ? dailyRow : monthlyRow
    : metric.period === 'DAILY' ? dailyRow : monthlyRow;
  if (!row) return null;
  const raw = (row as any)[metric.source_field];
  if (raw === null || raw === undefined) return null;
  let v = Number(raw);
  if (Number.isNaN(v)) return null;
  // 百分比单位智能转换：如果指标 unit='%' 且值在 0~1.5 区间（小数形式的百分比），自动 ×100
  if (metric.unit === '%' && v > 0 && v <= 1.5) {
    v = round2(v * 100);
  }
  return v;
}

// 旧指标编码兜底（无指标库定义时）：RATE/AMOUNT/ORDERS → 月度维度
function legacyMonthlyMetric(metric: string | null | undefined, row: MonthlyData | undefined): number | null {
  if (!row) return null;
  let v: number | null = null;
  if (metric === 'AMOUNT') v = row.monthly_total_amount;
  else if (metric === 'ORDERS') v = row.monthly_recovered_orders;
  else if (metric === 'RATE') v = row.monthly_recovery_rate;
  else return null;
  if (v === null || v === undefined || Number.isNaN(Number(v))) return null;
  v = Number(v);
  // RATE 值 0~1.5 → 自动 ×100 转百分比
  if (metric === 'RATE' && v > 0 && v <= 1.5) v = round2(v * 100);
  return v;
}

// 旧指标编码兜底（无指标库定义时）：RATE/AMOUNT/ORDERS → 日维度
function legacyDailyMetric(metric: string | null | undefined, day: DailyData | undefined): number | null {
  if (!day) return null;
  let v: number | null = null;
  if (metric === 'AMOUNT') v = day.recovered_amount;
  else if (metric === 'ORDERS') v = day.recovered_orders;
  else if (metric === 'RATE') v = day.target_recovery_rate;
  else return null;
  if (v === null || v === undefined || Number.isNaN(Number(v))) return null;
  v = Number(v);
  if (metric === 'RATE' && v > 0 && v <= 1.5) v = round2(v * 100);
  return v;
}

// 从任意月度行读取某指标的原生值（按指标库 source_field，旧编码兜底）
function rawMonthlyMetric(metricMeta: MetricConfig | undefined, metric: string, row: MonthlyData): number | null {
  const v = metricMeta?.source_field
    ? (row as any)[metricMeta.source_field]
    : legacyMonthlyMetric(metric, row);
  return v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v);
}

// 判断指标是否为比率类（用于跨阶段聚合时按金额加权平均而非直接求和）
function isRateMetric(metricMeta: MetricConfig | undefined, metric: string): boolean {
  if (metricMeta) {
    if (metricMeta.unit === '%') return true;
    const sf = metricMeta.source_field || '';
    if (sf.includes('rate')) return true;
  }
  return metric === 'RATE';
}

// 跨阶段聚合月度指标值（绩效考核：以员工所属的全部阶段汇总）
// - 比率类：按各阶段月度金额加权平均（无金额则简单平均）
// - 金额/订单类：全部阶段求和
function metricValueAcrossStages(
  metricMeta: MetricConfig | undefined,
  metric: string,
  rows: MonthlyData[]
): number | null {
  if (!rows || rows.length === 0) return null;
  if (isRateMetric(metricMeta, metric)) {
    let numerator = 0;
    let weightSum = 0;
    let count = 0;
    for (const r of rows) {
      const v = rawMonthlyMetric(metricMeta, metric, r);
      if (v === null) continue;
      const w = r.monthly_total_amount ? Number(r.monthly_total_amount) : 0;
      numerator += v * (w || 1);
      weightSum += w || 1;
      count++;
    }
    return count > 0 ? round2(numerator / weightSum) : null;
  }
  let sum = 0;
  let count = 0;
  for (const r of rows) {
    const v = rawMonthlyMetric(metricMeta, metric, r);
    if (v === null) continue;
    sum += v;
    count++;
  }
  return count > 0 ? round2(sum) : null;
}

// 泰铢精度：四舍五入到两位小数
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function tierMatch(tier: RuleTier, value: number): boolean {
  if (value < tier.min_val) return false;
  if (tier.max_val !== null && value >= tier.max_val) return false;
  return true;
}

function findTier(tiers: RuleTier[], value: number): RuleTier | null {
  const sorted = [...tiers].sort((a, b) => a.sort_order - b.sort_order || a.min_val - b.min_val);
  return sorted.find((t) => tierMatch(t, value)) ?? null;
}

function rangeText(tier: RuleTier | null): string {
  if (!tier) return '无匹配阶梯';
  const max = tier.max_val === null ? '∞' : tier.max_val.toString();
  return `[${tier.min_val}, ${max})`;
}

/**
 * 超额累进计算
 * 每个阶梯只对 [min_val, max_val) 区间内的金额部分 × 提成比例
 * 最低档 min_val = 基本任务门槛，低于门槛的部分不提
 */
function progressiveCalculate(
  tiers: RuleTier[],
  totalAmount: number
): {
  commission: number;
  breakdown: {
    min: number;
    max: number | null;
    portion: number;
    percentage: number;
    commission: number;
    range_text: string;
  }[];
} {
  const sorted = [...tiers].sort((a, b) => a.min_val - b.min_val);
  let totalCommission = 0;
  const breakdown: {
    min: number; max: number | null; portion: number;
    percentage: number; commission: number; range_text: string;
  }[] = [];

  for (const tier of sorted) {
    const pct = tier.reward_type === 'PERCENTAGE' ? tier.reward_value : 0;
    const max = tier.max_val === null ? Infinity : tier.max_val;
    // 该区间实际参与累进的金额 = [min_val, min(totalAmount, max)) 的长度
    const portion = totalAmount <= tier.min_val
      ? 0
      : Math.min(totalAmount, max) - tier.min_val;
    const commission = round2(portion * pct);
    totalCommission += commission;
    breakdown.push({
      min: tier.min_val,
      max: tier.max_val,
      portion,
      percentage: pct,
      commission,
      range_text: rangeText(tier),
    });
  }

  return { commission: round2(totalCommission), breakdown };
}

function rulesFor(
  rules: SalaryRuleWithTiers[],
  deptName: string | null | undefined,
  stage: string,
  type: SalaryRuleWithTiers['rule_type']
): SalaryRuleWithTiers[] {
  const enabled = rules.filter((r) => r.enabled && r.rule_type === type);
  // 优先级 1: 部门精确 + 阶段精确
  const dExactSExact = enabled.filter((r) => (r.dept_name ?? null) === (deptName ?? null) && r.stage_name === stage);
  if (dExactSExact.length > 0) return dExactSExact;
  // 优先级 2: 部门精确 + ALL 阶段
  const dExactSAll = enabled.filter((r) => (r.dept_name ?? null) === (deptName ?? null) && r.stage_name === 'ALL');
  if (dExactSAll.length > 0) return dExactSAll;
  // 优先级 3: 无部门 + 阶段精确
  const dNullSExact = enabled.filter((r) => !r.dept_name && r.stage_name === stage);
  if (dNullSExact.length > 0) return dNullSExact;
  // 优先级 4（兜底）: 无部门 + ALL
  return enabled.filter((r) => !r.dept_name && r.stage_name === 'ALL');
}

export interface EngineInput {
  employee: Employee;
  month: string;
  scheme: PerformanceScheme | null; // 绩效考核方案（可选，缺失则底薪/绩效为 0）
  rules: SalaryRuleWithTiers[];
  dailyRows: DailyData[]; // 日运营数据（引擎自动汇总出月度数据）
  metrics: MetricConfig[]; // 指标库（考核条件/提成解析用）
  stageGroups?: StageGroup[]; // 全局阶段合并组定义（可选）
  adjustment?: { // 薪酬调整（可选，导入覆盖用）
    actual_base_salary: number;
    full_attendance_bonus: number;
  } | null;
}

export function calculateSalary(input: EngineInput): Settlement {
  const { employee, month, scheme, rules, dailyRows, metrics, stageGroups, adjustment } = input;
  // 自动从日数据汇总月度数据（不再需要单独导入 import_monthly_data）
  const monthlyRows = aggregateDailyToMonthly(
    dailyRows.filter((d) => d.employee_id === employee.employee_id)
  ).map((r) => ({ ...r, month }));
  const defaultStage = employee.default_stage;
  const deptName = employee.department ?? null;
  const metricByCode = new Map<string, MetricConfig>((metrics || []).map((m) => [m.metric_code, m]));

  // 绩效考核方案：整月判定、与阶段无关（去掉 employee_stage 过滤）
  // 直接对该员工该月的全部月度行聚合（金额类求和、比率类按金额加权）
  const perfRows = monthlyRows;
  const opLabel: Record<string, string> = { GTE: '≥', LTE: '≤', GT: '>', LT: '<' };

  // ---- 1&2. 绩效考核方案：基本工资 + 绩效工资（多条件组：组内 AND、组间 OR）----
  let baseSalary = 0;
  let performanceBonus = 0;
  let schemeDetail: SettlementDetail['scheme'] = {
    base_salary: 0,
    actual_base_salary: 0,
    full_attendance_bonus: 0,
    performance_bonus: 0,
    groups: [],
    passed: false,
    bonus: 0,
  };
  if (scheme) {
    const groups: SettlementDetail['scheme']['groups'] = (scheme.groups || [])
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((g) => {
        const grp = g.conditions
          .slice()
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((c: PerformanceCondition) => {
            const metricMeta = metricByCode.get(c.metric);
            // 绩效实际值：跨员工全部参与阶段汇总（比率加权 / 金额与订单求和）
            const metricValue = metricMeta
              ? metricValueAcrossStages(metricMeta, c.metric, perfRows)
              : metricValueAcrossStages(undefined, c.metric, perfRows);
            const op = c.operator || 'GTE';
            return {
              metric: c.metric,
              operator: op,
              threshold_value: c.threshold_value,
              metric_value: metricValue,
              passed: metricValue !== null && compareOp(metricValue, op, Number(c.threshold_value)),
              range_text: `${opLabel[op] ?? '≥'} ${c.threshold_value}`,
            };
          });
        // 组内 AND：全部满足才达标；无条件的组视为不达标
        return {
          sort_order: g.sort_order,
          conditions: grp,
          passed: grp.length > 0 && grp.every((c) => c.passed),
        };
      });
    // 组间 OR：任一组达标即整体达标
    const passed = groups.length > 0 && groups.some((g) => g.passed);
    const bonus = passed ? round2(scheme.performance_bonus) : 0;
    baseSalary = round2(scheme.base_salary);
    performanceBonus = bonus;
    schemeDetail = {
      dept_name: deptName ?? undefined,
      base_salary: baseSalary,
      actual_base_salary: baseSalary,
      full_attendance_bonus: 0,
      performance_bonus: round2(scheme.performance_bonus),
      groups,
      passed,
      bonus,
    };
  }

  // ---- 薪酬调整覆盖（实发底薪 + 全勤奖） ----
  let actualBaseSalary = baseSalary;
  let fullAttendanceBonus = 0;
  if (adjustment) {
    actualBaseSalary = round2(adjustment.actual_base_salary);
    fullAttendanceBonus = round2(adjustment.full_attendance_bonus);
  }
  // schemeDetail 里也补 actual_base + full_attendance
  if (schemeDetail) {
    schemeDetail.actual_base_salary = actualBaseSalary;
    schemeDetail.full_attendance_bonus = fullAttendanceBonus;
  }

  // ---- 阶段集合 ----
  const stageSet = new Set<string>();
  const configuredStages =
    employee.stages && employee.stages.length > 0
      ? employee.stages
          .slice()
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((s) => s.stage_name)
      : [defaultStage];
  configuredStages.forEach((s) => stageSet.add(s));
  monthlyRows.forEach((r) => stageSet.add(r.stage));
  dailyRows.forEach((r) => stageSet.add(r.stage));
  if (stageSet.size === 0) stageSet.add(defaultStage);

  // ---- 合并组映射（支持多个合并组）----
  // 优先读 Employee.merge_group_ids（新，非空数组），fallback 到 stage_group_id（旧，向后兼容）
  let mergeGroupIds: number[] = [];
  if (Array.isArray((employee as any).merge_group_ids) && (employee as any).merge_group_ids.length > 0) {
    mergeGroupIds = (employee as any).merge_group_ids;
  } else if (employee.stage_group_id) {
    mergeGroupIds = [employee.stage_group_id];
  }
  const mergeGroups = mergeGroupIds
    .map((id) => stageGroups?.find((g) => g.group_id === id))
    .filter(Boolean) as StageGroup[];
  // 所有合并组覆盖的阶段名集合
  const mergedStageNames = new Set<string>();
  mergeGroups.forEach((g) => g.stage_names.forEach((s) => mergedStageNames.add(s)));

  // ---- 构建"虚拟阶段"列表 ----
  // 每个合并组 = 一个虚拟阶段；没在任何合并组里的阶段 = 独立虚拟阶段
  interface VirtualStage {
    label: string;       // 规则匹配用的 stage_name（合并组用组名，独立用阶段名）
    display: string;     // 展示用（合并组显示 "逾4-7+逾8-15"，独立显示阶段名）
    sourceStages: string[]; // 原始阶段集合
    isMerged: boolean;
  }

  const virtualStages: VirtualStage[] = [];
  for (const g of mergeGroups) {
    virtualStages.push({
      label: g.group_name,
      display: g.stage_names.join('+'),
      sourceStages: g.stage_names,
      isMerged: true,
    });
  }
  // 剩下的独立阶段（不在任何合并组里的）
  for (const s of [...stageSet].sort()) {
    if (!mergedStageNames.has(s)) {
      virtualStages.push({ label: s, display: s, sourceStages: [s], isMerged: false });
    }
  }

  const stageResults: StageSettlement[] = [];

  for (const vs of virtualStages) {
    // 合并组 → 汇总组内所有阶段的日/月数据
    let monthRow: MonthlyData | null = null;
    if (vs.isMerged) {
      // 汇总所有源阶段的月数据
      const srcMonthly = monthlyRows.filter((r) => vs.sourceStages.includes(r.stage));
      const totalAmount = srcMonthly.reduce((s, r) => s + (r.monthly_total_amount ?? 0), 0);
      const totalOrders = srcMonthly.reduce((s, r) => s + r.monthly_recovered_orders, 0);
      const totalBase = srcMonthly.reduce((s, r) => s + (r.monthly_recovery_rate ?? 0) * (r.monthly_total_amount ?? 0), 0);
      const weightedRate = totalAmount > 0 ? round2(totalBase / totalAmount) : null;
      monthRow = {
        month,
        employee_id: employee.employee_id,
        stage: vs.label,
        monthly_total_amount: round2(totalAmount),
        monthly_recovered_orders: totalOrders,
        monthly_recovery_rate: weightedRate,
      };
    } else {
      monthRow = monthlyRows.find((r) => r.stage === vs.label) ?? null;
    }

    // 日数据：合并组 → 按日期汇总
    let days: DailyData[];
    if (vs.isMerged) {
      const srcDays = dailyRows.filter((d) => vs.sourceStages.includes(d.stage));
      // 按 date 合并
      const byDate = new Map<string, DailyData>();
      for (const d of srcDays) {
        const existing = byDate.get(d.date);
        if (existing) {
          existing.recovered_orders += d.recovered_orders;
          existing.recovered_amount = round2(existing.recovered_amount + d.recovered_amount);
          // 比率类指标：用户说"直接加"
          if (d.target_recovery_rate != null) {
            existing.target_recovery_rate = round2((existing.target_recovery_rate ?? 0) + d.target_recovery_rate);
          }
          if (d.amount_achievement_rate != null) {
            existing.amount_achievement_rate = round2((existing.amount_achievement_rate ?? 0) + d.amount_achievement_rate);
          }
          if (d.total_orders != null) existing.total_orders = (existing.total_orders ?? 0) + d.total_orders;
          if (d.total_amount != null) existing.total_amount = round2((existing.total_amount ?? 0) + d.total_amount);
        } else {
          byDate.set(d.date, { ...d, stage: vs.label });
        }
      }
      days = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
    } else {
      days = dailyRows
        .filter((d) => d.stage === vs.label)
        .sort((a, b) => a.date.localeCompare(b.date));
    }

    // ---- 提成·日达成阶梯（独立开关：员工可选择是否参与）----
    const hasDailyCommission = employee.has_daily_commission !== false; // 默认 true（向后兼容）
    const dailyRules = hasDailyCommission
      ? rulesFor(rules, deptName, vs.label, 'DAILY_STEP')
      : [];
    const dailyHits: DailyRuleHit[] = [];
    for (const day of days) {
      for (const rule of dailyRules) {
        const metricMeta = metricByCode.get(rule.metric ?? '');
        // DAILY_STEP 场景强制取日数据（不管指标库 period 配置）
        let metricValue: number | null = metricMeta
          ? metricValueOf(metricMeta, undefined, day, 'DAILY')
          : legacyDailyMetric(rule.metric, day);
        if (metricValue === null || metricValue === undefined) continue;
        const tier = findTier(rule.tiers, metricValue);
        if (!tier) continue;
        let commission: number;
        if (tier.reward_type === 'FIXED_AMOUNT') {
          commission = tier.reward_value;
        } else if (tier.reward_type === 'UNIT_PRICE') {
          commission = tier.reward_value * day.recovered_orders;
        } else {
          commission = tier.reward_value * day.recovered_amount;
        }
        dailyHits.push({
          date: day.date,
          stage: vs.display,
          orders: day.recovered_orders,
          amount: day.recovered_amount,
          rate: day.target_recovery_rate,
          rule_id: rule.rule_id,
          rule_name: rule.rule_name,
          metric_value: metricValue,
          range_text: rangeText(tier),
          reward_type: tier.reward_type,
          reward_value: tier.reward_value,
          commission: round2(commission),
        });
      }
    }
    const dailyCommission = round2(dailyHits.reduce((s, h) => s + h.commission, 0));

    // ---- 提成·方案 B：分阶段金额提点（合并组也走同样逻辑）----
    const stageTierRule = rulesFor(rules, deptName, vs.label, 'STAGE_AMOUNT_TIER')[0] ?? null;
    let stageCommission: StageSettlement['stage_commission'] = {
      rule_id: null,
      rule_name: '未配置分阶段阶梯',
      total_amount: 0,
      range_text: '-',
      percentage: null,
      commission: 0,
    };
    if (stageTierRule) {
      const totalAmount = round2(
        monthRow?.monthly_total_amount ?? days.reduce((s, d) => s + d.recovered_amount, 0)
      );
      const tier = findTier(stageTierRule.tiers, totalAmount);
      const pct = tier?.reward_type === 'PERCENTAGE' ? tier.reward_value : null;
      stageCommission = {
        rule_id: stageTierRule.rule_id,
        rule_name: stageTierRule.rule_name,
        total_amount: totalAmount,
        range_text: rangeText(tier),
        percentage: pct,
        commission: tier && pct !== null ? round2(totalAmount * pct) : 0,
      };
    }

    stageResults.push({
      stage: vs.display,
      is_merged: vs.isMerged,
      source_stages: vs.isMerged ? vs.sourceStages : null,
      daily_hits: dailyHits,
      daily_commission: dailyCommission,
      stage_commission: stageCommission,
    });
  }

  // ---- 提成·方案 A：月度总回款阶梯提点 ----
  // 月度总回款规则按 ALL 阶段匹配（不跟具体阶段挂钩）
  const monthlyTierRule =
    rulesFor(rules, deptName, 'ALL', 'MONTHLY_TOTAL_TIER')[0] ?? null;
  // 整月总回款 = 员工各阶段月度行金额之和；无月度行时回退日明细汇总
  const sumMonthly = monthlyRows.reduce(
    (s, r) => s + (Number(r.monthly_total_amount) || 0),
    0
  );
  const grandTotal = round2(
    monthlyRows.length > 0
      ? sumMonthly
      : dailyRows.reduce((s, d) => s + d.recovered_amount, 0)
  );
  let monthlyTotalCommission = 0;
  let monthlyTotalDetail: SettlementDetail['monthly_total'] = {
    rule_id: null,
    rule_name: '未配置月度总回款阶梯',
    total_amount: grandTotal,
    range_text: '-',
    percentage: null,
    commission: 0,
  };
  if (monthlyTierRule) {
    const tier = findTier(monthlyTierRule.tiers, grandTotal);
    const pct = tier?.reward_type === 'PERCENTAGE' ? tier.reward_value : null;
    monthlyTotalCommission = tier && pct !== null ? round2(grandTotal * pct) : 0;
    monthlyTotalDetail = {
      rule_id: monthlyTierRule.rule_id,
      rule_name: monthlyTierRule.rule_name,
      total_amount: grandTotal,
      range_text: rangeText(tier),
      percentage: pct,
      commission: monthlyTotalCommission,
    };
  }

  // ---- 提成·月度超额累进 ----
  // 策略：
  //   A) 如果存在任意精确阶段规则（stage ≠ ALL）→ 各阶段独立匹配、独立累进、加总
  //      每个阶段：精确规则优先，没精确规则 fallback ALL
  //   B) 如果只有 ALL 规则（或没有任何累进规则）→ 用 grandTotal 整月算一次（典型场景）
  let progressiveCommission = 0;
  let progressiveDetail: SettlementDetail['monthly_progressive'] | undefined;

  // 部门级 ALL 累进规则（供 fallback 或整月模式用）
  const allProgressiveRule =
    rules.filter(
      (r) =>
        r.enabled &&
        r.rule_type === 'MONTHLY_PROGRESSIVE_TIER' &&
        r.stage_name === 'ALL' &&
        (r.dept_name ?? null) === deptName &&
        r.tiers.length > 0
    )[0] ?? null;

  // 是否存在任意精确阶段累进规则（stage ≠ ALL）
  const hasExactProgressive = rules.some(
    (r) =>
      r.enabled &&
      r.rule_type === 'MONTHLY_PROGRESSIVE_TIER' &&
      r.stage_name !== 'ALL' &&
      (r.dept_name ?? null) === deptName &&
      r.tiers.length > 0
  );

  if (hasExactProgressive) {
    // ======== 模式 A：各 VirtualStage 独立累进 ========
    type ProgressiveHit = {
      stageLabel: string;
      rule: SalaryRuleWithTiers;
      baseAmount: number;
    };
    const progressiveHits: ProgressiveHit[] = [];

    for (const vs of virtualStages) {
      // 精确阶段规则优先
      const exactRule = rules.find(
        (r) =>
          r.enabled &&
          r.rule_type === 'MONTHLY_PROGRESSIVE_TIER' &&
          r.stage_name !== 'ALL' &&
          r.stage_name === vs.label &&
          (r.dept_name ?? null) === deptName &&
          r.tiers.length > 0
      );
      const rule = exactRule ?? allProgressiveRule;
      if (!rule) continue;

      // 该阶段的月度金额作为累进基数
      let baseAmount = 0;
      if (vs.isMerged) {
        baseAmount = round2(
          monthlyRows
            .filter((r) => vs.sourceStages.includes(r.stage))
            .reduce((s, r) => s + (r.monthly_total_amount ?? 0), 0)
        );
      } else {
        baseAmount = round2(
          monthlyRows.find((r) => r.stage === vs.label)?.monthly_total_amount ?? 0
        );
      }

      progressiveHits.push({ stageLabel: vs.label, rule, baseAmount });
    }

    if (progressiveHits.length > 0) {
      type ProgressiveTier = NonNullable<SettlementDetail['monthly_progressive']>['tier_breakdown'][number];
      const allBreakdowns: ProgressiveTier[] = [];
      const ruleNames = new Set<string>();
      let baseAmountTotal = 0;

      for (const hit of progressiveHits) {
        const { commission, breakdown } = progressiveCalculate(hit.rule.tiers, hit.baseAmount);
        progressiveCommission += commission;
        baseAmountTotal += hit.baseAmount;
        ruleNames.add(hit.rule.rule_name);
        for (const b of breakdown) {
          (b as any).source_stage = hit.stageLabel;
        }
        allBreakdowns.push(...breakdown);
      }

      const allTiers = progressiveHits.flatMap((h) => h.rule.tiers);
      const minBase = [...allTiers].sort((a, b) => a.min_val - b.min_val)[0]?.min_val ?? 0;

      progressiveDetail = {
        rule_id: progressiveHits[0].rule.rule_id,
        rule_name: [...ruleNames].join(' / '),
        base_amount: minBase,
        total_amount: baseAmountTotal,
        commission: round2(progressiveCommission),
        tier_breakdown: allBreakdowns,
      };
      progressiveCommission = round2(progressiveCommission);
    }
  } else if (allProgressiveRule) {
    // ======== 模式 B：只有 ALL 规则 → 整月 grandTotal 算一次 ========
    const { commission, breakdown } = progressiveCalculate(allProgressiveRule.tiers, grandTotal);
    progressiveCommission = commission;
    progressiveDetail = {
      rule_id: allProgressiveRule.rule_id,
      rule_name: allProgressiveRule.rule_name,
      base_amount: [...allProgressiveRule.tiers].sort((a, b) => a.min_val - b.min_val)[0].min_val,
      total_amount: grandTotal,
      commission: progressiveCommission,
      tier_breakdown: breakdown,
    };
  }

  // ---- 汇总：绩效考核方案(底薪+绩效) + 提成方案 ----
  const dailyTotal = round2(stageResults.reduce((s, r) => s + r.daily_commission, 0));
  const stageTierTotal =
    employee.commission_plan === 'B'
      ? round2(stageResults.reduce((s, r) => s + r.stage_commission.commission, 0))
      : 0;
  const planATotal = employee.commission_plan === 'A' ? monthlyTotalCommission : 0;

  const total = round2(
    actualBaseSalary + fullAttendanceBonus + performanceBonus + dailyTotal + planATotal + stageTierTotal + progressiveCommission
  );

  const monthlySummary = monthlyRows.map((r) => ({
    stage: r.stage,
    monthly_total_amount: r.monthly_total_amount ?? 0,
    monthly_recovered_orders: r.monthly_recovered_orders ?? 0,
    monthly_recovery_rate: r.monthly_recovery_rate,
  }));

  const detail: SettlementDetail = {
    scheme: schemeDetail,
    monthly_summary: monthlySummary,
    stages: stageResults,
    monthly_total: monthlyTotalDetail,
    monthly_progressive: progressiveDetail,
  };

  return {
    month,
    employee_id: employee.employee_id,
    stage: defaultStage,
    base_salary: baseSalary,
    monthly_performance_bonus: performanceBonus,
    daily_commission: dailyTotal,
    monthly_total_commission: planATotal,
    stage_tier_commission: stageTierTotal,
    progressive_commission: progressiveCommission,
    actual_base_salary: actualBaseSalary,
    full_attendance_bonus: fullAttendanceBonus,
    total_salary: total,
    status: 'DRAFT',
    detail,
  };
}