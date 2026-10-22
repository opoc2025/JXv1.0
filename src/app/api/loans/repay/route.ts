import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/storage/database/supabase-client";

/**
 * 还款 / 冲减 API
 *
 * 两种调用方式：
 * 1. 手工还款:
 *    POST { employee_id, repay_date, amount, loan_ids?: [loan_id], remark? }
 *    → 自动按借款日期顺序冲减 OUTSTANDING 借款
 *
 * 2. 工资/奖励发放自动冲减（由 disbursement API 内部调用，不暴露给前端直接用）
 *    POST { employee_id, repay_date, amount, source: 'PAYROLL_MONTHLY', ref_key, remark }
 */
export async function POST(req: NextRequest) {
	const body = await req.json();
	const {
		employee_id,
		repay_date,
		amount,
		loan_ids,
		remark,
		source = "MANUAL",
		ref_key,
	} = body;

	if (!employee_id || !repay_date || !amount) {
		return NextResponse.json({ error: "工号、还款日期、金额必填" }, { status: 400 });
	}
	const repayAmount = Number(amount);
	if (repayAmount <= 0) {
		return NextResponse.json({ error: "还款金额必须大于 0" }, { status: 400 });
	}

	const supabase = getSupabaseClient();

	// 1. 查出该员工 OUTSTANDING 的借款（按日期排序，先借的先还）
	let loanQ = supabase
		.from("loan_record")
		.select("*")
		.eq("employee_id", employee_id)
		.eq("status", "OUTSTANDING")
		.order("loan_date", { ascending: true });

	// 如果指定了 loan_ids，只从这些里冲
	if (loan_ids && loan_ids.length > 0) {
		loanQ = loanQ.in("loan_id", loan_ids);
	}

	const { data: loans, error: e1 } = await loanQ;
	if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });
	if (!loans || loans.length === 0) {
		return NextResponse.json({ error: "该员工没有未清借款" }, { status: 400 });
	}

	// 2. 计算可冲减总额
	const totalOutstanding = loans.reduce(
		(sum, l) => sum + Number(l.amount) - Number(l.repaid_amount || 0),
		0
	);

	// 实际冲减 = min(repayAmount, totalOutstanding)
	const actualRepay = Math.min(repayAmount, totalOutstanding);
	if (actualRepay <= 0) {
		return NextResponse.json({ error: "无未清借款可冲减" }, { status: 400 });
	}

	// 3. 逐笔冲减 + 写冲减日志
	let remaining = actualRepay;
	const repayLogs: any[] = [];

	for (const loan of loans) {
		if (remaining <= 0) break;
		const owed = Number(loan.amount) - Number(loan.repaid_amount || 0);
		if (owed <= 0) continue;

		const thisRepay = Math.min(owed, remaining);
		remaining -= thisRepay;

		// 更新借款记录
		const newRepaid = Number(loan.repaid_amount || 0) + thisRepay;
		const newStatus =
			newRepaid >= Number(loan.amount) ? "CLEARED" : "OUTSTANDING";

		await supabase
			.from("loan_record")
			.update({
				repaid_amount: newRepaid,
				status: newStatus,
			})
			.eq("loan_id", loan.loan_id);

		// 写冲减日志
		const logEntry = {
			loan_id: loan.loan_id,
			employee_id,
			repay_date,
			amount: thisRepay,
			source,
			ref_key: ref_key || null,
			remark: remark || null,
		};
		repayLogs.push(logEntry);
	}

	// 批量写日志
	if (repayLogs.length > 0) {
		const { error: e2 } = await supabase
			.from("loan_repay_log")
			.insert(repayLogs);
		if (e2) console.error("冲减日志写入失败:", e2); // 不阻断主流程
	}

	return NextResponse.json({
		ok: true,
		repay_amount: actualRepay,
		original_request: repayAmount,
		fully_used: actualRepay === repayAmount,
		logs_written: repayLogs.length,
	});
}

// GET /api/loans/repayments?employee_id=xxx 查冲减历史
export async function GET(req: NextRequest) {
	const url = new URL(req.url);
	const employeeId = url.searchParams.get("employee_id");
	const loanId = url.searchParams.get("loan_id");

	const supabase = getSupabaseClient();
	let q = supabase
		.from("loan_repay_log")
		.select("*")
		.order("repay_date", { ascending: false });

	if (employeeId) q = q.eq("employee_id", employeeId);
	if (loanId) q = q.eq("loan_id", loanId);

	const { data, error } = await q;
	if (error) return NextResponse.json({ error: error.message }, { status: 500 });
	return NextResponse.json({ data });
}
