# 服务端 / Prisma（新后端起点）

> 本目录是新后端（NestJS + Prisma）的起点。当前含 `prisma/schema.prisma`（46 表）、`prisma/migrations/0001_init/migration.sql`（baseline ＋ 手工补充段，**已在真库 `win_crm` 跑通，并已 `migrate resolve` 登记基线**）、`prisma/migrations/0002_company_capital_legal_person/migration.sql`（**增量：`company` 加注册资本 / 法定代表人两列 ＋ 注释口径收口，✅ 已于 2026-09-13 在真库执行**）、`prisma/migrations/0003_username_and_phone_lock/migration.sql`（**增量：`employee` 加 `username`（登录账号名）＋ `contact` 加联系方式「锁」两列，✅ 已于 2026-09-14 在真库执行**）、**`prisma.config.ts`（2026-09-13 新增 —— Prisma 7 的连接串中枢，见下节）**、**`package.json`（2026-09-13 创建，同日升级为 Prisma `7.10.0`）＋ `package-lock.json`（同日 `npm install` 产生，**已入 git** —— 它才是版本真钉死的锚点）**；**依赖已装**（`node_modules/`，被根 `.gitignore` 忽略）：`prisma` / `@prisma/client` / `@prisma/adapter-mariadb` 均 **`7.10.0`** ＋ `typescript` **`5.9.3`**。**`src/` 已建成（2026-09-14 复验）** —— `kernel` / `shared` / `prisma` / `health` / `app.module` / `main` / `worker` 全部落地（**18 个 spec、160 条单测全绿**，`tsc --noEmit` 与 `npm run lint` 均 0 error，`dist/` 可产出）；**未做**：M0-51（冒烟留档）、M0-52（提交）、M0-54 ~ M0-57（前端）。骨架逐条状态见《过程产出/开发计划-V1.md》「M0 现状」段。

## ★ Prisma 7 升级（2026-09-13：6.19.3 → 7.10.0）

> **为什么升**：不钉版本时 `npx prisma` 取 registry 的 `latest` ＝ **`8.0.0-rc.14`（一个 RC，不可用于生产）**；而 7.10.0 是当前**最新稳定版**（其 `--version` 自报「Update available 7.10.0 -> 8.0.0-rc.14」，即 8 尚处 RC）。**升级前已留还原点**：提交 **`1300a80`**（v6 口径的最后可用状态）—— 回退＝`git revert` 或 `git reset --hard 1300a80`，另因 `node_modules` 不入库需重跑 `npm install`。

**版本集（全部钉死）**：`prisma` / `@prisma/client` / `@prisma/adapter-mariadb` = **`7.10.0`**；`typescript` = `5.9.3`；`engines.node` = **`^20.19.0 || ^22.12.0 || >=24.0.0`**（v7 的硬门槛，20.11~20.18 不再允许；本机实测 Node **v24.15.0**）。

**两处破坏性变更 ＋ 本项目的落法**：

| # | v7 变更（**实测确证**） | 本项目怎么改 |
|---|---|---|
| 1 | **`datasource` 里不能再写 `url`** —— 写了直接报 `P1012: The datasource property 'url' is no longer supported in schema files. Move connection URLs for Migrate to prisma.config.ts` | `schema.prisma` 的 `datasource db` 只留 `provider`；连接串移到 **`prisma.config.ts`：`datasource.url = env('DATABASE_URL')`**（供迁移类命令用） |
| 2 | **不再自动加载 `.env`**（v6 每次都会打印 `Environment variables loaded from .env`，v7 无此行为） | `prisma.config.ts` 顶部用 **Node 内置 `process.loadEnvFile('.env')`** 显式加载（**不引 dotenv 依赖**；用 `try/catch` 包住，CI 只给真实环境变量也能跑）。⚠ 它按**当前工作目录**找 `.env` → **prisma 命令一律在 `服务端/` 内执行** |

**CLI 参数改名（`migrate diff`）**：v6 的 `--from-schema-datamodel` / `--to-schema-datamodel` / `--from-schema-datasource` / `--to-schema-datasource` **已全部移除**（旧命令直接 unknown option，实测确认），替代为：

