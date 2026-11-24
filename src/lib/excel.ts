import * as XLSX from 'xlsx';

// 单元格行列
type Cell = string | number | null;
type SheetData = Cell[][];

function sheet(rows: SheetData, widths: number[]): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = widths.map((w) => ({ wch: w }));
  return ws;
}

function download(wb: XLSX.WorkBook, filename: string): void {
  XLSX.writeFile(wb, filename);
}

// ---------- 每日明细模板 ----------
export function downloadDailyTemplate(): void {
  const rows: SheetData = [
    ['每日运营明细导入模板（请勿修改表头；日期支持 YYYY-MM-DD 或 YYYYMMDD；阶段填写系统中配置的阶段名称）'],
    [
      'employee_id 工号',
      'date 业务日期',
      'stage 阶段',
      'total_orders 总单数',
      'total_amount 总金额(฿)',
      'recovered_amount 回款金额(฿)',
      'amount_achievement_rate 金额达成率(%)',
      'recovered_orders 回收订单数',
      'target_recovery_rate 订单达成率(%)',
    ],
    ['E001', '20261001', '早期催收', 20, 5000, 3200, 64, 12, 60],
    ['E002', '2026-10-01', '中期催收', 10, 12000, 8500, 71, 4, null],
  ];
  const ws = sheet(rows, [14, 16, 12, 14, 18, 20, 24, 18, 24]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '每日明细');
  download(wb, '每日运营明细模板.xlsx');
}

// ---------- 月度考核模板 ----------
export function downloadMonthlyTemplate(): void {
  const rows: SheetData = [
    ['月度考核数据导入模板（请勿修改表头，月份格式 YYYY-MM）'],
    [
      'month 月份',
      'employee_id 工号',
      'stage 阶段',
      'monthly_recovery_rate 月度回收率(%)',
      'monthly_total_amount 月度总回款(฿)',
      'monthly_recovered_orders 月度订单量(单)',
    ],
    ['2026-10', 'E001', '早期催收', 42, 68000, 320],
    ['2026-10', 'E002', '中期催收', null, 215000, 128],
  ];
  const ws = sheet(rows, [12, 18, 12, 26, 26, 24]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '月度考核');
  download(wb, '月度考核数据模板.xlsx');
}

// ---------- 通用解析 ----------
export interface ParsedSheet {
  rows: Record<string, Cell>[];
  errors: string[];
}

export async function parseWorkbook(
  file: File,
  expectedHeaders: string[]
): Promise<ParsedSheet> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return { rows: [], errors: ['文件中没有工作表'] };

  const aoa = XLSX.utils.sheet_to_json<Cell[]>(ws, { header: 1, blankrows: false });
  // 找到表头行（第一行包含任一期望表头的行，通常是第 2 行因为模板有说明行）
  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(aoa.length, 5); i++) {
    const row = aoa[i] ?? [];
    if (
      expectedHeaders.some((h) =>
        row.some((c) => String(c ?? '').trim().startsWith(h))
      )
    ) {
      headerRowIdx = i;
      break;
    }
  }
  if (headerRowIdx === -1) {
    return { rows: [], errors: [`未找到表头，需包含: ${expectedHeaders.join(', ')}`] };
  }

  const headers = (aoa[headerRowIdx] ?? []).map((c) => {
    const s = String(c ?? '').trim();
    return s.split(/\s+/)[0]; // 取 "employee_id 工号" 的英文部分
  });

  const rows: Record<string, Cell>[] = [];
  const errors: string[] = [];
  for (let i = headerRowIdx + 1; i < aoa.length; i++) {
    const raw = aoa[i] ?? [];
    if (raw.every((c) => c === null || c === undefined || c === '')) continue;
    const obj: Record<string, Cell> = {};
    headers.forEach((h, j) => {
      if (h) obj[h] = raw[j] ?? null;
    });
    rows.push(obj);
  }
  return { rows, errors };
}

