# 服务端 / Prisma —— 落库口径唯一落点

> **定位**：本目录承载「**数据落库口径**」——Prisma 版本硬口径 / 必须手写 migration 的部分 / 真库结构约束 / 上线前必做。
> **真相源**：《需求规格/销售CRM数据架构文档》**V1.37**（§三~§九 表、§十 索引、§十五 落库口径）。本文只记「Prisma 与 MySQL 层面的落法」，不重复业务规则。
> **读者**：改 `schema.prisma` / 写 migration / 首次部署前**必读**。所有 prisma 命令**一律在 `服务端/` 内执行**。
> 版本沿革查 git。

## 一、当前构成

| 项 | 内容 |
| --- | --- |
| `prisma/schema.prisma` | **46 张业务表**，与数据架构 V1.37 一致 |
| `prisma/migrations/0001_init/` | baseline（46 表 / 索引 / 外键）＋ 结尾**「手工补充段」**（生成列 / 3 张分区表 / 视图 / CHECK / 46 表中文 COMMENT）。**已 `migrate resolve --applied` 登记为基线** |
| `prisma/migrations/0002_company_capital_legal_person/` | 增量（详见 §四.2） |
| `prisma/migrations/0003_username_and_phone_lock/` | 增量（详见 §四.3） |
| `prisma/migrations/0004_product_line_color_key/` | 增量（详见 §四.4） |
| `prisma/migrations/0005_commitment_waive_reason/` | 增量（详见 §四.5） |
| `prisma/migrations/0006_perm_key_comment/` | 增量（只改列 COMMENT，详见 §四.6） |
| `prisma.config.ts` | Prisma 7 的**连接串中枢**（见 §二） |
| `prisma/seed/001_dev_seed.sql` | A 域开发种子（6 账号 / 5 部门 / 3 产品线 / 18 行权限矩阵）；幂等＝**先清后插** |
| `prisma/seed/002_dict_seed.sql` | **18 个内置字典 / 101 项**；幂等＝**不删行只更新**（见 §五） |
| 版本（全部钉死） | `prisma` / `@prisma/client` / `@prisma/adapter-mariadb` = **`7.10.0`**；`typescript` = `5.9.3`；`engines.node` = `^20.19 \|\| ^22.12 \|\| >=24`。`package-lock.json` **已入库** ＝ 版本真钉死的锚点，`node_modules/` 不入库（`.gitignore`） |
| `src/generated/prisma/` | Prisma Client 生成产物，**被根 `.gitignore` 忽略** → 改 `schema.prisma` 后**必须** `npm run prisma:generate`（`build` / `postinstall` 会带跑） |

六份 migration **均已在真库 `win_crm`（本机 phpStudy MySQL 8.0.12）执行**。

## 二、Prisma 7 硬口径（三条，缺一即炸）

> **为什么要钉版本**：不钉版本时 `npx prisma` 取 registry 的 `latest` ＝ **`8.0.0-rc.14`（RC，不可用于生产）**。

