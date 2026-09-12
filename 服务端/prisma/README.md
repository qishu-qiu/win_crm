# 服务端 / Prisma（新后端起点）

> 本目录是新后端（NestJS + Prisma）的起点。当前仅含 `prisma/schema.prisma`。

## schema.prisma

- **46 张表**，真相源＝**《需求规格/销售CRM数据架构文档》V1.27**（§三~§九 表、§十 索引、§十五 落库口径）。
- 已通过 **Prisma 6.19.3 校验**：`The schema at prisma/schema.prisma is valid 🚀`。

### 本地校验 / 格式化

```bash
# 需要一个（哪怕占位的）连接串，仅用于解析 schema，不需要真库
DATABASE_URL="mysql://user:pass@localhost:3306/crm" npx prisma validate --schema prisma/schema.prisma
DATABASE_URL="mysql://user:pass@localhost:3306/crm" npx prisma format   --schema prisma/schema.prisma
```

## migrations / 0001_init / migration.sql

- **生成方式**：`DATABASE_URL=占位 npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > migrations/0001_init/migration.sql`（**离线生成，不需要真库**）。
- **内容** = **Prisma 生成的 baseline（46 张表 / 索引 / 外键）** ＋ **结尾「手工补充段」**（①生成列改造 ②3 张分区表改造 ③视图 `v_contract_performance` ④审批 CHECK ⑤46 表全字段中文 `COMMENT`）。
- **✅ 2026-09-12 已在真实 MySQL 8.0.12（本机 phpStudy）上**「`DROP DATABASE win_crm` → 重建空库（utf8mb4 / utf8mb4_unicode_ci）→ 灌入 `migration.sql`」**，零报错、全段执行到底**（详见文末「✅ 验收结果」）。
- **实测踩坑（本机真撞到，2 条，均已修）**：
  1. **ERROR 1215** —— 生成列**不能引用带 `ON UPDATE CASCADE` 的外键列**（旧 baseline 正是停在这一步，`business_relation.active_key` 建不出来）。`business_relation` 的 `company_id` / `dept_id` / `product_line_id` 与 `relation_member.relation_id` 这 **4 条外键**已改为 **`ON UPDATE RESTRICT`**；`schema.prisma` 侧同步显式声明 `onUpdate: Restrict`（否则 `migrate diff` 会重新生成 `CASCADE` 并判 drift）。
  2. **ERROR 1064（视图）** —— **MySQL 8 的 `CREATE VIEW` 语法不支持 `COMMENT` 子句**（视图无法带注释，`information_schema.VIEWS.TABLE_COMMENT` 恒为空）。`v_contract_performance` 的口径说明已改为由**其上方 SQL 注释**承载。
- **MySQL 规则性约束（本机未直接撞到，但规则为真、且直接决定了设计；写错必炸）**：
  - **ERROR 1506** —— **分区表不能参与外键**（既不能当子表、也不能被引用）。故 `action_event` / `daily_agenda` **放弃分区**（保留分区的 `stat_daily` / `operation_log` / `job_run_log` 三张均无外键）。
  - **ERROR 1503** —— 分区表**每个唯一键（含主键）都必须包含分区列**。故 3 张分区表先 `ADD PRIMARY KEY (id, 分区列)` 再 `PARTITION BY`。
  - **ERROR 1064（分区）** —— `PARTITION BY` 是 `ALTER TABLE` 的**独立子句，前面不能有逗号**；`DROP PRIMARY KEY, ADD PRIMARY KEY (...), PARTITION BY ...` 中的**尾逗号必须删掉**。
- **⚠ 环境版本门槛（重要 · 实测）**：本机 phpStudy 为 **MySQL 8.0.12**，而 **CHECK 约束自 MySQL 8.0.16 才支持** —— 8.0.12 会把 `CHECK (...)` **解析后静默忽略**（实测：整段跑完后 `information_schema.TABLE_CONSTRAINTS` 里 `CONSTRAINT_TYPE='CHECK'` 计数为 **0**）。即 `chk_approval_not_self` 与 `action_event` 的内联 CHECK **在本机不生效**。**建生产库 / CI 请用 8.0.16+**，否则「审批人 ≠ 申请人」只剩应用层单拦。
- **发现并已记录**：Prisma 会把 `@ignore` 字段建成普通列 → 手工段里 `DROP` 后重建为 `GENERATED`（见下）。

## ★ 必须「手写 migration」的部分（数据架构 §十五.5，Prisma 表达不了）

