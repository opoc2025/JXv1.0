import type { MetricType, RewardType, RuleType } from './types';

export const RULE_TYPE_LABEL: Record<RuleType, string> = {
  BASE_SALARY: '固定底薪',
  MONTHLY_THRESHOLD: '月度绩效门槛',
  DAILY_STEP: '日达成阶梯',
  MONTHLY_TOTAL_TIER: '月度总回款提点',
  STAGE_AMOUNT_TIER: '分阶段金额提点',
  MONTHLY_PROGRESSIVE_TIER: '月度超额累进提成',
  DAILY_REWARD_TIER: '日奖励阶梯',
  WEEKLY_REWARD_TIER: '周奖励阶梯',
};

// 提成方案规则类型（绩效考核方案已独立，不再作为规则配置）
export const COMMISSION_RULE_TYPES: RuleType[] = [
  'DAILY_STEP',
  'MONTHLY_TOTAL_TIER',
  'STAGE_AMOUNT_TIER',
  'MONTHLY_PROGRESSIVE_TIER',
];

// 奖励中心规则类型（独立模块，和月工资无关）
export const REWARD_RULE_TYPES: RuleType[] = [
  'DAILY_REWARD_TIER',
  'WEEKLY_REWARD_TIER',
];

export const METRIC_LABEL: Record<MetricType, string> = {
  RATE: '订单达成率 (%)',
  ORDERS: '订单数 (单)',
  AMOUNT: '回款金额 (฿)',
};

export const REWARD_LABEL: Record<RewardType, string> = {
  FIXED_AMOUNT: '固定金额 (฿)',
  PERCENTAGE: '提点比例 (小数)',
  UNIT_PRICE: '单价 (฿/单)',
};

// 哪些规则类型需要选择度量指标
export function metricNeeded(type: RuleType): boolean {
  return type === 'DAILY_STEP' || type === 'MONTHLY_THRESHOLD';
}