| # | v7 变更（实测确证） | 本项目落法 |
| --- | --- | --- |
| 1 | **`datasource` 里不能再写 `url`** —— 写了直接报 `P1012: The datasource property 'url' is no longer supported in schema files` | `schema.prisma` 的 `datasource db` 只留 `provider`；连接串移到 **`prisma.config.ts` 的 `datasource.url = env('DATABASE_URL')`**（供迁移类命令用） |
| 2 | **不再自动加载 `.env`**（v6 每次打印 `Environment variables loaded from .env`，v7 无此行为） | `prisma.config.ts` 顶部用 Node 内置 **`process.loadEnvFile('.env')`** 显式加载（**不引 dotenv**；`try/catch` 包住，CI 只给真实环境变量也能跑）。⚠ 它按**当前工作目录**找 `.env` → **prisma 命令一律在 `服务端/` 内执行** |
| 3 | **运行时 `PrismaClient` 必须显式传 driver adapter** | MySQL → **`@prisma/adapter-mariadb`**（⚠ **`@prisma/adapter-mysql2` 这个包不存在**）。即「**迁移命令读 `prisma.config.ts`、运行时传 adapter`**」—— **两处都要 `DATABASE_URL`** |

**CLI 参数改名（`migrate diff`）**：v6 的 `--from-schema-datamodel` / `--to-schema-datamodel` / `--from-schema-datasource` / `--to-schema-datasource` **已全部移除**（旧命令直接 unknown option），替代为：

| 语义 | v7 参数 |
| --- | --- |
| 数据模型（schema 文件路径） | `--from-schema` / `--to-schema` |
| 连接串（取自 `prisma.config.ts`） | `--from-config-datasource` / `--to-config-datasource` |
| 空模型 | `--from-empty` / `--to-empty` |
| 迁移目录 | `--from-migrations` / `--to-migrations` |

**generator 也换了**：`provider = "prisma-client-js"` → **`provider = "prisma-client"` ＋ `output = "../src/generated/prisma"` ＋ `moduleFormat = "cjs"`**。`moduleFormat = "cjs"` 是关键 —— **NestJS 12 保持 CommonJS，不必为 Prisma 改 ESM**。生成已串进工具链（`postinstall` ＋ `build` 都先跑一次），新环境 clone 后不会再撞 TS2307「找不到 `../generated/prisma/client`」。

**本地校验 / 格式化**：

```bash
# 在 服务端/ 目录内执行（prisma.config.ts 按「当前工作目录」加载 .env）
npx prisma validate --schema prisma/schema.prisma   # 通过则输出 The schema … is valid 🚀
npx prisma format   --schema prisma/schema.prisma
```

> v7 起**不再需要**给命令内联 `DATABASE_URL=...`。要临时换库就直接覆盖环境变量（`loadEnvFile` **不覆盖**已存在的环境变量）；本机开发不必，`.env` 已指向 `win_crm`。
> 等价 npm 脚本：`prisma:validate` / `prisma:format` / `prisma:status` / `prisma:deploy` / `prisma:diff:db2schema`。

## 三、schema.prisma

- **46 张表**，真相源＝数据架构文档 **V1.37**。
- **教训一（P1012 · 关系未双向声明）**：`SignChecklist.product_line` 曾缺 `ProductLine` 侧对向字段 → 已在 `ProductLine` 补 `sign_checklists SignChecklist[]`。该行属**纯 Prisma 关系声明**，**不影响真库结构**。**规律：Prisma 关系字段是双向的 —— 加表 / 加关系时必须同批补对向字段，否则 `validate` 与 `generate` 直接失败。**
- **教训二（P1012 · v7 移除 `datasource.url`）**：见 §二。**规律：主版本升级先跑只读的 `migrate status` 验证迁移历史兼容，再动 schema。**

## 四、migration 逐份口径

> **⚠ 铁律（贯穿全部历史）**：`0001_init` / `0002` / `0003` / `0004` / `0005` / `0006` / `0007` / `0008` / `0009` **均已登记，一律不得改动**（改文件会与 `_prisma_migrations` 的**校验和不一致**）。**注释 / 结构修正一律走「新增量 migration」**。

### 4.1 `0001_init`（baseline）

**生成方式（仅「首建基线」用一次，此后禁用）**：

```bash
npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script > prisma/migrations/0001_init/migration.sql
```

**内容** ＝ Prisma 生成的 baseline（46 表 / 索引 / 外键）＋ **结尾「手工补充段」**：①生成列改造 ②3 张分区表改造 ③视图 `v_contract_performance` ④审批 CHECK ⑤46 表全字段中文 `COMMENT`。

**真库实测踩坑（已修，2 条）**：

1. **ERROR 1215** —— 生成列**不能引用带 `ON UPDATE CASCADE` 的外键列**。`business_relation` 的 `company_id` / `dept_id` / `product_line_id` 与 `relation_member.relation_id` 这 **4 条外键**已改为 **`ON UPDATE RESTRICT`**；`schema.prisma` 侧**同步显式声明 `onUpdate: Restrict`**（否则 `migrate diff` 会重新生成 `CASCADE` 并判 drift）。
2. **ERROR 1064（视图）** —— **MySQL 8 的 `CREATE VIEW` 不支持 `COMMENT` 子句**。`v_contract_performance` 的口径说明改由其上方 SQL 注释承载。

**MySQL 规则性约束（规则为真、直接决定设计，写错必炸）**：

- **ERROR 1506** —— **分区表不能参与外键**。故 `action_event` / `daily_agenda` **放弃分区**（保留分区的 `stat_daily` / `operation_log` / `job_run_log` 三张均无外键）；`action_event.uk_idem` 随之回退为**全局唯一 `(idempotency_key)`**。
- **ERROR 1503** —— 分区表**每个唯一键（含主键）都必须包含分区列**。故 3 张分区表先 `ADD PRIMARY KEY (id, 分区列)` 再 `PARTITION BY`。
- **ERROR 1064（分区）** —— `PARTITION BY` 是 `ALTER TABLE` 的**独立子句，前面不能有逗号**（`DROP PRIMARY KEY, ADD PRIMARY KEY (...), PARTITION BY ...` 的**尾逗号必须删掉**）。
- **发现并已记录**：Prisma 会把 `@ignore` 字段**建成普通列** → 手工段里 `DROP COLUMN` 后重建为 `GENERATED`。

**⚠ 环境版本门槛**：本机 phpStudy 为 **MySQL 8.0.12**，而 **CHECK 约束自 8.0.16 才支持** —— 8.0.12 会把 `CHECK (...)` **解析后静默忽略**（实测 `CONSTRAINT_TYPE='CHECK'` 计数＝**0**）。即 `chk_approval_not_self` 与 `action_event` 的内联 CHECK **在本机不生效**，只剩应用层单拦。**建生产库 / CI 必须用 8.0.16+。**

**⚠ 本机「多版本 MySQL 并存」（最容易悄悄踩）**：phpStudy `Extensions/` 下装了 **三个** MySQL —— `5.5.29` / `5.7.26` / **`8.0.12`**。3306 上跑的确实是 8.0.12，**但面板切版本或用 `PATH` 里的 `mysql` 会连到别的版本**（实测第一下抓到的就是 `5.5.29\bin\mysql.exe`）。**5.5 / 5.7 建不出生成列与 CHECK**，一旦用错版本，`0001_init` 会中途炸且现场难辨。
→ **动手前自证一句**：`select version()`，**建议直接用** `D:\ITtool\phpstudy_pro\Extensions\MySQL8.0.12\bin\mysql.exe`，别依赖 `PATH`。建库 / 跑 `migration.sql` / `SHOW CREATE TABLE` / 查 `information_schema` 之前都先跑它。

### 4.2 `0002_company_capital_legal_person`（增量）

- **做什么**：① `company` 加 2 列 —— `registered_capital`（`DECIMAL(16,2)`，**单位＝元**）/ `legal_person`（`VARCHAR(64)`）；② `address` / `bank_name` / `invoice_title` / `tax_no` 4 列注释由「成交后强制补」改为「**成交后可选补全，不强制**」。
- **为什么**：需求 **§7.3** 定 —— 注册资本 / 法定代表人＝**公司档案「可选扩展字段」，不做签约强制、不计入完善度**，只作档案留存与按规模筛选；同批修掉数据架构 **E8** 硬伤 —— 签约校验清单的 `field_key` 用了库里不存在的「逻辑名」（`registered_address` / `industry` / `region`），导致「逐项查字段非空」**写不出 SQL** → 改真实列名 `address` / `industry_l1` / `province`，**公司级默认清单收敛为 4 项**（项数 / 字段以 `→数据架构 E8` 为准）。
- **单位口径**：库内 / 接口层一律「**元**」；前端按「**万元**」录入与展示并做一次换算（`500` 万 ⇄ `5000000`）。
- **性质**：纯 `ALTER TABLE` 加列 / 改注释，**不回填数据、无破坏性**。表数不变（仍 46 张业务表），**无新增索引**（注册资金区间筛选选择性低，暂不建，见数据架构 B1）。

### 4.3 `0003_username_and_phone_lock`（增量）

- **做什么**：① `employee` 加 `username`（登录账号名 `VARCHAR(64) NULL` ＋ **`uk_username` 唯一索引**）；② `contact` 加 `phone_locked_at` / `phone_locked_by`（**联系方式「锁」**）。
- **为什么**：需求 **§4.3** 2026-09-14 拍板 —— ① 登录通道由「手机号 ＋ 密码」扩为「**手机号 / 账号名 二选一 ＋ 密码**」（员工自定、**可空**、**唯一**，两通道共用同一 `password_hash`）；② 联系方式**不再分档脱敏**，改为「**详情默认全可见 ＋ 联系人可上锁**」（→《废止口径登记表》**#30 / #31**）。
- **「可空 + 唯一」怎么共存**：MySQL 唯一索引**允许多个 NULL** → 「老员工可以没有账号名」与「账号名不许重」同时成立。
- **锁为什么**不用**外键**：`phone_locked_by` 与 `created_by` 等审计列口径一致（不建外键），避免「删员工被引用挡住」。**锁的消失条件由应用层实现**（落锁人不再是该联系人任一活跃关系的 owner —— 离职 / 转岗 / 掉公海 → 锁自动消失），**DB 不加触发器、不加约束**。
- **性质**：纯 `ALTER TABLE` 加列 ＋ 加唯一索引，不回填数据、无破坏性（三列初始全 NULL）。表数不变，**新增 1 个索引**：`employee.uk_username`。

### 4.4 `0004_product_line_color_key`（增量）

- **做什么**：`product_line` 加 `color_key`（`VARCHAR(32) NULL`，**固定配色键**）。
- **为什么**：需求 **§13.3**「产品线 = 全系统固定配色（7 条线各一色）」＋ 接口 §4.1 / §5.3 / §5.6 一直要求返回该字段，而《数据架构》A7 的 `product_line` 表定义**漏落该列**（`0001_init` 建表自然也没有）⇒ 补齐：数据架构 **V1.30 → V1.31**；需求 / 接口不动（它们本来就对）。
- **为什么可空**：存量行**不能瞎填默认色**（配色是业务决定）；未配置＝`NULL`，由前端回落 —— 给"假默认色"会让页面理直气壮地渲染错颜色，且没人会回来改。
- **性质**：纯 `ALTER TABLE` 加列，**不回填数据、无破坏性**；表数不变（仍 46 张业务表），**无新增索引**。
- ⚠ 本小节为**补登记**（该 migration 已入真库，但 §一 表格与本节此前未记）。

### 4.5 `0005_commitment_waive_reason`（增量）

- **做什么**：`commitment` 加 `waive_reason`（`VARCHAR(255) NULL`，**豁免原因**）。
- **为什么**：需求 **§10.1** 要求「豁免必须填原因」，数据架构 D1 的 `status` 也早已列出 `waived(豁免，必填原因)`，但表里**没有任何存原因的列**（`daily_agenda.action_reason` 是**动线条目**的，不是承诺的）⇒ D 域此前**不敢开放** `waived` 写入（收下原因却无处可存 ＝ 假契约，→ 交接说明 §二 A）。**七叔 2026-09-15 拍板「取消 / 豁免」分界**：`cancelled`＝**录错了 / 这事不成立了**（**不需原因**）；`waived`＝**确有其事但做不成**（客户变卦、特殊原因做不了…，**必填原因**）⇒ 数据架构 D1 补该列（**V1.31 → V1.32**）＋ 需求 §10.1 补分界（**V1.26 → V1.27**）。
- **为什么可空**：原因**只在 `waived` 时有值**（`open` / `done` / `cancelled` 三态都不该有）。给 `NOT NULL DEFAULT ''` 会让"没豁免的承诺"也顶一条空原因，将来统计「豁免原因 Top N」得先擦掉这批空串。
- **应用层约束**：`status=waived` 时**必填**（422），其余状态一律为空。⚠ 本迁移**只建列** —— **「豁免」这个动作在代码层尚未开放**（D 域当前仍只有 `done` / `cancelled` 两条人工流转），列先就位、待开放。
- **性质**：纯 `ALTER TABLE` 加列，**不回填数据、无破坏性**（存量行全 `NULL`）；表数不变，**无新增索引**。
- **实测（本机 8.0.12）**：`npx prisma migrate deploy` 自动应用并写入 `_prisma_migrations`（**无需手工 `resolve`**）；`SHOW FULL COLUMNS` 核对 `waive_reason varchar(255) NULL`、COMMENT 正确、存量 0 行有值。

### 4.6 `0006_perm_key_comment`（增量）

- **做什么**：**只改** `permission_matrix.perm_key` 的**列 COMMENT**（把举着的两个废止 key 换成现行三值）—— 不动结构 / 数据 / 索引 / 约束。
- **为什么**：`0001_init` 第 93 行建列时 COMMENT 举的是 `cross_dept_private`（看他人私海）/ `phone_unlock`（手机号解锁），两者 **2026-09-14 已废止**（→《废止口径登记表》**#31**）；现行三值 ＝ `contact_phone` / `relation_timeline` / `contract_amount`（数据架构 **A6**）。
- **为什么另开增量而不改 `0001_init`**：它是**冻结基线**，改文件会与 `_prisma_migrations` **校验和不一致** ⇒ 一律走新增量（本文件 §四 铁律）。
- **⚠ Prisma 不管列 COMMENT**（`schema.prisma` 的 `///` 是文档注释、**不落库**）→ 本笔只能手写；`migrate diff` 对它**不产生输出**（也不会被判 drift）。
- **实测（本机 8.0.12，2026-09-16）**：`migrate status` 先报 `0006` 未应用 → `npm run prisma:deploy` 成功 → 回读 `information_schema.COLUMNS` 得**新 COMMENT**、`_prisma_migrations` **6 份全登记**。

