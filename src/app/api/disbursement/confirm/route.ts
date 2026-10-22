import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/storage/database/supabase-client";

/**
 * POST /api/disbursement/confirm
 * 状态机闭环：
 *   PENDING ──PAID──▶ PAID ──CANCELLED──▶ CANCELLED
 *      │                                  │
 *      └──CANCELLED──▶ CANCELLED         └──借款回滚（如果已冲减）
 *
 * body: {
 *   table: 'payroll_disbursement' | 'reward_disbursement',
 *   ids: [1, 2, 3],
 *   action: 'PAID' | 'CANCELLED' | 'ARCHIVE' | 'UNARCHIVE',
 * }
 */
export async function POST(req: NextRequest) {
	const body = await req.json();
	const { table, ids, action } = body;

	if (!table || !ids || !action) {
		return NextResponse.json({ error: "table + ids + action 必填" }, { status: 400 });
	}
	if (!["payroll_disbursement", "reward_disbursement"].includes(table)) {
		return NextResponse.json({ error: "非法 table" }, { status: 400 });
	}
	if (!["PAID", "CANCELLED", "ARCHIVE", "UNARCHIVE"].includes(action)) {
		return NextResponse.json({ error: "非法 action，只接受 PAID / CANCELLED / ARCHIVE / UNARCHIVE" }, { status: 400 });
	}

	const supabase = getSupabaseClient();

	// 1. 查出这些行
	const { data: rows, error: e1 } = await supabase
		.from(table)
		.select("*")
		.in("id", ids);
	if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });
	if (!rows || rows.length === 0) {
		return NextResponse.json({ error: "没有找到对应行" }, { status: 400 });
	}

	const now = new Date().toISOString();
	const updates: any[] = [];
	const repayTasks: any[] = []; // PAID 时要冲减的借款
	const rollbackTasks: any[] = []; // CANCELLED 时要回滚的借款

	for (const row of rows) {
		if (action === "PAID") {
			if (row.status === "PAID") continue; // 已是 PAID 跳过
			updates.push({ id: row.id, status: "PAID", paid_at: now });

			if (Number(row.loan_deduction || 0) > 0) {
				repayTasks.push({
					employee_id: row.employee_id,
					amount: Number(row.loan_deduction),
					source: table === "payroll_disbursement" ? "PAYROLL_MONTHLY" : "REWARD_DISBURSEMENT",
					ref_key: row.period_key,
				});
			}
		} else if (action === "CANCELLED") {
			if (row.archived) continue; // 已归档不能取消
			// 取消发放只针对 PAID 行（已发放的要回滚），PENDING/CANCELLED 跳过
			if (row.status !== "PAID") continue;
			updates.push({ id: row.id, status: "CANCELLED", paid_at: null });

			// 回滚已冲减的借款
			if (Number(row.loan_deduction || 0) > 0) {
				rollbackTasks.push({
					employee_id: row.employee_id,
					amount: Number(row.loan_deduction),
					source: table === "payroll_disbursement" ? "PAYROLL_MONTHLY" : "REWARD_DISBURSEMENT",
					ref_key: row.period_key,
				});
			}
		} else if (action === "ARCHIVE") {
			updates.push({ id: row.id, archived: true, archived_at: now });
		} else if (action === "UNARCHIVE") {
			updates.push({ id: row.id, archived: false, archived_at: null });
		}
	}

	if (updates.length === 0) {
		return NextResponse.json({ ok: true, updated: 0, note: "没有可更新的行" });
	}

	// 2. 更新快照状态
	for (const u of updates) {
		const { id, ...patch } = u;
		const { error: e2 } = await supabase.from(table).update(patch).eq("id", id);
		if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });
	}

	// 2.5 ARCHIVE / UNARCHIVE → 同步归档批次备注
	if (action === "ARCHIVE" || action === "UNARCHIVE") {
		// 从 rows 里拿 period_key / period_type（PAYROLL 没 period_type）
		const sample = rows[0];
		const periodKey = sample?.period_key;
		const periodType = table === "reward_disbursement" ? sample?.period_type : "PAYROLL";
		if (periodKey) {
			const { error: e3 } = await supabase
				.from("disbursement_remark")
				.update({ archived: action === "ARCHIVE" })
				.eq("period_key", periodKey)
				.eq("period_type", periodType);
			if (e3) console.warn("remark archive error:", e3.message);
		}
	}

	// 3. PAID → 自动冲减借款（逐员工合并）
	let repayCount = 0;
	if (repayTasks.length > 0) {
		const merged = mergeTasks(repayTasks);
		for (const m of merged.values()) {
			const { count } = await doRepay(supabase, m, now);
			repayCount += count;
		}
	}

	// 4. CANCELLED → 回滚借款（逐员工合并）
	let rollbackCount = 0;
	if (rollbackTasks.length > 0) {
		const merged = mergeTasks(rollbackTasks);
		for (const m of merged.values()) {
			const { count } = await doRollback(supabase, m, now);
			rollbackCount += count;
		}
	}

	return NextResponse.json({
		ok: true,
		updated: updates.length,
		loan_repay_logs: repayCount,
		loan_rollback_logs: rollbackCount,
	});
}

