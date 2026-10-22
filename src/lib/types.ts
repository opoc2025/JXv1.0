// 领域类型定义

export type StageName = 'D0' | 'T1' | 'T2' | 'ALL';
export type RuleType =
  | 'BASE_SALARY'
  | 'MONTHLY_THRESHOLD'
  | 'DAILY_STEP'
  | 'MONTHLY_TOTAL_TIER'
  | 'STAGE_AMOUNT_TIER'
  | 'MONTHLY_PROGRESSIVE_TIER'
  | 'DAILY_REWARD_TIER'
  | 'WEEKLY_REWARD_TIER';
export type MetricType = 'RATE' | 'ORDERS' | 'AMOUNT';
export type RewardType = 'FIXED_AMOUNT' | 'PERCENTAGE' | 'UNIT_PRICE';
export type CommissionPlan = 'A' | 'B' | 'NONE';
// 指标适用场景 & 数据阶段 & 比较符
export type MetricScope = 'PERF' | 'COMMISSION' | 'BOTH';
export type MetricPeriod = 'MONTHLY' | 'DAILY';
export type CompareOp = 'GTE' | 'LTE' | 'GT' | 'LT';

export interface MetricConfig {
  metric_id?: number;
  metric_code: string;
  metric_name: string;
  scope: MetricScope;
  period: MetricPeriod;
  source_field: string;
  unit: string;
  enabled: boolean;
}
export type EmployeeStatus = 'active' | 'resigned';
export type SettlementStatus = 'DRAFT' | 'FINALIZED';

export interface Employee {
  employee_id: string;
  employee_name: string;
  department: string | null;
  default_stage: string;
  commission_plan: CommissionPlan;
  has_daily_commission?: boolean; // 日提成开关（默认 true）
  // 阶段合并组 ID：非空则该组内阶段的日提成/月B 合并计算；null = 各阶段独立
  stage_group_id?: number | null;
  status: EmployeeStatus;
  created_at?: string;
  updated_at?: string;
  // 员工参与的全部阶段（含主阶段），由 API 关联 employee_stage 填充
  stages?: EmployeeStage[];
}