### 4.7 `0007` / `0008` / `0009`（增量 · **补登记**）

> 本节为**补登记**：三份均已入真库，而 §四 此前只记到 `0006`。逐份的完整口径（为什么、性质、实测）在各自 `migration.sql` 的**文件头注释**里，此处只留索引。

- **`0007_contact_owner`（2026-09-16）**：`contact` 加 `owner_id`（`BIGINT UNSIGNED NULL` ＋ `idx_owner`）—— **待关联（未挂公司）联系人**的归属人（归属＝**建档录入人**）。→ 需求 §6.1 ⑦~⑪ / 数据架构 B3 /《欠账登记表》D-27。
- **`0008_owner_flag_in_seat`（2026-09-16）**：**重建** `relation_member.owner_flag` 生成列（表达式加 `AND revoked_at IS NULL`）＋ 重建 `uk_owner` —— 撤销即**释放位子**，否则掉海重领 / 转交时落不下新 owner。→ 数据架构 §10.2-1 /《欠账登记表》D-26。
- **`0009_employee_preferences`（2026-09-18）**：`employee` 加 `theme`（`VARCHAR(16) NULL`）/ `nav_open`（`JSON NULL`）—— **个人偏好的唯一落点**（主题 / 侧栏展开状态）；写入端＝`PUT /account/preferences`、读取端＝`GET /account/me`。→ 数据架构 A2 / 接口 §5.2 /《欠账登记表》D-37。
- **性质**：`0007` / `0009` 是**纯加列**（可空、不回填、无破坏性；`0007` 新增 1 个索引，`0009` **无索引**）；`0008` 是**重建一个生成列 ＋ 它的唯一索引**（先删后建，不动其它列与数据）。
- **实测（本机 8.0.12，2026-09-18）**：`npm run prisma:deploy` → `Applying migration 0009_employee_preferences` → `All migrations have been successfully applied`（**9 migrations found**，**无需手工 `resolve`**）；真库回读 `employee.theme='light'` / `employee.nav_open=["relation","customer"]`，`operation_log` 有 3 条 `account.preferences.update`。

