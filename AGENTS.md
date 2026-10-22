# AGENTS.md

## 项目概览
金融催收员工工资计算系统 —— 面向催收团队的内部薪酬核算后台（单角色，财务/管理员统一操作）。支持灵活的规则参数配置、Excel 批量导入运营数据、自动化薪酬计算与泰铢（THB）报表导出。

## 技术栈
- Next.js 16 (App Router) + React 19 + TypeScript 5
- Tailwind CSS 4 + shadcn/ui
- @supabase/supabase-js（service_role，后端直连；无登录系统，RLS 自动启用，无需 policy）
- xlsx（Excel 模板生成 / 导入解析 / 报表导出）

## 薪酬结构（两套并行方案）
每位员工同时拥有**绩效考核方案**与**提成方案**，分别设置、并行核算，最终应发 = 考核方案 + 提成方案。
1. **绩效考核方案**（`performance_scheme`，一员工一份，绑定 employee_id）：基本工资 `base_salary`（固定发放）+ 绩效工资 `performance_bonus`（月度条件组任一达标发放）。
   - 门槛用**多条件组**表述：`performance_condition` 子表（scheme_id 一对多），每条件含 `metric`（RATE 回收率 / AMOUNT 回款金额 / ORDERS 月度订单量）+ `threshold_value` 门槛值 + `sort_order`。
   - **达标逻辑 = OR**：任一条件实际月度值 ≥ 门槛值即达标，发放全额绩效工资；全部未满足则绩效为 0；方案无可配置条件或当月无月度数据则不达标。
   - 实际值按员工**默认阶段**的月度行读取：RATE→`monthly_recovery_rate`，AMOUNT→`monthly_total_amount`，ORDERS→`monthly_recovered_orders`。
2. **提成方案（规则）**：
   - **日达成提成（阶梯）**：`DAILY_STEP`，指标达成率 RATE / 回收单数 ORDS / 回款金额 AMOUNT；奖励类型单价 UNIT_PRICE（×单数）、固定金额 FIXED_AMOUNT、百分比 PERCENTAGE（×金额）。
   - **月度/跨阶段提成**：
     - 方案 A：`MONTHLY_TOTAL_TIER`，按整月总回款匹配提点百分比。
     - 方案 B：`STAGE_AMOUNT_TIER`，按「员工 + 阶段」隔离，各阶段独立匹配金额提点后求和。

> 注：`BASE_SALARY`、`MONTHLY_THRESHOLD` 旧规则类型已废弃（迁移到 `performance_scheme`）。规则页只管理提成方案。

## 指标库（metric_config）与多条件组
- **指标库**：自定义指标统一管理（金额回款率、订单回收率、回款金额、订单量、日达成率等）。字段：`metric_code`(唯一编码)、`metric_name`、`scope`(PERF/COMMISSION/BOTH)、`period`(MONTHLY/DAILY)、`source_field`(映射到 import_monthly_data/import_daily_data 列)、`unit`、`enabled`。考核条件与提成规则均通过 metric_code 引用；`/api/metrics` 提供 CRUD，`/metrics` 页面维护。
- **绩效考核门槛 = 多条件组**：一组内条件**AND**、组间**OR**，任一组全部满足即整体达标。结构：
  - `performance_condition_group`（scheme 一对多：group_id、scheme_id、sort_order）
  - `performance_condition`（group 一对多：condition_id、group_id、metric 编码、operator 比较符、threshold_value、sort_order）
- **比较符 `operator`**：`GTE`(≥) / `LTE`(≤) / `GT`(>) / `LT`(<)，缺省 GTE。
- 实际值按员工**默认阶段**的月度行读取：遍历 metric_config 找到对应 source_field 取值；旧编码兜底 `legacyMonthlyMetric`（RATE→monthly_recovery_rate，AMOUNT→monthly_total_amount，ORDERS→monthly_recovered_orders）。
- 提成规则 `metric` 同为指标库编码：日阶梯用 `period=DAILY` 指标（DAILY_RATE/DAILY_ORDERS/DAILY_AMOUNT 或自定义），月度方案用 `period=MONTHLY` 指标；引擎经 `metricValueOf` 解析，旧编码 `legacyDailyMetric` 兜底。