// ---------- 薪资报表导出 ----------
export interface ExportSettlementRow {
  employee_id: string;
  employee_name: string;
  department: string | null;
  stage: string;
  base_salary: number;
  monthly_performance_bonus: number;
  actual_base_salary: number;
  full_attendance_bonus: number;
  daily_commission: number;
  monthly_total_commission: number;
  stage_tier_commission: number;
  progressive_commission: number;
  total_salary: number;
  status: string;
}

export function exportSettlement(month: string, rows: ExportSettlementRow[]): void {
  const head = [
    '工号',
    '姓名',
    '团队/部门',
    '默认阶段',
    '固定底薪 (฿)',
    '实发绩效 (฿)',
    '实发底薪 (฿)',
    '全勤奖 (฿)',
    '日达成提成 (฿)',
    '月度总额提成 (฿)',
    '多阶段提成 (฿)',
    '超额累进提成 (฿)',
    '应发总工资 (฿)',
    '状态',
  ];
  const body = rows.map((r) => [
    r.employee_id,
    r.employee_name,
    r.department ?? '',
    r.stage,
    r.base_salary,
    r.monthly_performance_bonus,
    r.actual_base_salary,
    r.full_attendance_bonus,
    r.daily_commission,
    r.monthly_total_commission,
    r.stage_tier_commission,
    r.progressive_commission,
    r.total_salary,
    r.status === 'FINALIZED' ? '已终审' : '草稿',
  ]);
  const totals = [
    '合计',
    '',
    '',
    '',
    rows.reduce((s, r) => s + r.base_salary, 0),
    rows.reduce((s, r) => s + r.monthly_performance_bonus, 0),
    rows.reduce((s, r) => s + r.actual_base_salary, 0),
    rows.reduce((s, r) => s + r.full_attendance_bonus, 0),
    rows.reduce((s, r) => s + r.daily_commission, 0),
    rows.reduce((s, r) => s + r.monthly_total_commission, 0),
    rows.reduce((s, r) => s + r.stage_tier_commission, 0),
    rows.reduce((s, r) => s + r.progressive_commission, 0),
    rows.reduce((s, r) => s + r.total_salary, 0),
    '',
  ];
  const ws = sheet(
    [[`${month} 催收团队薪资汇总表（币种：泰铢 THB）`], head, ...body, totals],
    [10, 12, 14, 10, 14, 16, 14, 16, 16, 16, 10]
  );
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '薪资汇总');
  download(wb, `${month}薪资汇总表.xlsx`);
}

// ---------- 工资发放报表 ----------
export interface ExportPayrollRow {
  employee_id: string;
  employee_name: string;
  dept_name: string | null;
  base_salary: number;
  performance_bonus: number;
  full_attendance_bonus: number;
  gross_salary: number;
  commission: number;
  gross_total: number;
  subsidy_amount: number;
  loan_deduction: number;
  net_pay: number;
  status: string;
}