| 语义 | v7 参数 |
|---|---|
| 数据模型（schema 文件路径） | `--from-schema` / `--to-schema` |
| 连接串（取自 `prisma.config.ts`） | `--from-config-datasource` / `--to-config-datasource` |
| 空模型 | `--from-empty` / `--to-empty` |
| 迁移目录 | `--from-migrations` / `--to-migrations` |

**generator 也换了**：`provider = "prisma-client-js"` → **`provider = "prisma-client"` ＋ `output = "../src/generated/prisma"` ＋ `moduleFormat = "cjs"`**。`moduleFormat = "cjs"` 是关键 —— **NestJS 12 保持 CommonJS，不必为 Prisma 改 ESM**。✅ **已跑 `prisma generate`**（2026-09-14 复验；`src/generated/` 已入根 `.gitignore`）；并已把它**串进工具链** —— `postinstall` 与 `build` 都先跑一次生成，新环境 clone 后不会再撞「`tsc` 找不到 `../generated/prisma/client`」（TS2307）。见 `package.json` 的 `postinstall` / `build` / `prisma:generate`。

**运行时（写代码时必须知道）**：v7 的 `PrismaClient` **必须显式传 driver adapter**（MySQL → **`@prisma/adapter-mariadb`**；注意 **`@prisma/adapter-mysql2` 这个包不存在**）。即 **两处都要 `DATABASE_URL`**：「迁移命令」读 `prisma.config.ts`，「运行时」由 `new PrismaClient({ adapter })` 传入。

**升级实测（2026-09-13 · 4/4 通过）**：

| 项 | 命令 | 结果 |
|---|---|---|
| 依赖解析 ＋ config 生效 | `npx prisma --version` | `prisma 7.10.0` / `@prisma/client 7.10.0` / Node `v24.15.0` / TypeScript `5.9.3`，并打印 **`Loaded Prisma config from prisma.config.ts.`** ✅ |
| schema 有效 | `npx prisma validate --schema prisma/schema.prisma` | `The schema at prisma\schema.prisma is valid 🚀` ✅ |
| **真库兼容（关键）** | `npx prisma migrate status`（**只读**） | **`2 migrations found` ＋ `Database schema is up to date!`** ✅ —— **v7 认可 6.19.3 登记的 `_prisma_migrations` 历史：checksum 无冲突、无需重置、无需重建库** |
| 离线重生成 baseline 的能力保留 | `npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script` | 正常产出 SQL（**1050 行**）✅ |

> **v6 → v7 的安全结论**：**迁移历史与真库结构都无需任何处理** —— 本轮**未对真库执行任何写操作**（只跑了只读的 `migrate status` / `migrate diff`）。

## schema.prisma

- **46 张表**，真相源＝**《需求规格/销售CRM数据架构文档》V1.31**（§三~§九 表、§十 索引、§十五 落库口径）。
- ✅ **已通过 Prisma 校验**：`The schema at prisma\schema.prisma is valid 🚀`（**2026-09-12 于 `6.19.3`；2026-09-13 升级到 `7.10.0` 后再次复验通过**）。
- ⚠ **两次 P1012（都已修，值得记住）**：
  1. **2026-09-12 · 关系未双向声明**：`SignChecklist.product_line` 缺 `ProductLine` 侧的对向字段 → 已在 `ProductLine` 补一行 `sign_checklists SignChecklist[]`。该行属**纯 Prisma 关系声明**，**不影响真库结构**（`sign_checklist` 表与其外键，`migration.sql` 里一直是对的）。**教训：Prisma 关系字段是双向的 —— 加表/加关系时必须同批补对向字段，否则 `validate` 与 `generate` 直接失败（骨架一搭好就会撞）。**
  2. **2026-09-13 · Prisma 7 移除 `datasource.url`**：`The datasource property 'url' is no longer supported in schema files` → 连接串按要求迁到 **`prisma.config.ts`**（见上文「★ Prisma 7 升级」）。**教训：主版本升级先跑只读的 `migrate status` 验证迁移历史兼容性，再动 schema。**

### 本地校验 / 格式化

```bash
# 在 服务端/ 目录内执行（prisma.config.ts 按「当前工作目录」加载 .env）
npx prisma validate --schema prisma/schema.prisma
npx prisma format   --schema prisma/schema.prisma
```

