# 销售 CRM 接口 API 文档

> **⚠ 开工前必读**：先读《**废止口径登记表**》（需求规格/）——已废止的旧说法不得作为实现依据。
> 文档性质：四件套之三（①业务需求 ②数据架构 ③**接口 API** ④前端页面与交互）。
> 配套真相源：《销售CRM业务需求文档》、《销售CRM数据架构文档》、《销售CRM设计规范》、《销售CRM前端页面与交互文档》（均 需求规格/）。
> **版本沿革**：文档内不留「修改记录」章节（2026-09-12 决定 →《废止口径登记表》#22），沿革查 `git log --follow -- 需求规格/销售CRM接口API文档.md`。
> 生效日期：2026-09-21 ｜ 状态：**V1.38**（本版：**M9-F 规则配置片** —— `GET/PUT /sea/rules` 形状回填 §5.16（层级语义 / 7 天缓冲 / 两段式确认 `confirmed` / 变更预告 `affected_customers` / 谁能配哪一层）；同批 A10 登记动作名 `sea.rule_update`。上版（**V1.37**）：D-67 落地 —— 联系人可见性补上「**经理可看管辖部门内员工录入的待关联线索**」（详见 §5.5，依据需求 §6.1 ⑨「经理分派」）；「可看的待关联归属人」＝ 我 ∪（经理）管辖部门内员工，集合由 A 域出口给（兼部门在 JSON 列）；**销售连同部门的线索也不给**。再上版（**V1.36**）：D-28 收口 —— 联系人列表 / 详情按「我可见的公司」收敛，两条读路由迁聚合层 `company-aggregate`，详情与列表同宽，不再有"全公司裸奔"）。
> ⚠ **代码注释不绑文档版本号（2026-09-16 定）**：代码里引用规格一律写「《文档名》§X」，**不写 `V1.xx`** —— 绑版本号必漂移（实测 `V1.16` / `V1.27` / `V1.3` / `V1.32` 全成旧值：这正是坑 #1 / #6 的复现路径）。本版同批把 `服务端/src` ＋ `前端/src` 里的历史版本指针**全部去除**（逐文件**字面**替换，禁批量正则 → 铁律坑 19）。

---

## 一、文档体系与铁律

### 1.1 与四件套的关系
- 本文件只定义「**怎么对话**」（REST 契约：路径 / 方法 / 入参 / 出参 / 错误码）。
- **业务规则**（谁、什么场景、什么校验）一律见 `→需求§X`；**表结构**（字段类型/索引/字典）一律见 `→架构表Y`。
- **同一事实只定义一次**（L1 单一事实源）：本文件不重复写业务规则原文，只写指针。

### 1.2 两条元铁律（→ `README.md §八` 权威定义）
- **L0 / L1 的权威定义见 `README.md §八`**。本文只需遵守：**需求一改 → 本文同批改、同批升版**；**同一事实只定义一次** —— **错误码 / 出参形态（含脱敏）**在本文定义后，前端文档只写「见《接口 API 文档》§二」，不复制；**枚举码值（物理编码）不在本文定义**，唯一落点＝《数据架构文档》§十三 `dict_item`（`→§2.6`；与 `README §八` 权威落点总表一致）。
- **★ 对齐铁律（2026-09-11 立）**：**需求文档 §14.1「V1 做」里定义的每一项功能，都必须在本文件 §三 有对应端点**；反过来，端点也必须有前端页面落点（见《前端页面与交互文档》§一.1.2）。新增功能不得只写进需求、不落接口。

---

## 二、通用约定（全接口必须遵守）

### 2.1 基础环境
- Base URL：`https://api.crm.internal/v1`（生产）／`/api/v1`（本地开发）。
- 协议 HTTPS；所有写操作要求幂等头（见 2.5）。
- 字符集 UTF-8；`Content-Type: application/json`。

### 2.2 认证与数据权限（[铁律]）
- 登录：`POST /account/login` → 返回 `access_token`（Bearer JWT，建议 2h）+ `refresh_token`。
- 所有请求头：`Authorization: Bearer <access_token>`。
- **数据权限在服务端按登录人收敛**，前端不自行计算：
  - 销售：本人 owner 私海（含 collaborator/ask_help 并集）∪ 公海。
  - **交付 / 客服**：仅「服务中」客户（＝**在合同服务期内**，2026-09-14 定）及其公司档案、合同 —— **只读**；不进公海、不触发掉公海。
  - 经理：管辖部门（`dept_manager` 表集合，`→架构A3`）全部。
  - 总经理：全公司。
  - **管理员**：**可查看业务数据（2026-09-11 定）—— 一律只读、每次查看写 `operation_log`、不解除金额脱敏**（`→需求§4.2`）。
  - 越权（他人私海）：列表不返回、搜索搜不到、路由进不去，**三层都挡**（`→需求§4.2` `→架构§十一`）。
- 管辖部门交集收敛：多部门筛选时取「登录人管辖部门 ∩ 请求部门」（G7）。

### 2.3 统一响应包
```jsonc
// 成功（分页）
{ "code": 0, "message": "ok", "request_id": "r-xxxx",
  "data": { "list": [ ... ], "total": 120, "page": 1, "page_size": 20 } }
// 成功（单对象）
{ "code": 0, "message": "ok", "request_id": "r-xxxx", "data": { ... } }
// 失败
{ "code": 20402, "message": "联系人谈判特质超过 3 个", "request_id": "r-xxxx", "data": null }
```
- `code = 0` 成功；非 0 = 业务错误（见 2.4）。
- **成功响应 HTTP 状态码一律 `200`**（含 `POST` —— 框架对 `POST` 的默认 `201` 是实现细节、不是契约；2026-09-15 定）。失败状态码见 §2.4。
- `request_id` 全局追踪，排错必带。
- 分页固定字段：`list / total / page / page_size`（G2）。

### 2.4 错误码表
| HTTP | code | 含义 | 触发场景 |
|---|---|---|---|
| 400 | 20001 | 参数错误 | 字段缺失/类型错/枚举非法 |
| 401 | 20002 | 未认证 / token 失效 | 缺/错 Authorization |
| 403 | 20003 | 无权限（数据权限越界） | 访问他人私海/非管辖部门 |
| 409 | 20004 / 204xx | 唯一冲突 / 竞态 | 撞单(`uk_active_rel`)、抢公海、重复激活 → Prisma 唯一冲突 **`P2002`**；**分档映射与约束名取值 → `服务端/prisma/README.md §七`** |
| 422 | 204xx | 业务校验不通过 | 完成预约未留跟单、判死未填死因、开发价值未标（非灰度）、特质超限等 |
| 429 | 20005 | 限流 | **高频请求**（**幂等键重复不算限流** —— 见 §2.5：重复同 key 返回首次结果 200，不重复执行） |
| 500 | 20099 | 服务异常 | 未预期错误 |

常用业务码（204xx）：`20401` 撞单已存在｜`20402` 超过上限（标签/特质）｜`20403` 必填未填（死因 / 开发价值 / 签约校验清单 / **动线 `ignored` 原因 / 承诺豁免原因**）｜`20404` 预约未完成禁止｜`20405` 解锁申请已存在｜`20406` 关系已激活｜**`20407` 跨部门 @求助**（@求助仅限同部门，跨部门须走正式协同审批 —— **2026-09-15 补**：原规则只写了要求、没给码；按本表「422 ＋ 204xx ＝ 业务校验不通过」归类）｜**`20408` 公海关系未领取禁止写入**（**2026-09-18 补**：无主关系**只可改「开发价值」`value_tier`**，写跟单 / 快速标记 / 建改承诺 / 换阶段 / 加删成员一律拒 —— 同「422 ＋ 204xx」归类，与 `20404` 同为"状态不允许"一族）。
> 唯一冲突一律映射 **409（撞单/竞态/抢公海）或 422（业务校验）**，**绝不把数据库原话透给销售**——DB 层 MySQL `1062` / **Prisma 层 `P2002`** 都只在服务端内部消化（实现落点 `→架构§7.5`、`服务端/prisma/README.md §七`；负面约束 `→需求§十六`）。

### 2.5 幂等（Idempotency-Key，[约定] G6）

> **★ 2026-09-20 拍板补齐口径并落地**（原文只有下面两句、其余全未定 ⇒ 不许由实现反推契约，→《欠账登记表》**D-06**）。
> 实现落点：切面 `服务端/src/shared/interceptors/idempotency.interceptor.ts` ＋ 存取件 `服务端/src/kernel/idempotency/`；数据落点：**`idempotency_key` 表**（→《数据架构》§10.1）。

- 所有**非幂等写操作**（创建关系/激活/领取公海/转交/协同/创建合同/回款/审批通过）请求头带 `Idempotency-Key: <uuid>`。
- 重复同 key → 返回首次结果（200），不重复执行；用于防网络重试导致的双写/双领。
- **头部格式**：`Idempotency-Key: <字符串，≤ 64 字符>`；超长 → **400 / `20001`**（**不静默截断** —— 截断会把两把不同的钥匙变成同一把）。
- **作用域 ＝ 登录人 × 端点 × key**（端点取**路由模板**，如 `POST /relations`，**不是**实际路径 `/relations/5`）：同一把钥匙换个人 / 换个端点**互不影响**。
- **有效期 24h**：首次结果保留 24 小时；过期后同一把钥匙**视为没写过**（可再次执行）。
- **不带头的写请求放行**（★ 过渡期口径）：前端写端点尚未全部接入，一律拒＝前端须同批全改才敢发版；**全部接入后本句作废**（收口时删掉本行）。
- **同 key 但入参不同 → 409 / `20004`**（静默返回旧结果会让人以为这次写成功了）；入参指纹 ＝ **`SHA-256(body)`**（只比 body，不比 header / query —— 重试时网络层可能换 header，而 body 才是业务意图）。
- **重放的响应形状与首次完全一致**（统一响应包 `{code,message,request_id,data}`；`request_id` 按 §2.3 为**本次**请求新生成，其余字段同首次）。
- ⚠ **幂等键重复不算限流**（→ §2.4 的 `429` 行）：重复同 key 只会是 **200（同入参）或 409（异入参）**。
- ⚠ **不防「并发同 key」的双执行**：本实现是「**业务成功后才落库**」（失败请求不占键）；两个**同时**首次到达的请求会各执行一次、第二个落库撞 `uk_idem_scope` 被忽略。**竞态类双写（抢公海）由条件 UPDATE 兜底**（→《数据架构》§10.2-3），不依赖本表。

### 2.6 命名与枚举（[约定] G1/G3）
- 入参出参 **snake_case**；时间字段 `_at` 后缀。
- **枚举一律英文码**（**唯一例外：阶段 `stage` 是数字 `1`~`7`**，见下 ⚠）。
- **码值表不在此处列举（L1 单一事实源 · 2026-09-16 收口）** —— 一律以《**销售CRM数据架构文档**》为唯一落点（`README §八` 唯一权威落点总表）：
  - **字典类**（`action_type` / `pain_point` / `urgency` / `value_tier` / `customer_level` / `party` / `commitment_ctype` / `workflow_stage` / `competition` / `review_type` / `review_*_reason`…）→ **《数据架构文档》§十三 内置字典种子 ＋ `dict_item`**（`→架构A11`）。**展示中文名一律取字典 `label`，接口只传码。**
  - **状态 / 字段类**（`sea_status` → C1 `business_relation`；`approval_type` → G1 `approval.type`「五型一单」`→需求§7.9`）→ **《数据架构文档》§三~§九 字段口径**。
  - ⚠ **`stage` 例外**：数字 `1`~`7`（1 初步建联 → … → 6 已合作（成交 · 终态）→ 7 已流失（终态））—— **与「枚举英文码」的直觉相反，不许自造英文码**；7 值业务含义 `→需求§8.1`，中文名取 `workflow_stage` 字典 `label`。原举例的英文码已作废（《废止口径登记表》**#37**）。
