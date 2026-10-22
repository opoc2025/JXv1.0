-- ========================================
-- 金融催收薪酬系统 Supabase 建表脚本
-- 在 Supabase Dashboard → SQL Editor 中直接运行
-- ========================================

-- 启用 UUID 扩展（可选，本项目用 serial）
create extension if not exists "pgcrypto";

-- ========================================
-- 0. 健康检查表
-- ========================================
create table if not exists health_check (
    id serial primary key,
    updated_at timestamptz default now()
);

-- ========================================
-- 1. 员工档案
-- ========================================
create table if not exists employee (
    employee_id varchar(32) primary key,
    employee_name varchar(64) not null,
    department varchar(64),
    default_stage varchar(64) not null,
    commission_plan varchar(8) not null default 'A',
    status varchar(16) not null default 'active',
    created_at timestamptz default now() not null
);

create index if not exists employee_status_idx on employee(status);
create index if not exists employee_default_stage_idx on employee(default_stage);

-- ========================================
-- 10. 阶段配置（自定义业务阶段）
-- ========================================
create table if not exists stage_config (
    stage_id serial primary key,
    stage_code varchar(32) not null unique,
    stage_name varchar(64) not null unique,
    sort_order integer not null default 0,
    enabled boolean not null default true,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

create index if not exists stage_config_enabled_idx on stage_config(enabled);

-- ========================================
-- 11. 员工-阶段关联
-- ========================================
create table if not exists employee_stage (
    id serial primary key,
    employee_id varchar(32) not null references employee(employee_id) on delete cascade,
    stage_name varchar(64) not null references stage_config(stage_name) on delete restrict on update cascade,
    is_primary boolean not null default false,
    sort_order integer not null default 0,
    created_at timestamptz default now(),
    unique (employee_id, stage_name)
);

create index if not exists employee_stage_emp_idx on employee_stage(employee_id);
create index if not exists employee_stage_stage_idx on employee_stage(stage_name);

-- ========================================
-- 2. 薪酬规则配置主表（提成方案）
-- ========================================
create table if not exists salary_rule_config (
    rule_id serial primary key,
    stage_name varchar(64) not null,
    rule_type varchar(32) not null,
    metric varchar(32),
    rule_name varchar(128) not null,
    enabled boolean not null default true,
    created_at timestamptz default now() not null
);

create index if not exists salary_rule_stage_type_idx on salary_rule_config(stage_name, rule_type);

-- ========================================
-- 3. 阶梯明细
-- ========================================
create table if not exists rule_tier_detail (
    detail_id serial primary key,
    rule_id integer not null references salary_rule_config(rule_id) on delete cascade,
    min_val numeric(14, 2) not null default 0,
    max_val numeric(14, 2),
    reward_type varchar(16) not null,
    reward_value numeric(14, 4) not null,
    sort_order integer not null default 0
);

create index if not exists rule_tier_detail_rule_id_idx on rule_tier_detail(rule_id);

-- ========================================
-- 4. 每日业务明细
-- ========================================
create table if not exists import_daily_data (
    id serial primary key,
    batch_no varchar(40) not null,
    employee_id varchar(32) not null references employee(employee_id) on delete cascade,
    stage varchar(64) not null,
    date date not null,
    recovered_orders integer not null default 0,
    recovered_amount numeric(14, 2) not null default 0,
    target_recovery_rate numeric(7, 2),  -- 订单达成率
    total_orders integer,                  -- 当日分配订单总数（目标单数）
    total_amount numeric(14, 2),           -- 当日分配订单总金额（目标金额）
    amount_achievement_rate numeric(7, 2),  -- 金额达成率 %
    created_at timestamptz default now() not null,
    unique (employee_id, stage, date)
);

create index if not exists import_daily_employee_idx on import_daily_data(employee_id);
create index if not exists import_daily_date_idx on import_daily_data(date);
create index if not exists import_daily_batch_idx on import_daily_data(batch_no);

-- ========================================
-- 5. 月度考核明细
-- ========================================
create table if not exists import_monthly_data (
    id serial primary key,
    month varchar(7) not null,
    employee_id varchar(32) not null references employee(employee_id) on delete cascade,
    stage varchar(64) not null,
    monthly_recovery_rate numeric(7, 2),
    monthly_total_amount numeric(14, 2),
    monthly_recovered_orders integer not null default 0,
    created_at timestamptz default now() not null,
    unique (month, employee_id, stage)
);

create index if not exists import_monthly_employee_idx on import_monthly_data(employee_id);
create index if not exists import_monthly_month_idx on import_monthly_data(month);

-- ========================================
-- 6. 绩效考核方案
-- ========================================
create table if not exists performance_scheme (
    scheme_id serial primary key,
    employee_id varchar(32) not null unique references employee(employee_id) on delete cascade,
    base_salary numeric(14, 2) not null default 0,
    performance_bonus numeric(14, 2) not null default 0,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

create index if not exists performance_scheme_employee_idx on performance_scheme(employee_id);

-- ========================================
-- 6.0.1 指标配置库
-- ========================================
create table if not exists metric_config (
    metric_id serial primary key,
    metric_code varchar(32) not null unique,
    metric_name varchar(64) not null,
    scope varchar(16) not null default 'BOTH',
    period varchar(16) not null default 'MONTHLY',
    source_field varchar(32) not null,
    unit varchar(8) not null default '',
    enabled boolean not null default true,
    created_at timestamptz default now()
);

create index if not exists metric_config_scope_idx on metric_config(scope);

-- ========================================
-- 6.0.2 绩效条件组（组间 OR）
-- ========================================
create table if not exists performance_condition_group (
    group_id serial primary key,
    scheme_id integer not null references performance_scheme(scheme_id) on delete cascade,
    sort_order integer not null default 0
);

create index if not exists performance_condition_group_scheme_idx on performance_condition_group(scheme_id);

-- ========================================
-- 6.1 绩效条件（组内 AND）
-- ========================================
create table if not exists performance_condition (
    condition_id serial primary key,
    group_id integer not null references performance_condition_group(group_id) on delete cascade,
    metric varchar(32) not null,
    operator varchar(8) not null default 'GTE',
    threshold_value numeric(14, 2) not null,
    sort_order integer not null default 0
);

create index if not exists performance_condition_group_fk_idx on performance_condition(group_id);

-- ========================================
-- 7. 薪酬结算结果
-- ========================================
create table if not exists salary_settlement_result (
    settlement_id serial primary key,
    month varchar(7) not null,
    employee_id varchar(32) not null references employee(employee_id) on delete cascade,
    stage varchar(64) not null,
    base_salary numeric(14, 2) not null default 0,
    monthly_performance_bonus numeric(14, 2) not null default 0,
    daily_commission numeric(14, 2) not null default 0,
    monthly_total_commission numeric(14, 2) not null default 0,
    stage_tier_commission numeric(14, 2) not null default 0,
    total_salary numeric(14, 2) not null default 0,
    status varchar(16) not null default 'DRAFT',
    detail jsonb,
    created_at timestamptz default now(),
    updated_at timestamptz default now(),
    unique (month, employee_id)
);

create index if not exists salary_settlement_month_idx on salary_settlement_result(month);
create index if not exists salary_settlement_status_idx on salary_settlement_result(status);

-- ========================================
-- 启用 RLS（Supabase 默认启用），允许 service_role 访问
-- 本项目用 service_role key 直连后端，无登录系统
-- 对所有业务表禁用 RLS，或保留 RLS 但不设置 policy（service_role 自带全权限）
-- 推荐方式：保留 RLS，不添加 policy，service_role 绕过 RLS
-- ========================================

alter table health_check enable row level security;
alter table employee enable row level security;
alter table stage_config enable row level security;
alter table employee_stage enable row level security;
alter table salary_rule_config enable row level security;
alter table rule_tier_detail enable row level security;
alter table import_daily_data enable row level security;
alter table import_monthly_data enable row level security;
alter table performance_scheme enable row level security;
alter table metric_config enable row level security;
alter table performance_condition_group enable row level security;
alter table performance_condition enable row level security;
alter table salary_settlement_result enable row level security;