| # | 场景 | 做法 |
|---|---|---|
| 1 | **生成列**：`business_relation.active_key` / `relation_member.owner_flag` / `contact.phone_active` | schema 中已声明为 `@ignore` 字段（Client 不暴露、不读不写）。**⚠ 实测：Prisma 仍会把这 3 个字段建成「普通可空列」**——故 migration 里需 **`DROP COLUMN` 后重建为 `GENERATED ALWAYS AS (...) STORED` ＋ 建唯一索引**（`uk_active_rel` / `uk_owner` / `uk_phone_active`）。**唯一性由 DB 兜底，冲突靠 P2002 识别** |
| 2 | **分区表**（**3 张**）：`stat_daily` / `operation_log` / `job_run_log` | schema 保持普通表定义（会报 drift 警告，可接受）；migration 手写 `ALTER TABLE ... PARTITION BY RANGE`（按 `biz_date` / `occurred_at` / `run_at` 月分区）。**⚠ MySQL 规则：每个唯一键（含主键）都必须包含分区列，否则报 ERROR 1503** —— 故先扩主键含分区列（`ADD PRIMARY KEY (id, 分区列)`）。**🚫 原定的 `action_event` / `daily_agenda` 已因「保外键」放弃分区**（分区表不能参与外键，ERROR 1506），二者主键保持建表原样 `(id)`；`action_event.uk_idem` 随之回退为**全局唯一 `(idempotency_key)`**（原 `(idempotency_key, event_at)` 只为满足分区要求而加） |
| 3 | **CHECK 约束** | 如 `approval` 申请人 ≠ 审批人（DB CHECK ＋ 应用双拦）。**⚠ 需 MySQL 8.0.16+**：8.0.12 会解析后静默忽略（见上方「环境版本门槛」） |
| 4 | **视图** | `v_contract_performance` ＝ `contract × contract_split`（无 split 则 `signer_id` 占 100%）——**业绩统计一律读此视图**，避免口径漂移。**⚠ 视图不能带 `COMMENT`**（MySQL `CREATE VIEW` 无该子句，ERROR 1064），口径说明只写在脚本里其上方 SQL 注释 |
| 5 | **键约束** | 手机号唯一、公司信用代码唯一为**数据库级约束**（撞单兜底） |
| 6 | **表 / 字段中文 `COMMENT`** | **Prisma 无法表达 MySQL `COMMENT`**（`schema.prisma` 不写、`db pull` 不读）。故 `migration.sql` 里 **46 张表全部带表级 `COMMENT='…'` ＋ 每个字段行尾 `COMMENT '…'`**，让 DBA / Navicat / `SHOW CREATE TABLE` 直接可读（口径来源＝《数据架构文档》V1.27 各表字段说明）。**⚠ 用 `prisma migrate diff` 重新生成 baseline 会把这批 COMMENT 全部抹掉** —— 重生成后必须补回，或改用「手写增量 migration」承载注释。**视图列不受此覆盖**（视图无 COMMENT，且表达式列 `employee_id` / `percent` / `performance_amount` 在 `information_schema` 里 `COLUMN_COMMENT` 为空属正常） |

## 口径约定（写代码前先读）

- **枚举一律 `String`（VARCHAR(32) 英文码）**，展示文案走字典 `dict_item`——**不用 DB ENUM**（T1/T5：可加项、停用不删）。
- **唯一冲突**：Prisma 报 **P2002**（不是 MySQL 1062）→ 异常过滤器映射 **409（撞单/竞态/抢公海）/ 422（业务校验）**，`meta.target` 取约束名回友好提示。
- **复杂查询 / 报表 / 递归 CTE**（合并树 `WITH RECURSIVE`、`GROUP BY` 聚合）→ 走 `$queryRaw` ＋ `Prisma.sql` 参数化，**不为迁就 Client API 牺牲 SQL 表达力**。
- **JSON 列**（`ledger.extra_fields` / `contact.extra_phones` / `dept_rule.level_tiers` 等）→ Prisma `Json` 原生支持；**禁止反向 `JSON_CONTAINS` 全表扫描**，高频检索 key 走生成列或正式字段。
- **审计字段**全表统一：`created_by / created_at / updated_by / updated_at`；逻辑删除 `deleted_at`（NULL=未删）。
- **主键**：`BigInt @db.UnsignedBigInt @default(autoincrement())`；金额 `Decimal(12,2)`；时间 `DateTime(0)`。

## ✅ 验收结果（2026-09-12 · MySQL 8.0.12 实跑取证）

方式：`DROP DATABASE win_crm` → `CREATE DATABASE win_crm CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci` → `SOURCE migration.sql`（**exit 0、零报错、全段到底**）。下表「实测」列均为 `information_schema` 实查值。

| 验收项 | 期望 | 实测 |
|---|---|---|
| 基表数 | 46 | **46** ✅ |
| 视图 | 1（`v_contract_performance`，可查） | **1**；`SELECT COUNT(*) FROM v_contract_performance` 正常返回 ✅ |
| 表级中文 `COMMENT` | 46 / 46 | **46 / 46** ✅（抽查 `company` / `business_relation` / `action_event` / `stat_daily` 中文正常、无乱码） |
| 字段级中文 `COMMENT` | 基表字段全覆盖 | **基表字段全覆盖（544）** ✅；仅视图 3 个表达式列 `employee_id` / `percent` / `performance_amount` 为空（视图不可注释，属预期） |
| 生成列（STORED） | 3：`contact.phone_active` / `business_relation.active_key` / `relation_member.owner_flag` | **3** ✅ |
| 生成列唯一索引 | `uk_phone_active` / `uk_active_rel` / `uk_owner` | **3 个均在** ✅ |
| 分区表 | 恰 3 张：`stat_daily` / `operation_log` / `job_run_log` | **恰这 3 张** ✅ |
| `action_event.uk_idem` | 全局唯一 `(idempotency_key)` | **单列 `idempotency_key`** ✅ |
| 外键 `ON UPDATE RESTRICT` | 恰 4 条（`business_relation` ×3 ＋ `relation_member.relation_id`） | **恰这 4 条**；全库外键 **41** 条均保留 ✅ |
| CHECK 约束 | 2（`chk_approval_not_self` ＋ `action_event` 内联） | **0** ⚠ 本机 8.0.12 不支持 CHECK（需 8.0.16+），已解析后忽略 —— 见上方「环境版本门槛」 |

**回退安全网**：旧 baseline 可从 git 取回（`git show HEAD:服务端/prisma/migrations/0001_init/migration.sql`）；重建前另做了 `mysqldump --no-data` 结构备份（存于系统临时目录 `win_crm_before_rebuild.schema.sql`，**临时目录非长期保留**）。