- **新增枚举 / 改码值**：先落《数据架构文档》字典种子（码值变更走 L0 联动），**本文件不重复维护码表** —— 两套码并存即「双真相源」翻车点（《废止口径登记表》#36 / #37、坑 #24）。

### 2.7 分页 / 排序 / 过滤
- 查询统一 `page`（默认1）/`page_size`（默认20，最大100）/`order_by`（字段）/ `desc`（bool）。
- 时间范围 `start_at` / `end_at`（ISO8601，Asia/Shanghai）。
- 模糊搜 `keyword`（公司名走 ngram 全文索引，`→架构§十`）。

> **★ 2026-09-20 铺开进度与口径补记**（→《欠账登记表》**D-07 / D-08**）：
> - **分页**：C 域（`GET /relations`）＋ B 域三个列表（`GET /companies` / `GET /contacts` / `GET /companies/:id/contacts`）**已铺开**；其余列表仍待铺（→ D-08）。
> - **`order_by` 一律白名单**（不白名单＝任意列排序 —— 用排序结果**能探出未授权列的存在与取值**）：**当前仅 C 域**支持，白名单 ＝ **`id`（默认）/ `created_at` 建档时间 / `last_event_at` 最近跟进 / `stage` 阶段**；**白名单之外的取值 → 400**（**不静默回落** —— 回落会让人以为排序生效了）。`desc` 缺省 **`true`**（与既有 `id desc` 的观感一致，**不改变默认行为**）；对外参数名 `stage` 对应落库列 `stage_id`。
> - **`keyword` 当前仅 C 域**支持，语义 ＝ **按公司名模糊搜**（`company.full_name`）；`total` 数的是**筛完之后**的总数（与筛选同理）。
> - ⚠ **`keyword` 的索引前提未落地**：本节原文说「走 ngram 全文索引」，而 **`company` 表并没有该索引**（《数据架构》§10.1 只有 `idx_full_name` / `idx_name_core`）⇒ 现实现走 `LIKE '%…%'`、**用不上索引**（当前数据量下无碍；要建索引须**新增量 migration**，→《欠账登记表》）。
> - ⏳ **`start_at` / `end_at` 仍未接**：它该过滤「**哪一列时间**」规格没写（建档 `created_at`？最近跟进 `last_event_at`？）—— **不许由实现反推契约** ⇒ **待拍板**（→《欠账登记表》D-07）。

### 2.8 联系方式 / 脱敏规则（[铁律] G4/G5）

> **★ 2026-09-14 重写**：联系方式**不再按角色 / 场景分档脱敏** —— 改为「**详情默认全可见 ＋ 联系人可上锁**」（`→需求§4.3`）。

- **联系方式（手机号）**：**凡是「详情」出参都给全号**（`phone`），**与角色无关**；**只有「列表 / 卡片」出参给 `phone_masked`**（`xxx****xxxx`）—— **这是出参形态、不是权限**，目的是防"一眼扫走一列号"的批量截图。
- **联系人「锁」**：被 owner **上锁**的联系人，**非 owner 看详情时**给 `phone_locked:true` ＋ `phone_locked_by:{id,name}`、**不给 `phone`**；**锁跟人 —— 主号与 `extra_phones` 备用号一并锁**（2026-09-14 定），不允许"主号锁了、备用号仍可见"；申请走 `POST /phone-unlock/apply` → **审批人 ＝ 落锁人**（⚠ 例外于 §7.9，**并知会其直属上级**）→ 批后 **24h** 内出参带 `phone` ＋ `unlocked_until`（`→需求§4.3 二`）。
- **金额跨业务线**：非归属 / 跨管辖响应返回 `amount: null` + `amount_masked: "***"`，仅露非金额信息（已合作 + 签约日期）。库内永远明文（`→需求§4.3 四` `→架构§十一`）。
- **跨部门跟单全文**：销售 / 客服 / 交付 / 经理跨管辖 → **不返跟单全文**，仅"近 30 天 N 次"概览（`→需求§4.3 三`）。
- **报表 / 看板不脱敏**：经理 / 老板出口（`/reports/*`、`/targets/progress`）**返回真实金额**——金额脱敏只作用于"销售看他人私海 / 跨部门关系"的列表与详情（`→需求§4.3`）。

### 2.9 时间与时区
- 服务端统一 `Asia/Shanghai`；出入参 ISO8601（`2026-09-05T09:30:00+08:00`）。

### 2.10 文件上传（file_asset，[新增] `→架构B8`）
- 先 `POST /files/asset` 上传拿 `file_key`（存 key 不存 URL），再在业务接口传 `file_key`（如合同凭证 `payment_record.voucher_file_id`）。

### 2.11 版本与变更
- URL 含 `/v1`；破坏性变更升 `v2`。每次变更**走 git 提交留痕**（提交信息写清改了什么、为什么；**文档内不留「修改记录」章节**）+ 同步业务需求文档。

---

## 三、接口总览（★ 索引·非规范：契约以 §四 / §五 为准）

> **⚠ 本节是"目录"，不是"契约"，已压缩为「域 / 分组 → 端点清单」。** 只回答"有哪些端点"；**请求响应字段、错误码、校验、角色一律以 §四 分模块契约 与 §五 数据结构为准**；冲突时以 §四 / §五 为准。

> 记法：**方法 路径**（G 查 / P 建 / U 改 / D 删，逻辑删为主、停用不删）；**★** ＝ V1.1 对齐校正补全（原目录遗漏、需求已定义）。

| 域 | 分组 | 端点（方法 + 路径） |
|---|---|---|
| 认证 | account | `P /account/login`、`P /account/refresh`、`G /account/me`、`U /account/preferences` ★ |
| 组织 | org | `G/P/U/D /org/departments` ★、`G/P/D /org/departments/:id/managers` ★、`G/P/U /org/employees` ★、`G/U /org/employees/:id/roles` ★、`P /org/employees/:id/offboard` ★、`G /org/roles`、`G /org/permissions`、`G/P/U /org/product-lines` ★、`G/U /org/dept-rule` |
| 组织 | dict | `G/P/U /dict/types`、`G/P/U /dict/items` ★ |
| 公司 | company | `G/P /companies`、`G/U /companies/:id`、`G/P/D /companies/:id/profile-tags`、`P /companies/search-dup`、`P /companies/:id/merge` ★、`G /companies/:id/contacts` ★ |
| 联系人 | contact | `G/P/U /contacts`、`P/D /contacts/:id/phone-lock` ★、`D /contacts/:id` ★、`U /contacts/:id/traits`、`P /contacts/:id/merge` ★、`G /contacts/:id/employments` ★、`P /contacts/phone-change/apply` ★ |
| 关系 | relation | `G/P /relations`、`G/U /relations/:id`、`P /relations/:id/stage` ★、`G/P/U/D /relations/:id/members`、`G /relations/:id/stage-log`、`G/P/D /relations/:id/labels`、`P /relations/:id/transfer`、`P /relations/batch-transfer` ★、`U /relations/:id/competition` |
| 公海 | sea | `G /sea/company`、`G /sea/department`、`P /sea/company/:id/claim`、`G /sea/records`、`G /sea/manager-todo`、`P /sea/manager-decision`、`G/U /sea/rules` ★ |
| 行动 | commitment / event / cadence / agenda | `G/P/U /relations/:id/commitments`、`G/P /relations/:id/events`、`P /events/quick-mark`、`G/U /cadence-rules`、`G /today-agenda`、`P /today-agenda/:id/action` ★ |
| 预约 / 外出 | appointment / visit | `G/P/U /appointments`、`P /appointments/:id/complete`、`G/P /visits`、`P /visits/:id/return` ★ |
| 合同 | contract | `G/P/U /contracts`、`G/P /contracts/:id/payments`、`G/P/U /contracts/:id/splits`、`G /contracts/suspected-duplicates` ★ |
| 工单 / 台账 | workorder / ledger / field | `G/P/U /workorders`、`P /workorders/:id/convert` ★、`G /ledgers`、`G/U /ledgers/:id`、`G/P/U /product-lines/:id/field-templates` |
| 审批 | approval | `G /approvals/todo`、`G /approvals/mine`、`P /approvals/:id/approve`、`P /approvals/:id/reject`、`P /phone-unlock/apply` |
| 报表 | report | `G /reports/dashboard`、`G /reports/sales`、`G /reports/dept`、`G /reports/company` ★、`G /reports/sea` ★、`G /reports/renewal` ★、`G /reports/workorder-sla` ★、`G /reports/death-reason` ★、`G /reports/churn-reason` ★ |
| 目标 / 通知 | target / notice | `G/P/U /targets`、`G /targets/progress` ★、`G/U /notifications` |
| 复盘 / 竞品 | review / competitor | `P /relations/:id/review`、`G /reviews/win-library` ★、`G /reviews/defense` ★、`G/P/U /competitors` ★ |
| 文件 / 系统 | file / system | `P /files/asset` ★、`G /files/:id` ★、`G/U /system/config` ★、`G /operation-logs` ★ |

> 端点总数 **~78**。**每条端点的入参 / 出参 / 错误码 / 校验 / 角色，一律以 §四、§五 为准**（本节不含这些信息）。

---

## 四、分模块关键契约

> 每模块只列「最易错 / 已拍板」的硬约束；完整字段以 `→架构表Y` 为准。

### 4.1 认证 account
- `POST /account/login` 的入参、以及 `UserVO` 的完整结构：**唯一权威落点见 §5.2**（本节只留指针，不复制字段，防双真相源）。
- `GET /account/me`：返回 `UserVO`（结构同 §5.2）＋ 角色 + 管辖部门集合（前端据此渲染菜单/数据范围）；`managed_dept_ids` 空 = 非经理。

### 4.2 组织与权限 org / dict
- `GET /org/employees`：**服务端按 `managed_dept_ids` 收敛**（G7）；销售只能看同部门。
- `GET /org/product-lines`：返回 `color_key`（7 线固定配色，前端照渲染，`→需求§13.3`）。
- `GET /org/dept-rule`：返回 `drop_days` / `gray_remind_days` / `level_tiers` / `contact_trait_max`（默认3）/ `ask_help_days`（默认7）。

