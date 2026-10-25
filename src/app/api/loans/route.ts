import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/storage/database/supabase-client";

export async function GET(req: NextRequest) {
	const url = new URL(req.url);
	const employeeId = url.searchParams.get("employee_id");
	const status = url.searchParams.get("status");
	const dept = url.searchParams.get("dept");
	const mode = url.searchParams.get("mode"); // 'summary' = 员工汇总
	const sort = url.searchParams.get("sort"); // 'event' = 事件流(含还款日志)

	const supabase = getSupabaseClient();

	// 员工汇总模式
	if (mode === "summary") {
		let q = supabase.from("loan_record").select("*");
		if (employeeId) q = q.eq("employee_id", employeeId);
		if (status) q = q.eq("status", status);

		const { data, error } = await q;
		if (error) return NextResponse.json({ error: error.message }, { status: 500 });

		// join employee 拿姓名和部门
		const empIds = [...new Set((data || []).map((r) => r.employee_id))];
		let empMap = new Map<string, any>();
		if (empIds.length > 0) {
			const { data: emps } = await supabase
				.from("employee")
				.select("employee_id, employee_name, department")
				.in("employee_id", empIds);
			for (const e of emps || []) empMap.set(e.employee_id, e);
		}

		// 按部门过滤
		let records = data || [];
		if (dept) {
			const filteredEmps = [...empMap.values()].filter((e) => e.department === dept);
			const ids = new Set(filteredEmps.map((e) => e.employee_id));
			records = records.filter((r) => ids.has(r.employee_id));
		}

		// 按员工聚合
		const summary = new Map<string, {
			employee_id: string;
			employee_name: string;
			department: string | null;
			total_loan: number;
			total_repaid: number;
			total_outstanding: number;
			outstanding_count: number;
			cleared_count: number;
		}>();

		for (const r of records) {
			const emp = empMap.get(r.employee_id);
			const key = r.employee_id;
			if (!summary.has(key)) {
				summary.set(key, {
					employee_id: key,
					employee_name: emp?.employee_name || key,
					department: emp?.department || null,
					total_loan: 0,
					total_repaid: 0,
					total_outstanding: 0,
					outstanding_count: 0,
					cleared_count: 0,
				});
			}
			const s = summary.get(key)!;
			s.total_loan += r.amount;
			s.total_repaid += r.repaid_amount;
			s.total_outstanding += r.amount - r.repaid_amount;
			if (r.status === "OUTSTANDING") s.outstanding_count++;
			else s.cleared_count++;
		}

		const arr = [...summary.values()];
		// 排序：未清多的在前，同则按部门→工号
		arr.sort((a, b) => {
			if (b.total_outstanding !== a.total_outstanding)
				return b.total_outstanding - a.total_outstanding;
			if (a.department !== b.department)
				return (a.department || '').localeCompare(b.department || '');
			return a.employee_id.localeCompare(b.employee_id);
		});

		return NextResponse.json({ data: arr });
	}

	// 事件流模式：合并借款记录 + 还款日志，按 created_at 精准到秒
	if (sort === "event") {
		const events: Array<{
			type: 'LOAN' | 'REPAY';
			loan_id: number | null;
			employee_id: string;
			employee_name?: string;
			timestamp: string;
			amount: number;
			source: string;
			remark: string | null;
		}> = [];

		// 借款记录
		let lq = supabase.from("loan_record").select("*");
		if (employeeId) lq = lq.eq("employee_id", employeeId);
		const { data: loans, error: le } = await lq;
		if (le) return NextResponse.json({ error: le.message }, { status: 500 });

		// 还款日志
		let rq = supabase.from("loan_repay_log").select("*");
		if (employeeId) rq = rq.eq("employee_id", employeeId);
		const { data: repays, error: re } = await rq;
		if (re) return NextResponse.json({ error: re.message }, { status: 500 });

		for (const l of loans || []) {
			events.push({
				type: 'LOAN',
				loan_id: l.loan_id,
				employee_id: l.employee_id,
				timestamp: l.created_at || l.loan_date,
				amount: l.amount,
				source: l.source,
				remark: l.remark,
			});
		}
		for (const r of repays || []) {
			events.push({
				type: 'REPAY',
				loan_id: r.loan_id,
				employee_id: r.employee_id,
				timestamp: r.created_at || r.repay_date,
				amount: r.amount,
				source: r.source,
				remark: r.remark,
			});
		}

		// 精准到秒排序（timestamp 是 ISO 格式字符串，直接比就行）
		events.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));

		// join 姓名
		const empIds = [...new Set(events.map((e) => e.employee_id))];
		let empMap = new Map<string, string>();
		if (empIds.length > 0) {
			const { data: emps } = await supabase
				.from("employee")
				.select("employee_id, employee_name, department")
				.in("employee_id", empIds);
			if (dept) {
				const deptIds = new Set((emps || []).filter((e: any) => e.department === dept).map((e: any) => e.employee_id));
				const filtered = events.filter((e) => deptIds.has(e.employee_id));
				for (const e of emps || []) empMap.set(e.employee_id, e.employee_name);
				return NextResponse.json({ data: filtered.map((e) => ({ ...e, employee_name: empMap.get(e.employee_id) })) });
			}
			for (const e of emps || []) empMap.set(e.employee_id, e.employee_name);
		}

		return NextResponse.json({ data: events.map((e) => ({ ...e, employee_name: empMap.get(e.employee_id) })) });
	}

	// 默认：借款记录列表（按 created_at 倒序，比 loan_date 更精准）
	let q = supabase.from("loan_record").select("*");
	if (employeeId) q = q.eq("employee_id", employeeId);
	if (status) q = q.eq("status", status);
	q = q.order("created_at", { ascending: false });

	const { data, error } = await q;
	if (error) return NextResponse.json({ error: error.message }, { status: 500 });

	if (dept) {
		const { data: emps } = await supabase
			.from("employee")
			.select("employee_id")
			.eq("department", dept);
		const empIds = new Set((emps || []).map((e) => e.employee_id));
		return NextResponse.json({ data: (data || []).filter((r) => empIds.has(r.employee_id)) });
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

// PATCH: 部分更新
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
