# CODEBUDDY.md This file provides guidance to CodeBuddy when working with code in this repository.

> 本项目是**文档驱动（spec-driven）**的销售 CRM 系统。当前处于「文档定稿 + 后端骨架起步」阶段：**真相源是文档，不是代码**。动手前先按本文与 `README.md` 的规则锁定口径。

> **★ 动工前必读（AI 行为约束）**：`技术决策/AI协作铁律与踩坑复盘.md` —— **AI 协作元规则的唯一落点**（AI 行为硬约束 / 踩坑复盘 / 通例）。**凡写文件 / 装依赖 / 跑命令 / 调用有副作用工具前，先读它**；今后 WorkBuddy 与 CodeBuddy 新增同类规则一律追加到该文档。

## 一、当前状态（务必先读）

- `服务端/` 下**只有 `prisma/schema.prisma`（46 张表）**，**尚无 `package.json` / `src/`**；前端代码尚未创建（将落在 `前端/`）。
- `归档/` 内是被取代的旧代码与旧文档，**移动未删除**；根目录 `.ignore` 已让 ripgrep 默认跳过 `归档/`（查历史需显式指定路径或 `--no-ignore`）。
- 因此下文命令分两类：**现已可跑**（Prisma 相关）与**骨架搭好后按文档执行**（NestJS / 前端脚本）。

## 二、常用命令

**Prisma 校验 / 格式化**（现已可跑，需要一个占位连接串即可，不用真库）
```bash
DATABASE_URL="mysql://user:pass@localhost:3306/crm" npx prisma validate --schema prisma/schema.prisma
DATABASE_URL="mysql://user:pass@localhost:3306/crm" npx prisma format   --schema prisma/schema.prisma
```
用途：改完 `schema.prisma` 后确认语法有效、格式统一。校验通过输出 `The schema is valid 🚀`。不连接数据库。

**离线生成 baseline migration**（现已可跑，不需要真库）
```bash
DATABASE_URL=占位 npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > migrations/0001_init/migration.sql
```
仅在表结构变更后重生成。产物需再手工补「生成列 / 分区表 / 视图 / CHECK」段落，**且必须在真实 MySQL 8 上首次执行并逐条核对**（重点：生成列表达式、分区键与主键扩列、ERROR 1503）。

**Lint（含模块边界硬卡）** — 骨架搭好后
```bash
npm run lint
```
在 `服务端/` 内执行。ESLint 的 `no-restricted-imports` 强制「模块边界」，**故意写一个跨域 import 必须报错**（架构说明 §5.4）。提交前必跑。

**测试** — 骨架搭好后
```bash
npm test                              # 全量
npm test -- <文件名或 -t 名称>        # 跑单个用例
```
每条业务铁律（公海掉落、撞单、状态机、脱敏口径等）都应写单测；`domain/` 层为纯函数，用假数据单测即可，无需真库。

**启动进程** — 骨架搭好后
```bash
npm run start:web       # Web 进程（HTTP，监听端口）
npm run start:worker    # Worker 进程（定时/异步，不监听端口）
npm run start:prod:web  # node dist/main.js
npm run start:prod:worker # node dist/worker.js
```
Web 可多开实例；**Worker 全局只能跑 1 个**，否则定时任务重复执行（架构说明 §六）。

**生成前端共享类型** — 前端接入时
```bash
npm run gen:types
```
从后端 OpenAPI（Swagger）用 `openapi-typescript` 生成 `frontend/src/api/types.ts`。**禁止手写对接、禁止前后端各维护一份接口类型**（双真相源是 AI 出错重灾区）。

## 三、代码架构（大图景）

### 1. 唯一真相源与文档层级（最高优先级）

所有实现以文档为准，冲突时以上游为准，下游只写指针不复制：

| 层 | 文档（位置） | 管什么 |
| --- | --- | --- |
| ① | 《销售CRM业务需求文档》V1.21（需求规格/） | 业务规则 / 流程 / 权限口径 |
| ② | 《销售CRM数据架构文档》V1.25（需求规格/） | 表 / 字段 / 索引 / 字典 / 数据权限 |
| ③ | 《销售CRM接口API文档》V1.10（需求规格/） | 接口入参/出参 / 错误码 |
| ④ | 《销售CRM前端页面与交互文档》V1.13（需求规格/） | 页面 / 交互 / 角色矩阵 |
| ④-a | 《销售CRM设计规范》V1.0（需求规格/） | 视觉 / 组件 / token / 主题 |
| ⑤ | 《销售CRM架构设计说明》V1.1（技术决策/） | 代码目录 / 模块边界 / 进程 / 扩展 |

