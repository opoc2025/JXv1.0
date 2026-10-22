// 金额与数值格式化

export function formatTHB(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '-';
  return n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatRate(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '-';
  return `${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}%`;
}

export function formatPct(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '-';
  return `${(n * 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`;
}

export function currentMonth(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// 返回月份的 [起始日, 下月1日)，用于构造日期区间，避免固定 day=32 在小月非法
export function monthRange(month: string): { start: string; endExclusive: string } {
  const [year, mon] = month.split('-').map(Number);
  const [nextYear, nextMon] = mon === 12 ? [year + 1, 1] : [year, mon + 1];
  return {
    start: `${month}-01`,
    endExclusive: `${nextYear}-${String(nextMon).padStart(2, '0')}-01`,
  };
}
