import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/storage/database/supabase-client";

/**
 * 补贴记录
 * GET    /api/subsidies[?month=&employee_id=&dept=]
 * POST   { employee_id, month, category_id, amount, remark? }
 * DELETE ?subsidy_id=
 */
export async function GET(req: NextRequest) {
	const url = new URL(req.url);
	const month = url.searchParams.get("month");
	const employeeId = url.searchParams.get("employee_id");
	const dept = url.searchParams.get("dept");

	const supabase = getSupabaseClient();

	let q = supabase
		.from("subsidy_record")
		.select("*, subsidy_category(category_id, category_name), employee(employee_id, employee_name, department)")
		.order("month", { ascending: false })
		.order("subsidy_id", { ascending: false });
	if (month) q = q.eq("month", month);
	if (employeeId) q = q.eq("employee_id", employeeId);

	const { data, error } = await q;
	if (error) return NextResponse.json({ error: error.message }, { status: 500 });

	// 按部门过滤（join 字段非外键过滤，手动实现）
	let records: any[] = data || [];
	if (dept) records = records.filter((r) => r.employee?.department === dept);

	return NextResponse.json({ data: records });
}

export async function POST(req: NextRequest) {
	const body = await req.json();
	const { employee_id, month, category_id, amount, remark } = body;

	if (!employee_id) return NextResponse.json({ error: "员工必填" }, { status: 400 });
	if (!month || !/^\d{4}-\d{2}$/.test(month))
		return NextResponse.json({ error: "月份格式必须为 YYYY-MM" }, { status: 400 });
	if (!category_id) return NextResponse.json({ error: "补贴类目必填" }, { status: 400 });
	if (amount == null || Number(amount) <= 0)
		return NextResponse.json({ error: "金额必须大于 0" }, { status: 400 });

	const supabase = getSupabaseClient();

	// 校验员工存在
	const { data: emp } = await supabase
		.from("employee")
		.select("employee_id")
		.eq("employee_id", employee_id)
		.single();
	if (!emp) return NextResponse.json({ error: "员工不存在" }, { status: 400 });

	// 校验类目存在且启用
	const { data: cat } = await supabase
		.from("subsidy_category")
		.select("category_id, enabled")
		.eq("category_id", Number(category_id))
		.single();
	if (!cat) return NextResponse.json({ error: "补贴类目不存在" }, { status: 400 });
	if (!cat.enabled) return NextResponse.json({ error: "补贴类目已停用" }, { status: 400 });

	const { data, error } = await supabase
		.from("subsidy_record")
		.insert({
			employee_id,
			month,
			category_id: Number(category_id),
			amount: Number(amount),
			remark: remark?.trim() || null,
		})
		.select()
		.single();
	if (error) return NextResponse.json({ error: error.message }, { status: 500 });
	return NextResponse.json({ data });
}

export async function DELETE(req: NextRequest) {
	const url = new URL(req.url);
	const subsidyId = url.searchParams.get("subsidy_id");
	if (!subsidyId) return NextResponse.json({ error: "subsidy_id 必填" }, { status: 400 });

	const supabase = getSupabaseClient();
	const { error } = await supabase
		.from("subsidy_record")
		.delete()
		.eq("subsidy_id", Number(subsidyId));
	if (error) return NextResponse.json({ error: error.message }, { status: 500 });
	return NextResponse.json({ ok: true });
}