> **v7 起不再需要给命令内联 `DATABASE_URL=...`**：`.env` 已由 `prisma.config.ts` 用 `process.loadEnvFile` 显式加载（v6 是 CLI 自动加载，v7 取消了这件事）。
> 要临时换库就直接覆盖环境变量（`loadEnvFile` **不覆盖**已存在的环境变量）——**本机开发不必**，`.env` 已指向 `win_crm`。
> 等价 npm 脚本：`npm run prisma:validate` / `prisma:format` / `prisma:status` / `prisma:deploy`。

## migrations / 0001_init / migration.sql

- **生成方式（当时是 v6 口径）**：`DATABASE_URL=占位 npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > migrations/0001_init/migration.sql`（**离线生成，不需要真库**）。
  ⚠ **该参数名 v7 已移除** —— 2026-09-13 升 v7 后的等价命令：`npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script`（**已实测可跑，输出 1050 行**；`DATABASE_URL` 前缀也不再需要，由 `prisma.config.ts` 从 `.env` 加载）。**该命令仍只用于「首建基线」，不得用来改已登记的 `0001_init`。**
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

方式：`npx prisma migrate deploy --schema prisma/schema.prisma`（**当时钉 `prisma@6.19.3`** —— 不钉版本 `npx` 会拉到 `latest`，**2026-09-13 实测 ＝ `8.0.0-rc.14`（一个 RC）**，故必须钉版本；**同日稍后已升级到 `7.10.0` 并复验，见下**）。下表「实测」列均为 `information_schema` 实查值。

> **【2026-09-13 · v7 `7.10.0` 复验】** 升级后重跑 `npx prisma migrate status` → **`2 migrations found` ＋ `Database schema is up to date!`** ✅ —— 即上表结论**在 v7 下全部依然成立**：v7 认可 6.19.3 登记的 `_prisma_migrations` 历史（**checksum 无冲突**），**升级既未触碰真库、也未改动迁移历史**。

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

## migrations / 0003_username_and_phone_lock / migration.sql（增量 · 2026-09-14）

- **做什么**：① `employee` 加 `username`（登录账号名 `VARCHAR(64) NULL` ＋ **`uk_username` 唯一索引**）；② `contact` 加 `phone_locked_at` / `phone_locked_by`（**联系方式「锁」**）。
- **为什么**：需求 **§4.3** 2026-09-14 拍板 —— ① 登录通道由「手机号 ＋ 密码」扩为「**手机号 / 账号名 二选一 ＋ 密码**」（员工自定、**可空**、**唯一**、两通道共用同一 `password_hash`）；② 联系方式**不再分档脱敏**，改为「**详情默认全可见 ＋ 联系人可上锁**」（`→《废止口径登记表》#30 / #31`）。
- **「可空 + 唯一」怎么共存**：MySQL 唯一索引**允许多个 NULL** —— 所以"老员工可以没有账号名"与"账号名不许重"两件事同时成立。
- **锁为什么不建外键**：`phone_locked_by` 与 `created_by` 等审计列口径一致（**不建外键**），避免"删员工被引用挡住"。**锁的消失条件由应用层实现**（落锁人不再是该联系人任一活跃关系的 owner —— 离职 / 转岗 / 掉公海 → 锁自动消失），**DB 不加触发器、不加约束**。
- **✅ 2026-09-14 已在真库执行**（`npx prisma migrate deploy` → `Applying migration 0003_username_and_phone_lock` → **`All migrations have been successfully applied.`**）；属纯 `ALTER TABLE` 加列 ＋ 加唯一索引，**不回填数据、无破坏性**（`username` 与两个锁列初始全为 NULL）。
- **⚠ 不要改 `0001_init` / `0002`**：两份均已登记 → **注释 / 结构修正一律走新增量**（本目录已是第二次实践）。
- **重建库顺序**：`0001_init` → `0002_company_capital_legal_person` → `0003_username_and_phone_lock`（再**各自** `migrate resolve --applied`）。
- 表数不变（仍 **46 张业务表**）；**新增 1 个索引**：`employee.uk_username`。

### ✅ 0003 验收结果（2026-09-14 · MySQL 8.0.12 实跑取证）

方式：`npx prisma migrate deploy --schema prisma/schema.prisma`（**钉 `prisma@7.10.0`**，不钉版本会拉到 `8.0.0-rc.14`）。下表「实测」列均为 `information_schema` 实查值。