## 阶段自定义与员工多阶段
- **阶段库 `stage_config`**：业务阶段（如 D0/T1/T2）改为自定义维护，字段 stage_code（唯一编码，创建后不可改）、stage_name（**唯一，作为全系统阶段引用键**）、sort_order、enabled；`/api/stages` CRUD，`/stages` 页面管理。
- **阶段引用统一用阶段名称（stage_name）**：员工 `default_stage`、`employee_stage`、提成规则 `stage_name`、导入数据 `stage`、结算 `stage`、引擎比对全部存/用阶段名称。规则特殊值 `ALL`（全部阶段通用）除外。
- **员工多阶段**：员工保留 `default_stage`（主阶段，绩效考核与日数据默认归属），另通过关联表 `employee_stage`（employee_id + stage_name + is_primary + sort_order）表达**参与的多个阶段**。员工对话框主阶段下拉 + 参与阶段多选（主阶段必选且不可取消）。
- **删除保护**：阶段已被员工关联（employee_stage 或 default_stage）、提成规则引用或存在导入数据时拒绝删除。
- **改名级联**：`stage_name` 允许编辑；改名时级联同步 employee.default_stage、employee_stage、salary_rule_config、导入日/月数据的 stage（employee_stage 外键为 ON UPDATE CASCADE）。**注意**：与既有名称冲突或已有该名数据时改名会失败/静默，改名请避开已占用名称。
- **引擎取数**：
  - 计算阶段集合 = 员工配置的参与阶段 ∪ 实际有月度/日数据的阶段。
  - 方案A（`MONTHLY_TOTAL_TIER`）按员工**整月总回款（各阶段月度金额汇总）**匹配一次提点（规则优先 stage_name=ALL，否则取第一条），不再按阶段重复匹配。
  - 方案B（`STAGE_AMOUNT_TIER`）遍历员工**参与的每个阶段**，各阶段按月度行金额独立匹配提点后求和。

## 目录结构
```
src/
├── app/
│   ├── api/
│   │   ├── employees/route.ts          # GET/POST 员工
│   │   ├── employees/[id]/route.ts     # PUT/DELETE 员工
│   │   ├── employees/import/route.ts   # POST 员工 Excel 批量导入
│   │   ├── rules/route.ts              # GET(?withTiers)/POST 规则
│   │   ├── rules/[id]/route.ts         # PUT/DELETE 规则
│   │   ├── import/daily/route.ts       # GET(?month)/POST 日数据导入
│   │   ├── import/monthly/route.ts     # GET(?month)/POST 月数据导入
│   │   ├── import/monthly/[id]/route.ts# DELETE 月数据
│   │   ├── calculate/route.ts          # POST 一键核算（写结算）
│   │   ├── settlements/route.ts        # GET(?month)/PATCH(终审)
│   │   ├── overview/route.ts           # GET 看板统计
│   │   ├── batches/route.ts            # GET/DELETE 导入批次
│   │   ├── performance-schemes/route.ts# GET/POST/DELETE 绩效考核方案
│   │   └── metrics/route.ts            # GET(?scope)/POST/PATCH/DELETE 指标库
│   │   ├── stages/route.ts             # GET(?enabled)/POST/PATCH/DELETE 阶段库
│   ├── page.tsx                        # 薪酬看板
│   ├── employees/page.tsx              # 员工档案
│   ├── performance/page.tsx            # 绩效考核方案配置（多条件组）
│   ├── rules/page.tsx                  # 提成方案配置
│   ├── metrics/page.tsx                # 指标库管理
│   ├── stages/page.tsx                 # 阶段管理（自定义阶段）
│   ├── import/page.tsx                 # Excel 导入
│   ├── settlements/page.tsx            # 结算汇总/明细
│   └── globals.css                     # 暗色主题 token
├── lib/
│   ├── types.ts                        # 领域类型
│   ├── payroll-engine.ts               # 薪酬计算引擎（核心）
│   ├── api-helpers.ts                  # ok/fail/字段校验
│   ├── format.ts                       # THB/比率格式化 + monthRange
│   ├── rule-labels.ts                  # 规则/指标/奖励类型中文映射
│   └── excel.ts                        # xlsx 模板/解析/导出
├── components/
│   ├── admin-shell.tsx                 # 侧边栏布局
│   └── month-context.tsx               # 全局月份选择
└── storage/database/
    ├── supabase-client.ts              # Supabase 客户端
    └── shared/schema.ts                # Drizzle schema（6 张业务表）
scripts/seed.ts                          # 种子：员工A-E + 规则 + 示例数据
```

