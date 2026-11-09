import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/storage/database/supabase-client";

/**
 * GET /api/disbursement/reward
 * 获取奖励发放快照列表
 *
 * Query params:
 *   period_key?   '2026-W40' | '2026-09'
 *   period_type?  'WEEKLY' | 'MONTHLY'
 *   dept?
 *   status?
 *   archived?     默认 false
 */
export async function GET(req: NextRequest) {
	const url = new URL(req.url);
	const periodKey = url.searchParams.get("period_key");
	const periodType = url.searchParams.get("period_type");
	const dept = url.searchParams.get("dept");
	const status = url.searchParams.get("status");
	const archived = url.searchParams.get("archived");

	const supabase = getSupabaseClient();
	let q = supabase.from("reward_disbursement").select("*, employee!inner(employee_id,employee_name,salary_qr_code_url)");

	if (periodKey) q = q.eq("period_key", periodKey);
	if (periodType) q = q.eq("period_type", periodType);
	if (dept) q = q.eq("dept_name", dept);
	if (status) q = q.eq("status", status);
	if (archived !== null && archived !== undefined) {
		q = q.eq("archived", archived === "true");
	} else {
		q = q.eq("archived", false);
	}

	q = q.order("employee_id", { ascending: true });

	const { data, error } = await q;
	if (error) return NextResponse.json({ error: error.message }, { status: 500 });
	return NextResponse.json({ data });
}

/**
 * DELETE /api/disbursement/reward?id=123
 * 删除单条奖励发放快照（前端应仅对 PENDING/CANCELLED 行调用，PAID 行需先取消发放回滚借款冲减）
 */
export async function DELETE(req: NextRequest) {
	const url = new URL(req.url);
	const id = url.searchParams.get("id");
	if (!id) return NextResponse.json({ error: "id 必填" }, { status: 400 });

	const supabase = getSupabaseClient();
	const { data, error } = await supabase
		.from("reward_disbursement")
		.delete()
		.eq("id", Number(id))
		.select();
	if (error) return NextResponse.json({ error: error.message }, { status: 500 });
	if (!data?.length) return NextResponse.json({ error: "记录不存在" }, { status: 404 });
	return NextResponse.json({ data: { deleted: data.length } });
}
