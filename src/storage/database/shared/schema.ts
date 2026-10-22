import { pgTable, serial, varchar, integer, boolean, numeric, date, text, jsonb, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"


export const healthCheck = pgTable("health_check", {
	id: serial().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
});

// 0. 部门配置表（自定义业务部门，如催收一部、催收二部；部门自定义维护）
export const departmentConfig = pgTable(
	"department_config",
	{
		dept_id: serial("dept_id").primaryKey(),
		dept_code: varchar("dept_code", { length: 32 }).notNull().unique(),
		dept_name: varchar("dept_name", { length: 64 }).notNull().unique(),
		sort_order: integer("sort_order").notNull().default(0),
		enabled: boolean("enabled").notNull().default(true),
		created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
		updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
	},
	(table) => [
		index("department_config_enabled_idx").on(table.enabled),
	]
);

// 1. 员工信息表
export const employee = pgTable(
	"employee",
	{
		employee_id: varchar("employee_id", { length: 32 }).primaryKey(),
		employee_name: varchar("employee_name", { length: 64 }).notNull(),
		// 部门引用（字符串，API 层校验 department_config 合法性）
		department: varchar("department", { length: 64 }),
		default_stage: varchar("default_stage", { length: 64 }).notNull(),
		// 月度提成方式: A = 月度总回款提点, B = 分阶段金额提点, NONE = 无月度提成
		commission_plan: varchar("commission_plan", { length: 8 }).notNull().default("A"),
		// 日提成开关: true = 参与 DAILY_STEP 日达成提成计算, false = 不参与
		has_daily_commission: boolean("has_daily_commission").notNull().default(true),
		// 阶段合并组: 非空则该组内阶段的日/月B提成合并计算；null = 各阶段独立
		stage_group_id: integer("stage_group_id"),
		status: varchar("status", { length: 16 }).notNull().default("active"),
		// 工资收款码：支持 base64 DataURL 或远程图片 URL
		salary_qr_code_url: text("salary_qr_code_url"),
		created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
	},
	(table) => [
		index("employee_status_idx").on(table.status),
		index("employee_default_stage_idx").on(table.default_stage),
		index("employee_department_idx").on(table.department),
	]
);

// 2. 薪酬规则配置主表（按 dept_name + stage_name + rule_type 匹配，dept_name 为空=全部门通用）
export const salaryRuleConfig = pgTable(
	"salary_rule_config",
	{
		rule_id: serial("rule_id").primaryKey(),
		// 部门引用（可空：空=全部门通用，优先级低于具体部门规则）
		dept_name: varchar("dept_name", { length: 64 }),
		stage_name: varchar("stage_name", { length: 64 }).notNull(),
		// BASE_SALARY | MONTHLY_THRESHOLD | DAILY_STEP | MONTHLY_TOTAL_TIER | STAGE_AMOUNT_TIER
		rule_type: varchar("rule_type", { length: 32 }).notNull(),
		// DAILY_STEP: RATE | ORDERS | AMOUNT ; MONTHLY_THRESHOLD: RATE | AMOUNT
		metric: varchar("metric", { length: 16 }),
		rule_name: varchar("rule_name", { length: 128 }).notNull(),
		enabled: boolean("enabled").notNull().default(true),
		// === 排名择优（可选，只给最优者发奖）===
		// 空 = 不排名（默认）
		// DAY_STAGE = 同天同阶段排名
		// DAY_DEPT  = 同天同部门排名
		// DAY_ALL   = 同天全公司排名
		// WEEK_STAGE / WEEK_DEPT / WEEK_ALL = 同理周维度
		rank_scope: varchar("rank_scope", { length: 16 }),
		// 主排名指标（metric_code），按该指标降序取第一
		rank_best_by: varchar("rank_best_by", { length: 32 }),
		// 平票时比较指标（metric_code），空则按 employee_id 决定
		rank_tiebreaker: varchar("rank_tiebreaker", { length: 32 }),
		created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
	},
	(table) => [
		index("salary_rule_stage_type_idx").on(table.stage_name, table.rule_type),
	]
);

// 3. 阶梯明细配置表
export const ruleTierDetail = pgTable(
	"rule_tier_detail",
	{
		detail_id: serial("detail_id").primaryKey(),
		rule_id: integer("rule_id").notNull().references(() => salaryRuleConfig.rule_id, { onDelete: "cascade" }),
		min_val: numeric("min_val", { precision: 14, scale: 2 }).notNull().default(sql`0`),
		max_val: numeric("max_val", { precision: 14, scale: 2 }),
		// FIXED_AMOUNT | PERCENTAGE | UNIT_PRICE
		reward_type: varchar("reward_type", { length: 16 }).notNull(),
		reward_value: numeric("reward_value", { precision: 14, scale: 4 }).notNull(),
		sort_order: integer("sort_order").notNull().default(0),
	},
	(table) => [
		index("rule_tier_detail_rule_id_idx").on(table.rule_id),
	]
);

// 4. 每日业务明细导入表
export const importDailyData = pgTable(
	"import_daily_data",
	{
		id: serial("id").primaryKey(),
		batch_no: varchar("batch_no", { length: 40 }).notNull(),
		employee_id: varchar("employee_id", { length: 32 }).notNull().references(() => employee.employee_id, { onDelete: "cascade" }),
		stage: varchar("stage", { length: 64 }).notNull(),
		date: date("date", { mode: "string" }).notNull(),
		recovered_orders: integer("recovered_orders").notNull().default(0),
		recovered_amount: numeric("recovered_amount", { precision: 14, scale: 2 }).notNull().default(sql`0`),
		// 订单达成率（原"达成率"，字段名保留兼容）
		target_recovery_rate: numeric("target_recovery_rate", { precision: 7, scale: 2 }),
		// 当日分配订单总数（目标单数）
		total_orders: integer("total_orders"),
		// 当日分配订单总金额（目标金额）
		total_amount: numeric("total_amount", { precision: 14, scale: 2 }),
		// 金额达成率 %
		amount_achievement_rate: numeric("amount_achievement_rate", { precision: 7, scale: 2 }),
		created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex("import_daily_unique_idx").on(table.employee_id, table.stage, table.date),
		index("import_daily_employee_idx").on(table.employee_id),
		index("import_daily_date_idx").on(table.date),
		index("import_daily_batch_idx").on(table.batch_no),
	]
);

// 5. 月度考核明细导入表
export const importMonthlyData = pgTable(
	"import_monthly_data",
	{
		id: serial("id").primaryKey(),
		month: varchar("month", { length: 7 }).notNull(),
		employee_id: varchar("employee_id", { length: 32 }).notNull().references(() => employee.employee_id, { onDelete: "cascade" }),
		stage: varchar("stage", { length: 16 }).notNull(),
		monthly_recovery_rate: numeric("monthly_recovery_rate", { precision: 7, scale: 2 }),
		monthly_total_amount: numeric("monthly_total_amount", { precision: 14, scale: 2 }),
		monthly_recovered_orders: integer("monthly_recovered_orders").notNull().default(0),
		created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex("import_monthly_unique_idx").on(table.month, table.employee_id, table.stage),
		index("import_monthly_employee_idx").on(table.employee_id),
		index("import_monthly_month_idx").on(table.month),
	]
);

// 6. 绩效考核方案表（绑定部门：一部门一份，整月判定、与阶段无关）
export const performanceScheme = pgTable(
	"performance_scheme",
	{
		scheme_id: serial("scheme_id").primaryKey(),
		// 部门名称（一部门一份方案，部门内员工共享）
		dept_name: varchar("dept_name", { length: 64 }).notNull().unique(),
		// 基本工资（底薪）
		base_salary: numeric("base_salary", { precision: 14, scale: 2 }).notNull().default(sql`0`),
		// 绩效工资（门槛条件组任一达成后发放）
		performance_bonus: numeric("performance_bonus", { precision: 14, scale: 2 }).notNull().default(sql`0`),
		created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
		updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
	},
	(table) => [
		index("performance_scheme_dept_idx").on(table.dept_name),
	]
);

// 6.0.1 指标配置库（自定义指标：考核与提成共用）
export const metricConfig = pgTable(
	"metric_config",
	{
		metric_id: serial("metric_id").primaryKey(),
		// 指标编码（唯一，条件/规则通过 code 引用）
		metric_code: varchar("metric_code", { length: 32 }).notNull().unique(),
		// 指标显示名（如 订单回收率、金额回款率、订单数量、日回款金额）
		metric_name: varchar("metric_name", { length: 64 }).notNull(),
		// 适用场景: PERF = 绩效考核, COMMISSION = 提成, BOTH = 通用
		scope: varchar("scope", { length: 16 }).notNull().default("BOTH"),
		// 数据来源阶段: MONTHLY | DAILY
		period: varchar("period", { length: 16 }).notNull().default("MONTHLY"),
		// 取值字段名（映射到 import_monthly_data / import_daily_data 的列）
		//   月度: monthly_recovery_rate | monthly_total_amount | monthly_recovered_orders
		//   日:   target_recovery_rate | recovered_amount | recovered_orders
		source_field: varchar("source_field", { length: 32 }).notNull(),
		// 单位: % | ฿ | 单
		unit: varchar("unit", { length: 8 }).notNull().default(""),
		enabled: boolean("enabled").notNull().default(true),
		created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
	},
	(table) => [
		index("metric_config_scope_idx").on(table.scope),
	]
);

// 6.0.2 绩效考核门槛条件组（组间 OR；组内条件 AND）
export const performanceConditionGroup = pgTable(
	"performance_condition_group",
	{
		group_id: serial("group_id").primaryKey(),
		scheme_id: integer("scheme_id").notNull().references(() => performanceScheme.scheme_id, { onDelete: "cascade" }),
		sort_order: integer("sort_order").notNull().default(0),
	},
	(table) => [
		index("performance_condition_group_scheme_idx").on(table.scheme_id),
	]
);

// 6.1 绩效考核门槛条件子表（隶属某个条件组；组内 AND、组间 OR）
export const performanceCondition = pgTable(
	"performance_condition",
	{
		condition_id: serial("condition_id").primaryKey(),
		group_id: integer("group_id").notNull().references(() => performanceConditionGroup.group_id, { onDelete: "cascade" }),
		// 关联指标库编码（如 RATE、AMOUNT、ORDERS 或自定义）
		metric: varchar("metric", { length: 32 }).notNull(),
		// 比较符: GTE >= | LTE <= | GT > | LT <
		operator: varchar("operator", { length: 8 }).notNull().default("GTE"),
		// 门槛值（如 40、200000、300 单）
		threshold_value: numeric("threshold_value", { precision: 14, scale: 2 }).notNull(),
		sort_order: integer("sort_order").notNull().default(0),
	},
	(table) => [
		index("performance_condition_group_fk_idx").on(table.group_id),
	]
);

// 7. 薪酬结算结果汇总表
export const salarySettlementResult = pgTable(
	"salary_settlement_result",
	{
		settlement_id: serial("settlement_id").primaryKey(),
		month: varchar("month", { length: 7 }).notNull(),
		employee_id: varchar("employee_id", { length: 32 }).notNull().references(() => employee.employee_id, { onDelete: "cascade" }),
		stage: varchar("stage", { length: 64 }).notNull(),
		base_salary: numeric("base_salary", { precision: 14, scale: 2 }).notNull().default(sql`0`),
		monthly_performance_bonus: numeric("monthly_performance_bonus", { precision: 14, scale: 2 }).notNull().default(sql`0`),
		daily_commission: numeric("daily_commission", { precision: 14, scale: 2 }).notNull().default(sql`0`),
		monthly_total_commission: numeric("monthly_total_commission", { precision: 14, scale: 2 }).notNull().default(sql`0`),
		stage_tier_commission: numeric("stage_tier_commission", { precision: 14, scale: 2 }).notNull().default(sql`0`),
		progressive_commission: numeric("progressive_commission", { precision: 14, scale: 2 }).notNull().default(sql`0`),
		actual_base_salary: numeric("actual_base_salary", { precision: 14, scale: 2 }).notNull().default(sql`0`),
		full_attendance_bonus: numeric("full_attendance_bonus", { precision: 14, scale: 2 }).notNull().default(sql`0`),
		total_salary: numeric("total_salary", { precision: 14, scale: 2 }).notNull().default(sql`0`),
		// DRAFT | FINALIZED
		status: varchar("status", { length: 16 }).notNull().default("DRAFT"),
		// 计算明细快照（分阶段、分日的命中规则与金额）
		detail: jsonb("detail"),
		created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
		updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex("salary_settlement_unique_idx").on(table.month, table.employee_id),
		index("salary_settlement_month_idx").on(table.month),
		index("salary_settlement_status_idx").on(table.status),
	]
);

// 10. 阶段配置表（自定义业务阶段，如 D0/T1/T2）
export const stageConfig = pgTable(
	"stage_config",
	{
		stage_id: serial("stage_id").primaryKey(),
		stage_code: varchar("stage_code", { length: 32 }).notNull().unique(),
		stage_name: varchar("stage_name", { length: 64 }).notNull().unique(),
		sort_order: integer("sort_order").notNull().default(0),
		enabled: boolean("enabled").notNull().default(true),
		created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
		updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
	},
	(table) => [
		index("stage_config_enabled_idx").on(table.enabled),
	]
);

// 11. 员工-阶段关联表（员工可参与多个阶段，is_primary 标记主阶段）
export const employeeStage = pgTable(
	"employee_stage",
	{
		id: serial("id").primaryKey(),
		employee_id: varchar("employee_id", { length: 32 }).notNull().references(() => employee.employee_id, { onDelete: "cascade" }),
		stage_name: varchar("stage_name", { length: 64 }).notNull().references(() => stageConfig.stage_name, { onDelete: "restrict", onUpdate: "cascade" }),
		is_primary: boolean("is_primary").notNull().default(false),
		sort_order: integer("sort_order").notNull().default(0),
		created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex("employee_stage_unique_idx").on(table.employee_id, table.stage_name),
		index("employee_stage_emp_idx").on(table.employee_id),
		index("employee_stage_stage_idx").on(table.stage_name),
	]
);

// 12. 全局阶段合并组（共享：多个员工可引用同一个组）
// 场景：员工负责多个阶段，日提成/月B 按组内总额合并匹配一条规则
export const stageGroup = pgTable(
	"stage_group",
	{
		group_id: serial("group_id").primaryKey(),
		group_name: varchar("group_name", { length: 64 }).notNull().unique(),
		description: varchar("description", { length: 256 }),
		sort_order: integer("sort_order").notNull().default(0),
		enabled: boolean("enabled").notNull().default(true),
		created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
	},
	(table) => [
		index("stage_group_enabled_idx").on(table.enabled),
	]
);

// 12.1 合并组成员阶段（多对多）
export const stageGroupMember = pgTable(
	"stage_group_member",
	{
		id: serial("id").primaryKey(),
		group_id: integer("group_id").notNull().references(() => stageGroup.group_id, { onDelete: "cascade" }),
		stage_name: varchar("stage_name", { length: 64 }).notNull().references(() => stageConfig.stage_name, { onDelete: "cascade", onUpdate: "cascade" }),
	},
	(table) => [
		uniqueIndex("stage_group_member_unique_idx").on(table.group_id, table.stage_name),
		index("stage_group_member_group_idx").on(table.group_id),
	]
);

// 12.2 员工-合并组多对多关联（一个员工可引用多个合并组）
export const employeeStageGroup = pgTable(
	"employee_stage_group",
	{
		id: serial("id").primaryKey(),
		employee_id: varchar("employee_id", { length: 32 }).notNull().references(() => employee.employee_id, { onDelete: "cascade" }),
		group_id: integer("group_id").notNull().references(() => stageGroup.group_id, { onDelete: "cascade" }),
	},
	(table) => [
		uniqueIndex("employee_stage_group_unique_idx").on(table.employee_id, table.group_id),
		index("employee_stage_group_emp_idx").on(table.employee_id),
	]
);

// 12. 薪酬调整表（实发底薪 + 全勤奖，月度覆盖导入）
export const salaryAdjustment = pgTable(
	"salary_adjustment",
	{
		id: serial("id").primaryKey(),
		month: varchar("month", { length: 7 }).notNull(), // YYYY-MM
		employee_id: varchar("employee_id", { length: 32 }).notNull().references(() => employee.employee_id, { onDelete: "cascade" }),
		actual_base_salary: numeric("actual_base_salary", { precision: 14, scale: 2 }).notNull().default(sql`0`),
		full_attendance_bonus: numeric("full_attendance_bonus", { precision: 14, scale: 2 }).notNull().default(sql`0`),
		remark: varchar("remark", { length: 500 }),
		batch_id: integer("batch_id"),
		created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex("salary_adjustment_unique_idx").on(table.month, table.employee_id),
		index("salary_adjustment_month_idx").on(table.month),
		index("salary_adjustment_batch_idx").on(table.batch_id),
	]
);

// 13. 奖励条件组（DAILY_REWARD_TIER / WEEKLY_REWARD_TIER 两种规则共用）
export const rewardConditionGroup = pgTable(
	"salary_condition_group",
	{
		id: serial("id").primaryKey(),
		rule_id: integer("rule_id").notNull().references(() => salaryRuleConfig.rule_id, { onDelete: "cascade" }),
		rule_type: varchar("rule_type", { length: 32 }).notNull(),
		sort_order: integer("sort_order").notNull().default(0),
	},
	(table) => [
		index("reward_cond_group_rule_idx").on(table.rule_id, table.rule_type),
		index("reward_cond_group_sort_idx").on(table.sort_order),
	]
);

// 15. 奖励条件明细（组内 AND、组间 OR）
export const rewardCondition = pgTable(
	"salary_condition",
	{
		id: serial("id").primaryKey(),
		group_id: integer("group_id").notNull().references(() => rewardConditionGroup.id, { onDelete: "cascade" }),
		metric_code: varchar("metric_code", { length: 64 }).notNull(),
		operator: varchar("operator", { length: 4 }).notNull().default("GTE"),
		threshold_value: numeric("threshold_value", { precision: 14, scale: 2 }).notNull(),
		sort_order: integer("sort_order").notNull().default(0),
	},
	(table) => [
		index("reward_cond_group_fk_idx").on(table.group_id),
		index("reward_cond_sort_idx").on(table.sort_order),
	]
);

// 16. 统一奖励结算表（日奖励 + 周奖励共用，period 字段区分 DAILY/WEEKLY）
export const weeklyRewardSettlement = pgTable(
	"weekly_reward_settlement",
	{
		settlement_id: serial("settlement_id").primaryKey(),
		period: varchar("period", { length: 8 }).notNull(),       // 'DAILY' | 'WEEKLY'
		period_key: varchar("period_key", { length: 16 }).notNull(), // '2026-09-15' | '2026-W37'
		employee_id: varchar("employee_id", { length: 32 }).notNull().references(() => employee.employee_id, { onDelete: "cascade" }),
		dept_name: varchar("dept_name", { length: 64 }),
		stage: varchar("stage", { length: 64 }).notNull().default("ALL"),
		total_reward: numeric("total_reward", { precision: 14, scale: 2 }).notNull().default(sql`0`),
		tier_detail: jsonb("tier_detail"),
		status: varchar("status", { length: 16 }).notNull().default("DRAFT"),
		created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex("reward_settlement_unique_idx").on(table.period, table.period_key, table.employee_id, table.stage),
		index("reward_settlement_period_idx").on(table.period, table.period_key),
		index("reward_settlement_status_idx").on(table.status),
	]
);

// ============ 借款模块 ============

// 17. 借款记录（员工向公司借支）
export const loanRecord = pgTable(
	"loan_record",
	{
		loan_id: serial("loan_id").primaryKey(),
		employee_id: varchar("employee_id", { length: 32 }).notNull().references(() => employee.employee_id, { onDelete: "cascade" }),
		loan_date: date("loan_date", { mode: "string" }).notNull(),
		amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
		repaid_amount: numeric("repaid_amount", { precision: 14, scale: 2 }).notNull().default(sql`0`),
		status: varchar("status", { length: 16 }).notNull().default("OUTSTANDING"), // OUTSTANDING | CLEARED
		remark: text("remark"),
		// 来源：MANUAL（手工登记）| PAYROLL（工资发放自动冲减）
		source: varchar("source", { length: 16 }).notNull().default("MANUAL"),
		created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
	},
	(table) => [
		index("loan_record_emp_idx").on(table.employee_id),
		index("loan_record_status_idx").on(table.status),
		index("loan_record_date_idx").on(table.loan_date),
	]
);

// 17.1 还款/冲减明细（每次还款或工资冲减都记一条）
export const loanRepayLog = pgTable(
	"loan_repay_log",
	{
		log_id: serial("log_id").primaryKey(),
		loan_id: integer("loan_id").notNull().references(() => loanRecord.loan_id, { onDelete: "cascade" }),
		employee_id: varchar("employee_id", { length: 32 }).notNull().references(() => employee.employee_id, { onDelete: "cascade" }),
		repay_date: date("repay_date", { mode: "string" }).notNull(),
		amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
		// MANUAL = 手工还款 | PAYROLL_MONTHLY = 月工资冲减 | REWARD_WEEKLY = 周奖励冲减
		source: varchar("source", { length: 24 }).notNull().default("MANUAL"),
		ref_key: varchar("ref_key", { length: 32 }), // 关联发放 period_key，如 '2026-09' / '2026-W40'
		remark: text("remark"),
		created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
	},
	(table) => [
		index("loan_repay_log_loan_idx").on(table.loan_id),
		index("loan_repay_log_emp_idx").on(table.employee_id),
		index("loan_repay_log_date_idx").on(table.repay_date),
	]
);

// ============ 发放模块 ============

// 18. 工资发放快照（按月，从 salary_settlement_result 复制）
export const payrollDisbursement = pgTable(
	"payroll_disbursement",
	{
		id: serial("id").primaryKey(),
		period_key: varchar("period_key", { length: 16 }).notNull(), // '2026-09'
		employee_id: varchar("employee_id", { length: 32 }).notNull().references(() => employee.employee_id, { onDelete: "cascade" }),
		dept_name: varchar("dept_name", { length: 64 }),
		// === 快照字段（从 salary_settlement_result 复制）===
		base_salary: numeric("base_salary", { precision: 14, scale: 2 }).notNull().default(sql`0`), // 底薪
		performance_bonus: numeric("performance_bonus", { precision: 14, scale: 2 }).notNull().default(sql`0`), // 绩效工资
		full_attendance_bonus: numeric("full_attendance_bonus", { precision: 14, scale: 2 }).notNull().default(sql`0`), // 全勤
		gross_salary: numeric("gross_salary", { precision: 14, scale: 2 }).notNull().default(sql`0`), // 基础工资小计
		commission: numeric("commission", { precision: 14, scale: 2 }).notNull().default(sql`0`), // 提成合计
		gross_total: numeric("gross_total", { precision: 14, scale: 2 }).notNull().default(sql`0`), // 工资合计
		// === 借款 ===
		loan_deduction: numeric("loan_deduction", { precision: 14, scale: 2 }).notNull().default(sql`0`), // 抵扣金额（可改）
		loan_deduction_override: boolean("loan_deduction_override").notNull().default(false),
		loan_remaining_before: numeric("loan_remaining_before", { precision: 14, scale: 2 }).notNull().default(sql`0`), // 发放前未清借款
		// === 实发 ===
		net_pay: numeric("net_pay", { precision: 14, scale: 2 }).notNull().default(sql`0`), // 实发（可改）
		net_pay_override: boolean("net_pay_override").notNull().default(false),
		// === 状态 ===
		status: varchar("status", { length: 16 }).notNull().default("PENDING"), // PENDING | PAID | CANCELLED
		paid_at: timestamp("paid_at", { withTimezone: true, mode: "string" }),
		archived: boolean("archived").notNull().default(false),
		archived_at: timestamp("archived_at", { withTimezone: true, mode: "string" }),
		remark: text("remark"),
		created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex("payroll_disb_unique_idx").on(table.period_key, table.employee_id),
		index("payroll_disb_period_idx").on(table.period_key),
		index("payroll_disb_status_idx").on(table.status),
		index("payroll_disb_archived_idx").on(table.archived),
	]
);

// 19. 奖励发放快照（按周或月，从 weekly_reward_settlement 复制）
export const rewardDisbursement = pgTable(
	"reward_disbursement",
	{
		id: serial("id").primaryKey(),
		period_key: varchar("period_key", { length: 16 }).notNull(), // '2026-W40' | '2026-09'
		period_type: varchar("period_type", { length: 8 }).notNull(), // WEEKLY | MONTHLY
		employee_id: varchar("employee_id", { length: 32 }).notNull().references(() => employee.employee_id, { onDelete: "cascade" }),
		dept_name: varchar("dept_name", { length: 64 }),
		// === 快照字段 ===
		daily_total: numeric("daily_total", { precision: 14, scale: 2 }).notNull().default(sql`0`), // 日奖励合计
		weekly_total: numeric("weekly_total", { precision: 14, scale: 2 }).notNull().default(sql`0`), // 周奖励合计
		reward_total: numeric("reward_total", { precision: 14, scale: 2 }).notNull().default(sql`0`), // 奖励合计
		// === 借款（奖励也可以抵扣借款）===
		loan_deduction: numeric("loan_deduction", { precision: 14, scale: 2 }).notNull().default(sql`0`),
		loan_deduction_override: boolean("loan_deduction_override").notNull().default(false),
		loan_remaining_before: numeric("loan_remaining_before", { precision: 14, scale: 2 }).notNull().default(sql`0`),
		// === 实发 ===
		net_pay: numeric("net_pay", { precision: 14, scale: 2 }).notNull().default(sql`0`),
		net_pay_override: boolean("net_pay_override").notNull().default(false),
		// === 状态 ===
		status: varchar("status", { length: 16 }).notNull().default("PENDING"),
		paid_at: timestamp("paid_at", { withTimezone: true, mode: "string" }),
		archived: boolean("archived").notNull().default(false),
		archived_at: timestamp("archived_at", { withTimezone: true, mode: "string" }),
		remark: text("remark"),
		created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex("reward_disb_unique_idx").on(table.period_key, table.period_type, table.employee_id),
		index("reward_disb_period_idx").on(table.period_key),
		index("reward_disb_status_idx").on(table.status),
		index("reward_disb_archived_idx").on(table.archived),
	]
);

// 20. 发放批次备注（多条历史记录，对应一个 period_key）
export const disbursementRemark = pgTable(
	"disbursement_remark",
	{
		id: serial("id").primaryKey(),
		period_key: varchar("period_key", { length: 16 }).notNull(),
		period_type: varchar("period_type", { length: 8 }).notNull(), // PAYROLL | REWARD
		content: text("content").notNull(),
		archived: boolean("archived").default(false).notNull(),
		updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
		created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
	},
	(table) => [
		index("disb_remark_period_idx").on(table.period_key, table.period_type, table.archived),
	]
);
