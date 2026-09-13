# 服务端 / Prisma（新后端起点）

> 本目录是新后端（NestJS + Prisma）的起点。当前含 `prisma/schema.prisma`（46 表）＋ `prisma/migrations/0001_init/migration.sql`（baseline ＋ 手工补充段，**已在真库 `win_crm` 跑通，并已 `migrate resolve` 登记基线**）＋ `prisma/migrations/0002_company_capital_legal_person/migration.sql`（**增量：`company` 加注册资本 / 法定代表人两列 ＋ 注释口径收口，✅ 已于 2026-09-13 在真库执行**）；**`package.json` 与 `src/` 尚未创建**（骨架＝开发计划 M0-01 ~ M0-09）。

## schema.prisma

- **46 张表**，真相源＝**《需求规格/销售CRM数据架构文档》V1.28**（§三~§九 表、§十 索引、§十五 落库口径）。
- ✅ **已通过 Prisma 6.19.3 校验（2026-09-12 复验）**：`The schema at prisma\schema.prisma is valid 🚀`。
- ⚠ **复验前曾失败（P1012，2026-09-12 发现并已修）**：`SignChecklist.product_line` 缺 `ProductLine` 侧的对向字段 → 已在 `ProductLine` 补一行 `sign_checklists SignChecklist[]`。该行属**纯 Prisma 关系声明**，**不影响真库结构**（`sign_checklist` 表与其外键，`migration.sql` 里一直是对的）。**教训：Prisma 关系字段是双向的 —— 加表/加关系时必须同批补对向字段，否则 `validate` 与 `generate` 直接失败（骨架一搭好就会撞）。**

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
- **⚠ 本机「多版本 MySQL 并存」（2026-09-12 实测 · 最容易悄悄踩）**：phpStudy 面板的 `Extensions/` 下装了 **三个** MySQL —— `MySQL5.5.29` / `MySQL5.7.26` / **`MySQL8.0.12`**。**3306 上跑的确实是 8.0.12**（`netstat -ano` 查到 PID → 进程路径 `…\MySQL8.0.12\bin\mysqld.exe`，可自证）。**但风险真实存在**：面板切版本、或用 `PATH` 里的 `mysql` 命令，会连到 / 建到别的版本上（**实测：脚本探测时第一下抓到的就是 `MySQL5.5.29\bin\mysql.exe`**）。**5.5 / 5.7 建不出生成列与 CHECK**，一旦用错版本，`0001_init` 会中途炸且现场难辨。
  - **动手前自证一条**：`select version()`（**建议直接用** `D:\ITtool\phpstudy_pro\Extensions\MySQL8.0.12\bin\mysql.exe`，别依赖 `PATH`）—— 建库 / 跑 `migration.sql` / `SHOW CREATE TABLE` / `information_schema` 核对之前都先跑这一句。
- **发现并已记录**：Prisma 会把 `@ignore` 字段建成普通列 → 手工段里 `DROP` 后重建为 `GENERATED`（见下）。

## migrations / 0002_company_capital_legal_person / migration.sql（增量 · 2026-09-13）