### 4.8 重建库 / 重灌顺序（**必守**）

`0001_init` → `0002_company_capital_legal_person` → `0003_username_and_phone_lock` → `0004_product_line_color_key` → `0005_commitment_waive_reason` → `0006_perm_key_comment` → `0007_contact_owner` → `0008_owner_flag_in_seat` → `0009_employee_preferences`，**并分别** `npx prisma migrate resolve --applied <name>`。

> ⚠ 若不 `resolve`：库内没有 `_prisma_migrations` 记录，`migrate status` 会判为「未应用」并试图**重跑整份 baseline**（在已有表上执行 → 必炸）。
> ⚠ `migrate resolve` **不校验关系完整性**（只读 datasource）—— **别把它当作 schema 有效的证据**。
> 回退安全网：旧 baseline 可从 git 取回（`git show HEAD:服务端/prisma/migrations/0001_init/migration.sql`）。

## 五、种子文件

| 文件 | 幂等策略 | 为什么这样选 |
| --- | --- | --- |
| `001_dev_seed.sql` | **先清后插** | A 域开发数据，可重建 |
| `002_dict_seed.sql` | **不删行只更新**（撞 `uk_code` / `uk_type_item` 时只更新 `label / sort / builtin / status / updated_at`，**不删行、不改 id**） | 字典会被业务行（如 `action_event.action_type`）以**码值**引用 —— 清空重建会让历史行指向不存在的码 |

