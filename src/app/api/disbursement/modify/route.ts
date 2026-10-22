import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/storage/database/supabase-client";

/**
 * PATCH /api/disbursement/modify
 * 修改发放快照的实发金额 / 借款抵扣
 *
 * body: {
 *   table: 'payroll_disbursement' | 'reward_disbursement',
 *   id: number,
 *   net_pay?: number,       // 实发（修改后自动 net_pay_override=true）
 *   loan_deduction?: number // 借款抵扣（修改后自动 loan_deduction_override=true，且重新算 net_pay）
 * }
 *
 * 计算规则：
 *   如果只改 loan_deduction → net_pay = max(0, gross_total - loan_deduction)
 *   如果只改 net_pay → 直接存，net_pay_override=true
 *   如果都改 → 以传入的 net_pay 为准
 */
export async function PATCH(req: NextRequest) {
	const body = await req.json();
	const { table, id } = body;
	if (!table || !id) return NextResponse.json({ error: "table + id 必填" }, { status: 400 });

	const supabase = getSupabaseClient();

	// 查出原行
	const { data: rows, error: e1 } = await supabase
		.from(table)
		.select("*")
		.eq("id", id);
	if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });
	const row = rows?.[0];
	if (!row) return NextResponse.json({ error: "行不存在" }, { status: 404 });
	if (row.status === "PAID") {
		return NextResponse.json({ error: "已发放的行不能修改" }, { status: 400 });
	}

	const updates: any = {};
	const hasLoanChange = body.loan_deduction !== undefined;
	const hasNetChange = body.net_pay !== undefined;

	if (hasLoanChange) {
		const ld = Math.max(0, Number(body.loan_deduction));
		updates.loan_deduction = ld;
		updates.loan_deduction_override = true;
		// 如果没同时改 net_pay，自动重算
		if (!hasNetChange) {
			const grossTotal = Number(
				table === "payroll_disbursement" ? row.gross_total : row.reward_total
			);
			updates.net_pay = Math.max(0, grossTotal - ld);
			updates.net_pay_override = false; // 自动算的不算手动修改
		}
	}
	if (hasNetChange) {
		updates.net_pay = Math.max(0, Number(body.net_pay));
		updates.net_pay_override = true;
	}

	const { data, error: e2 } = await supabase
		.from(table)
		.update(updates)
		.eq("id", id)
		.select();
	if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });

	return NextResponse.json({ data: data?.[0] });
}