- **做什么**：① `company` 加 2 列 —— `registered_capital`（注册资本 `DECIMAL(16,2)`，**单位＝元**）/ `legal_person`（法定代表人 `VARCHAR(64)`）；② 把 `address` / `bank_name` / `invoice_title` / `tax_no` 4 列的注释从「成交后强制补」改为「成交后可选补全，不强制」。
- **为什么**：需求 **V1.24 §7.3** 定 —— 注册资本 / 法定代表人＝**公司档案「可选扩展字段」，不做签约强制、不计入完善度**，只作档案留存与按规模筛选（如"注册资金 > 100 万"）；同时修掉数据架构 **E8** 的硬伤——清单 `field_key` 用了库里不存在的「逻辑名」（`registered_address`/`industry`/`region`），导致签约校验「逐项查字段非空」**写不出 SQL** → 改真实列名 `address`/`industry_l1`/`province`，公司级默认清单 **6 项 → 4 项**。
- **单位口径**：库内 / 接口层一律「**元**」；前端按「**万元**」录入与展示并做一次换算（`500` 万 ⇄ `5000000`）。
- **✅ 2026-09-13 已在真库执行**（`npx prisma migrate deploy` → `Applying migration 0002_company_capital_legal_person` → **`All migrations have been successfully applied.`**）；属纯 `ALTER TABLE` 加列 / 改注释，**未回填数据、无破坏性**。若日后走手工 `SOURCE` 重建，需补 `npx prisma migrate resolve --applied 0002_company_capital_legal_person`（本次未用）。
- **⚠ 不要改 `0001_init`**：它已 `migrate resolve --applied` 登记为基线，改文件会与 `_prisma_migrations` 的**校验和不一致** → 注释 / 结构修正一律走**新增量**（本目录即此原则的第一次实践）。
- **重建库顺序**：`0001_init` → `0002_company_capital_legal_person`（再分别 `migrate resolve`）。
- 表数不变（仍 **46 张业务表**）；**无新增索引**（注册资金区间筛选选择性低，暂不建，见数据架构 B1）。

### ✅ 0002 验收结果（2026-09-13 · MySQL 8.0.12 实跑取证）

方式：`npx prisma migrate deploy --schema prisma/schema.prisma`（**钉 `prisma@6.19.3`** —— 不钉版本 `npx` 会拉到 7.x）。下表「实测」列均为 `information_schema` 实查值。

| 验收项 | 期望 | 实测 |
|---|---|---|
| `company.registered_capital` | `decimal(16,2)` / NULL | **`decimal(16,2)` / YES** ✅ |
| `company.legal_person` | `varchar(64)` / NULL | **`varchar(64)` / YES** ✅ |
| 4 列注释口径收口 | `bank_name` / `invoice_title` / `tax_no` 去「强制补」；`address` 补「签约校验清单『注册地址』项落点」 | **4 / 4 已改** ✅ |
| `prisma migrate status` | `2 migrations found` ＋ 无 pending | **`2 migrations found` ＋ `Database schema is up to date!`** ✅ |
| `_prisma_migrations` | 增 1 条 `0002_...` | **2 条**：`0001_init`（09-12 09:51:41）＋ `0002_company_capital_legal_person`（09-13 14:22:39） ✅ |
| drift 双向反查（M0-20 复跑） | 新增 2 列**不得**出现在 drift 里 | **未出现** ✅（drift 仍仅 M0-20 记录的 4 类可接受项，无第 5 类） |
| 表数 / 索引 | 仍 46 业务表；无新增索引 | **不变** ✅（全库 47 基表 ＝ 46 业务表 ＋ 1 元数据表；另 1 视图） |

> ⚠ **执行前自证**：先用 `D:\ITtool\phpstudy_pro\Extensions\MySQL8.0.12\bin\mysql.exe` 跑 `select version()` → **`8.0.12`**（本机三版本并存，见上文「多版本 MySQL 并存」）。

## ★ 必须「手写 migration」的部分（数据架构 §十五.5，Prisma 表达不了）