| 验收项 | 期望 | 实测 |
|---|---|---|
| `employee.username` | `varchar(64)` / NULL | **`varchar(64)` / YES** ✅ |
| `employee.uk_username` | 唯一、单列 | **`NON_UNIQUE=0`、列 `username`、`SEQ_IN_INDEX=1`** ✅ |
| `contact.phone_locked_at` | `datetime` / NULL | **`datetime` / YES** ✅ |
| `contact.phone_locked_by` | `bigint unsigned` / NULL | **`bigint(20) unsigned` / YES** ✅ |
| 三列中文 `COMMENT` | 3 / 3 | **3 / 3 已带** ✅ |
| `prisma migrate status` | `3 migrations found` ＋ 无 pending | **`3 migrations found` ＋ `Database schema is up to date!`** ✅ |
| `migrate diff` 核对（**只作核对**） | 仅 3 列 ＋ `uk_username` 为真差异；其余是 4 类"设计使然" | **diff 里只有 `ADD COLUMN ×3` ＋ `CREATE UNIQUE INDEX uk_username`，其余 6 条（`DROP INDEX uk_active_rel / uk_phone_active / uk_owner` ＋ `DROP PRIMARY KEY` 三张分区表）全是"设计使然"，执行即破坏** ✅ |
| 种子重跑（幂等） | Q1~Q5 自检全通过 | **Q1 行数不变（矩阵仍 18 行）／Q4 六人账号名齐备／Q5 key 集合＝`contact_phone,contract_amount,relation_timeline`** ✅ |
| 三绿 | `tsc --noEmit` / `lint` / `test` 全过 | **tsc 0 error ／ lint 0 error ／ 23 suites · 254 tests 全绿**（与改动前一致） ✅ |
| 表数 / 其余索引 | 仍 46 业务表；除 `uk_username` 无新增 | **不变** ✅（全库 47 基表 ＝ 46 业务表 ＋ 1 元数据表） |

> ⚠ **已知未清**：`0001_init` 第 93 行 `permission_matrix.perm_key` 的列 `COMMENT` 里仍举着两个**已废止**的 key（`cross_dept_private` / `phone_unlock`）。按上文「注释修正走新增量」本该再开 `0004` 只改注释 —— **本批未做**（不在本次授权范围），待指令。

### ✅ 字典种子 002_dict_seed（2026-09-15 · MySQL 8.0.12 实跑取证）

方式：以 `source` 执行 `prisma/seed/002_dict_seed.sql`（七叔 2026-09-15「执行」）。
**幂等策略**：`dict_type` 撞 `uk_code`、`dict_item` 撞 `uk_type_item` 时**只更新** `label / sort / builtin / status / updated_at`，**不删行、不改 id**。
⚠ **与 A 域 `001_dev_seed.sql` 的「先清后插」取舍不同**：字典会被业务行（如 `action_event.action_type`）以**码值**引用，清空重建会让历史行指向不存在的码。

| 验收项 | 期望 | 实测 |
|---|---|---|
| 字典类型 | 18 个（＝《数据架构文档》§十三） | **18** ✅ |
| 字典项 | 每条 `builtin=1` / `status=active` | **101 条；builtin 101；status 全 `active`** ✅ |
| `urgency` 取值 | 数据架构那套（2026-09-15 裁定；《废止口径登记表》#36） | **`weekly / monthly / quarterly / long_term / gray`** ✅ |
| 幂等（**跑第二遍**） | 行数不变、`(type_id,item_code)` 无重复 | **items 101 ／ distinct 101 ／ types 18** ✅ |
| 每字典条数 | 见 §十三 | action_type 11 ／ pain_point 8 ／ urgency 5 ／ value_tier 4 ／ customer_level 5 ／ party 3 ／ commitment_ctype 9 ／ identity_tag 6 ／ policy_tag 4 ／ decision_chain 4 ／ contact_trait 7 ／ risk_label 5 ／ workflow_stage 7 ／ competition 3 ／ review_type 3 ／ win 5 ／ loss 6 ／ churn 6 ✅ |

