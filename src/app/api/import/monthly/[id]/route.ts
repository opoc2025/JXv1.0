import { getSupabaseClient } from '@/storage/database/supabase-client';
import { ok, fail } from '@/lib/api-helpers';

export const dynamic = 'force-dynamic';

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const client = getSupabaseClient();
  const { error } = await client
    .from('import_monthly_data')
    .delete()
    .eq('id', Number(id));
  if (error) return fail(`删除月度数据失败: ${error.message}`, 500);
  return ok({ id: Number(id) });
}