export function exportPayrollDisbursement(periodKey: string, rows: ExportPayrollRow[]): void {
  const head = [
    '工号',
    '姓名',
    '部门',
    '底薪 (฿)',
    '绩效 (฿)',
    '全勤 (฿)',
    '基础工资 (฿)',
    '提成 (฿)',
    '工资合计 (฿)',
    '补贴 (฿)',
    '借款抵扣 (฿)',
    '实发金额 (฿)',
    '状态',
  ];
  const body = rows.map((r) => [
    r.employee_id,
    r.employee_name,
    r.dept_name ?? '',
    r.base_salary,
    r.performance_bonus,
    r.full_attendance_bonus,
    r.gross_salary,
    r.commission,
    r.gross_total,
    r.subsidy_amount,
    r.loan_deduction,
    r.net_pay,
    r.status === 'PAID' ? '已发放' : r.status === 'CANCELLED' ? '已取消' : '待发放',
  ]);
  const totals = [
    '合计',
    '',
    '',
    rows.reduce((s, r) => s + r.base_salary, 0),
    rows.reduce((s, r) => s + r.performance_bonus, 0),
    rows.reduce((s, r) => s + r.full_attendance_bonus, 0),
    rows.reduce((s, r) => s + r.gross_salary, 0),
    rows.reduce((s, r) => s + r.commission, 0),
    rows.reduce((s, r) => s + r.gross_total, 0),
    rows.reduce((s, r) => s + r.subsidy_amount, 0),
    rows.reduce((s, r) => s + r.loan_deduction, 0),
    rows.reduce((s, r) => s + r.net_pay, 0),
    '',
  ];
  const ws = sheet(
    [[`${periodKey} 工资发放表（币种：泰铢 THB）`], head, ...body, totals],
    [12, 14, 12, 12, 12, 10, 14, 14, 14, 12, 14, 14, 10]
  );
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '工资发放');
  download(wb, `${periodKey}工资发放表.xlsx`);
}

// ---------- 奖励发放报表 ----------
export interface ExportRewardRow {
  employee_id: string;
  employee_name: string;
  dept_name: string | null;
  period_type: string;
  period_key: string;
  daily_total: number;
  weekly_total: number;
  reward_total: number;
  loan_deduction: number;
  net_pay: number;
  status: string;
}

export function exportRewardDisbursement(periodKey: string, periodType: string, rows: ExportRewardRow[]): void {
  const head = [
    '工号',
    '姓名',
    '部门',
    '周期类型',
    '周期',
    '日奖励 (฿)',
    '周奖励 (฿)',
    '奖励合计 (฿)',
    '借款抵扣 (฿)',
    '实发金额 (฿)',
    '状态',
  ];
  const body = rows.map((r) => [
    r.employee_id,
    r.employee_name,
    r.dept_name ?? '',
    r.period_type === 'WEEKLY' ? '周奖励' : '月奖励',
    r.period_key,
    r.daily_total,
    r.weekly_total,
    r.reward_total,
    r.loan_deduction,
    r.net_pay,
    r.status === 'PAID' ? '已发放' : r.status === 'CANCELLED' ? '已取消' : '待发放',
  ]);
  const totals = [
    '合计',
    '',
    '',
    '',
    '',
    rows.reduce((s, r) => s + r.daily_total, 0),
    rows.reduce((s, r) => s + r.weekly_total, 0),
    rows.reduce((s, r) => s + r.reward_total, 0),
    rows.reduce((s, r) => s + r.loan_deduction, 0),
    rows.reduce((s, r) => s + r.net_pay, 0),
    '',
  ];
  const ws = sheet(
    [[`${periodKey} ${periodType === 'WEEKLY' ? '周' : '月'}奖励发放表（币种：泰铢 THB）`], head, ...body, totals],
    [12, 14, 12, 10, 14, 12, 12, 14, 14, 14, 10]
  );
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '奖励发放');
  download(wb, `${periodKey}${periodType === 'WEEKLY' ? '周' : '月'}奖励发放表.xlsx`);
}

// ---------- 员工档案导入模板 ----------
export function downloadEmployeeTemplate(): void {
  const rows: SheetData = [
    ['员工档案导入模板（请勿修改表头；主阶段、参与阶段须填写系统中已配置的阶段名称，多阶段用英文逗号分隔）'],
    [
      'employee_id 工号',
      'employee_name 姓名',
      'department 部门',
      'default_stage 主阶段',
      'stages 参与阶段(逗号分隔)',
      'commission_plan 方案(A/B)',
      'status 状态(active/inactive)',
    ],
    ['E101', '张三', '催收一组', '早期催收', '早期催收,中期催收', 'A', 'active'],
  ];
  const ws = sheet(rows, [16, 14, 14, 14, 28, 16, 20]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '员工档案');
  download(wb, '员工档案导入模板.xlsx');
}
