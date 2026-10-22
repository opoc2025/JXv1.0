import { getSupabaseClient } from '@/storage/database/supabase-client';
import { ok, fail, numify, NUMERIC_TIER } from '@/lib/api-helpers';
import type { RuleTier, SalaryRuleWithTiers } from '@/lib/types';

export const dynamic = 'force-dynamic';

// GET /api/rules?withTiers=true
export async function GET(req: Request) {
  const url = new URL(req.url);
  const withTiers = url.searchParams.get('withTiers') === 'true';
  const client = getSupabaseClient();

  const { data: rules, error } = await client
    .from('salary_rule_config')
    .select('*')
    .order('rule_id', { ascending: true });
  if (error) return fail(`查询规则失败: ${error.message}`, 500);

  if (!withTiers) return ok(rules);

  const ruleIds = (rules ?? []).map((r) => (r as { rule_id: number }).rule_id);

  // 1. 阶梯
  const { data: tiers, error: tierError } = await client
    .from('rule_tier_detail')
    .select('*')
    .in('rule_id', ruleIds)
    .order('sort_order', { ascending: true })
    .order('min_val', { ascending: true });
  if (tierError) return fail(`查询阶梯失败: ${tierError.message}`, 500);

  // 2. 条件组
  const { data: groups, error: gErr } = await client
    .from('salary_condition_group')
    .select('*')
    .in('rule_id', ruleIds)
    .order('sort_order', { ascending: true });
  if (gErr) return fail(`查询条件组失败: ${gErr.message}`, 500);

  // 3. 条件明细
  const groupIds = (groups ?? []).map((g) => g.id);
  const { data: conds, error: cErr } = groupIds.length > 0
    ? await client
        .from('salary_condition')
        .select('*')
        .in('group_id', groupIds)
        .order('sort_order', { ascending: true })
    : { data: [], error: null as any };
  if (cErr) return fail(`查询条件明细失败: ${cErr.message}`, 500);

  const tierRows = (tiers ?? []).map((t) => numify(t as Record<string, unknown>, NUMERIC_TIER)) as unknown as RuleTier[];
  const byRule = new Map<number, RuleTier[]>();
  tierRows.forEach((t) => {
    const list = byRule.get(t.rule_id) ?? [];
    list.push(t);
    byRule.set(t.rule_id, list);
  });

  // 条件组嵌套
  const byGroup = new Map<number, any[]>();
  (conds ?? []).forEach((c: any) => {
    const list = byGroup.get(c.group_id) ?? [];
    list.push(c);
    byGroup.set(c.group_id, list);
  });
  const byRuleGroups = new Map<number, any[]>();
  (groups ?? []).forEach((g: any) => {
    const withConds = { ...g, conditions: byGroup.get(g.id) ?? [] };
    const list = byRuleGroups.get(g.rule_id) ?? [];
    list.push(withConds);
    byRuleGroups.set(g.rule_id, list);
  });

  const result = (rules ?? []).map((r) => {
    const rid = (r as { rule_id: number }).rule_id;
    return {
      ...(r as object),
      rule_tier_detail: byRule.get(rid) ?? [],
      salary_condition_group: byRuleGroups.get(rid) ?? [],
    };
  });

  return ok(result);
}

interface TierInput {
  min_val: number;
  max_val?: number | null;
  reward_type: 'FIXED_AMOUNT' | 'PERCENTAGE' | 'UNIT_PRICE';
  reward_value: number;
  sort_order?: number;
}

interface ConditionInput {
  metric_code: string;
  operator: string;
  threshold_value: number;
  sort_order?: number;
}

interface ConditionGroupInput {
  sort_order?: number;
  conditions: ConditionInput[];
}

interface CreateBody {
  dept_name?: string | null;
  stage_name?: string;
  rule_type?: SalaryRuleWithTiers['rule_type'];
  metric?: string | null;
  rule_name?: string;
  enabled?: boolean;
  // 排名择优
  rank_scope?: string | null;
  rank_best_by?: string | null;
  rank_tiebreaker?: string | null;
  tiers?: TierInput[];
  // 条件组嵌套
  conditions?: ConditionGroupInput[];
}

export async function POST(req: Request) {
  const body = (await req.json()) as CreateBody;
  if (!body.stage_name || !body.rule_type || !body.rule_name) {
    return fail('阶段、规则类型、规则名称为必填项');
  }
  const client = getSupabaseClient();
  // 校验部门（如果指定了 dept_name）
  if (body.dept_name) {
    const { data: dept } = await client
      .from('department_config')
      .select('dept_name')
      .eq('dept_name', body.dept_name)
      .eq('enabled', true)
      .single();
    if (!dept) return fail(`部门「${body.dept_name}」不存在或已停用`);
  }
  const { data: ruleData, error } = await client
    .from('salary_rule_config')
    .insert({
      dept_name: body.dept_name ?? null,
      stage_name: body.stage_name,
      rule_type: body.rule_type,
      metric: body.metric ?? null,
      rule_name: body.rule_name,
      enabled: body.enabled ?? true,
      rank_scope: body.rank_scope ?? null,
      rank_best_by: body.rank_best_by ?? null,
      rank_tiebreaker: body.rank_tiebreaker ?? null,
    })
    .select();
  if (error) return fail(`新增规则失败: ${error.message}`, 500);

  const ruleId = ruleData[0].rule_id as number;
  if (body.tiers && body.tiers.length > 0) {
    const rows = body.tiers.map((t, i) => ({
      rule_id: ruleId,
      min_val: t.min_val,
      max_val: t.max_val ?? null,
      reward_type: t.reward_type,
      reward_value: t.reward_value,
      sort_order: t.sort_order ?? i,
    }));
    const { error: tierError } = await client.from('rule_tier_detail').insert(rows);
    if (tierError) return fail(`新增阶梯失败: ${tierError.message}`, 500);
  }

  // 条件组 + 条件明细
  if (body.conditions && body.conditions.length > 0) {
    for (let gi = 0; gi < body.conditions.length; gi++) {
      const g = body.conditions[gi];
      const { data: gRow, error: gErr } = await client
        .from('salary_condition_group')
        .insert({
          rule_id: ruleId,
          rule_type: body.rule_type,
          sort_order: g.sort_order ?? gi,
        })
        .select()
        .single();
      if (gErr) return fail(`新增条件组失败: ${gErr.message}`, 500);

      if (g.conditions && g.conditions.length > 0) {
        const cRows = g.conditions.map((c, ci) => ({
          group_id: gRow.id,
          metric_code: c.metric_code,
          operator: c.operator,
          threshold_value: c.threshold_value,
          sort_order: c.sort_order ?? ci,
        }));
        const { error: cErr } = await client.from('salary_condition').insert(cRows);
        if (cErr) return fail(`新增条件明细失败: ${cErr.message}`, 500);
      }
    }
  }

  return ok({ rule_id: ruleId });
}