### 4.3 公司档案 company / 联系人 contact
- `POST /companies/search-dup`：入 `{phone?, credit_code?, name?}` → 返回相似候选（手机 UNIQUE 为主入口；公司名归一化去噪声词后比字号，`→需求§6.3`）。命中分支（**4 分支**，逐条文案 / 按钮 / 落点见 `→需求§12.1`）：① **公海可直领**；② **本部门已激活**（联系本人 / 申请转交 / 申请协同）；③ **跨部门可并行激活**（只显部门名 ＋ 日期，不露跟单）；④ **挂现有公司**（使用已有 / 确认新建，**疑似重复必须给强行新建出口**，防乱填公司名）。
- `GET /companies/:id`：出参含 `profile_tags`（身份/制度/决策链，`→架构B2`）、`contacts[]`（**默认全号**；被 owner 上锁时给 `phone_locked`）、`relations_summary`（各业务线签约日期，跨线金额 `amount_masked`）、**`registered_capital`（注册资本，单位＝元）/ `legal_person`（法定代表人）——可选扩展字段，不做签约强制**（`→需求§7.3`）。
- `GET /companies`：列表支持**注册资本区间筛选** `min_registered_capital` / `max_registered_capital`（**单位＝元**；如"注册资金 > 100 万"→ `min_registered_capital=1000000`）。
- `PUT /contacts/:id/traits`：超过 `contact_trait_max` → **422 / 20402**；未配部门走默认3（`→需求§9` `→架构B4`）。

### 4.4 业务关系 relation（[核心]）
- `POST /relations`（激活）：`{company_id, dept_id, product_line_id}` → 唯一约束 **`uk_active_rel(active_key)`**（生成列 ＝ 三元组 ＋ **`deleted_at IS NULL` ＋ `merged_into IS NULL`** —— **★ 2026-09-21 起：公海也占位**，同三元组**至多一条关系**，`→数据架构§10.2-5` / `→需求§6.3`）撞则 **409 / 20401**，**人话分两档**：同三元组已有**私海** → 「已有归属，请走转交或协同」；已有**公海**行 → 「该客户在本部门·产品线已在公海，请**直接领取**」。
- `POST /contacts/:id/activate-relation`（**V1.23 新增**，2026-09-16 拍板）：「**关联公司并激活业务关系**」—— 把一条「待关联」联系人登记到公司 ＋ 激活一条业务关系 ＋ 把该联系人名下**未挂关系**的跟单批量挂到新关系（三件事一个动作，形状与错误约定见 **§5.6**）。
- `GET /relations`：**列表类一律分页**（→ §2.3 / §2.7）—— 入参 `tab` ＋ `page`（默认 1）/ `page_size`（默认 20、最大 100），出参＝ **`{list,total,page,page_size}`**（**不是裸数组**）。**排序 / 搜索（V1.33 · D-07）**：`order_by`（**白名单**：`id` 默认 / `created_at` / `last_event_at` / `stage`；**白名单外 → 400**）＋ `desc`（缺省 `true`）＋ `keyword`（**按公司名**模糊搜；索引前提见 §2.7 补记）。**筛选（V1.21）**：`view`（视图：`all` 我的全部 / `following` 跟进中＝阶段 1~5 / `cooperated` 已合作＝阶段 6 / `churned` 已流失＝阶段 7）＋ `urgency`（紧迫档**多选**、逗号分隔）——**由后端过滤**（前端本地过滤在分页后只能筛当前页），`total` 数的是**筛完之后**的总数。`list` 项含 `stage`（彩色点）、`urgency`、`value_tier`、逾期标红、`drop_in_x_days`（24h 掉公海⚠）、竞争徽标、跨线 `amount_masked`。
- `GET /relations/:id/events`：默认 `range=1m`（近1月）；出参按 `created_by == 当前人` 分 `main` / `branch`（树杈），带 `createdByName` + `contactName`（`→需求§7.5` `→设计规范§八`）。
- `POST /relations/:id/transfer`：跨部门转交 = **双方上级双签**；上级缺失上溯经理/总经理（`→需求§7.9` `→架构G1`）。

### 4.5 公海 sea
- `POST /sea/company/:id/claim`：**幂等（2.5）**；领取即继承原 owner 全文跟单（`→需求§6.3`）。**`:id` ＝ 公司 id**；**定位**＝按 body `{dept_id, product_line_id}` 找「公司 × 部门 × 产品线」下的**那一条公海关系**（与 `POST /relations` 逐字同形）—— 跨部门领公海**不存在**（别部门想要这个客户＝自己激活一条本部门关系）。**谁能领**＝**可写角色 ＋ 读范围**（销售＝本部门公海、经理＝管辖部门、总经理＝全部；**管理员（只读）｜交付 · 客服 一律 403**），与公海读门**同一档**、不另开一格权限。**抢到才算**：条件 UPDATE 影响 1 行，并发被同事先领走 → **409**（`→数据架构§10.2-3`）。**req / resp / 错误码逐条见 §5.16**。
- `GET /sea/company/:id`：未领时**返概览 ＋ 全号 `phone`**（近30天 N 次 + 最后跟进 + 卡哪步；**列表/卡片仍返 `phone_masked`**，只有详情给全号），**但不返跟单全文**（防跨部门策略泄露，`→需求§4.1`）；**每次调用写 `operation_log`（`action=sea.phone.view`，含 ip/user_agent），不设次数上限**（`→需求§4.3`）。
- `POST /sea/manager-decision`：超期由部门经理决策保留/删除（删除=逻辑删 `deleted_at` 留痕，不自动流转）。

### 4.6 行动引擎 commitment / event
- `POST /relations/:id/events`：完成预约触发的事件由服务端生成（前端完成预约即调 `appointment/:id/complete`）；`event_type` 含 `meal/gift/greeting`（客情，`→架构D2`）。
- `POST /events/quick-mark`：三型（未联系/未接/说两句），**落库、可批量、但不算有效跟进、不更新 `last_event_at`**（防点一下保号刷倒计时，`→需求§十六`第二批）。
- `POST /relations/:id/commitments`：`type` ∈ `me/them/verdict`；`them` 催客户、`verdict` 给结论。**承诺收尾三态**：`done` 兑现 / `cancelled` 取消（**录错了 / 不成立，不需原因**）/ `waived` 豁免（**确有其事但做不成，必填原因**）（`→需求§10.1`）。
- `PUT /relations/:id/commitments`：入 `{id,status?,waive_reason?,due_at?,remind_at?}`（`status` ∈ 收尾三态；**`waived` 必填 `waive_reason`**，否则 **422 / 20403**；已结束的承诺（兑现 / 取消 / 豁免）再改同样 **422 / 20403**）（`→需求§10.1`）。

### 4.7 预约 / 外出 appointment / visit
- `POST /appointments/:id/complete`：服务端**强制**生成一条跟单事件，否则 **422**（`→需求§15.#3`）。
- `POST /visits`：纯行政考勤，**不产生业务事件**（与报销解耦，`→需求§14.2` `→架构C6`）。

### 4.8 合同 / 回款 contract / payment / split
- `POST /contracts/:id/payments`：回款流水；`voucher_file_id` 指向 `file_asset`（补上悬空外键，`→架构B8`）。
- `POST /contracts/:id/splits`：默认 signer 100%；填「给谁多少」合计须 100%；**不配费率/不分类型/不走审批**（`→需求§7.6` `→架构E7`）。
- 签约校验：点「签合同」时按**本条业务线必填清单**卡（完善度百分比只展示不卡，`→需求§7.3` `→需求§十六`）；创建前服务端按 `sign_checklist` 预校验＋硬卡（见 §5.15 / §5.9 校验结构），缺失返回 422 + 缺失清单。
- `GET /contracts/suspected-duplicates`：**经理侧**「疑似重复合同」清单。入参可选 `{window_days?}`（默认 7）；按 **同 `company_id` ＋ 同 `signer_id` ＋ 同 `amount` ＋ `sign_date` 相近（≤ `window_days`）** 分组，返回可疑对 `[{contracts:[{id,contract_no,amount,sign_date,signer_id}], company_id}]`。**只读、只"找"**——**无自动合并/拦截端点**；经理在前端点选"合并/保留"走既有合同编辑/作废流程，判定留痕（`→需求§7.6` `→需求§十六` N7）。**同号重复**仍由 `uk_contract_no` 在 `POST /contracts` 时以 `P2002` → 409 拦死。

### 4.9 工单 workorder
- `type` ∈ `after_sale` / `opportunity`（双分类）；商机↔工单双向流转（`→需求§6.4` `→架构E3`）。

### 4.10 客户台账 ledger / field
- `GET /ledgers`：列 = 通用 8 列 + 各产品线扩展列（由 `field_template` 驱动动态渲染）；到期 30 天黄警；停用字段置灰（`→需求§7.7` `→架构E5/E6`）。
- `POST /product-lines/:id/field-templates`：**先登记 key/类型（🔒不可改）后写入**，禁止无登记 Key（`→需求§7.7` `→架构E6`）。

### 4.11 审批中心 approval（五型一单）
- 审批人默认 = 直属上级；跨部门转交 = 双方上级双签；缺失上溯（`→需求§7.9`）。
- **离职批量转交（`relation_reassign`）**：由该员工的**直属经理发起**（该员工无直属经理时由管理员兜底发起，2026-09-14 定）→ 批量勾选其名下客户 / 业务关系、分派给不同在职业务员（可回公海）→ 发起人即直属上级时**上溯**审批 → **一次审批、批量生效**、幂等（`→需求§5.2` / §7.9）。
- ⚠ **联系方式解锁是例外**：`POST /phone-unlock/apply` 的审批人 ＝ **落锁人本人**（并知会其直属上级）—— 锁是**个人自我保护**、不是组织流程（`→需求§4.3 二` / §7.9）。
- `POST /phone-unlock/apply`：L05，批后 **24h** 内可见全号（`→需求§4.3 二`）。
- 驳回必填 `reject_reason`（前端弹窗强制）。

### 4.12 报表 / 目标 report / target
- 经理报表**只被动聚合**事件流/回款/工单，**绝不要求销售确认处境**（`→需求§2` `→架构D7`）。
- `GET /targets`：完成进度按**回款额**算，并列显示签约额（`→需求§7.11`）。
- 离职后业绩：历史照常显示；「人均」只按当月在职人数算分母（`→需求§十六`第三批）。

### 4.13 通知 / 复盘 notice / review
- `GET /notifications`：Tab 全部/待办/审批/系统；已读未读；「去处理」跳对应页。
- `POST /relations/:id/review`：win 经理主导（草稿→批注→published 进弹药库）；loss **死因点选必填 422**（T2 唯一例外，文字次日缓写）；churn **经理必须亲自回访**（`→需求§11.2`）。

---

### 4.14 端点契约补遗（对齐校正新增，★）

> 以下为 2026-09-11 三方对账后补齐的端点。**落点写法同 §二 通用约定**：`→需求§X` ＝ 业务规则、`→架构表Y` ＝ 表结构（X / Y 为占位符，本节每条已在行末标出具体的 § 与表号）。

