-- ========================================
-- import_daily_data 新列：总单数 / 总金额 / 金额达成率
-- 在 Supabase Dashboard → SQL Editor 中运行
-- ========================================

alter table import_daily_data add column if not exists total_orders integer;
alter table import_daily_data add column if not exists total_amount numeric(14, 2);
alter table import_daily_data add column if not exists amount_achievement_rate numeric(7, 2);

comment on column import_daily_data.total_orders is '当日分配订单总数（目标单数）';
comment on column import_daily_data.total_amount is '当日分配订单总金额（目标金额）';
comment on column import_daily_data.amount_achievement_rate is '金额达成率 %';
