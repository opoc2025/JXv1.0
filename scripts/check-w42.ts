/**
 * 对账脚本：W42 结算 vs 快照
 * pnpm tsx scripts/check-w42.ts
 */
import { getSupabaseClient } from "@/storage/database/supabase-client";

// W42 = 2026-W42 → 10月12日(周一) ~ 10月18日(周日)
const W42_DATES = ["2026-10-12","2026-10-13","2026-10-14","2026-10-15","2026-10-16","2026-10-17","2026-10-18"];

async function main() {
  const sb = getSupabaseClient();

  // 1. 查 W42 DAILY 结算
  const { data: daily, error: e1 } = await sb
    .from("weekly_reward_settlement")
    .select("*")
    .eq("period", "DAILY")
    .gte("period_key", W42_DATES[0])
    .lte("period_key", W42_DATES[6]);
  if (e1) throw e1;

  // 2. 查 W42 WEEKLY 结算
  const { data: weekly, error: e2 } = await sb
    .from("weekly_reward_settlement")
    .select("*")
    .eq("period", "WEEKLY")
    .eq("period_key", "2026-W42");
  if (e2) throw e2;

  // 3. 查 W42 快照
  const { data: snap, error: e3 } = await sb
    .from("reward_disbursement")
    .select("*")
    .eq("period_key", "2026-W42")
    .eq("period_type", "WEEKLY");
  if (e3) throw e3;

  // 4. 查员工表（拿姓名）
  const empIds = [...new Set([
    ...(daily || []).map(r => r.employee_id),
    ...(weekly || []).map(r => r.employee_id),
    ...(snap || []).map(r => r.employee_id),
  ])];
  const { data: emps } = await sb.from("employee").select("employee_id,employee_name").in("employee_id", empIds);
  const empMap = new Map((emps || []).map(e => [e.employee_id, e.employee_name]));

  // 5. 聚合结算（按员工）
  const agg = new Map<string, { daily: number; weekly: number; details: string[] }>();
  for (const r of daily || []) {
    const key = r.employee_id;
    const a = agg.get(key) || { daily: 0, weekly: 0, details: [] };
    const amt = Number(r.total_reward || 0);
    a.daily += amt;
    a.details.push(`D:${r.period_key} stage=${r.stage} =${amt.toFixed(2)}`);
    agg.set(key, a);
  }
  for (const r of weekly || []) {
    const key = r.employee_id;
    const a = agg.get(key) || { daily: 0, weekly: 0, details: [] };
    const amt = Number(r.total_reward || 0);
    a.weekly += amt;
    a.details.push(`W:${r.period_key} stage=${r.stage} =${amt.toFixed(2)}`);
    agg.set(key, a);
  }

  // 6. 快照按员工
  const snapMap = new Map<string, any>();
  for (const r of snap || []) snapMap.set(r.employee_id, r);

  // 7. 对比
  console.log("\n===== W42 对账 =====");
  console.log(`DAILY 结算行数: ${daily?.length || 0}`);
  console.log(`WEEKLY 结算行数: ${weekly?.length || 0}`);
  console.log(`快照行数: ${snap?.length || 0}`);
  console.log(`员工数: ${agg.size} (结算) vs ${snapMap.size} (快照)`);

  console.log("\n--- 逐员工对比 ---");
  let mismatches = 0;
  for (const [empId, a] of [...agg.entries()].sort()) {
    const settleTotal = Math.round((a.daily + a.weekly) * 100) / 100;
    const s = snapMap.get(empId);
    const snapTotal = s ? Number(s.reward_total) : null;

    const name = empMap.get(empId) || "?";
    const mark = snapTotal === null ? "❌ 快照缺失" : (Math.abs(settleTotal - snapTotal) < 0.01 ? "✅" : "❌ 不一致");

    if (mark !== "✅") {
      mismatches++;
      console.log(`\n${mark} ${empId} ${name}`);
      console.log(`   结算: daily=${a.daily.toFixed(2)} + weekly=${a.weekly.toFixed(2)} = ${settleTotal.toFixed(2)}`);
      if (s) console.log(`   快照: reward_total=${snapTotal.toFixed(2)} (daily_total=${s.daily_total}, weekly_total=${s.weekly_total})`);
      else console.log(`   快照: 无`);
      console.log(`   结算明细:`);
      for (const d of a.details) console.log(`     ${d}`);
      console.log(`   差: ${snapTotal !== null ? (snapTotal - settleTotal).toFixed(2) : "N/A"}`);
    }
  }

  // 快照里有但结算里没有的
  for (const [empId, s] of snapMap) {
    if (!agg.has(empId)) {
      mismatches++;
      const name = empMap.get(empId) || "?";
      console.log(`\n❌ 快照多了 ${empId} ${name}: reward_total=${s.reward_total}`);
    }
  }

  // 合计对比
  const settleSum = [...agg.values()].reduce((s, a) => s + a.daily + a.weekly, 0);
  const snapSum = (snap || []).reduce((s: number, r: any) => s + Number(r.reward_total || 0), 0);
  console.log(`\n--- 合计 ---`);
  console.log(`结算合计: ${settleSum.toFixed(2)}`);
  console.log(`快照合计: ${snapSum.toFixed(2)}`);
  console.log(`差异: ${(snapSum - settleSum).toFixed(2)}`);
  console.log(`\n结果: ${mismatches === 0 ? "✅ 全部一致" : `❌ ${mismatches} 处不一致`}`);
}

main().catch(e => { console.error(e); process.exit(1); });
