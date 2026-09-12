# 服务端 / Prisma（新后端起点）

> 本目录是新后端（NestJS + Prisma）的起点。当前仅含 `prisma/schema.prisma`。

## schema.prisma

- **46 张表**，真相源＝**《需求规格/销售CRM数据架构文档》V1.24**（§三~§九 表、§十 索引、§十五 落库口径）。
- 已通过 **Prisma 6.19.3 校验**：`The schema at prisma/schema.prisma is valid 🚀`。

### 本地校验 / 格式化

```bash
# 需要一个（哪怕占位的）连接串，仅用于解析 schema，不需要真库
DATABASE_URL="mysql://user:pass@localhost:3306/crm" npx prisma validate --schema prisma/schema.prisma
DATABASE_URL="mysql://user:pass@localhost:3306/crm" npx prisma format   --schema prisma/schema.prisma
```

## migrations / 0001_init / migration.sql

- **生成方式**：`DATABASE_URL=占位 npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > migrations/0001_init/migration.sql`（**离线生成，不需要真库**）。
- **内容** = **Prisma 生成的 baseline（46 张表 / 索引 / 外键）** ＋ **结尾「手工补充段」**（①生成列改造 ②5 张分区表改造 ③视图 `v_contract_performance` ④审批 CHECK）。
- **⚠ 未在真实 MySQL 8 上跑过**：本环境无数据库，migration 为**静态产出**，首次建库时须在真库执行并逐条核对（重点：生成列表达式、分区键与主键扩列、ERROR 1503）。
- **发现并已记录**：Prisma 会把 `@ignore` 字段建成普通列 → 手工段里 `DROP` 后重建为 `GENERATED`（见下）。

## ★ 必须「手写 migration」的部分（数据架构 §十五.5，Prisma 表达不了）

| # | 场景 | 做法 |
|---|---|---|
| 1 | **生成列**：`business_relation.active_key` / `relation_member.owner_flag` / `contact.phone_active` | schema 中已声明为 `@ignore` 字段（Client 不暴露、不读不写）。**⚠ 实测：Prisma 仍会把这 3 个字段建成「普通可空列」**——故 migration 里需 **`DROP COLUMN` 后重建为 `GENERATED ALWAYS AS (...) STORED` ＋ 建唯一索引**（`uk_active_rel` / `uk_owner` / `uk_phone_active`）。**唯一性由 DB 兜底，冲突靠 P2002 识别** |
| 2 | **分区表**（5 张）：`action_event` / `daily_agenda` / `stat_daily` / `operation_log` / `job_run_log` | schema 保持普通表定义（会报 drift 警告，可接受）；migration 手写 `CREATE TABLE ... PARTITION BY RANGE`（按 `event_at` / `biz_date` / `run_at` / `occurred_at` 月分区）。**⚠ `action_event` 的 `uk_idem` 必须含分区键 `event_at`，否则建表报 ERROR 1503** |
| 3 | **CHECK 约束** | 如 `approval` 申请人 ≠ 审批人（DB CHECK ＋ 应用双拦） |
| 4 | **视图** | `v_contract_performance` ＝ `contract × contract_split`（无 split 则 `signer_id` 占 100%）——**业绩统计一律读此视图**，避免口径漂移 |
| 5 | **键约束** | 手机号唯一、公司信用代码唯一为**数据库级约束**（撞单兜底） |

## 口径约定（写代码前先读）

- **枚举一律 `String`（VARCHAR(32) 英文码）**，展示文案走字典 `dict_item`——**不用 DB ENUM**（T1/T5：可加项、停用不删）。
- **唯一冲突**：Prisma 报 **P2002**（不是 MySQL 1062）→ 异常过滤器映射 **409（撞单/竞态/抢公海）/ 422（业务校验）**，`meta.target` 取约束名回友好提示。
- **复杂查询 / 报表 / 递归 CTE**（合并树 `WITH RECURSIVE`、`GROUP BY` 聚合）→ 走 `$queryRaw` ＋ `Prisma.sql` 参数化，**不为迁就 Client API 牺牲 SQL 表达力**。
- **JSON 列**（`ledger.extra_fields` / `contact.extra_phones` / `dept_rule.level_tiers` 等）→ Prisma `Json` 原生支持；**禁止反向 `JSON_CONTAINS` 全表扫描**，高频检索 key 走生成列或正式字段。
- **审计字段**全表统一：`created_by / created_at / updated_by / updated_at`；逻辑删除 `deleted_at`（NULL=未删）。
- **主键**：`BigInt @db.UnsignedBigInt @default(autoincrement())`；金额 `Decimal(12,2)`；时间 `DateTime(0)`。
