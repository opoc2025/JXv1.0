-- ========================================
-- 修复：employee_stage FK 缺少 ON UPDATE CASCADE
-- 改名时 Postgres 不会自动级联同步引用表
-- 在 Supabase Dashboard → SQL Editor 中运行
-- ========================================

-- 1. 删除旧约束，重建带 ON UPDATE CASCADE
ALTER TABLE employee_stage
  DROP CONSTRAINT IF EXISTS employee_stage_stage_name_fkey;

ALTER TABLE employee_stage
  ADD CONSTRAINT employee_stage_stage_name_fkey
  FOREIGN KEY (stage_name)
  REFERENCES stage_config(stage_name)
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

-- 2. 同时检查其他引用表（虽然 salary_rule_config / import_daily_data / import_monthly_data / employee.default_stage
--    目前没有显式 FK 约束，但如果以后加了也需要注意）

-- 验证
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'employee_stage'::regclass;
