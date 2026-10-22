import { getSupabaseClient } from '@/storage/database/supabase-client';
import { ok, fail } from '@/lib/api-helpers';

export const dynamic = 'force-dynamic';

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

interface UpdateBody {
  dept_name?: string | null;
  stage_name?: string;
  rule_type?: string;
  metric?: string | null;
  rule_name?: string;
  enabled?: boolean;
  // 排名择优
  rank_scope?: string | null;
  rank_best_by?: string | null;
  rank_tiebreaker?: string | null;
  tiers?: TierInput[];
  // 条件组嵌套（整体替换：先删后建）
  conditions?: ConditionGroupInput[];
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const ruleId = Number(id);
  const body = (await req.json()) as UpdateBody;
  const client = getSupabaseClient();

  const updateCols: Record<string, unknown> = {};
  (['dept_name', 'stage_name', 'rule_type', 'metric', 'rule_name', 'enabled',
    'rank_scope', 'rank_best_by', 'rank_tiebreaker'] as const).forEach((k) => {
    if (body[k] !== undefined) updateCols[k] = body[k];
  });

  if (Object.keys(updateCols).length > 0) {
    const { error } = await client
      .from('salary_rule_config')
      .update(updateCols)
      .eq('rule_id', ruleId);
    if (error) return fail(`更新规则失败: ${error.message}`, 500);
  }

  // 阶梯整体替换
  if (body.tiers) {
    const { error: delError } = await client
      .from('rule_tier_detail')
      .delete()
      .eq('rule_id', ruleId);
    if (delError) return fail(`清空旧阶梯失败: ${delError.message}`, 500);

    if (body.tiers.length > 0) {
      const rows = body.tiers.map((t, i) => ({
        rule_id: ruleId,
        min_val: t.min_val,
        max_val: t.max_val ?? null,
        reward_type: t.reward_type,
        reward_value: t.reward_value,
        sort_order: t.sort_order ?? i,
      }));
      const { error: tierError } = await client.from('rule_tier_detail').insert(rows);
      if (tierError) return fail(`写入新阶梯失败: ${tierError.message}`, 500);
    }
  }

  // 条件组整体替换（先删后建）
  if (body.conditions !== undefined) {
    const { error: delError } = await client
      .from('salary_condition_group')
      .delete()
      .eq('rule_id', ruleId);
    if (delError) return fail(`清空旧条件组失败: ${delError.message}`, 500);

    for (let gi = 0; gi < body.conditions.length; gi++) {
      const g = body.conditions[gi];
      const { data: gRow, error: gErr } = await client
        .from('salary_condition_group')
        .insert({
          rule_id: ruleId,
          rule_type: body.rule_type ?? '',
          sort_order: g.sort_order ?? gi,
        })
        .select()
        .single();
      if (gErr) return fail(`写入条件组失败: ${gErr.message}`, 500);

      if (g.conditions && g.conditions.length > 0) {
        const cRows = g.conditions.map((c, ci) => ({
          group_id: gRow.id,
          metric_code: c.metric_code,
          operator: c.operator,
          threshold_value: c.threshold_value,
          sort_order: c.sort_order ?? ci,
        }));
        const { error: cErr } = await client.from('salary_condition').insert(cRows);
        if (cErr) return fail(`写入条件明细失败: ${cErr.message}`, 500);
      }
    }
  }

  return ok({ rule_id: ruleId });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const client = getSupabaseClient();
  const { error } = await client
    .from('salary_rule_config')
    .delete()
    .eq('rule_id', Number(id));
  if (error) return fail(`删除规则失败: ${error.message}`, 500);
  return ok({ rule_id: Number(id) });
}