**动手前必读《需求规格/废止口径登记表》** —— 被推翻的 25 条旧口径集中登记，正文若仍出现旧说法以它为准。**`归档/` 内容默认不得作为实现依据。**

**关键鉴别**：文档里标「**索引·非规范**」的章节（速查表、接口总目录、追溯索引、README 文档地图）**只作导航**，实现一律以**正文**为准；需求 **§十六《否决与后置清单》是★规范级**，收录全部「不做 / 已砍 / 后置 / 不是那样」，**"表里没有"才代表"允许"**。改文档时负面约束必须收全在 §十六。

**变更联动铁律（L0）**：业务需求一改 → 受影响的接口 / 前端 / 数据架构**同批升版**，且在**同一次 git 提交**里改完；下游不得自造业务规则。版本沿革**只存在于 git**（各文档内「修改记录」章节已整体移除）。

### 2. 架构形态：模块化单体（Modular Monolith）

- **一个代码库、两个进程**：Web（`src/main.ts`，处理接口）＋ Worker（`src/worker.ts`，跑定时/异步，不监听端口）。
- **一个库、一个缓存**：MySQL 8 单库（46 张表）＋ Redis。不分库分表、无消息队列、无微服务。
- **按业务域分目录**：7 域 = 7 模块，边界用 ESLint 硬卡（不靠自觉）。

```
服务端/
├── prisma/            # schema.prisma（46 表）+ migrations
├── src/
│   ├── main.ts        # Web 入口
│   ├── worker.ts      # Worker 入口
│   ├── app.module.ts  # Web 组装全部域
│   ├── worker.module.ts
│   ├── kernel/        # 内核：context / events / audit / errors / common（零业务）
│   ├── shared/        # 横切装配：guards / interceptors / filters / pipes（只读上下文，不查库）
│   ├── modules/       # 七域：org(A) company(B) relation(C) engine(D) trade(E) sea(F) approval(G)
│   ├── report/        # 报表与统计（独立圈出，预留只读副本入口）
│   └── jobs/          # 定时任务（只被 Worker 加载）
```

**域内部统一四层**（以 `modules/company/` 为例）：
- `*.controller.ts`：只解析请求、调**一个** service、返回。不写业务判断、不碰 Prisma。
- `*.service.ts`：编排多步、开事务（`$transaction`）、发领域事件。不写复杂规则、不写 SQL。
- `domain/`：**纯业务规则的保险箱** —— 不 import `@nestjs/*`、不 import Prisma、不查库，可用假数据直接单测。掉海判定、撞单、脱敏口径等放这里。
- `*.repository.ts`：**唯一允许 import Prisma 的地方**，只查/写库，不写业务判断。

### 3. 模块边界（谁能调谁）

严格单向分层，**只能依赖比自己低的层**：

```
第 0 层  kernel
第 1 层  org (A)      组织与权限
第 2 层  company (B)  客户资产
第 3 层  relation (C) 业务关系
第 4 层  engine (D) / trade (E) / sea (F) / approval (G)
```

- **同层之间禁止直接依赖**（D 不许 import E，E 不许 import F）。
- A 域不许依赖任何业务域；`domain/**` 不许 import 框架/Prisma。
- **跨域三条路**：① 马上要用结果 → 同步调对方 **exports 出来的 service**（禁止查对方的表）；② 不等结果 → 发**领域事件**；③ 改多个表必须一起成功 → **本域内** `$transaction`，**禁止跨域大事务**（为将来拆服务预留）。
- 已约定的跨域事件：`RelationCreated` / `RelationStageAdvanced` / `RelationReleased` / `RelationClaimed` / `ActionEventRecorded` / `ContractSigned` / `PaymentReceived` / `ApprovalApproved|Rejected` / `CollaborationGranted`（架构说明 §5.3）。

### 4. 横切层（最易出事，必须收口）

- **请求上下文**：鉴权守卫解析「我是谁、管哪些部门、什么角色、数据范围」，横切层**只读上下文、不查库**（避免 A 域与权限互相依赖）。
- **数据范围注入**：所有列表查询必须经过拦截器；**禁止在 repository 手写 `where owner_id = ...`**。销售＝本人 ∪ 有效协同人 ∪ 公海；经理＝管辖部门；总经理＝不过滤。
- **脱敏渲染**：出口统一处理。**报表 / 看板 / 汇总出口不脱敏**（经理/老板看真实金额）；脱敏只作用于「销售看他人私海 / 跨部门关系」。
- **审计留痕**：敏感动作在**业务事务内**写 `operation_log`，业务失败一起回滚。
- **异常映射**：Prisma 唯一冲突是 **`P2002`**（不是 MySQL `1062`）→ 409/422，从 `meta.target` 取约束名回人话提示。

