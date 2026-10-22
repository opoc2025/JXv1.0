import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/storage/database/supabase-client";

/**
 * 批次备注（多条历史记录，每次保存 append 一条）
 *
 * GET    /api/disbursement/remark?period_key=2026-09&period_type=PAYROLL  → 按 created_at DESC 返回所有备注
 * POST   /api/disbursement/remark { period_key, period_type, content }    → 新增一条（若该周期已归档则拒绝）
 * PATCH  /api/disbursement/remark { period_key, period_type, archived }   → 批量归档/反归档
 */

export async function GET(req: NextRequest) {
	const url = new URL(req.url);
	const periodKey = url.searchParams.get("period_key");
	const periodType = url.searchParams.get("period_type");
	const archived = url.searchParams.get("archived");

	const supabase = getSupabaseClient();
	let q = supabase.from("disbursement_remark").select("*");
	if (periodKey) q = q.eq("period_key", periodKey);
	if (periodType) q = q.eq("period_type", periodType);
	if (archived !== null && archived !== undefined) q = q.eq("archived", archived === "true");
	q = q.order("created_at", { ascending: false });

	const { data, error } = await q;
	if (error) return NextResponse.json({ error: error.message }, { status: 500 });
	return NextResponse.json({ data });
}

export async function POST(req: NextRequest) {
	const body = await req.json();
	const { period_key, period_type, content } = body;
	if (!period_key || !period_type || !content?.trim()) {
		return NextResponse.json({ error: "period_key + period_type + content 必填" }, { status: 400 });
	}

	const supabase = getSupabaseClient();

	// 检查是否已归档（任一归档快照 → 备注归档）
	const table = period_type === "REWARD" ? "reward_disbursement" : "payroll_disbursement";
	const { data: archCheck } = await supabase
		.from(table)
		.select("id")
		.eq("period_key", period_key)
		.eq("archived", true)
		.limit(1);
	if (archCheck && archCheck.length > 0) {
		return NextResponse.json({ error: "该周期已归档，无法添加备注。如需修改请先反归档。" }, { status: 400 });
	}

	const { data, error } = await supabase
		.from("disbursement_remark")
		.insert({ period_key, period_type, content: content.trim(), archived: false })
		.select();
	if (error) return NextResponse.json({ error: error.message }, { status: 500 });
	return NextResponse.json({ data: data?.[0] });
}

export async function PATCH(req: NextRequest) {
	// 批量归档/反归档（随快照一起）
	const body = await req.json();
	const { period_key, period_type, archived } = body;
	if (!period_key || !period_type) return NextResponse.json({ error: "period_key + period_type 必填" }, { status: 400 });

	const supabase = getSupabaseClient();
	const { data, error } = await supabase
		.from("disbursement_remark")
		.update({ archived, updated_at: new Date().toISOString() })
		.eq("period_key", period_key)
		.eq("period_type", period_type)
		.select();
	if (error) return NextResponse.json({ error: error.message }, { status: 500 });
	return NextResponse.json({ data });
}