**种子里的 ⚠ 待裁项 —— 三项均已裁定（2026-09-15）**：

1. ✅ **`workflow_stage` 码 —— 数字 `1`~`7`**（＝ `business_relation.stage` 数值列口径 ＋ 数据架构 §十三 编号写法）。原《接口API文档》§2.6 举例的英文码（`first_contact … churned`）**已作废**，接口文档同步升 **V1.17**，登记见《废止口径登记表》**#37**。**中文名仍由本种子的 `label` 出**（接口只传数字）。
2. ✅ **6 个 AI 起草的字典码 —— 已确认照用**（2026-09-15，七叔）：`company_identity_tag` / `company_policy_tag` / `decision_chain` / `contact_trait` / `relation_risk_label` / `review_win_reason` 的 `item_code` 规格里只给了中文，由 AI 按语义起草（全站要求「枚举一律英文码」）。**要改仍可改**（改前先 grep 引用）。
3. ✅ **7 条产品线名称 —— 已裁定**（2026-09-15，七叔）：**财税 / 法务 / 网站 / GEO / 短视频 / 招聘 / 房产**（落 `001_dev_seed.sql`）。规格（需求 §13.3 / 数据架构 A7）**只说「7 条线各一色」，既没给名称、也没给色值** → `code` 与 `color_key` 由 AI 起草（**可改**）；`dept_ids`（承接部门）/ `service_cycle_days`（服务周期）**仍是 DEV 占位**。

