import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/storage/database/supabase-client";

/**
 * DELETE /api/disbursement/clear
 * 清除未归档的快照（可选按 period_key 过滤）
 *
 * body: {
 *   table: 'payroll_disbursement' | 'reward_disbursement',
 *   period_key?: string,      // 可选，只清某个月/周
 *   period_type?: 'PAYROLL' | 'WEEKLY' | 'MONTHLY', // 可选（reward 用）
 *   also_paid?: boolean,      // 默认 false：只清 PENDING；true：连 PAID 一起清
 * }
 */
export async function DELETE(req: NextRequest) {
	const body = await req.json();
	const { table, period_key, period_type, also_paid } = body;

	if (!table || !["payroll_disbursement", "reward_disbursement"].includes(table)) {
		return NextResponse.json({ error: "table 必填且只能是 payroll_disbursement 或 reward_disbursement" }, { status: 400 });
	}

	const supabase = getSupabaseClient();

	// 先查要删的数量（给用户反馈）
	let q = supabase.from(table).select("id");
	q = q.eq("archived", false);
	if (period_key) q = q.eq("period_key", period_key);
	if (table === "reward_disbursement" && period_type) q = q.eq("period_type", period_type);
	if (!also_paid) q = q.eq("status", "PENDING"); // 默认只清待发放

	const { data: toDelete, error: e1 } = await q;
	if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });

	if (!toDelete || toDelete.length === 0) {
		return NextResponse.json({ ok: true, deleted: 0 });
	}

	const ids = (toDelete as any[]).map((r) => r.id);

	const { error: e2 } = await supabase.from(table).delete().in("id", ids);
	if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });

	return NextResponse.json({ ok: true, deleted: ids.length });
}
