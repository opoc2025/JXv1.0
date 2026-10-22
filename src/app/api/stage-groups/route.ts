import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export const dynamic = 'force-dynamic';

export async function GET() {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('stage_group')
    .select('group_id,group_name,description,sort_order,enabled,created_at,stage_group_member(stage_name)')
    .order('sort_order')
    .order('group_name');
  if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  const groups = (data ?? []).map((g: any) => ({
    ...g,
    stage_names: (g.stage_group_member ?? []).map((m: any) => m.stage_name),
  }));
  return NextResponse.json({ ok: true, data: groups });
}

export async function POST(req: Request) {
  const client = getSupabaseClient();
  const body = await req.json();
  const { group_name, description, stage_names = [], sort_order = 0 } = body ?? {};
  if (!group_name) return NextResponse.json({ ok: false, message: '合并组名必填' }, { status: 400 });
  if (!Array.isArray(stage_names) || stage_names.length < 2)
    return NextResponse.json({ ok: false, message: '至少选择 2 个阶段' }, { status: 400 });

  // 检查阶段都存在
  const { data: stages, error: sErr } = await client
    .from('stage_config')
    .select('stage_name')
    .in('stage_name', stage_names);
  if (sErr) return NextResponse.json({ ok: false, message: sErr.message }, { status: 500 });
  if ((stages?.length ?? 0) !== stage_names.length)
    return NextResponse.json({ ok: false, message: '包含不存在的阶段' }, { status: 400 });

  // 创建合并组
  const { data: group, error: gErr } = await client
    .from('stage_group')
    .insert({ group_name, description, sort_order })
    .select()
    .single();
  if (gErr) return NextResponse.json({ ok: false, message: gErr.message }, { status: 400 });

  // 添加成员
  const members = stage_names.map((stage_name: string) => ({
    group_id: group.group_id,
    stage_name,
  }));
  const { error: mErr } = await client.from('stage_group_member').insert(members);
  if (mErr) return NextResponse.json({ ok: false, message: mErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, data: { ...group, stage_names } });
}

export async function PATCH(req: Request) {
  const client = getSupabaseClient();
  const body = await req.json();
  const { group_id, group_name, description, stage_names, sort_order, enabled } = body ?? {};
  if (!group_id) return NextResponse.json({ ok: false, message: 'group_id 必填' }, { status: 400 });

  const updates: any = {};
  if (group_name !== undefined) updates.group_name = group_name;
  if (description !== undefined) updates.description = description;
  if (sort_order !== undefined) updates.sort_order = sort_order;
  if (enabled !== undefined) updates.enabled = enabled;

  if (Object.keys(updates).length > 0) {
    const { error } = await client.from('stage_group').update(updates).eq('group_id', group_id);
    if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 400 });
  }

  if (Array.isArray(stage_names)) {
    if (stage_names.length < 2)
      return NextResponse.json({ ok: false, message: '至少 2 个阶段' }, { status: 400 });
    // 清空旧成员 + 插入新成员
    await client.from('stage_group_member').delete().eq('group_id', group_id);
    const members = stage_names.map((s) => ({ group_id, stage_name: s }));
    const { error } = await client.from('stage_group_member').insert(members);
    if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  }

  const { data: final } = await client
    .from('stage_group')
    .select('group_id,group_name,description,sort_order,enabled,created_at,stage_group_member(stage_name)')
    .eq('group_id', group_id)
    .single();
  const g: any = final;
  return NextResponse.json({
    ok: true,
    data: { ...g, stage_names: (g.stage_group_member ?? []).map((m: any) => m.stage_name) },
  });
}

export async function DELETE(req: Request) {
  const client = getSupabaseClient();
  const url = new URL(req.url);
  const id = Number(url.searchParams.get('id'));
  if (!id) return NextResponse.json({ ok: false, message: 'id 必填' }, { status: 400 });

  // 删除保护：有员工引用
  const { data: refs } = await client.from('employee').select('employee_id').eq('stage_group_id', id).limit(1);
  if (refs && refs.length > 0)
    return NextResponse.json({ ok: false, message: '有员工引用此合并组，无法删除' }, { status: 400 });

  const { error } = await client.from('stage_group').delete().eq('group_id', id);
  if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