> ⚠ **两处待确认（写在种子文件头，别当既定口径）**：
> ① **`workflow_stage` 码**：本文件用 **`1`~`7`**（＝ `business_relation.stage` 的数值列口径 ＋ §十三 的编号写法），而《接口API文档》V1.16 §2.6 的 `stage` 举例是**英文码**（`first_contact … churned`）—— 两套并存，**需裁一次**；
> ② **AI 起草的码**：`company_identity_tag / company_policy_tag / decision_chain / contact_trait / relation_risk_label / review_win_reason` 的 `item_code` 规格里**只给了中文**，现由 AI 按语义起草（全站要求「枚举一律英文码」）；**业务确认后可改码**（改前先 grep 引用）。

## ★ 必须「手写 migration」的部分（数据架构 §十五.5，Prisma 表达不了）

| # | 场景 | 做法 |
|---|---|---|
| 1 | **生成列**：`business_relation.active_key` / `relation_member.owner_flag` / `contact.phone_active` | schema 中已声明为 `@ignore` 字段（Client 不暴露、不读不写）。**⚠ 实测：Prisma 仍会把这 3 个字段建成「普通可空列」**——故 migration 里需 **`DROP COLUMN` 后重建为 `GENERATED ALWAYS AS (...) STORED` ＋ 建唯一索引**（`uk_active_rel` / `uk_owner` / `uk_phone_active`）。**唯一性由 DB 兜底，冲突靠 P2002 识别** |
| 2 | **分区表**（**3 张**）：`stat_daily` / `operation_log` / `job_run_log` | schema 保持普通表定义（会报 drift 警告，可接受）；migration 手写 `ALTER TABLE ... PARTITION BY RANGE`（按 `biz_date` / `occurred_at` / `run_at` 月分区）。**⚠ MySQL 规则：每个唯一键（含主键）都必须包含分区列，否则报 ERROR 1503** —— 故先扩主键含分区列（`ADD PRIMARY KEY (id, 分区列)`）。**🚫 原定的 `action_event` / `daily_agenda` 已因「保外键」放弃分区**（分区表不能参与外键，ERROR 1506），二者主键保持建表原样 `(id)`；`action_event.uk_idem` 随之回退为**全局唯一 `(idempotency_key)`**（原 `(idempotency_key, event_at)` 只为满足分区要求而加） |
| 3 | **CHECK 约束** | 如 `approval` 申请人 ≠ 审批人（DB CHECK ＋ 应用双拦）。**⚠ 需 MySQL 8.0.16+**：8.0.12 会解析后静默忽略（见上方「环境版本门槛」） |
| 4 | **视图** | `v_contract_performance` ＝ `contract × contract_split`（无 split 则 `signer_id` 占 100%）——**业绩统计一律读此视图**，避免口径漂移。**⚠ 视图不能带 `COMMENT`**（MySQL `CREATE VIEW` 无该子句，ERROR 1064），口径说明只写在脚本里其上方 SQL 注释 |
| 5 | **键约束** | 手机号唯一、公司信用代码唯一为**数据库级约束**（撞单兜底） |
| 6 | **表 / 字段中文 `COMMENT`** | **Prisma 无法表达 MySQL `COMMENT`**（`schema.prisma` 不写、`db pull` 不读）。故 `migration.sql` 里 **46 张表全部带表级 `COMMENT='…'` ＋ 每个字段行尾 `COMMENT '…'`**，让 DBA / Navicat / `SHOW CREATE TABLE` 直接可读（口径来源＝《数据架构文档》V1.31 各表字段说明）。**⚠ 用 `prisma migrate diff` 重新生成 baseline 会把这批 COMMENT 全部抹掉** —— 重生成后必须补回，或改用「手写增量 migration」承载注释。**视图列不受此覆盖**（视图无 COMMENT，且表达式列 `employee_id` / `percent` / `performance_amount` 在 `information_schema` 里 `COLUMN_COMMENT` 为空属正常） |

## 口径约定（写代码前先读）