## 六、必须「手写 migration」的部分（数据架构 §十五.5，Prisma 表达不了）

| # | 场景 | 做法 |
| --- | --- | --- |
| 1 | **生成列**：`business_relation.active_key` / `relation_member.owner_flag` / `contact.phone_active` | schema 中已声明为 `@ignore` 字段（Client 不暴露）。**⚠ 实测：Prisma 仍会把它们建成「普通可空列」** → migration 里需 **`DROP COLUMN` 后重建为 `GENERATED ALWAYS AS (...) STORED` ＋ 建唯一索引**（`uk_active_rel` / `uk_owner` / `uk_phone_active`）。**唯一性由 DB 兜底，冲突靠 P2002 识别**。★ `owner_flag` **自 migration `0008`（2026-09-16）起为「只有在位者占位」**：表达式含 `AND revoked_at IS NULL` —— 撤销即释放位子（否则掉海重新领取 / 转交时落不下新 owner，→ 数据架构 §10.2-1 /《欠账登记表》D-26） |
| 2 | **分区表**（**恰 3 张**）：`stat_daily` / `operation_log` / `job_run_log` | schema 保持普通表定义（会报 drift 警告，可接受）；migration 手写 `ALTER TABLE ... PARTITION BY RANGE`（按 `biz_date` / `occurred_at` / `run_at` 月分区）。🚫 `action_event` / `daily_agenda` 已因「保外键」**放弃分区**（ERROR 1506） |
| 3 | **CHECK 约束** | 如 `approval` 申请人 ≠ 审批人（DB CHECK ＋ 应用双拦）。**⚠ 需 MySQL 8.0.16+**，8.0.12 静默忽略 |
| 4 | **视图** | `v_contract_performance` ＝ `contract × contract_split`（无 split 则 `signer_id` 占 100%）——**业绩统计一律读此视图**，避免口径漂移。**⚠ 视图不能带 `COMMENT`** |
| 5 | **键约束** | 手机号唯一、公司信用代码唯一为**数据库级约束**（撞单兜底） |
| 6 | **表 / 字段中文 `COMMENT`** | **Prisma 无法表达 MySQL `COMMENT`**（`schema.prisma` 不写、`db pull` 不读）。故 `migration.sql` 里 **46 张表全部带表级 `COMMENT='…'` ＋ 每个字段行尾 `COMMENT '…'`**。**⚠ 用 `migrate diff` 重新生成 baseline 会把这批 COMMENT 全抹掉** → 重生成后必须补回，或改用「手写增量」承载注释。视图无 COMMENT，其表达式列 `COLUMN_COMMENT` 为空属正常 |

## 七、口径约定（写代码前先读）

- **枚举一律 `String`（VARCHAR(32) 英文码）**，展示文案走字典 `dict_item` —— **不用 DB ENUM**。
- **唯一冲突**：Prisma 报 **`P2002`**（**不是** MySQL 1062）→ 异常过滤器映射 **409（撞单 / 竞态 / 抢公海）/ 422（业务校验）**；约束名从 **`meta.driverAdapterError.cause.constraint.index`** 取（**非 `meta.target`** —— Prisma 7 ＋ driver adapter 实测，→ 废止口径登记表 **#29**）回友好提示。
- **复杂查询 / 报表 / 递归 CTE**（合并树 `WITH RECURSIVE`、`GROUP BY` 聚合）→ 走 `$queryRaw` ＋ `Prisma.sql` 参数化，**不为迁就 Client API 牺牲 SQL 表达力**。
- **JSON 列**（`ledger.extra_fields` / `contact.extra_phones` / `dept_rule.level_tiers` 等）→ Prisma `Json` 原生支持；**禁止反向 `JSON_CONTAINS` 全表扫描**，高频检索 key 走生成列或正式字段。
- **审计字段**全表统一：`created_by / created_at / updated_by / updated_at`；逻辑删除 `deleted_at`（NULL＝未删）。
  - ⚠ **裸 SQL 插入必须显式给 `updated_at`**：真库里它是 `datetime NOT NULL` **且无默认值** —— Prisma 的 `@updatedAt` **只在 ORM 内生效**，不经 ORM 的写入会给错。
