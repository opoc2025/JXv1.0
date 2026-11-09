import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/storage/database/supabase-client";

/**
 * 补贴类目管理
 * GET    /api/subsidy-categories[?enabled=true]
 * POST   { category_name, sort_order? }
 * PATCH  { category_id, category_name?, sort_order?, enabled? }
 * DELETE ?category_id=
 */
export async function GET(req: NextRequest) {
	const url = new URL(req.url);
	const enabled = url.searchParams.get("enabled");
	const supabase = getSupabaseClient();

	let q = supabase.from("subsidy_category").select("*").order("sort_order").order("category_id");
	if (enabled === "true") q = q.eq("enabled", true);

	const { data, error } = await q;
	if (error) return NextResponse.json({ error: error.message }, { status: 500 });
	return NextResponse.json({ data });
}

export async function POST(req: NextRequest) {
	const body = await req.json();
	const { category_name, sort_order } = body;
	if (!category_name?.trim()) return NextResponse.json({ error: "类目名称必填" }, { status: 400 });

	const supabase = getSupabaseClient();
	const { data, error } = await supabase
		.from("subsidy_category")
		.insert({ category_name: category_name.trim(), sort_order: sort_order ?? 0 })
		.select()
		.single();
	if (error) {
		if (error.code === "23505") return NextResponse.json({ error: "类目名称已存在" }, { status: 400 });
		return NextResponse.json({ error: error.message }, { status: 500 });
	}
	return NextResponse.json({ data });
}

export async function PATCH(req: NextRequest) {
	const body = await req.json();
	const { category_id, ...updates } = body;
	if (!category_id) return NextResponse.json({ error: "category_id 必填" }, { status: 400 });

	const supabase = getSupabaseClient();
	const { data, error } = await supabase
		.from("subsidy_category")
		.update(updates)
		.eq("category_id", category_id)
		.select()
		.single();
	if (error) {
		if (error.code === "23505") return NextResponse.json({ error: "类目名称已存在" }, { status: 400 });
		return NextResponse.json({ error: error.message }, { status: 500 });
	}
	return NextResponse.json({ data });
}

export async function DELETE(req: NextRequest) {
	const url = new URL(req.url);
	const categoryId = url.searchParams.get("category_id");
	if (!categoryId) return NextResponse.json({ error: "category_id 必填" }, { status: 400 });

	const supabase = getSupabaseClient();

	// 删除保护：被补贴记录引用的类目拒删
	const { count } = await supabase
		.from("subsidy_record")
		.select("subsidy_id", { count: "exact", head: true })
		.eq("category_id", Number(categoryId));
	if (count && count > 0) {
		return NextResponse.json(
			{ error: `该类目已被 ${count} 条补贴记录引用，无法删除。可先停用（enabled=false）。` },
			{ status: 400 }
		);
	}

	const { error } = await supabase
		.from("subsidy_category")
		.delete()
		.eq("category_id", Number(categoryId));
	if (error) return NextResponse.json({ error: error.message }, { status: 500 });
	return NextResponse.json({ ok: true });
}