| # | 场景 | 做法 |
|---|---|---|
| 1 | **生成列**：`business_relation.active_key` / `relation_member.owner_flag` / `contact.phone_active` | schema 中已声明为 `@ignore` 字段（Client 不暴露、不读不写）。**⚠ 实测：Prisma 仍会把这 3 个字段建成「普通可空列」**——故 migration 里需 **`DROP COLUMN` 后重建为 `GENERATED ALWAYS AS (...) STORED` ＋ 建唯一索引**（`uk_active_rel` / `uk_owner` / `uk_phone_active`）。**唯一性由 DB 兜底，冲突靠 P2002 识别** |
| 2 | **分区表**（**3 张**）：`stat_daily` / `operation_log` / `job_run_log` | schema 保持普通表定义（会报 drift 警告，可接受）；migration 手写 `ALTER TABLE ... PARTITION BY RANGE`（按 `biz_date` / `occurred_at` / `run_at` 月分区）。**⚠ MySQL 规则：每个唯一键（含主键）都必须包含分区列，否则报 ERROR 1503** —— 故先扩主键含分区列（`ADD PRIMARY KEY (id, 分区列)`）。**🚫 原定的 `action_event` / `daily_agenda` 已因「保外键」放弃分区**（分区表不能参与外键，ERROR 1506），二者主键保持建表原样 `(id)`；`action_event.uk_idem` 随之回退为**全局唯一 `(idempotency_key)`**（原 `(idempotency_key, event_at)` 只为满足分区要求而加） |
| 3 | **CHECK 约束** | 如 `approval` 申请人 ≠ 审批人（DB CHECK ＋ 应用双拦）。**⚠ 需 MySQL 8.0.16+**：8.0.12 会解析后静默忽略（见上方「环境版本门槛」） |
| 4 | **视图** | `v_contract_performance` ＝ `contract × contract_split`（无 split 则 `signer_id` 占 100%）——**业绩统计一律读此视图**，避免口径漂移。**⚠ 视图不能带 `COMMENT`**（MySQL `CREATE VIEW` 无该子句，ERROR 1064），口径说明只写在脚本里其上方 SQL 注释 |
| 5 | **键约束** | 手机号唯一、公司信用代码唯一为**数据库级约束**（撞单兜底） |
| 6 | **表 / 字段中文 `COMMENT`** | **Prisma 无法表达 MySQL `COMMENT`**（`schema.prisma` 不写、`db pull` 不读）。故 `migration.sql` 里 **46 张表全部带表级 `COMMENT='…'` ＋ 每个字段行尾 `COMMENT '…'`**，让 DBA / Navicat / `SHOW CREATE TABLE` 直接可读（口径来源＝《数据架构文档》V1.28 各表字段说明）。**⚠ 用 `prisma migrate diff` 重新生成 baseline 会把这批 COMMENT 全部抹掉** —— 重生成后必须补回，或改用「手写增量 migration」承载注释。**视图列不受此覆盖**（视图无 COMMENT，且表达式列 `employee_id` / `percent` / `performance_amount` 在 `information_schema` 里 `COLUMN_COMMENT` 为空属正常） |

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
| 基表数 | 46 | **46** ✅（**2026-09-12 二次更新**：M0-21 登记基线后库内增 Prisma 元数据表 `_prisma_migrations` → 现查为 **47 基表 = 46 业务表 ＋ 1 元数据表**，元数据表不计入业务表） |
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

## drift 清单（M0-20 · 2026-09-12 双向反查取证）

方式：**没用 `prisma db pull`** —— 它会**覆盖 `schema.prisma`**，把手工段才有的关系声明/字段抹平（风险高于收益）。改用**等价的只读**双向比对，判定结果一致但**零副作用**：

```bash
# 方向 A：schema → 真库（列出「真库有、schema 声明里没有」的项）
npx prisma migrate diff --from-schema-datamodel prisma/schema.prisma --to-schema-datasource prisma/schema.prisma --script
# 方向 B：真库 → schema（列出「schema 声明里有、真库缺」的项）
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script
```

**结论：drift 仅 4 类，全部可接受；无一条需要改库、也无一条需要改 `schema.prisma`。**

| # | drift 项 | 为什么会有 | 判定 |
|---|---|---|---|
| 1 | **3 张分区表的主键含分区列**：`stat_daily` `(id, biz_date)` / `operation_log` `(id, occurred_at)` / `job_run_log` `(id, run_at)`（schema 侧仍写 `(id)`） | 手工补充段按 **ERROR 1503**（分区表唯一键必须含分区列）改造；**分区本身 schema 表达不了** | **可接受·设计使然** |
| 2 | **3 个生成列唯一索引**：`uk_active_rel` / `uk_owner` / `uk_phone_active` | 生成列在 schema 里是 `@ignore` 字段，索引由手工段 `DROP` 后重建 | **可接受·设计使然** |
| 3 | **5 个 MySQL 自动索引**：`permission_matrix_role_code_fkey` / `business_relation_product_line_id_fkey` / `cadence_rule_scope_line_id_fkey` / `sea_rule_dept_id_fkey` / `sea_rule_product_line_id_fkey` | MySQL **为外键自动建索引**（仅当该列没有显式索引；其余 FK 列已有 `idx_*`，故未重复建） | **可接受·MySQL 机制** |
| 4 | **`_prisma_migrations` 元数据表**（不计入业务表） | M0-21 `migrate resolve` 时由 Prisma 自建自管 | **可接受·Prisma 机制** |