### 5. 数据层口径（Prisma / MySQL）

- **命名**：表名/字段名统一 `snake_case`；索引前缀 `idx_` / `uk_`；审计字段全表统一 `created_by/at`、`updated_by/at`；逻辑删除 `deleted_at`（NULL=未删）。
- **枚举一律 `String`（VARCHAR(32) 英文码）**，展示文案走字典 `dict_item`，**不用 DB ENUM**。
- **主键** `BigInt @db.UnsignedBigInt`；金额 `Decimal(12,2)`。
- **Prisma 表达不了、必须手写 migration** 的 5 类：①生成列（`active_key`/`owner_flag`/`phone_active`，schema 用 `@ignore`，migration 里 `DROP` 后重建为 `GENERATED ... STORED` ＋唯一索引）；②5 张分区表（`action_event`/`daily_agenda`/`stat_daily`/`operation_log`/`job_run_log`）；③CHECK（如审批人≠申请人）；④视图 `v_contract_performance`（**业绩统计一律读此视图**）；⑤手机号/信用代码等 DB 级唯一约束。
- **复杂查询 / 报表 / 递归 CTE** 走 `$queryRaw` ＋ `Prisma.sql`，不为迁就 Client API 牺牲 SQL 表达力。
- `schema.prisma` 顶部注释与 `服务端/prisma/README.md` 是落库口径的完整说明，改表前先读。

### 6. 业务模型速记

两层结构：**公司档案（＝公司公海，全公司唯一共享）＋ 业务关系（部门 × 产品线 × 销售，CRM 最小单元，掉公海＝没 owner 但部门不变）**。「部门公海」不是独立一层，就是本部门的关系集合。工作流为 **6 阶段**；客户等级按**部门维度**挂业务关系。撞单/竞争、公海掉落、脱敏见需求 §5 / §8 与数据架构 §十一。

### 7. 开工顺序（竖切一条动线，非按域横向做完）

已定案：**竖切一条完整动线** —— 登录 → 建公司/联系人 → 建业务关系 → 写一条跟单 → 工作台看到它（穿透 A/B/C/D 四域）。8 步：**0** 打地基（kernel + Prisma + OpenAPI + ESLint 边界）→ **1** A 域登录 → **2** B 域建档/查重 → **3** C 域建关系/私海 → **4** D 域写跟单/时间线/工作台 → **5** 横切层（数据范围+脱敏+审计）→ **6** 接前端（`gen:types`）→ **7** Worker 骨架（掉海预警先只告警）→ **8** 验收。每步＝一次可提交的还原点（架构说明 §九）。

### 8. Git 约定

**本地单线，直接在 `main` 提交，不切 feat/dev 分支**。每完成一个独立阶段做一次提交；提交信息写清「改了什么 / 为什么 / 联动哪几份文档」。提交即还原点（回退 `git reset --hard <号>` 或 `git revert <号>`）。**改文档必须提交**，否则版本沿革断档。

## 四、导航速查

- 项目章程与全部对齐铁律：`README.md`（根，唯一不归子目录的文档）。
- **AI 协作铁律与踩坑复盘（★ 动工前必读）**：`技术决策/AI协作铁律与踩坑复盘.md`（AI 行为约束 / 踩坑复盘 / 元规则唯一落点）。
- 代码结构 / 模块边界 / 进程 / 扩展路线：`技术决策/销售CRM架构设计说明.md`。
- 数据落库口径（生成列/分区/视图/CHECK）：`服务端/prisma/README.md`。
- 已废止旧口径：`需求规格/废止口径登记表.md`。
- 过程产出（自查报告、拍板清单、构想图）：`过程产出/`。

## 五、技能路由（强制）

下列场景**必须先 `use_skill` 加载对应技能，再动手**（技能命中靠硬规则，不靠模型自觉）：

| 用户意图关键词 | 必须先加载的技能 |
| --- | --- |
| 开发计划 / 排期 / 迭代计划 / 里程碑 / 需求文档转开发方案 / 写 PRD / 任务拆解 / 代码评审 / 上线发版 | `生产级工程生命周期技能`（production-engineering-skills） |
| 测试用例 / 用例设计 / 测试计划 / 用例覆盖 | `测试用例设计`（lynxce-test-cases） |
| 初始化项目 / 新建工作台 / 项目目录 / 六件套 | `MASTER万能工作台`（project-init） |

**特别说明**：本项目的「生成开发计划」属于 `生产级工程生命周期技能` 的 Define→Plan 阶段，**不得**用 CodeBuddy 自带 Plan 能力直接出计划绕过该技能。
