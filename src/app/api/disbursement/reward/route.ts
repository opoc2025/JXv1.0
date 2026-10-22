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