- **枚举一律 `String`（VARCHAR(32) 英文码）**，展示文案走字典 `dict_item`——**不用 DB ENUM**（T1/T5：可加项、停用不删）。
- **唯一冲突**：Prisma 报 **P2002**（不是 MySQL 1062）→ 异常过滤器映射 **409（撞单/竞态/抢公海）/ 422（业务校验）**，约束名从 **`meta.driverAdapterError.cause.constraint.index`** 取（**非 `meta.target`** —— Prisma 7 ＋ driver adapter 实测，→ 废止口径登记表 #29）回友好提示。
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
npx prisma migrate diff --from-schema prisma/schema.prisma --to-config-datasource --script
# 方向 B：真库 → schema（列出「schema 声明里有、真库缺」的项）
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
# 方向 B 的等价 npm 脚本：npm run prisma:diff:db2schema
```

> ⚠ **v7 参数改名（2026-09-13 实测）**：上面两条命令在 **2026-09-12 执行时用的是 v6 参数**（`--from-schema-datamodel` / `--to-schema-datasource` / `--from-schema-datasource` / `--to-schema-datamodel`）；**v7 已把这四个全部移除**（旧命令直接 unknown option），改为 `--from-schema` / `--to-schema`（schema 文件）＋ `--from-config-datasource` / `--to-config-datasource`（连接串取自 `prisma.config.ts`）。**比对逻辑等价，下表的 drift 结论不受影响。**

> 🚫 **绝不能把 diff 输出的 SQL 拿去执行**（2026-09-13 实测方向 B 的输出全文只有 6 个动作，且这 6 个都**不能做**）：
> `ALTER TABLE stat_daily / operation_log / job_run_log DROP PRIMARY KEY, ADD PRIMARY KEY (\`id\`)`（3 条）＋ `DROP INDEX uk_active_rel / uk_owner / uk_phone_active`（3 条）。
> 前者会把**分区表主键改坏**（分区表主键必须含分区列，否则 ERROR 1503），后者会**拆掉生成列的唯一约束**（撞单兜底失效）。这 6 条正是下表第 1 / 2 类「设计使然」的 drift —— **`migrate diff` 只作核对，永不作为执行依据**；要改库一律走「新增量 migration → 真库执行 → `information_schema` 逐条核对」。

**结论：drift 仅 4 类，全部可接受；无一条需要改库、也无一条需要改 `schema.prisma`。**

| # | drift 项 | 为什么会有 | 判定 |
|---|---|---|---|
| 1 | **3 张分区表的主键含分区列**：`stat_daily` `(id, biz_date)` / `operation_log` `(id, occurred_at)` / `job_run_log` `(id, run_at)`（schema 侧仍写 `(id)`） | 手工补充段按 **ERROR 1503**（分区表唯一键必须含分区列）改造；**分区本身 schema 表达不了** | **可接受·设计使然** |
| 2 | **3 个生成列唯一索引**：`uk_active_rel` / `uk_owner` / `uk_phone_active` | 生成列在 schema 里是 `@ignore` 字段，索引由手工段 `DROP` 后重建 | **可接受·设计使然** |
| 3 | **5 个 MySQL 自动索引**：`permission_matrix_role_code_fkey` / `business_relation_product_line_id_fkey` / `cadence_rule_scope_line_id_fkey` / `sea_rule_dept_id_fkey` / `sea_rule_product_line_id_fkey` | MySQL **为外键自动建索引**（仅当该列没有显式索引；其余 FK 列已有 `idx_*`，故未重复建） | **可接受·MySQL 机制** |
| 4 | **`_prisma_migrations` 元数据表**（不计入业务表） | M0-21 `migrate resolve` 时由 Prisma 自建自管 | **可接受·Prisma 机制** |

**关键结论**：**无缺表 / 无缺列 / 无缺索引** —— 即 `migration.sql` 与 `schema.prisma` 的**结构一致**，上文「46 表 / 索引 / 外键」的验收结论不受 drift 影响。

> ⚠ **重建提醒（必读）**：日后若 `DROP DATABASE win_crm` 重灌 `migration.sql`，**必须重跑 `npx prisma migrate resolve --applied 0001_init`**。否则库内没有 `_prisma_migrations` 记录，`migrate status` 会把它判为「未应用」并试图**重跑整份 baseline**（在已有表上执行 → 必炸）。**2026-09-14 起**：重灌＝**三份都要跑**（`0001_init` → `0002_company_capital_legal_person` → `0003_username_and_phone_lock`）并**分别 `migrate resolve --applied`**（否则 `migrate status` 会报 `0002` / `0003` 未应用）。

## ✅ 基线登记（M0-21 · 2026-09-12 取证）

- 命令：`npx prisma migrate resolve --applied 0001_init --schema prisma/schema.prisma` → `Migration 0001_init marked as applied.`
- 实查 `_prisma_migrations`：`0001_init｜applied_steps_count=0｜finished_at=2026-09-12 09:51:41｜rolled_back_at=NULL`
- `npx prisma migrate status` → `1 migration found in prisma/migrations` ＋ **`Database schema is up to date!`**
- 注：`migrate resolve` **不校验关系完整性**（只读 datasource），所以它在 `schema.prisma` 尚为 P1012 时就跑通了 —— **别把它当作 schema 有效的证据**。

## ⬆ 上服务器时必做（上线前清单 · 2026-09-13 立，2026-09-14 补第 7~9 项）

> 本机开发环境的**已知降级项**在服务器上**必须补回** —— 本机"跑通了"不等于生产合规。

| # | 项 | 本机现状（开发用） | 服务器必做 |
|---|---|---|---|
| 1 | **MySQL 版本** | phpStudy **8.0.12** | 装 **8.0.16+**（`CHECK` 自 8.0.16 才生效） |
| 2 | **CHECK 约束复验** | 8.0.12 下 `CHECK` **静默忽略**（`CONSTRAINT_TYPE='CHECK'` 计数＝**0**）→ 靠应用层单测兜底（M0-19） | 建库后**复验真生效**：插入「申请人 ＝ 审批人」→ 断言报错（不再静默放过） |
| 3 | **docker-compose** | 本机无 Docker，**从未跑过**（M0-07 只做 YAML 语法自检） | 首次部署跑 `docker compose config` ＋ `up`，确认 `mysql:8`（**≥8.0.16**）/ `redis:7` 起得来 |
| 4 | **Redis 版本** | phpStudy **3.0.504**（**无密码**） | 换 **Redis 7**；代码里「禁用 6/7 专有命令」的临时红线（`UNLINK` / `EXPIRE … NX｜GT｜LT` / ACL）**可解禁**；**必须设密码** |
| 5 | **密钥 / 口令** | `.env` 里 DB / Redis **均无强口令**、`JWT_SECRET` 为本地随机值 | 换生产密钥与强口令；`.env` 不入库 |
| 6 | **migration 全量重放** | 已应用 `0001_init` ＋ `0002` ＋ `0003` | 空库上按序 `0001_init` → `0002` → `0003` → 逐份 `migrate resolve --applied`（口径见上文「重建提醒」），再 `migrate status` 断言 **`up to date!`** |
| 7 | **`/docs` OpenAPI 暴露** | 开发环境**默认开放**（`/docs` ＋ `/docs-json`） | **生产已默认关闭** —— `main.ts` 的 `openApiEnabled()`：`NODE_ENV=production` 且未设 `OPENAPI_ENABLED=true` 时**跳过挂载**（`/docs` 是中间件直出、不经守卫，开了即等同公开全部接口定义）。确需保留必须**自加访问控制**。**部署后必查**：`curl -o /dev/null -w '%{http_code}' http://<host>/docs` 应为 **404**（2026-09-14 立） |
| 8 | **构建链路（尤其 `npm ci --omit=dev`）** | `package.json` 已含 `prisma:generate` / `build` / `postinstall`；本机 `npm run build` **已实测通过** | `npm ci` 会自动跑 `postinstall → prisma generate`；⚠ 但 **`--omit=dev` 时 `prisma` CLI 不在 → `postinstall` 会失败**：改用**多阶段构建**（构建阶段装 devDeps 跑 `npm run build`，运行阶段只带 `dist/` ＋ prod deps ＋ 已生成的 client），或 `npm ci --ignore-scripts` 后自行 `npm run prisma:generate`。**首次部署必跑 `npm run build` 验证**（2026-09-14 立） |
| 9 | **分区预置月数 / 滚动** | 建库时预置到 `p202712`（真实上界 `202801`）＋ `pmax(MAXVALUE)` | **有 `pmax` 兜底 → 绝不会插失败**；但 **2028-01 起全部新行落入单一 `pmax`**，且老分区**无法 `DROP PARTITION` 清理** → 生产建库**预置月数 ≥ 3 年**，并把「分区滚动」纳入定时任务（→ 数据架构 §十二 末行，2026-09-14 补录） |

> ⚠ 第 **1、2 项是同一个坑的两面**：本机 `CHECK` 静默失效最容易被拖到上线才炸 —— 本机当前只靠应用层单测兜住「审批人 ≠ 申请人」。
