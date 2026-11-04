import { getSupabaseClient } from '@/storage/database/supabase-client';
import { ok, fail } from '@/lib/api-helpers';

export const dynamic = 'force-dynamic';

interface StageBreakdown {
  stage: string;
  rows: number;
}

interface ImportCheckRow {
  employee_id: string;
  employee_name: string;
  department: string;
  default_stage: string;
  total_rows: number;          // 该员工总数据条数（多行含不同 stage）
  unique_dates: number;         // 该员工实际覆盖的天数（去重 date 数）
  expected_days: number;        // 区间内应有的天数
  missing_dates: string[];      // 缺失的具体日期
  missing_count: number;        // 缺失天数
  stage_breakdown: StageBreakdown[];
  complete: boolean;            // 是否齐全
}

interface CheckReport {
  from: string;
  to: string;
  total_days: number;           // 区间总天数
  total_rows: number;           // 全部日数据行数
  employee_count: number;       // 在职员工数
  with_data: number;            // 有数据的员工数
  complete_count: number;       // 完全齐全的员工数
  missing_count: number;        // 有缺失的员工数
  no_data_count: number;        // 完全没数据的员工数
  rows: ImportCheckRow[];
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const dept = searchParams.get('dept');
  const employee = searchParams.get('employee');

  if (!from || !to) {
    return fail('缺少 from/to 参数');
  }

  try {
    const client = getSupabaseClient();

    // === 1. 拉全部在职员工 ===
    let empQuery = client
      .from('employee')
      .select('employee_id, employee_name, department, default_stage, status')
      .neq('status', 'inactive');
    if (dept) empQuery = empQuery.eq('department', dept);
    if (employee) empQuery = empQuery.eq('employee_id', employee);

    const { data: emps, error: empErr } = await empQuery;
    if (empErr) throw new Error(`拉员工失败: ${empErr.message}`);

    // === 2. 拉区间内全部日数据（分页，每次 1000 行）===
    let allDaily: any[] = [];
    let offset = 0;
    const PAGE = 1000;
    while (true) {
      let q = client
        .from('import_daily_data')
        .select('employee_id, stage, date')
        .gte('date', from)
        .lt('date', to)
        .range(offset, offset + PAGE - 1);
      if (employee) q = q.eq('employee_id', employee);

      const { data: page, error: dErr } = await q;
      if (dErr) throw new Error(`拉日数据失败: ${dErr.message}`);
      if (!page || page.length === 0) break;
      allDaily = allDaily.concat(page);
      if (page.length < PAGE) break;
      offset += PAGE;
    }

    // === 3. 构建区间内的全部日期集合 ===
    const fromDate = new Date(from + 'T00:00:00');
    const toDate = new Date(to + 'T00:00:00');
    const allDatesInRange: string[] = [];
    for (let d = new Date(fromDate); d < toDate; d.setDate(d.getDate() + 1)) {
      allDatesInRange.push(
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      );
    }
    const expectedDays = allDatesInRange.length;
    const expectedSet = new Set(allDatesInRange);

    // === 4. 按 employee_id 分组聚合 ===
    const empMap = new Map<string, {
      name: string;
      dept: string | null;
      defaultStage: string;
      rows: any[];
      dateSet: Set<string>;
      stageCount: Map<string, number>;
    }>();

    // 先初始化所有在职员工
    for (const e of (emps ?? [])) {
      empMap.set(e.employee_id, {
        name: e.employee_name,
        dept: e.department,
        defaultStage: e.default_stage,
        rows: [],
        dateSet: new Set(),
        stageCount: new Map(),
      });
    }

    // 聚合日数据
    for (const d of allDaily) {
      const eid = d.employee_id;
      if (!empMap.has(eid)) {
        // 有日数据但员工不在列表里（可能已离职但日数据还在），也加进来
        empMap.set(eid, {
          name: eid,
          dept: null,
          defaultStage: '-',
          rows: [],
          dateSet: new Set(),
          stageCount: new Map(),
        });
      }
      const bucket = empMap.get(eid)!;
      bucket.rows.push(d);
      bucket.dateSet.add(d.date);
      bucket.stageCount.set(d.stage, (bucket.stageCount.get(d.stage) ?? 0) + 1);
    }

    // === 5. 生成每行报告 ===
    const rows: ImportCheckRow[] = [];
    let completeCount = 0;
    let withDataCount = 0;
    let noDataCount = 0;

    for (const [eid, bucket] of empMap.entries()) {
      // 算缺失日期
      const missingDates: string[] = [];
      for (const dt of allDatesInRange) {
        if (!bucket.dateSet.has(dt)) missingDates.push(dt);
      }
      const isComplete = bucket.dateSet.size === expectedDays && expectedDays > 0;
      if (bucket.rows.length > 0) withDataCount++;
      else noDataCount++;
      if (isComplete) completeCount++;

      const stage_breakdown: StageBreakdown[] = Array.from(bucket.stageCount.entries())
        .map(([stage, rows]) => ({ stage, rows }))
        .sort((a, b) => b.rows - a.rows);

      rows.push({
        employee_id: eid,
        employee_name: bucket.name,
        department: bucket.dept ?? '-',
        default_stage: bucket.defaultStage,
        total_rows: bucket.rows.length,
        unique_dates: bucket.dateSet.size,
        expected_days: expectedDays,
        missing_dates: missingDates,
        missing_count: missingDates.length,
        stage_breakdown,
        complete: isComplete,
      });
    }

    // 排序：完整的在前，按部门 → 工号
    rows.sort((a, b) => {
      if (a.complete !== b.complete) return a.complete ? -1 : 1;
      if (a.missing_count !== b.missing_count) return a.missing_count - b.missing_count;
      if (a.department !== b.department) return a.department.localeCompare(b.department, 'zh');
      return a.employee_id.localeCompare(b.employee_id);
    });

    // 算显示用的闭区间 to（半开区间 [from, to) 内部转成 [from, displayTo] 展示）
    const toDateForDisplay = new Date(to + 'T00:00:00');
    toDateForDisplay.setDate(toDateForDisplay.getDate() - 1);
    const displayTo = `${toDateForDisplay.getFullYear()}-${String(toDateForDisplay.getMonth() + 1).padStart(2, '0')}-${String(toDateForDisplay.getDate()).padStart(2, '0')}`;

    const report: CheckReport = {
      from,
      to: displayTo,
      total_days: expectedDays,
      total_rows: allDaily.length,
      employee_count: emps?.length ?? 0,
      with_data: withDataCount,
      complete_count: completeCount,
      missing_count: withDataCount - completeCount,
      no_data_count: noDataCount,
      rows,
    };

    return ok(report);
  } catch (e: any) {
    return fail(e.message ?? '数据检查失败');
  }
}