- **主键** `BigInt @db.UnsignedBigInt @default(autoincrement())`；金额 `Decimal(12,2)`；时间 `DateTime(0)`。
- ⏱ **时间列一律「UTC 存、出口换算」（★ 2026-09-20 拍板 →《欠账登记表》D-54）**：`DateTime(0)` 落库是**无时区**的 `DATETIME(0)`，Prisma 写入按 **UTC**；⚠ **不经 Prisma 的裸 SQL / mariadb 驱动直读**会按连接时区解释 ⇒ **同一行差 8 小时**（实测：进程日志写本地 12:00:38，SQL 直读 04:00:38）。三条落实：① 排查直读一律 `CONVERT_TZ(col, '+00:00', '+08:00')`（或连接串显式指定时区），**不靠"心里减 8 小时"**；② **HTTP 出参一律 ISO8601 带 `Z`**，本地化（+08:00）在**前端**做，`job_run_log` 之类**不出口**的列不做换算；③ **分区键同此口径** —— `job_run_log` 按 `run_at` 分区（`YEAR(run_at)*100+MONTH(run_at)`），**边界按 UTC**：本地 10-01 00:30 的行落进 `p202609`（＝UTC 9 月），**这是口径、不是错位**。
- **插入顺序**：`employee_role.role_code` / `permission_matrix.role_code` 是**外键指向 `role.code`** → **角色必须先插**（种子 / 造数据时按此排序）。

## 八、drift 核对（M0-20）

**为什么不用 `prisma db pull`**：它会**覆盖 `schema.prisma`**，把手工段才有的关系声明 / 字段抹平（风险高于收益）。改用**等价的只读**双向比对：

```bash
# 方向 A：schema → 真库（列「真库有、schema 没声明」的项）
npx prisma migrate diff --from-schema prisma/schema.prisma --to-config-datasource --script
# 方向 B：真库 → schema（列「schema 声明有、真库缺」的项）
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
```

> 🚫 **绝不能把 diff 输出的 SQL 拿去执行**。实测方向 B 的输出全文只有 6 个动作，且**都不该做**：
> `ALTER TABLE stat_daily / operation_log / job_run_log DROP PRIMARY KEY, ADD PRIMARY KEY (\`id\`)`（3 条）＋ `DROP INDEX uk_active_rel / uk_owner / uk_phone_active`（3 条）。
> 前者会把**分区表主键改坏**（分区表主键必须含分区列，ERROR 1503），后者会**拆掉生成列的唯一约束**（撞单兜底失效）。
> **`migrate diff` 只作核对，永不作为执行依据**；要改库一律走「新增量 migration → 真库执行 → `information_schema` 逐条核对」。

**结论：drift 仅 4 类，全部「设计使然」，无一条需要改库或改 `schema.prisma`**：

| # | drift 项 | 为什么会有 |
| --- | --- | --- |
| 1 | **3 张分区表的主键含分区列**（schema 侧仍写 `(id)`） | 手工段按 **ERROR 1503** 改造；**分区本身 schema 表达不了** |
| 2 | **3 个生成列唯一索引** `uk_active_rel` / `uk_owner` / `uk_phone_active` | 生成列在 schema 里是 `@ignore`，索引由手工段 `DROP` 后重建 |
| 3 | **5 个 MySQL 自动索引**（`permission_matrix_role_code_fkey` / `business_relation_product_line_id_fkey` / `cadence_rule_scope_line_id_fkey` / `sea_rule_dept_id_fkey` / `sea_rule_product_line_id_fkey`） | MySQL **为外键自动建索引**（仅当该列无显式索引） |
| 4 | **`_prisma_migrations` 元数据表** | Prisma 自建自管（**不计入业务表**） |

**关键结论**：**无缺表 / 无缺列 / 无缺索引** —— `migration.sql` 与 `schema.prisma` 结构一致。