## 数据库表（11 张）
- `employee`：员工档案（工号、姓名、部门、主阶段、方案 A/B、状态）
- `performance_scheme`：绩效考核方案（一员工一份：基本工资/绩效工资）
- `performance_condition_group`：绩效门槛条件组（scheme 一对多，组间 OR）
- `performance_condition`：绩效门槛条件（group 一对多：指标编码/比较符 operator/门槛值/排序，组内 AND）
- `metric_config`：指标库（编码/名称/适用场景/周期/数据来源字段/单位）
- `stage_config`：阶段库（自定义业务阶段编码/名称/排序/启用）
- `employee_stage`：员工-阶段关联（员工参与多阶段，is_primary 标记主阶段）
- `salary_rule_config`：提成规则主表（阶段、类型、指标 metric 编码、名称、启用）
- `rule_tier_detail`：阶梯明细（区间 min/max、奖励类型、奖励值、排序）
- `import_daily_data`：每日业务明细（批次、阶段、日期、单数、金额、达成率）
- `import_monthly_data`：月度考核（回收率、累计回款、订单量；唯一键 month+employee+stage）
- `salary_settlement_result`：结算结果（各项金额 + detail JSONb + 草稿/终审状态）

## 构建与运行
- 安装依赖：`pnpm install`
- 开发：`pnpm run dev`
- 构建：`pnpm run build`
- 启动：`pnpm run start`
- 类型检查：`pnpm ts-check`
- Lint：`pnpm lint`
- 重建种子数据：`pnpm tsx scripts/seed.ts`（幂等）
- Schema 变更：编辑 `src/storage/database/shared/schema.ts` 后执行 `coze-coding-ai db upgrade`

## 关键实现说明
- 日期区间查询必须使用 `monthRange(month)` 返回的 [start, 下月1日)，**禁止** 用固定 `month-32`（小月非法日期会报错）。
- 所有金额经 `round2()` 保留两位小数；币种统一泰铢。
- 绩效考核方案按员工**全部参与阶段**的月度数据判定**多条件组**（**组内 AND、组间 OR**，无主次之分）：对每个指标按其来源字段跨员工所有参与阶段（`employee_stage.stage_name`）取月度行汇总——比率类（unit=% 或字段含 rate）按各阶段月度金额加权平均，金额/订单类直接求和；旧编码兜底 RATE→`monthly_recovery_rate`，AMOUNT→`monthly_total_amount`，ORDERS→`monthly_recovered_orders`；任一组全部满足即达标。`calculate/route` 返回的 `employee.stages` 需手动归一化 `employee_stage` 关联。
- 员工导入：`/api/employees/import`（multipart `file`）按员工模板批量建档，逐行校验主阶段/参与阶段存在且启用，已存在工号跳过、缺主阶段/非法阶段记录失败行，成功同时重建 `employee_stage` 关联。
- 结算 `detail` JSONB 结构：`scheme`（考核方案：底薪/绩效/groups 条件组明细及各自命中情况/是否达标）+ `stages`（各阶段日提成与方案B）+ `monthly_total`（方案A）。每组含 `conditions`（metric/operator/metric_value/passed/range_text）与 `passed`。
- 已终审(FINALIZED)结算在重新核算时自动跳过，防止覆盖。
- Excel 导入严格依赖模板列名；同批次可选择先删后导（replace）。