**关键结论**：**无缺表 / 无缺列 / 无缺索引** —— 即 `migration.sql` 与 `schema.prisma` 的**结构一致**，上文「46 表 / 索引 / 外键」的验收结论不受 drift 影响。

> ⚠ **重建提醒（必读）**：日后若 `DROP DATABASE win_crm` 重灌 `migration.sql`，**必须重跑 `npx prisma migrate resolve --applied 0001_init`**。否则库内没有 `_prisma_migrations` 记录，`migrate status` 会把它判为「未应用」并试图**重跑整份 baseline**（在已有表上执行 → 必炸）。**2026-09-13 起**：重灌＝**两份都要跑**（`0001_init` → `0002_company_capital_legal_person`）并**分别 `migrate resolve --applied`**（否则 `migrate status` 会报 `0002` 未应用）。

## ✅ 基线登记（M0-21 · 2026-09-12 取证）

- 命令：`npx prisma migrate resolve --applied 0001_init --schema prisma/schema.prisma` → `Migration 0001_init marked as applied.`
- 实查 `_prisma_migrations`：`0001_init｜applied_steps_count=0｜finished_at=2026-09-12 09:51:41｜rolled_back_at=NULL`
- `npx prisma migrate status` → `1 migration found in prisma/migrations` ＋ **`Database schema is up to date!`**
- 注：`migrate resolve` **不校验关系完整性**（只读 datasource），所以它在 `schema.prisma` 尚为 P1012 时就跑通了 —— **别把它当作 schema 有效的证据**。

## ⬆ 上服务器时必做（上线前清单 · 2026-09-13 立）

> 本机开发环境的**已知降级项**在服务器上**必须补回** —— 本机"跑通了"不等于生产合规。

| # | 项 | 本机现状（开发用） | 服务器必做 |
|---|---|---|---|
| 1 | **MySQL 版本** | phpStudy **8.0.12** | 装 **8.0.16+**（`CHECK` 自 8.0.16 才生效） |
| 2 | **CHECK 约束复验** | 8.0.12 下 `CHECK` **静默忽略**（`CONSTRAINT_TYPE='CHECK'` 计数＝**0**）→ 靠应用层单测兜底（M0-19） | 建库后**复验真生效**：插入「申请人 ＝ 审批人」→ 断言报错（不再静默放过） |
| 3 | **docker-compose** | 本机无 Docker，**从未跑过**（M0-07 只做 YAML 语法自检） | 首次部署跑 `docker compose config` ＋ `up`，确认 `mysql:8`（**≥8.0.16**）/ `redis:7` 起得来 |
| 4 | **Redis 版本** | phpStudy **3.0.504**（**无密码**） | 换 **Redis 7**；代码里「禁用 6/7 专有命令」的临时红线（`UNLINK` / `EXPIRE … NX｜GT｜LT` / ACL）**可解禁**；**必须设密码** |
| 5 | **密钥 / 口令** | `.env` 里 DB / Redis **均无强口令**、`JWT_SECRET` 为本地随机值 | 换生产密钥与强口令；`.env` 不入库 |
| 6 | **migration 全量重放** | 已应用 `0001_init` ＋ `0002` | 空库上按序 `0001_init` → `0002` → 逐份 `migrate resolve --applied`（口径见上文「重建提醒」），再 `migrate status` 断言 **`up to date!`** |

> ⚠ 第 **1、2 项是同一个坑的两面**：本机 `CHECK` 静默失效最容易被拖到上线才炸 —— 本机当前只靠应用层单测兜住「审批人 ≠ 申请人」。
