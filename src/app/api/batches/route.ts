import { getSupabaseClient } from '@/storage/database/supabase-client';
import { ok, fail } from '@/lib/api-helpers';

export const dynamic = 'force-dynamic';

// GET /api/batches — 批次列表（含行数）
export async function GET() {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('import_daily_data')
    .select('batch_no, created_at, id')
    .order('id', { ascending: false });
  if (error) return fail(`查询批次失败: ${error.message}`, 500);

  const map = new Map<string, { batch_no: string; rows: number; created_at: string }>();
  (data ?? []).forEach((r) => {
    const row = r as { batch_no: string; created_at: string };
    const cur = map.get(row.batch_no);
    if (cur) cur.rows += 1;
    else map.set(row.batch_no, { batch_no: row.batch_no, rows: 1, created_at: row.created_at });
  });
  return ok([...map.values()]);
}

interface DeleteBody {
  batch_no?: string;
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const batchNo = url.searchParams.get('batch_no');
  const body = (await req.json().catch(() => ({}))) as DeleteBody;
  const target = batchNo ?? body.batch_no;
  if (!target) return fail('batch_no 必填');
  const client = getSupabaseClient();
  const { error } = await client
    .from('import_daily_data')
    .delete()
    .eq('batch_no', target);
  if (error) return fail(`删除批次失败: ${error.message}`, 500);
  return ok({ batch_no: target });
}