## 九、⚠ 已知未清（待指令）

`0001_init` 第 93 行 `permission_matrix.perm_key` 的列 `COMMENT` 里仍举着两个**已废止**的 key（`cross_dept_private` / `phone_unlock`）。**✅ 已清（2026-09-16）**：按「注释修正走新增量」新开 `0006_perm_key_comment` 只改 COMMENT（详见 §4.6），已 `deploy` 到真库并回读核对。**本节无未清项。**

## 十、⬆ 上服务器时必做（上线前清单）

> 本机开发环境的**已知降级项**在服务器上**必须补回** —— 本机「跑通了」不等于生产合规。

| # | 项 | 本机现状（开发用） | 服务器必做 |
| --- | --- | --- | --- |
| 1 | **MySQL 版本** | phpStudy **8.0.12** | 装 **8.0.16+**（`CHECK` 自 8.0.16 才生效） |
| 2 | **CHECK 约束复验** | 8.0.12 下 `CHECK` **静默忽略** → 靠应用层单测兜底 | 建库后**复验真生效**：插入「申请人 ＝ 审批人」→ 断言报错 |
| 3 | **docker-compose** | 本机无 Docker，**从未跑过** | 首次部署跑 `docker compose config` ＋ `up`，确认 `mysql:8`（**≥8.0.16**）/ `redis:7` 起得来 |
| 4 | **Redis 版本** | phpStudy **3.0.504**（**无密码**） | 换 **Redis 7**；代码里「禁用 6/7 专有命令」的临时红线（`UNLINK` / `EXPIRE … NX｜GT｜LT` / ACL）**可解禁**；**必须设密码** |
| 5 | **密钥 / 口令** | `.env` 里 DB / Redis **均无强口令**、`JWT_SECRET` 为本地随机值 | 换生产密钥与强口令；`.env` 不入库 |
| 6 | **migration 全量重放** | 已应用 `0001_init` ＋ `0002` ＋ `0003` ＋ `0004` ＋ `0005` ＋ `0006` ＋ `0007` ＋ `0008` ＋ `0009` | 空库上按序跑到最新 → 逐份 `migrate resolve --applied`（见 **§4.8**），再 `migrate status` 断言 **`up to date!`** |
| 7 | **`/docs` OpenAPI 暴露** | 开发环境**默认开放**（`/docs` ＋ `/docs-json`） | **生产已默认关闭** —— `main.ts` 的 `openApiEnabled()`：`NODE_ENV=production` 且未设 `OPENAPI_ENABLED=true` 时**跳过挂载**（`/docs` 是中间件直出、不经守卫，开了即等同公开全部接口定义）。确需保留必须**自加访问控制**。**部署后必查**：`curl -o /dev/null -w '%{http_code}' http://<host>/docs` 应为 **404** |
| 8 | **构建链路（尤其 `npm ci --omit=dev`）** | `package.json` 已含 `prisma:generate` / `build` / `postinstall`，本机 `npm run build` 已实测通过（⚠ **2026-09-20 起**：`dist` 已 >500 文件，本工作区的**环境删除守卫**会拦在"清 dist"这一步 ⇒ **类型校验改用 `npx tsc --noEmit`**，产新产物 →《欠账登记表》**D-58**） | `npm ci` 会自动跑 `postinstall → prisma generate`；⚠ 但 **`--omit=dev` 时 `prisma` CLI 不在 → `postinstall` 会失败**：改用**多阶段构建**（构建阶段装 devDeps 跑 `npm run build`，运行阶段只带 `dist/` ＋ prod deps ＋ 已生成的 client），或 `npm ci --ignore-scripts` 后自行 `npm run prisma:generate`。**首次部署必跑 `npm run build` 验证** |
| 9 | **分区预置月数 / 滚动** | 建库时预置到 `p202712`（真实上界 `202801`）＋ `pmax(MAXVALUE)` | **有 `pmax` 兜底 → 绝不会插失败**；但 **2028-01 起全部新行落入单一 `pmax`**，且老分区**无法 `DROP PARTITION` 清理** → 生产建库**预置月数 ≥ 3 年**，并把「分区滚动」纳入定时任务（→ 数据架构 §十二 末行） |

> ⚠ 第 **1、2 项是同一个坑的两面**：本机 `CHECK` 静默失效最容易被拖到上线才炸 —— 本机当前只靠应用层单测兜住「审批人 ≠ 申请人」。
