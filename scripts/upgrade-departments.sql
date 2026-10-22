-- ============================================================
-- 部门关联架构升级（2026-10-16）
-- 1) 新增 department_config 部门库
-- 2) performance_scheme 从 employee_id 改成 dept_name（一部门一份）
-- 3) salary_rule_config 加 dept_name（可空：空=全部门通用）
-- ============================================================

-- ① 新建部门配置表
CREATE TABLE IF NOT EXISTS department_config (
    dept_id serial PRIMARY KEY,
    dept_code varchar(32) NOT NULL UNIQUE,
    dept_name varchar(64) NOT NULL UNIQUE,
    sort_order integer NOT NULL DEFAULT 0,
    enabled boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS department_config_enabled_idx ON department_config(enabled);

-- ② salary_rule_config 加 dept_name
ALTER TABLE salary_rule_config ADD COLUMN IF NOT EXISTS dept_name varchar(64);

-- ③ performance_scheme 重构：从 employee_id（按员工）改成 dept_name（按部门）
-- 先看现状：如果 employee_id 存在且 dept_name 不存在，先迁移旧数据
DO $$
DECLARE
    old_col_exists boolean;
BEGIN
    SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'performance_scheme' AND column_name = 'employee_id') INTO old_col_exists;

    IF old_col_exists THEN
        -- 新增 dept_name 列
        ALTER TABLE performance_scheme ADD COLUMN IF NOT EXISTS dept_name varchar(64) UNIQUE;

        -- 尝试从 employee.department 回填（如果员工有部门）
        UPDATE performance_scheme ps
        SET dept_name = e.department
        FROM employee e
        WHERE ps.employee_id = e.employee_id
          AND e.department IS NOT NULL;

        -- 把 dept_name 设为 NOT NULL（只在有成功回填的情况下）
        -- 注意：如果有 scheme 无法关联到 employee 或 employee 没部门，会失败
        -- 此时用户需要手动处理这些孤立行，或我们改成跳过 NOT NULL 约束
        BEGIN
            ALTER TABLE performance_scheme ALTER COLUMN dept_name SET NOT NULL;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE '某些行没有 dept_name，暂不设置 NOT NULL，请手动处理';
        END;

        -- 删除旧的 employee_id + 关联
        ALTER TABLE performance_scheme DROP CONSTRAINT IF EXISTS performance_scheme_employee_id_key;
        ALTER TABLE performance_scheme DROP CONSTRAINT IF EXISTS performance_scheme_employee_id_fkey;
        ALTER TABLE performance_scheme DROP COLUMN IF EXISTS employee_id;
    END IF;
END $$;