**4.14.1 组织与权限（原只有 G，补 CRUD，`→需求§7.1`）**
- `POST/PUT/DELETE /org/departments`：部门增/改/**停用不删**（名称、上级、关联产品线、启用客服开关、状态）。
- `GET/POST/DELETE /org/departments/:id/managers`：部门经理**多对多**（`dept_manager`，决定经理查数范围 `→架构A3`）。
- `POST/PUT /org/employees`：员工入职 / 改主部门·兼部门·关联产品线·**直属经理（审批链）**·**登录账号名 `username`（可空、全局唯一，`→§5.3`）**；`status` ∈ `active`/`resigned`/`disabled`。**离职用 `resigned`，物理不删**（历史业绩照常显示）。
- `PUT /org/employees/:id/roles`：角色多选分配（`employee_role` `→架构A5`）。
- `POST /org/employees/:id/offboard`：**离职批量转交**——**由该员工的直属经理发起**（无直属经理时由管理员兜底，2026-09-14 定），**批量勾选**该员工名下客户 / 业务关系并**分派给不同在职业务员**（可分多人、也可回公海），走 `relation_reassign` 审批（发起人即直属上级时**上溯**审批，`→需求§7.9`）；幂等。
- `POST/PUT /org/product-lines`：产品线（含 `color_key` 7 线固定配色、承接部门、服务周期）。
- `POST /dict/items`：新增字典项（**builtin=1 不可删、只可停用** `→架构A11`）。

**4.14.2 公司 / 联系人合并与跳槽（`→需求§7.2` §7.3）**
- `POST /companies/:id/merge`：撞码**墓碑合并**——单事务 6 步：① loser 打 `merged_into` ② winner `aliases` 收进 loser 全称 ③ loser `credit_code` 置 NULL **释放唯一位** ④ 档案标签并集（决策链冲突弹人工选，打标人留痕全保留）⑤ 任职记录 + 业务关系归 winner（**同部门同产品线撞 `uk_active_rel` → loser 关系置非活跃分支，不占活跃位**；否则 `company_id` 直接改指）⑥ 写 1 条 `operation_log`。**子表（跟单/承诺/预约/阶段/合同回款）零改动**。
- `POST /contacts/:id/merge`：**墓碑合并**（**经理权限**）——loser 打 `merged_into`=winner、**物理不删**、traits **并集**、子记录零改动（`→需求§7.2`）。
- `GET /contacts/:id/employments`：就职/**跳槽历史**（`company_contact` N:M 含历史）；换公司时新公司存在则加入、不存在则新建档案，**原就职记录保留**并在原公司标"对接人已离职"。
- `DELETE /contacts/:id`：**仅经理可删，销售不可**（`→需求§7.2`）。
- `POST /contacts/phone-change/apply`：**手机号变更申请** → `approval_type=phone_change` → **通过后冻结 24h 生效**；留痕写 `contact_change_log`（`→架构B6` `→需求§7.9`）。
- **旧号回收提示**：注册/改号时若该号**曾属于其他联系人**（历史号）→ 出参带 `phone_history_hint: "曾属于 XX"`，**只提示、不拦截**（运营商回收号属正常，`→需求§7.2`）。

**4.14.3 阶段推进（`→需求§8.1`）**
- `POST /relations/:id/stage`：入 `{to_stage, confirm?}`。**动作驱动 + 建议态**：服务端按事件给 `suggested_stage`，**绝不自动改**，须销售确认。**限频**：距上次变更 <3 天且非跨里程碑 → 不重复建议（`429 / 20005`，码值口径见 §2.4）。允许跳级与回退，**每次写 `relation_stage_log`**（谁/何时/从哪到哪）。`stage=6`（已合作）、`stage=7`（已流失）为终态（**阶段一律数字 `1`~`7`**，→ §2.6 /《废止口径登记表》#37）。**推进零证据、经理不审核**（`→需求§8.1`）；**回退（rollback）触发经理 `notification`（`biz_type=stage_revert`，→架构 A9）——经理只知会、不审核、不拦截**，流程照走。

**4.14.4 今日动线处理反馈（`→需求§10.4`）**
- `POST /today-agenda/:id/action`：入 `{action, reason?}` ∈ `done` / `snoozed` / `ignored`。
  - `done` → 引导写事件并**自动销承诺**；
  - `snoozed` → 推明天，**同一条最多 3 次**，第 4 次起**不再返回该选项**（强制 done/ignored，杜绝无限推迟）；
  - `ignored` → **必填原因**（`422 / 20403`），留痕且**经理可见**（看板可看某人 ignored 占比）。
  - 同一客户同一原因被忽略后 **7 天内不再重复推**。

**4.14.5 外出登记（`→需求§7.5`）**
- `POST /visits`：外出时登记 `{depart_at, reason, relation_id?}`（**就三样**，无预计返回时间/交通方式/目的地/备注）。
- `POST /visits/:id/return`：**回来点一下**，只写 `actual_return_at`。**纯行政，不产生业务事件、不关联报销**。

**4.14.6 工单流转与审批人（`→需求§6.4` §7.9）**
- `POST /workorders/:id/convert`：商机↔工单**双向流转**（`after_sale` ⇄ `opportunity`），双向留痕。
- 审批人：一般＝申请人**直属上级**；跨部门转交＝**双方上级双签**；上级缺失或本人即上级 → 上溯部门经理/总经理；离职批量转交（`relation_reassign`）＝**由该员工直属经理发起**、发起人即直属上级时**上溯**审批（无直属经理时由管理员兜底发起，2026-09-14 定）。

**4.14.7 报表补齐（`→需求§7.10`，共 9 张）**

| 端点 | 报表 | 受众 |
|---|---|---|
| `/reports/sales` | 我的日报 | 销售本人 |
| `/reports/dept` | 部门月报 | 部门经理 |
| `/reports/company` | 全公司月报 | 总经理 |
| `/reports/sea` | 公海报表（停留/领取率/流失原因）| 经理+ |
| `/reports/renewal` | 续约预警 30/60/90 | 销售+客服 |
| `/reports/workorder-sla` | 工单 SLA（时长/超时率）| 交付+管理员 |
| `/targets/progress` | 目标进度（vs 时间进度）| 老板+经理 |
| `/reports/death-reason` | 死因看板 | 经理+ |
| `/reports/churn-reason` | 流失原因分布 | 经理+ |

- **铁律**：所有指标**只被动聚合**销售干活留下的痕迹，**禁止新增"为报表而填"的字段**。
- 视图：汇总统计（图表+数字）｜明细下钻到业务关系｜同环比（日报含昨日、月报含上月）。
- 凡涉客户等级统计，出参必须带 `stat_unit`（`relation` 条 / `company` 家）口径标注（`→需求§8.3`）。

**4.14.8 复盘消费视图 + 竞品名册（`→需求§11`）**
- `GET /reviews/win-library`：**赢单弹药库**——默认**本部门可见**，总经理可设全公司可见；未收录（待处理/已丢弃）仅本人+直属经理可见（让销售敢写真话）。
- `GET /reviews/defense`：**防守清单**——哪个竞品在反挖我们的客户。
- `GET/POST/PUT /competitors`：**竞品名册**（名称+产品线+一句话定位）——**经理维护，销售只读引用**；**不做价格表/功能对照表**（`→需求§11.1`）。

**4.14.9 文件 / 系统 / 个人偏好**
- `POST /files/asset`：上传 → 返回 `file_key`（**存 key 不存 URL**）；业务接口只传 `file_key`（如 `payment_record.voucher_file_id` `→架构B8`）。
- `GET /files/:id`：预览/下载，**服务端按归属鉴权**，防越权直链。
- `GET/PUT /system/config`：系统级配置（gm 可改，改前改后写 `operation_log` `→架构A12`）。
- `GET /operation-logs`：操作留痕审计查询（经理+/管理员，按人/对象/时间筛 `→架构A10`）。
- `PUT /account/preferences`：个人主题（**`light` 白天 / `dark` 夜间**，V1 两态；A/B/C 风格后置）与**侧栏展开状态**，**存账号**（已落 2026-09-18 · D-37：落库＝数据架构 **A2** `employee.theme` / `nav_open`，migration `0009`；入参 / 出参 / 错误码完整口径 → **§5.2**）。⚠ 「**通知偏好**」规格只给了 `notif?:{...}`，**括号里是什么从未定义** ⇒ 本版**未实现该键**（不许由实现反过来定义契约，→《欠账登记表》**D-42**）。

**4.14.10 公海规则配置（`→架构F1` `→需求§6.3`）**
- `GET/PUT /sea/rules`：公海规则 L1-L4 配置（`sea_rule` 表）。**改掉海天数走 7 天缓冲**——新值 **7 天后生效**、在途倒计时**从生效日重新起算**、提交时**预告受影响客户数**；落库＝插新版本行 ＋ 旧行 `status=disabled`（**停用不删**，`→需求§6.3` 第二批）。

---

## 五、数据结构（请求 / 响应）★（2026-09-11 新增）

> **本章定义各接口的请求体（DTO）与响应体（VO）**。**接口结构 ≠ 表结构**——出参须**脱敏**、含**派生字段**、剔除**内部字段**（如 `password_hash`、审计列）。
> 记号：`?`=可选，`[]`=数组，`|`=枚举取值；时间 ISO8601（`2026-09-05T09:30:00+08:00`）；金额为 number（前端做 `¥` 千分位）；金额/手机脱敏见 2.8。
> **枚举出参一律「英文码」**，展示文案由前端读 `GET /dict/items` 本地映射（**不逐条下发 label**）；**实体引用**返 `xxx_id` ＋ 展示名（`xxx_name` 或 `{id,name}` 对象）。

### 5.1 公共对象

**Envelope（所有响应外层）**
```jsonc
{ "code": 0, "message": "ok", "request_id": "r-x", "data": {} }
```
**PageResult（列表类 `data`）**
```jsonc
{ "list": [], "total": 120, "page": 1, "page_size": 20 }
```
**列表通用入参（query）**：`page=1`、`page_size=20`、`order_by`、`desc=false`、`keyword?`、`start_at?`、`end_at?`
**实体通用出参**：`id`、`created_at`、`updated_at`、`created_by_id?`、`created_by_name?`
**实体引用（内嵌）**：`dept:{id,name}`、`product_line:{id,name,color_key}`、`owner:{id,name,avatar}`、`contact:{id,name}`、`company:{id,name}`
**脱敏出参形态（[铁律]）**
```jsonc
// 跨业务线金额：amount 置 null + 掩码，仅露非金额信息
{ "amount": null, "amount_masked": "***", "cooperated": true, "sign_date": "2026-08-01" }
// 列表 / 卡片（任何场景）：号码一律给掩码、不给 phone（防批量截图；是出参形态，不是权限）
{ "phone_masked": "138****5678" }
// 详情（默认，与角色无关）：给全号
{ "phone": "13800001111" }
// 详情（该联系人被 owner 上锁、且查看者不是 owner）：不给 phone，给锁信息 +「申请解锁」入口
{ "phone_locked": true, "phone_locked_by": { "id": "3", "name": "王海涛" } }
// 公海详情（未领取）：号码可见（锁随掉公海自动消失）+ 概览，但不返跟单全文；写 operation_log(sea.phone.view)
{ "phone": "13800001111", "try_count_30d": 5, "last_summary": "客户说下周答复", "stuck_stage": 3 }
```
**派生字段（出参算、库不存）**：`old_customer`（有历史合同）、`address_maintained`（address 或坐标为空→false）、`drop_in_x_days`、`overdue`、`is_weekly`、`pay_progress`、`expire_level`、`stat_unit`（`relation`｜`company`）。

### 5.2 认证 account
- `POST /account/login` req `{account,password}` → resp `{access_token,refresh_token,user:UserVO}`
  - **`account` ＝ 手机号 或 登录账号名**（`employee.username`），**二选一**；**服务端判别**（11 位手机号格式按手机号查，否则按账号名查）。**两种通道共用同一个 `password_hash`**。
  - ⚠ **2026-09-14 变更**：入参由 `{phone,password}` 扩为 `{account,password}`；**前端只给一个输入框**（`→《前端页面与交互文档》登录页`）。
  - 账号不存在 / 密码错 → **一律 401 / 20002**「手机号或密码不正确」（**不泄露账号是否存在，也不区分是账号名错还是密码错**）。
- `POST /account/refresh` req `{refresh_token}` → resp **`{access_token,refresh_token}`** —— **不带 `user`**（2026-09-15 定；刷新只负责换令牌，前端要用户信息就调 `GET /account/me`，避免两个出口各带一份用户信息）。
- `GET /account/me` → `UserVO` ＝ `{id,name,username?,role,dept:{id,name},managed_dept_ids:[],permissions:{"perm_key":"level"},theme,nav_open:[]}`
  - `theme`：**`"light"` / `"dark"` / `null`** —— `null` ＝ **从未设置过**（≠「显式选了白天」）；前端按「跟随默认」回落（落库口径 → 数据架构 **A2**）。
  - `nav_open`：侧栏展开的分组键集合（`→需求§13.4`）。**始终下发该键**：没存过给 `[]`（⚠ 客户端**不得**把 `[]` 当成"用户手动全收起"—— 服务端把它拉平了，两者在线上**不可区分**）。
- `PUT /account/preferences` req `{theme?:"light"|"dark",nav_open?:[],notif?:{...}}` → resp **`UserVO`**（结构与 `GET /account/me` **完全相同** · 2026-09-18 落实现）
  - **部分更新**：**没给到的键一律原样保留**（前端「只切主题」不必回传侧栏状态）；**一个键都不给也回 `200`** 且**不改库**（空 body 是合法请求，不是错误）。
  - `theme` 非法取值（如 `blue`）→ **400 / 20001**；`nav_open` 上限 **64 项 / 每项 64 位**。
  - **只有本人能改自己的偏好**：操作对象取自令牌上下文，**入参没有任何 `employee_id`**。
  - ⚠ `notif`（通知偏好）**内部结构规格未定**（本节只写 `{...}`）⇒ **本版未实现**，传了也不落库（→《欠账登记表》**D-42**）。
  - ⚠ 登录账号名**随员工编辑维护**（`PUT /org/employees`，管理员操作）；**V1 不做员工自助改名**。
- **登录账号名规则**：`employee.username`、**可空**（为空则只能手机号登录）、**全局唯一**、大小写不敏感、建议 4~32 位字母 / 数字 / 下划线。

### 5.3 组织与权限 org / dict
- 部门 `{id,name,parent_id,service_enabled,status,manager_ids:[],product_line_ids:[]}`
- 员工 `{id,work_no,name,phone,username?,primary_dept:{id,name},extra_depts:[],product_lines:[],direct_manager:{id,name},roles:["sale"],status}`
- `POST/PUT /org/employees` req `{name,phone,username?,work_no?,primary_dept_id,extra_dept_ids?:[],product_line_ids?:[],direct_manager_id?,role_codes:[],password?}`
  - `username` **可空、全局唯一**（撞唯一约束 → **409**，提示「该账号名已被占用」）；留空＝只能手机号登录。
- 部门规则 `{dept_id,level_tiers:[{level,min_amount}],gray_remind_days,s_social_days,newbie_first_follow_hours,ask_help_days,contact_trait_max,updated_at}`
- 产品线 `{id,name,code,color_key,dept_ids:[],service_cycle_days,status}`
- 角色 `{code,name,is_builtin}`；权限矩阵行 `{perm_key,role_code,level}`
- 字典 `type:{code,name}`、`item:{id,item_code,label,sort,builtin,status}`

### 5.4 公司档案 company
- 列表项 `{id,full_name,city,industry_l1,scale,credit_code?,registered_capital?,legal_person?,relation_count,old_customer,address_maintained,updated_at}`；**筛选参数** `min_registered_capital` / `max_registered_capital`（**单位＝元**，纯数值区间比较）
  - **列表类一律分页**（→ §2.3 / §2.7；**2026-09-20 起**）：`GET /companies` 入参 `page` / `page_size`，出参 ＝ **`{list,total,page,page_size}`**（**不再是裸数组** —— 原「最近 100 条」作废）；排序恒 `id desc`。⚠ §2.7 的 `order_by` / `keyword` 尚未铺到 B 域（→《欠账登记表》**D-07**）
- 详情 `{...company字段, completeness:{c1,c2,c3}, profile_tags:{identity:[{tag_id,tag_code,label}],policy:[],decision_chain:{tag_id,label}?}, contacts:[ContactBrief], relations_summary:[{dept,product_line:{id,name,color_key},sign_date,amount|amount_masked}], event_count_30d}`
  - **★ 落点（D-61 桥③ · 2026-09-21）**：`GET /companies/:id` 已从 B 域 `company.controller` **迁移到聚合层模块 `company-aggregate`**（B(L2) 禁止依赖 C(L3)、C 禁止依赖 D/E，跨域拼装只能发生在更高编排层；→《欠账登记表》D-61）。聚合层同时合法 import `CompanyModule`(B) ＋ `RelationModule`(C)，以后补 D/E 字段只在聚合层加 import，业务域零改动。
  - **★ `relations_summary` 本期子集（D-61 · 2026-09-21）**：数组项**仅含 `dept` / `product_line`**（来自 C 域 `business_relation` 按公司分组的真实业务线）；`sign_date` / `amount` 来自 **E 域 `contract`**，本期 E 域未建 module ⇒ **暂不出、不编假值**，待 E 域就绪由聚合层补（→ D-61 后续，仍欠）。
  - **★ `event_count_30d` 已落地（D-61 后续 · 2026-09-21）**：口径 ＝ **近 30 个自然日**该公司**各关系下**的**跟单条数合计**（**派生、不落列**）：① **只计当前查看者可见的关系**（＝ §2.2 私海那四档范围；看不见的关系下有多少条跟单**不算进来**）；② **不计系统事件**（建档 / 领取，`action_type=system` —— 那是系统动作、**不是销售写的跟单**，→ 数据架构 D2 / 本文件 §5.7）。⚠ 故同一家公司，**不同角色看到的这个数字可以不同**（各自的可见范围不同）—— 这是**口径，不是 bug**。实现落点 ＝ 聚合层拼装 → **D 域出口**（按关系集计数）→ **C 域可见性出口**（哪些关系可见），**B / C / D 三个业务域零改动**（→ D-61 桥③ 的长期价值）。
  - **★ 上条的口径三要素「已拍板」（2026-09-21）**：① 粒度＝**自然日**（不是 720 小时滚动窗）；② **含今天**（窗口 ＝ `[今天(UTC) 00:00 − 29 天, 现在]`，共 **30 个自然日**）；③ 日界＝**UTC**（依据 `服务端/prisma/README.md` §七「UTC 存 / 边界按 UTC」，→ D-54）。★ 规格正文只写「近 30 天」、这三条**未逐字见于正文** ⇒ 属**本项目已拍板口径**（不是"实现顺手定的"）；改口径**只动一处**（`engine/domain/event-count-window.ts`）。**同批拍板**：**系统事件不计入** —— `action_type=system`（建档 / 领取）不是「销售写的跟单」。
- **★ 公司档案不含跟单正文（2026-09-18 定）**：`GET /companies/:id` **只给基本资料 ＋ 跟单计数**（`event_count_30d` ＝ 近 30 天该公司各关系下的跟单条数合计，**派生、不落列**，→ §十六 N11 同源），**不给跟单正文 / 时间线** —— 正文**只在关系层出**（`GET /relations/:id/events`）。公司档案是**全公司共享的资料层**，跟单是**关系层的推进记录**，不混层。
- 建档/改 req `{full_name,industry_l1?,industry_l2?,province?,city?,district?,scale?,website?,address?,bank_name?,invoice_title?,tax_no?,credit_code?,registered_capital?,legal_person?,longitude?,latitude?,aliases?:[]}`
- **注册资本单位口径（2026-09-13 定）**：`registered_capital` **接口层一律以「元」传输**（字符串 / 数值、两位小数）；**前端按「万元」录入与展示**并各做一次换算（录入 `500` 万 → 提交 `5000000`；展示 `5000000` → `500万`）。`legal_person` 为文本、同样可空。**两者均不做签约强制、不进签约校验清单默认播种**（`→需求§7.3`、`→架构 E8`）
- `POST /companies/:id/profile-tags` req `{group_code,tag_id}`
- `POST /companies/search-dup` req `{phone?,credit_code?,name?}` → resp `{candidates:[{id,full_name,credit_code_masked,similarity,match_type:"same"|"high_sim"}],suggest:"use_exists"|"create_new"}`
- `POST /companies/:id/merge` req `{loser_id,decision_chain_tag_id?}`（survivor＝路径 `:id`）
- `GET /companies/:id/contacts` → **分页形态** `{list:[ContactBrief],total,page,page_size}`（含历史 / 已离职标记；**2026-09-20 起分页**，→ §2.3）；排序恒 `is_current desc, id desc`（**在职在前**）

### 5.5 联系人 contact
- `ContactBrief` `{id,name,position?,phone|phone_masked,phone_locked?,decision_role,is_current}`（**列表 / 卡片出参一律 `phone_masked`**）
  - **列表类一律分页**（→ §2.3 / §2.7；**2026-09-20 起**）：`GET /contacts` 入参 `page` / `page_size`（＋既有的 `only_unlinked`），出参 ＝ `{list,total,page,page_size}`（**不再是裸数组**）；排序恒 `id desc`
- 详情 `{id,name,phone?,phone_locked,phone_locked_by?:{id,name},extra_phones:[{type,number,note}],wechat,email,gender,birthday,decision_role,tags:[],traits:[{trait_id,trait_code,label}],status,employments:[{company_id,company_name,position,joined_at,left_at,is_current}]}`
  - `extra_phones[].type` **值域唯一落点 ＝《数据架构》B2**：`mobile` / `tel` / `wechat`（★ 2026-09-20 拍板收敛：**原出参声明的 `landline` / `other` 作废**，旧码仅作历史数据兜底 —— 前端"两套都认"的临时做法由此取消，→《废止口径登记表》/《欠账登记表》D-49）
  - `gender` **值域唯一落点 ＝《数据架构》B2**：`male` / `female` / `unknown`（★ 2026-09-20 定值域 →《欠账登记表》D-49②；**`unknown` ＝「明确不便说」，与「从未填过」的空值不是一回事**；建档 / 改送非法值 → **400 / 20001**）
  - **`phone` 与 `extra_phones` 只在一种情况下缺省**：该联系人**已被 owner 上锁**、且查看者不是 owner → 此时给 `phone_locked:true` ＋ `phone_locked_by`，**主号与备用号一并隐藏**（**锁跟人**，2026-09-14 定，`→需求§4.3 二`）。**其余情况一律全号，与角色无关**。
- `POST /contacts/:id/phone-lock` → 上锁（**仅该联系人归属关系的 owner**；非 owner → **403**）；幂等。
- `DELETE /contacts/:id/phone-lock` → 手动解锁（**仅落锁人本人**；**总经理 / 管理员可强制解锁，须留痕**）。
- 建档/改 req `{name,phone,extra_phones?:[],wechat?,email?,gender?,birthday?,decision_role?,tags?:[],company_id?,position?}`
- `PUT /contacts/:id/traits` req `{trait_ids:[]}`（**上限校验只拦「新增」**：更新后数量 > 当前已有数量且超 `contact_trait_max` → **422/20402**；不增量则放行）
- `POST /contacts/:id/merge` req `{winner_id}`（经理权限）
- `GET /contacts/:id/employments` → 就职/跳槽历史（同上 employments 形态）
- `POST /contacts/phone-change/apply` req `{contact_id,new_phone}` → `approval_id`
- `GET /contacts` **入参**（V1.22 起）：`only_unlinked`（`true` ＝只看「**未关联公司**」的待跟进，即"待关联"视图，判定＝该联系人无任何 `company_contact` 记录 → 需求 §6.1 ③）。
  **可见范围**（2026-09-16 定 ＋ **2026-09-21 收口**，→ 需求 §6.1 ⑪）：**自己的待关联线索**（未挂公司 ⇒ `contact.owner_id` 是我；**经理另加：管辖部门内员工录入的**，2026-09-21 拍板 · 依据 §6.1 ⑨「经理分派」）＋ **自己关系下公司的联系人**（已挂公司 ⇒ 就职于「**我可见的公司**」之一；可见公司 ＝ 我可见关系（私海四档 ∪ 本部门公海）所对应的公司）。`all` 档（总经理 / 管理员，→ §2.2 / 需求 §4.2）**不套过滤**。★ **落点**：本端点与 `GET /contacts/:id` 于 2026-09-21 由 B 域**迁至聚合层** `company-aggregate`（「我可见的公司」只有 C 域算得出，而 B(L2) 不许依赖 C(L3)）；**详情与列表同一套判定**（不许出现"列表看不到、详情能打开"或反过来）。★ 「**可看的待关联归属人**」＝ 我 ∪（经理）管辖部门内员工 —— 集合由 **A 域出口**给（兼部门在 JSON 列，只有 A 域解得对）。
- 建号/改号命中历史号 → 出参 `phone_history_hint:"曾属于 XX"`（**提示不拦截**）

### 5.6 业务关系 relation（核心）
- **列表出参** ＝ §2.3 分页形态 **`{list,total,page,page_size}`**（**列表类一律分页**，→ §2.7；`total` 数的是**筛选后的结果集**、不是本页行数）；`list` 每项结构见下。
- **列表入参（筛选，V1.21）**：`tab`（`private` / `sea`）＋ `page` / `page_size` ＋ **`view`**（`all`｜`following` 阶段 1~5｜`cooperated` 阶段 6｜`churned` 阶段 7）＋ **`urgency`**（紧迫档五档**多选**、逗号分隔，→ 需求 §8.2）。⚠ **视图各档的判定不写在本文件**（本文件只定"参数长什么样"），唯一落点＝`服务端 .../domain/relation-list-filter.ts`；**第五档「逾期未跟进」暂不提供**（依赖 `overdue`，→《欠账登记表》D-10）。
- **列表项** `{id,company:{id,name},dept:{id,name},product_line:{id,name,color_key},stage:1-7,urgency,value_tier,customer_level,owner:{id,name},last_event_at,drop_in_x_days,overdue,competition,amount|amount_masked,old_customer,is_weekly}`
- **详情** ＝ 列表项 ＋ `{next_action_hint,sea_status,round_no（当前轮次号＝已掉海次数+1，派生不落表）,prev_round?:{round_no,owner:{id,name},dead_or_churn?:reason,dropped_at,claimed_at?,event_count},competitors:[{id,name,positioning}],labels:{risk:[{label_id,label_code,label}],other:[]},members:[{employee:{id,name},member_type:"owner"|"collaborator",source,valid_until?}],stage_logs:[{from_stage,to_stage,action,reason?,operator:{id,name},created_at}],try_count_30d}`
- `POST /relations`（激活）req `{company_id,dept_id,product_line_id}`（撞 `uk_active_rel` → **409/20401**，**人话分档**：同三元组已有**私海** → 「已有归属，请走转交或协同」；已有**公海**行 → 「该客户在本部门·产品线已在公海，请**直接领取**」—— 公海行走 `POST /sea/company/:id/claim` 承接**同一条**，**不另建行**，→ 需求 §6.3 /《欠账登记表》D-53）
- `POST /contacts/:id/activate-relation`（**V1.23 新增**，2026-09-16 拍板）：把一条「**待关联**」联系人（还没挂公司）**关联到公司 ＋ 激活一条业务关系**，并把该联系人名下**未挂关系**的跟单**批量挂到新关系**（历史不断，→ 需求 §6.1 ④）。
  - req `{company_id,dept_id,product_line_id,position?}`（`position?` ＝ 此人在该公司的职位，写进就职关系；可空）。
  - resp ＝ **新关系的列表项**（同本节列表项形状，前端可直接跳详情）＋ `linked_events`（本次搬运的跟单条数）。
  - **一个动作含三件事**：① 写**就职关系**（`company_contact`，`is_current=true`）② **建关系**（公司 × 部门 × 产品线；**owner ＝ 发起人**，与 `POST /relations` 同规矩）③ **批量改挂孤儿跟单**（`action_event` 里 `relation_id` 为空、且 `contact_id` 是该联系人的行）。
  - **错误**：三元组已有活跃关系 → **409 / 20401**（与 `POST /relations` **同一句人话**）；**该联系人已挂过公司**（不是「待关联」）→ **409**（防重复触发）；部门越权 / 只读角色 → **403**；各类 id 不存在 → **400**。
  - ⚠ **可重入**：重复调用不会二次搬运（第三步只动 `relation_id` 为空的行）。⚠ **实现前置**：本动线跨 **B / C / D 三域**且架构禁跨域大事务，动手前先核**层级**（`C` 域**不可反向依赖** `D` 域）与 EventBus 现状（→《欠账登记表》**D-29**）。
- **★ 公海（无主）关系 ＝ 可读不可写（2026-09-18 定）**：
  - **可读**（→ §5.7 同口径）：`GET /relations/:id`（详情）＋ `GET /relations/:id/events`（跟单全文）＋ `GET /relations/:id/commitments`（承诺）＋ 阶段留痕，对**该关系所属部门**开放 —— 销售＝**本部门**公海、经理＝管辖部门、总经理 / 管理员＝全部；**别部门公海 → 403**；交付 / 客服**不进公海**（→ §2.2 四档）。理由：**看不到历史就判断不出值不值得捞**。
  - **公司档案不含跟单正文**：`GET /companies/:id` 只给基本资料 ＋ **跟单计数**（近 30 天 N 次，**派生不落列**），**不给跟单正文 / 时间线** —— 正文只在关系层出（2026-09-18 定）。
  - **不可写**：`POST /relations/:id/events`、`POST /events/quick-mark`、`POST/PUT /relations/:id/commitments`、`PUT /relations/:id/stage`、`POST/DELETE /relations/:id/members`，以及 `PUT /relations/:id` 里**除 `value_tier` 以外**的字段 → **422 / `20408`**（人话：「该公司还在公海（未领取）：要写跟单请先领取到私海」）。
  - **唯一例外 ＝ `PUT /relations/:id` 只传 `value_tier`**：改「开发价值」—— **开发价值是「部门共同维护」的属性**，故**本部门（经理＝管辖部门 / 总经理＝全部）内**谁都能标，**销售也可以**（⚠ **不看 owner**：无主关系没有 owner 可看；判定 = 该关系在本人的读范围内 ＋ 可写角色）；其余字段一起传**也算写** → `20408`；**写跟单只能在私海**。
- `PUT /relations/:id` req `{urgency?,value_tier?,next_action_hint?,competition?,competitor_id?}`
- `PUT /relations/:id/stage` req `{to_stage,confirm?:true}` → resp `{suggested_stage?,stage_log}`
- `POST/DELETE /relations/:id/members` req `{employee_id,member_type,source:"collaborate"|"ask_help",valid_until?}`
- `POST/DELETE /relations/:id/labels` req `{group_code,label_id}`
- `POST /relations/:id/transfer` req `{to_employee_id,reason?}`
- `POST /relations/batch-transfer` req `{from_employee_id,to_employee_id,relation_ids?:[]}`
- `PUT /relations/:id/competition` req `{competition,competitor_id?,competition_note?}`
- **历史轮次（P0-④⑤，`→需求§8.1` / `→架构 F2/D2`）**：`GET /relations/:id/rounds` → `{rounds:[RelationRound]}`，`RelationRound{round_no,owner:{id,name},sea_record:{relation_id,reason,dropped_at,claimed_at?},event_count,stage_logs?:[...]}`；`round_no` 由 `sea_record` 计数派生（一轮＝一次私海→掉回公海）。
- **重新领取级联（P0-④⑤）**：`POST /sea/company/:id/claim` 领取瞬间，该关系所有 **open 承诺 `owner_id` 转新 owner**（承诺随关系走，与转交口径一致，→需求§8.1）；领取后新建跟单的 `owner_snapshot` 取新 owner，前主人轮次跟单保留旧 `owner_snapshot` 供归组；该端点的 **req / resp / 错误码见 §5.16**。

### 5.7 行动引擎 commitment / event / cadence / agenda
- **事件项（跟单卡）** `{id,action_type,summary,outcome,pain_point:{id,label}?,competition?,actor:{id,name},owner_snapshot?（本条创建时关系归属人，用于按轮次归组）,contact:{id,name}?,duration_min?,event_at,branch:"main"|"sub",round_no（派生：本条所属轮次）,attachments:[]}`（**P0-④⑤**：前端按 `round_no` 分组、轮次内按 `owner_snapshot` 归组——先看本轮 owner 主线/树杈，前主人轮次标姓名；`branch` 仍按 `actor_id` 与 owner 比较，→需求§7.5 / §8.1）
- `POST /relations/:id/events` req `{contact_id?,action_type,summary?,outcome?,stage_forward?,pain_point_id?,competition?,competitor_id?,competition_note?,duration_min?,mentioned_user_ids?:[],promise?:{party,ctype,content,due_at?},appointment_id?,visit_log_id?}`
- **待关联阶段事件（无关系，配合 需求§6.1 模型 B）**：`POST /contacts/:id/events` req 同 `POST /relations/:id/events`（省 `relation_id`，由服务端置空）；**关联公司激活关系后，服务端批量把该联系人名下 `relation_id` 为空的事件挂到新关系**（`→架构 D2` `→需求§10.2`）。
  - **谁能写 / 会怎样（2026-09-20 补，原缺口 →《欠账登记表》D-51；依据＝需求 §6.1 ⑦⑨ ＋ 同族 `quick-mark` 联系人侧，**非自造**）**：① **只有该联系人的当前归属人能记**（`contact.owner_id`，**可改**：经理分派 / 离职交接 → 需求 §6.1 ⑨），别人 → **403** `contact_event.not_mine`；② **已挂公司**的联系人（那一列只有待关联的人有值 ⇒ `owner_id` 为 `null`）**同为 403**，人话一并指引「到业务关系里记」；③ `req` 里若仍带 `contact_id` 且与路径**不是同一个人** → **400** `event.contact_conflict`（**静默忽略入参更糟**）；④ 联系人不存在 / 已删已合并 → **400** `event.contact_missing`；⑤ **有效沟通必写一句话结果** → **422**（同关系侧，→ 需求 §10.2）；同内容重复 → **409** `uk_idem`（幂等键 `relationId=null`）。
  - **落库形态**：`relation_id` 与 `owner_snapshot` **均 `null`**（无关系 ⇒ `owner_snapshot` 无从取值），`contact_id` 取路径；**不判关系可写、不回写 `last_event_at`**（那列在 C 域，本条没有关系）。
- `POST /events/quick-mark` req `{relation_ids?:[],contact_ids?:[],outcome:"not_contacted"|"no_answer"|"brief_hangup"}`（`relation_ids` 与 `contact_ids` **至少一组非空**；**不更新 `last_event_at`**）
  - **两组判定不同（2026-09-16 定，→ 需求 §6.1 ⑦⑨）**：`relation_ids` 判**关系可写**（越权 / 只读角色 → **403**）；`contact_ids` 判**归属人是不是我** —— 「待关联」（未挂公司）线索属私人待跟进，**只有当前归属人能标**，别人的 → **403** `quick_mark.not_mine`；id 不存在 / 已合并已删 → **400** `quick_mark.contact_missing`。落库时联系人侧 `relation_id` 为空。
  - resp `{marked}`（2026-09-20 补，原缺口 →《欠账登记表》D-24）：`marked` ＝ **实际落库的事件条数**（去重后能写的关系 / 联系人数）。
- 承诺 `{id,relation_id,party:"me"|"them"|"verdict",ctype,content,due_at,remind_at,status,waive_reason?,done_at?}`（`status` ＝**收尾三态**：`done` 兑现 / `cancelled` 取消（录错了，**不填原因**）/ `waived` 豁免（**必填 `waive_reason`**）；`waive_reason` 仅 `waived` 有值，其余为 `null`，→ 需求 §10.1）
  - `PUT /relations/:id/commitments` req `{id,status?,waive_reason?,due_at?,remind_at?}`（2026-09-20 补，原缺口 →《欠账登记表》D-16）：`id` **必填** ＝ 要改哪条承诺（十进制字符串，**由 body 指认目标**，不是路径参数）；`status` ＝ `done` / `cancelled` / `waived`（→ 需求 §10.1 收尾三态）；`waived` **必填 `waive_reason`**（≤255 字）；`due_at` / `remind_at` ＝ 改期（ISO 字符串）；**已结束的承诺（兑现 / 取消 / 豁免）再改 → 422 / `20403`**。
- 节奏规则 `{id,scope_dept_id?,scope_line_id?,trigger,suggest_action,soft,enabled,sort}`
- 动线条目 `{id,ref_type,ref_id,relation:{id,name},contact?,reason,priority,action_hint,status,snooze_count}`
- `POST /today-agenda/:id/action` req `{action:"done"|"snoozed"|"ignored",reason?}`（snoozed 上限 3；**ignored 必填 reason** → 422/20403）

### 5.8 预约 / 外出 appointment / visit
- 预约 `{id,relation_id,contact?,appointment_at,note,status,drop_in_x_days}`
- `POST /appointments` req `{relation_id,contact_id?,appointment_at,note?}`；`PUT /appointments/:id` 改期 req 同（写 `reschedule_log`）
- `POST /appointments/:id/complete` → resp `{event_id}`（服务端强制生成事件，否则 **422**）
- `POST /visits` req `{depart_at,reason,relation_ids?:[]}`；`POST /visits/:id/return` req `{}`（写 `actual_return_at`）

### 5.9 合同 / 回款 / 分配 contract / payment / split
- 列表项 `{id,contract_no,company:{id,name},product_line,signer:{id,name},amount,paid_amount,pay_progress,status,sign_date,service_end,expire_level:0|30|60|90}`
- 详情 ＋ `{payments:[{id,amount,paid_at,method,voucher?:{file_id,file_name}}],splits:[{employee:{id,name},percent}],attachments:[]}`
- 创建 req `{relation_id,contact_id?,amount,pay_type?,sign_date,service_start?,service_end?,auto_renew?,remind_days?:[]}`
- `POST /contracts/:id/payments` req `{amount,paid_at,method?,voucher_file_key?}`
- `PUT /contracts/:id/splits` req `{splits:[{employee_id,percent}]}`（**合计须 100 → 422**）
- **签约校验（创建前）**：`POST /contracts` 先按 `sign_checklist`（本 `product_line_id`）逐项校验；缺失任一 → **422 / `20403`（必填未填）** + 响应 `{missing:[{scope,field_key,label,goto}]}`（`goto` = 内联补/跳补锚点，见 §5.15）；全部齐备才落库。

### 5.10 工单 workorder
- `{id,order_no,type:"after_sale"|"opportunity",title,priority?,assignee:{id,name}?,sla_deadline?,overdue,relation:{id,name}?,status}`
- 建/改 req `{type,title,content?,relation_id?,source?,priority?,assignee_id?,sla_deadline?,est_effort_min?}`
- `POST /workorders/:id/convert` req `{to_type}`

### 5.11 客户台账 ledger / field
- 列表行 ＝ 通用列 `{contract_no,company:{id,name},contact?,sales?,delivery?,customer_level,sign_date,expire_date,remark}` ＋ `extra_fields`（按字段模板动态）
- `GET /ledgers` 出参附 `columns:[{field_key,label,control_type,show_in_list,status}]` 供前端**动态渲染**
- `POST /product-lines/:id/field-templates` req `{field_key,label,control_type,required?,sort?,show_in_list?,options?}`（**field_key / control_type 保存后不可改**）

### 5.12 审批中心 approval
- 待办项 `{id,type,title,applicant:{id,name},target:{type,id},payload,waiting_hours,urgent:bool}`
- **payload 分型**：`transfer{to_employee_id,reason?}`｜`collaborate{employee_id,valid_until?}`｜`phone_change{contact_id,old_phone,new_phone}`｜`phone_unlock{contact_id,relation_id?,locked_by:{id,name}}`｜**`relation_reassign{items:[{relation_id,to_employee_id\|null}],reason?}`**（`to_employee_id=null` ＝ 该关系回公海；2026-09-14 定）
- `POST /approvals/:id/approve` req `{comment?}`；`POST /approvals/:id/reject` req `{comment}`（**必填**）
- `POST /phone-unlock/apply` req `{contact_id,relation_id?}` → resp `{approval_id}`；**`approver_id` ＝ 该联系人的落锁人**（`phone_unlock.locked_by`，**例外于"默认直属上级"**，`→需求§4.3 二`）；**审批通过后 24h 内**目标联系人出参带 `phone` 与 `unlocked_until`

### 5.13 报表 / 目标 report / target
- 看板 `GET /reports/dashboard` → `{kpi:{today_new,today_todo,month_signed:{amount,chain_ratio}},pending_todo:[],warnings:[{type,...}],dept_compare:[],top_sales:[],zombie_weekly:[],sea_todo:[]}`
- 目标 `POST/PUT /targets` req `{period,scope_type:"company"|"dept"|"employee",scope_id,amount,remark?}`
- 进度 `GET /targets/progress` → `{stat_unit:"relation"|"company",items:[{scope_type,scope_id,name,target_amount,paid_amount,signed_amount,rate,time_rate,diff_points,adjusted:bool}]}`
- 各报表统一 `{summary:{...},list:[]}`；涉客户等级统计必带 `stat_unit`（条/家）

### 5.14 通知 / 复盘 / 竞品 / 文件 / 系统
- 通知项 `{id,type,title,content,biz:{type,id},read:bool,created_at}`
- 复盘 `POST /relations/:id/review` req `{review_type:"win"|"loss"|"churn",why_code?,competitor_id?,detail?}`；`GET /reviews/win-library` 项 `{id,review_type,company,detail,manager_note,published_at}`
- 竞品 `{id,name,product_line_id,positioning?,note?,status}`
- 文件 `POST /files/asset`（multipart）→ `{file_id,file_key,file_name,file_size,mime_type}`；`GET /files/:id` → 服务端鉴权后返回短时下载地址
- 系统 `GET/PUT /system/config` `{config_key,value}`；`GET /operation-logs` 项 `{id,occurred_at,operator:{id,name},action,target:{type,id},ip}`

### 5.15 签约校验清单 sign_checklist（管理员配置）
- **查询** `GET /sign-checklists?product_line_id=` → 该线全部项 `[{id,product_line_id,scope,field_key,label,required,sort,status}]`
- **改** `PUT /sign-checklists/:id` req `{required?,sort?,status?}`（仅 `required`/`sort`/`status` 可改；`product_line_id`/`scope`/`field_key` 保存后不可变，参照 `field_template` 铁律）→ **管理员权限**，其余角色 403
- **新增项** `POST /sign-checklists` req `{product_line_id,scope,field_key,label,required?}`（超 `uk_line_scope_field` → 409）；`ledger` 类 `field_key` 须已登记 `field_template` 否则 422
- **删除** = 置 `status=disabled`（T5 停用不删，不物理删）
- **数据结构（DTO）**：
  - `SignChecklistItem` `{id,product_line_id,scope:"company"|"relation"|"ledger",field_key,label,required:bool,sort:int,status:"active"|"disabled"}`
  - `ContractSignMissing` `{missing:[{scope,field_key,label,goto:"inline_company"|"goto_relation_value"|"goto_ledger"}]}`（签约校验 422 响应体）
- 落点：`→架构 E8 sign_checklist`、`→需求§7.3` 签约校验清单落地。`scope=company` 字段校验看 `company` 表（共享，有值即过）；`scope=relation` 看 `business_relation.value_tier`/签约联系人；`scope=ledger` 看 `ledger.extra_fields`。
- **默认播种（2026-09-13 定）**：`scope=company` **4 项** ＝ `credit_code` / `address`（注册地址）/ `industry_l1`（行业）/ `province`（地区）——**`field_key` 必须是 `company` 表真实列名**；**`registered_capital` / `legal_person` 默认不播种**（个别产品线要卡，由管理员自选加回）

### 5.16 公海 sea（2026-09-20 新增：领取端点形状回填；2026-09-21 补规则配置两条）

> 本节落点是**已实现**的三条端点：`POST /sea/company/:id/claim`（F-01，片 1 `5c59d9f` / 片 2 `7f24d8f`，真库真机已验）
> ＋ `GET/PUT /sea/rules`（**M9-F 规则配置片**，2026-09-21）。
> 公海其余端点（`G /sea/company`、`G /sea/department`、`G /sea/records`、`G /sea/manager-todo`、`P /sea/manager-decision`）**尚无形状章节**，随实现分批回填（→《欠账登记表》D-33 ④）。

- `POST /sea/company/:id/claim` —— **领取公海客户到我的私海**（`:id` ＝ **公司 id**；动线 `→需求§6.3`，落点 `服务端/src/modules/sea/`）。
  - **req** `{dept_id, product_line_id}`（**与 `POST /relations` 逐字同形**）：部门 × 产品线是**业务关系**的属性，公海的一"条"＝**一条业务关系**，故必须能定位到具体那一条。两个 id 都是**十进制字符串**；字段缺失 / 类型错 / 长度非法 → **400 / 20001**。
  - **定位规则**：按「公司 ＋ `dept_id` ＋ `product_line_id` ＋ `sea_status='company_sea'` ＋ 未删未并」取关系；**同三元组多行**（掉海残留）取**入公海时间最新**的一条（→《欠账登记表》**D-53**）。
  - **resp** ＝ **`GET /relations` 列表项**（形状唯一落点见 §5.6）＋ **`claimed_at`**（本次领回时间 ISO；**`null` ＝ 这条关系没有入公海历史行** —— **不造行、不假装掉过海**，与「领取成功」不矛盾）。前端据此直接跳 `/relations/:id`。
  - **一次领取含四件事**：① **认领本体** —— `sea_status` 公海→私海 ＋ **`stage_id` 置 1**（新一轮，`→需求§8.1`），**条件 UPDATE 影响 1 行才算抢到**（`→数据架构§10.2-3`）；② **owner 成员切给领取人**（先撤在位行，再**复活 / 插入**——`uk_member` 不含 `revoked_at`，曾当过 owner 的人领回只能复活）；③ **阶段留痕**：`stage_id` 原值 ≠1 时写一行 `relation_stage_log{from_stage:原值, to_stage:1, action:'normal', reason:null}`（复位属"正常推进到新一轮"，**不新造 reason 码**）；④ **`sea_record` 最近一条**回填 `claimed_by` / `claimed_at`（**没有历史行则跳过**）。★ ①~③ 在 **C 域同一事务**内完成、④ 在 **F 域**（本域的表）—— **跨域不开大事务**（`→架构§5.2`）。
  - **承诺随人走**：领取瞬间该关系所有 **open 承诺 `owner_id` 转新 owner**（→ §5.6 尾 / 需求 §8.1）。⚠ 这条级联走**领域事件**（**不等结果** —— 承诺晚转几十毫秒不影响领取成功），是架构 §5.2「路之②」的用例；**F / D 两域同层，禁互相依赖**（`→架构§3` / §5.3）。
  - **错误**（⚠ 两个 400 **不是一件事**，别挤成一句人话）：
    | HTTP | code | constraint | 场景 / 人话 |
    |---|---|---|---|
    | 400 | 20001 | `relation.company_missing` / `relation.dept_missing` / `relation.product_line_missing` | **id 指错**（公司 / 部门 / 产品线不存在）→ **改参数重试** |
    | 400 | 20001 | `sea.relation_not_claimed` | **定位不到那条公海关系**（本来就没有 / 刚刚被同事领走）→ **刷新列表**（也是本端点的**语义幂等**：重复调用第二次必然落这里，不是 500、不会双写） |
    | 403 | 20003 | `relation.read_only` | **只读角色**：管理员（`all` 档也拦）｜交付 · 客服 |
    | 403 | 20003 | `relation.out_of_scope` | **领别部门的公海** |
    | 409 | 20004 | `sea.claim_conflict` | **并发被抢**（条件 UPDATE 影响 0 行）→ 刷新列表 |
  - **越权判定用入参 `dept_id`、不看定位结果**：否则「定位不到 → 400」与「越界 → 403」两个回包可被拿来**反推别部门有没有这条公海**（同 §5.6「不许用 422 反推存在性」）。
  - **幂等**：`Idempotency-Key` 横切**尚未实现**（→《欠账登记表》**D-06**，同现状不额外要求请求头）；本端点的语义幂等由上面第二行 400 保证。
  - **留痕**：审计动作 `sea.claim`，对象类型取**路径参数指向的对象**（＝ `company`）；级联另落一条 D 域 `system` 事件（「领取：从公海领取到私海」）。
  - ⛔ **本端点不含**：A 域「通知前 owner」那半（通知设施未建 →《欠账登记表》**D-42**）、经理「直接指派给某销售」（需求 §6.3 提到但**无端点形状**，不许由实现自造）。

- `GET /sea/rules` —— **公海规则列表**（L1-L4；`→需求§6.3` / `→架构F1`；2026-09-21 · M9-F）。
  - **resp** `RuleVo[]`（**不分页**：规则是**配置**，同层同位置至多一条 `active`，行数是"层级数"量级，没有翻页的语义）：
    `{id, level, dept:{id,name}|null, product_line:{id,name}|null, follow_freq_days, deal_cycle_days, stay_days, no_progress_max, effective_from, status, pending}`。
    **四个天数各自可为 `null` ＝ 该维度未配置**（前端显示"未配置"，**不许回落成默认天数** —— 回落＝凭空造业务口径）。
  - **`pending` 是派生字段**（`effective_from > 现在`）＝ "7 天缓冲期内、还没生效"。★ **列表含待生效行**：F1 的落库口径是「插新版本行 ＋ **旧行** `status=disabled`」⇒ 新版本行本身就是 `active`，只是还没到 `effective_from`；漏了它，经理看不到自己刚提交的变更。
  - **谁能看**（→ 需求 §6.3 层级 ＋ 前端 §四.2）：**老板 / 管理员＝全部**；**部门经理＝L1 / L2 全部**（上级兜底：看不到就解释不了"我这个部门到底按几天算"）**＋ 自己管辖部门的 L3 / L4**；**销售 / 交付 / 客服 → 403 / 20003**。
  - ⚠ 权限口径属**合成**（需求 §6.3 只写了「老板 / 部门经理」两档、未含管理员）⇒ 已登记《欠账登记表》**D-69**，待需求 §7 补正式权限表后回归规格。

- `PUT /sea/rules` —— **提交某层级规则的新版本**（2026-09-21 · M9-F）。★ 语义 ＝ **整行覆盖**（不是部分更新：`PUT` 提交的就是"这条规则新版本的内容"，没给的字段＝该维度不配；想保留原值请一起带上）。
  - **req** `{level, dept_id?, product_line_id?, follow_freq_days?, deal_cycle_days?, stay_days?, no_progress_max?, confirmed?}`：
    - `level` ∈ `1` 全局 / `2` 产品线 / `3` 部门 / `4` 部门×产品线；**层级与两个 key 必须搭配一致**（1＝两个都不给 / 2＝只给产品线 / 3＝只给部门 / 4＝都给）—— ★ **搭配错了不会被库拦下**（F1 的 `idx_level` 是**非唯一**索引），只会在运行期静默失配（命中解析判不中＝那条规则等于没配）⇒ 在**写入口**就拒：**400 / 20001**。
    - 四个天数：`null` / 不给 ＝ **不配**；给 0 或负数 → **400 / 20001**（"不配"请用 `null`，别用 0 表示）。⚠ `deal_cycle_days`（触发②）与 `no_progress_max`（触发③）的**锚点口径规格未写** ⇒ 本版**只配不生效**（扫描不读它们，→《欠账登记表》**D-57**）；`stay_days` 按 F1 ★ P-10 修正**只用于「公海停留超期」**、不参与私海倒计时（该任务与决策端点属后续片）。
    - `confirmed`：**两段式确认**（形态**不新增端点** —— §三 总目录只有 `G/U /sea/rules`）：不传 / `false` ⇒ **只回预告、零写库**；`true` ⇒ 落库。
  - **resp** `{applied, affected_customers, effective_from, rule|null}`：`applied=false` ⇒ 只回了预告（`rule` 为 `null`）；`applied=true` ⇒ 新版本行（含 `pending: true`）。
  - **7 天缓冲**（`→需求§6.3` / F1 逐字）：落库＝**插新版本行 ＋ 同位置旧行 `status=disabled`（停用不删）**，`effective_from` ＝ **提交日 + 7 天**；生效瞬间**受该规则约束**的在途关系**倒计时从生效日重新起算**（＝每个客户至少再给一整轮）。
  - **变更预告 `affected_customers`** ＝ 新版本生效后**由这条规则约束的在途私海客户数**：把"变更后"的规则集合拼出来（去掉同位置旧版本行 ＋ 加入新版本行），逐个「部门 × 产品线」用**与掉海扫描同一个** `resolveSeaRuleFor` 解析（L4→L1 取第一条），命中的那批计数相加。
    ★ **预告与落库共用同一个判定基准**（`effective_from`）与同一套规则解析 ⇒ 不会出现"预告说 3 个、落库后其实 5 个"（经理是**照着这个数**决定要不要改的）。⚠ 被更高层规则压着的层级（如已配 L4 的部门×产品线）**不计入**低层规则的预告 —— 它不受这条规则管。
    ⚠ **「重新起算」的集合＝受该规则约束的关系（不是字面"全库在途"）**：依据 ① 需求 §6.3「经理可取消或**改小幅度**」只有在"影响面随规则范围变"时才成立；② 字面全局重算**在 F1 的数据模型里无处落**（全局"最近一次变更时刻"没有任何一列承载，`effective_from` 是**逐行**的）。**本句已在代码落点写明**（`服务端/src/modules/sea/domain/sea-rule.ts` 文件头 ★），如需改成字面全局请先补承载列。
  - **谁能改**（→ 需求 §6.3 层级）：`L1` / `L2` → **老板 / 管理员**；`L3` / `L4` → **该部门的部门经理**（或老板 / 管理员）。越权 → **403 / 20003**。⚠ 同 `GET`：口径属合成（→ **D-69**）。
  - **错误**：400 / `20001`（`sea.rule_scope_inconsistent` 层级搭配错；`sea.rule_dept_missing` / `sea.rule_product_line_missing` 引用不存在）｜403 / `20003`（`sea.rule_write_forbidden`）｜400 / `20001` 字段级（`level` 不在 1~4、天数为 0 / 负数、`confirmed` 非布尔）。
  - **留痕**：审计动作 **`sea.rule_update`**，对象类型 `sea_rule`（→ 架构 §7.4 / 数据架构 A10）。⚠ **`confirmed=false` 的那次预告调用也留一条** —— 切面按 HTTP 方法判定、不看落没落库，这是**有意为之**（配置动作本身即敏感动作）；落没落库看出参 `applied`。

---

## 六、跨模块关键流程（实现务必对齐）

1. **撞单**：激活 `uk_active_rel` 撞 → 409/20401 → **按占位行的状态分两档**：已有**私海** → 前端提示「已有归属」并给转交/协同入口；已有**公海**行 → 提示「**请直接领取**」（走 `POST /sea/company/:id/claim` 承接**同一条**，**不另建行** —— 另建会把轮次与历史割裂，`→需求§6.3` /《欠账登记表》D-53）；同部门显归属人、跨部门只说「已有其他部门跟进」不露名（`→需求§6.3`）。
2. **协同**：`collaborator`（审批通过，可带 `valid_until`）可共同写跟单+看全文；`ask_help`（轻量临时，默认7天自动收回，不授读权）——两码事（`→需求§13` `→架构C2`）。
3. **领取公海**：幂等 + 继承全文；部门公海 = 公司公海映射视图（非独立一层，`→需求§6.3`）。
4. **联系方式 / 脱敏口径（2026-09-14 重写）**：**详情一律给全号**（与角色无关）；**只有列表 / 卡片给 `phone_masked`**（含公海，防批量截图）；跨线金额给 `amount_masked`；非归属**被锁**联系人给 `phone_locked` 而不给 `phone`；跨部门**仍不返跟单全文**（`→需求§4.3`）。
5. **锁与解锁**：上锁 `POST /contacts/:id/phone-lock`（**仅 owner**）；解锁申请 `phone-unlock/apply` → **落锁人审批**（＋知会其直属上级）→ **批后 24h 可见全号**，留痕 `operation_log`（不新增表）。**掉公海 / 离职 / 转岗 → 锁自动消失**；**总经理 / 管理员可强制解锁（须留痕）**。