function mergeTasks(tasks: any[]) {
	const merged = new Map<string, { employee_id: string; amount: number; source: string; ref_keys: string[] }>();
	for (const t of tasks) {
		const m = merged.get(t.employee_id) || {
			employee_id: t.employee_id,
			amount: 0,
			source: t.source,
			ref_keys: [] as string[],
		};
		m.amount += t.amount;
		if (!m.ref_keys.includes(t.ref_key)) m.ref_keys.push(t.ref_key);
		merged.set(t.employee_id, m);
	}
	return merged;
}

/** 正向冲减：OUTSTANDING 借款按日期顺序逐笔扣减 */
async function doRepay(sb: any, m: any, now: string): Promise<{ count: number }> {
	const repayDate = now.slice(0, 10);
	const { data: loans } = await sb
		.from("loan_record")
		.select("*")
		.eq("employee_id", m.employee_id)
		.eq("status", "OUTSTANDING")
		.order("loan_date", { ascending: true });

	if (!loans || loans.length === 0) return { count: 0 };

	let remaining = Math.round(m.amount * 100) / 100;
	const repayLogs: any[] = [];

	for (const loan of loans) {
		if (remaining <= 0) break;
		const owed = Number(loan.amount) - Number(loan.repaid_amount || 0);
		if (owed <= 0) continue;
		const thisRepay = Math.round(Math.min(owed, remaining) * 100) / 100;
		remaining = Math.round((remaining - thisRepay) * 100) / 100;

		const newRepaid = Number(loan.repaid_amount || 0) + thisRepay;
		const newStatus = newRepaid >= Number(loan.amount) ? "CLEARED" : "OUTSTANDING";

		await sb.from("loan_record").update({ repaid_amount: newRepaid, status: newStatus }).eq("loan_id", loan.loan_id);

		repayLogs.push({
			loan_id: loan.loan_id,
			employee_id: m.employee_id,
			repay_date: repayDate,
			amount: thisRepay,
			source: m.source,
			ref_key: m.ref_keys.join(","),
			remark: `自动冲减（发放确认）`,
		});
	}

	if (repayLogs.length > 0) {
		await sb.from("loan_repay_log").insert(repayLogs);
	}
	return { count: repayLogs.length };
}

/** 反向回滚：找到已冲减的 repay_log，把 amount 加回 loan_record.repaid_amount */
async function doRollback(sb: any, m: any, now: string): Promise<{ count: number }> {
	const rollbackDate = now.slice(0, 10);
	const sources = ["PAYROLL_MONTHLY", "REWARD_DISBURSEMENT"];

	// 查这些员工 + 这些来源的冲减日志（用 ref_key 匹配任一 period）
	let q = sb.from("loan_repay_log").select("*").eq("employee_id", m.employee_id).in("source", sources);
	if (m.ref_keys.length === 1) {
		q = q.eq("ref_key", m.ref_keys[0]);
	} else {
		// 多个 period：逐 ref_key 查或用 or
		q = q.or(m.ref_keys.map((rk: string) => `ref_key.ilike.%${rk}%`).join(","));
	}
	const { data: logs } = await q;

	if (!logs || logs.length === 0) return { count: 0 };

	// 按 loan_id 汇总要回滚的金额
	const rollbackByLoan = new Map<number, number>();
	for (const log of logs) {
		const lid = Number(log.loan_id);
		rollbackByLoan.set(lid, (rollbackByLoan.get(lid) || 0) + Number(log.amount));
	}

	const reverseLogs: any[] = [];

	for (const [loanId, rollbackAmt] of rollbackByLoan) {
		const { data: loan } = await sb.from("loan_record").select("*").eq("loan_id", loanId).single();
		if (!loan) continue;

		// 回滚：repaid_amount 减去冲减额（不能 < 0）
		const newRepaid = Math.max(0, Number(loan.repaid_amount || 0) - rollbackAmt);
		// 如果回滚后还有未还，变回 OUTSTANDING
		const newStatus = newRepaid < Number(loan.amount) ? "OUTSTANDING" : "CLEARED";

		await sb.from("loan_record").update({ repaid_amount: newRepaid, status: newStatus }).eq("loan_id", loanId);

		reverseLogs.push({
			loan_id: loanId,
			employee_id: m.employee_id,
			repay_date: rollbackDate,
			amount: rollbackAmt,
			source: "REVERT",
			ref_key: m.ref_keys.join(","),
			remark: `冲减回滚（取消发放）`,
		});
	}

	if (reverseLogs.length > 0) {
		await sb.from("loan_repay_log").insert(reverseLogs);
	}
	return { count: reverseLogs.length };
}
