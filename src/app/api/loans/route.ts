import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/storage/database/supabase-client";

export async function GET(req: NextRequest) {
	const url = new URL(req.url);
	const employeeId = url.searchParams.get("employee_id");
	const status = url.searchParams.get("status");
	const dept = url.searchParams.get("dept"); // 新增：部门筛选

	const supabase = getSupabaseClient();

	// 先查借款记录
	let q = supabase.from("loan_record").select("*");
	if (employeeId) q = q.eq("employee_id", employeeId);
	if (status) q = q.eq("status", status);
	q = q.order("loan_date", { ascending: false });

	const { data, error } = await q;
	if (error) return NextResponse.json({ error: error.message }, { status: 500 });

	// 如果要按部门过滤，需要 join employee 表
	if (dept) {
		const { data: emps } = await supabase
			.from("employee")
			.select("employee_id")
			.eq("department", dept);
		const empIds = (emps || []).map((e) => e.employee_id);
		const filtered = (data || []).filter((r) => empIds.includes(r.employee_id));
		return NextResponse.json({ data: filtered });
	}

	return NextResponse.json({ data });
}

// POST: 新增借款
export async function POST(req: NextRequest) {
	const body = await req.json();
	const { employee_id, loan_date, amount, remark } = body;

	if (!employee_id || !loan_date || !amount) {
		return NextResponse.json({ error: "工号、日期、金额必填" }, { status: 400 });
	}
	if (Number(amount) <= 0) {
		return NextResponse.json({ error: "金额必须大于 0" }, { status: 400 });
	}

	const supabase = getSupabaseClient();
	const { data, error } = await supabase
		.from("loan_record")
		.insert({
			employee_id,
			loan_date,
			amount: Number(amount),
			remark: remark || null,
			source: "MANUAL",
		})
		.select();

	if (error) return NextResponse.json({ error: error.message }, { status: 500 });
	return NextResponse.json({ data: data?.[0] });
}

// PATCH: 部分更新（改状态、改备注等）
export async function PATCH(req: NextRequest) {
	const body = await req.json();
	const { loan_id, ...updates } = body;
	if (!loan_id) return NextResponse.json({ error: "loan_id 必填" }, { status: 400 });

	const supabase = getSupabaseClient();
	const { data, error } = await supabase
		.from("loan_record")
		.update(updates)
		.eq("loan_id", loan_id)
		.select();

	if (error) return NextResponse.json({ error: error.message }, { status: 500 });
	return NextResponse.json({ data: data?.[0] });
}

// DELETE
export async function DELETE(req: NextRequest) {
	const url = new URL(req.url);
	const loanId = url.searchParams.get("loan_id");
	if (!loanId) return NextResponse.json({ error: "loan_id 必填" }, { status: 400 });

	const supabase = getSupabaseClient();
	const { error } = await supabase.from("loan_record").delete().eq("loan_id", loanId);
	if (error) return NextResponse.json({ error: error.message }, { status: 500 });
	return NextResponse.json({ ok: true });
}