export interface DepartmentConfig {
  dept_id?: number;
  dept_code: string;
  dept_name: string;
  sort_order: number;
  enabled: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface StageConfig {
  stage_id?: number;
  stage_code: string;
  stage_name: string;
  sort_order: number;
  enabled: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface EmployeeStage {
  id?: number;
  employee_id: string;
  // 阶段引用统一用阶段名称（stage_config.stage_name）
  stage_name: string;
  is_primary: boolean;
  sort_order: number;
}

export interface StageGroup {
  group_id: number;
  group_name: string;
  description?: string | null;
  stage_names: string[];
  enabled?: boolean;
}

export type RankScope =
  | 'DAY_STAGE'
  | 'DAY_DEPT'
  | 'DAY_ALL'
  | 'WEEK_STAGE'
  | 'WEEK_DEPT'
  | 'WEEK_ALL';

export interface SalaryRule {
  rule_id: number;
  // 部门引用（空字符串/null = 全部门通用）
  dept_name: string | null;
  stage_name: string;
  rule_type: RuleType;
  // 提成指标编码（对应指标库 metric_config.metric_code，如 RATE/ORDERS/AMOUNT 或自定义）
  metric: string | null;
  rule_name: string;
  enabled: boolean;
  // === 排名择优（可选）===
  rank_scope?: RankScope | null;
  rank_best_by?: string | null;
  rank_tiebreaker?: string | null;
}

export interface RuleTier {
  detail_id: number;
  rule_id: number;
  min_val: number;
  max_val: number | null;
  reward_type: RewardType;
  reward_value: number;
  sort_order: number;
}

export interface SalaryRuleWithTiers extends SalaryRule {
  tiers: RuleTier[];
}

export interface DailyData {
  id?: number;
  batch_no?: string;
  employee_id: string;
  stage: string;
  date: string;
  recovered_orders: number;
  recovered_amount: number;
  /** 订单达成率（原"达成率"，字段名保留兼容） */
  target_recovery_rate: number | null;
  /** 当日分配订单总数（目标单数） */
  total_orders: number | null;
  /** 当日分配订单总金额（目标金额） */
  total_amount: number | null;
  /** 金额达成率 % */
  amount_achievement_rate: number | null;
}

export interface MonthlyData {
  id?: number;
  month: string;
  employee_id: string;
  stage: string;
  monthly_recovery_rate: number | null;
  monthly_total_amount: number | null;
  monthly_recovered_orders: number;
}

// 绩效考核门槛条件（隶属某个条件组：组内 AND）
export interface PerformanceCondition {
  condition_id?: number;
  group_id?: number;
  metric: string; // 指标编码（对应指标库）
  operator: CompareOp | null; // 比较符，缺省按 ≥ 处理
  threshold_value: number;
  sort_order: number;
}

// 绩效考核门槛条件组（组间 OR）：组内所有条件需同时满足（AND）才视该组达标
export interface PerformanceConditionGroup {
  group_id?: number;
  scheme_id?: number;
  sort_order: number;
  conditions: PerformanceCondition[];
}

// 绩效考核方案（一部门一份：整月判定、与阶段无关；部门内员工共享）
export interface PerformanceScheme {
  scheme_id: number;
  dept_name: string;
  base_salary: number; // 基本工资（底薪）
  performance_bonus: number; // 绩效工资（任一条件组达标发放）
  groups: PerformanceConditionGroup[];
}

// 计算明细结构
export interface DailyRuleHit {
  date: string;
  stage: string;
  orders: number;
  amount: number;
  rate: number | null;
  rule_id: number;
  rule_name: string;
  metric_value: number;
  range_text: string;
  reward_type: RewardType;
  reward_value: number;
  commission: number;
}

export interface StageSettlement {
  stage: string;
  /** 是否为合并组（多个阶段合并计算） */
  is_merged?: boolean;
  /** 合并组包含的原始阶段名列表（独立阶段则为 null） */
  source_stages?: string[] | null;
  // 日提成
  daily_hits: DailyRuleHit[];
  daily_commission: number;
  // 方案 B 分阶段提点
  stage_commission: {
    rule_id: number | null;
    rule_name: string;
    total_amount: number;
    range_text: string;
    percentage: number | null;
    commission: number;
  };
}

export interface PerformanceConditionResult extends Omit<PerformanceCondition, 'group_id' | 'sort_order'> {
  metric_value: number | null; // 该项指标的实际值（按指标解读：回收率 / 金额 / 单量）
  passed: boolean; // 该项是否满足（含比较符判定）
  range_text: string; // 比较符 + 门槛 的可读文本，如 "≥ 40"
}

export interface PerformanceGroupResult extends Omit<PerformanceConditionGroup, 'conditions'> {
  conditions: PerformanceConditionResult[];
  passed: boolean; // 该组是否达标（组内 AND：全部条件满足）
}

export interface MonthlySummary {
  stage: string;
  monthly_total_amount: number;
  monthly_recovered_orders: number;
  monthly_recovery_rate: number | null;
}

export interface SettlementDetail {
  // 绩效考核方案（整月考核：底薪 + 绩效工资，多条件组：组内 AND、组间 OR）
  scheme: {
    dept_name?: string; // 方案所属部门
    base_salary: number; // 原底薪（方案配置值）
    actual_base_salary: number; // 实发底薪（导入覆盖后）
    full_attendance_bonus: number; // 全勤奖
    performance_bonus: number;
    groups: PerformanceGroupResult[]; // 各条件组明细及各自命中情况
    passed: boolean; // 任一组达标即达标（组间 OR）
    bonus: number;
  };
  // 月度汇总数据（从日数据自动汇总，按阶段分组）
  monthly_summary: MonthlySummary[];
  // 提成方案：按阶段展开
  stages: StageSettlement[];
  // 方案 A
  monthly_total: {
    rule_id: number | null;
    rule_name: string;
    total_amount: number;
    range_text: string;
    percentage: number | null;
    commission: number;
  };
  // 月度超额累进提成
  monthly_progressive?: {
    rule_id: number | null;
    rule_name: string;
    base_amount: number; // 最低档 min_val = 基本任务门槛
    total_amount: number; // 整月总回款
    commission: number; // 累进合计
    tier_breakdown: {
      min: number;
      max: number | null;
      portion: number; // 该区间实际参与累进的金额
      percentage: number;
      commission: number;
      range_text: string;
    }[];
  };
}

export interface Settlement {
  settlement_id?: number;
  month: string;
  employee_id: string;
  stage: string;
  base_salary: number;
  monthly_performance_bonus: number;
  daily_commission: number;
  monthly_total_commission: number;
  stage_tier_commission: number;
  progressive_commission: number;
  actual_base_salary: number; // 实发底薪（导入覆盖后）
  full_attendance_bonus: number; // 全勤奖
  total_salary: number;
  status: SettlementStatus;
  detail: SettlementDetail | null;
}


export interface SalaryAdjustment {
  id?: number;
  month: string; // YYYY-MM
  employee_id: string;
  actual_base_salary: number;
  full_attendance_bonus: number;
  remark?: string | null;
  batch_id?: number | null;
}

// ==== 奖励中心 ====
export type RewardPeriod = 'DAILY' | 'WEEKLY';
export type RewardSettlementStatus = 'DRAFT' | 'FINALIZED';

// 奖励数据源（Excel 导入，一张表同时用于日 + 周）
export interface DailyRewardData {
  id?: number;
  batch_no: string;
  employee_id: string;
  stage: string;
  date: string; // YYYY-MM-DD
  amount: number;
  orders: number;
  recovery_rate: number; // 回收率 %
}

// 条件组（组间 OR）
export interface RewardConditionGroup {
  id?: number;
  rule_id: number;
  rule_type: RuleType;
  sort_order: number;
  conditions: RewardCondition[];
}

// 条件明细（组内 AND）
export interface RewardCondition {
  id?: number;
  group_id?: number;
  metric_code: string;
  operator: CompareOp;
  threshold_value: number;
  sort_order: number;
}

// 奖励阶梯匹配结果
export interface RewardTierMatch {
  tier_detail_id: number;
  min_val: number;
  max_val: number | null;
  reward_type: RewardType;
  reward_value: number;
  metric_value: number;
  reward_amount: number;
  range_text: string;
}

// 奖励结算记录（日 + 周共用）
export interface WeeklyRewardSettlement {
  settlement_id?: number;
  period: RewardPeriod;
  period_key: string; // '2026-09-15' | '2026-W37'
  employee_id: string;
  dept_name: string | null;
  stage: string;
  total_reward: number;
  tier_detail?: RewardTierMatch[] | null;
  status: RewardSettlementStatus;
  created_at?: string;
}
