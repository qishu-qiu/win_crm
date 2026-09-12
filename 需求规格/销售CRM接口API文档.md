# 销售 CRM 接口 API 文档 V1.10

> **⚠ 开工前必读**：先读《**废止口径登记表**》（需求规格/）——已废止的旧说法不得作为实现依据。
> 文档性质：四件套之三（①业务需求 ②数据架构 ③**接口 API** ④前端页面与交互）。
> 配套真相源：《销售CRM业务需求文档》**V1.22**、《销售CRM数据架构文档》**V1.26**、《销售CRM设计规范》V1.0、《销售CRM前端页面与交互文档》**V1.13**（均 需求规格/）。
> 生效日期：2026-09-12 ｜ 状态：**V1.10**（待定项拍板版 · 紧随需求 V1.22 / 数据架构 V1.26 / 前端 V1.13）。

---

## 一、文档体系与铁律

### 1.1 与四件套的关系
- 本文件只定义「**怎么对话**」（REST 契约：路径 / 方法 / 入参 / 出参 / 错误码）。
- **业务规则**（谁、什么场景、什么校验）一律见 `→需求§X`；**表结构**（字段类型/索引/字典）一律见 `→架构表Y`。
- **同一事实只定义一次**（L1 单一事实源）：本文件不重复写业务规则原文，只写指针。

### 1.2 两条元铁律（L0 变更联动 / L1 单一事实源）
- **L0**：业务需求一改，本文件必须**同批**跟着改、同批升版；一次变更一张变更单，先改需求再改下游。
- **L1**：枚举值、错误码、脱敏口径在本文定义一次后，前端文档只写「见《接口 API 文档》§二」，不复制。
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
  - 经理：管辖部门（`dept_manager` 表集合，`→架构A3`）全部。
  - 总经理：全公司。
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
- `request_id` 全局追踪，排错必带。
- 分页固定字段：`list / total / page / page_size`（G2）。

### 2.4 错误码表
| HTTP | code | 含义 | 触发场景 |
|---|---|---|---|
| 400 | 20001 | 参数错误 | 字段缺失/类型错/枚举非法 |
| 401 | 20002 | 未认证 / token 失效 | 缺/错 Authorization |
| 403 | 20003 | 无权限（数据权限越界） | 访问他人私海/非管辖部门 |
| 409 | 20004 / 204xx | 唯一冲突 / 竞态 | 撞单(`uk_active_rel`)、抢公海、重复激活 → 映射 Prisma `P2002`（`meta.target` 取约束名回友好提示）|
| 422 | 204xx | 业务校验不通过 | 完成预约未留跟单、判死未填死因、开发价值未标（非灰度）、特质超限等 |
| 429 | 20005 | 限流 | 幂等键重复/高频 |
| 500 | 20099 | 服务异常 | 未预期错误 |

常用业务码（204xx）：`20401` 撞单已存在｜`20402` 超过上限（标签/特质/必填）｜`20403` 必填未填（死因/开发价值）｜`20404` 预约未完成禁止｜`20405` 解锁申请已存在｜`20406` 关系已激活。
> 唯一冲突一律映射 **409（撞单/竞态/抢公海）或 422（业务校验）**，**绝不把数据库原话透给销售**——DB 层是 MySQL `1062`、**Prisma 层暴露为 `P2002`**，两者都只在服务端内部消化（`→架构§7.5` `→数据架构§十五.5` `→需求§十六`）。

### 2.5 幂等（Idempotency-Key，[约定] G6）
- 所有**非幂等写操作**（创建关系/激活/领取公海/转交/协同/创建合同/回款/审批通过）请求头带 `Idempotency-Key: <uuid>`。
- 重复同 key → 返回首次结果（200），不重复执行；用于防网络重试导致的双写/双领。

### 2.6 命名与枚举（[约定] G1/G3）
- 入参出参 **snake_case**；时间字段 `_at` 后缀。
- **枚举一律英文码**（示例）：
  - 阶段 `stage`：`first_contact` / `need_confirm` / `demo` / `objection` / `closing` / `cooperated`（终态）。
  - 紧迫 `urgency`：`week_key` / `month_key` / `quarter_follow` / `long_term` / `gray`（默认）。
  - 公海 `sea_status`：`private` / `company_sea`（两态，`→架构F`）。
  - 竞争 `competition`：`none` / `in_use` / `comparing`。
  - 审批 `approval_type`：**`transfer` / `collaborate` / `phone_change` / `phone_unlock`**（四型一单）＋ **`relation_reassign`**（离职批量转交，管理员发起）（`→需求§7.9`）。
    - ⚠ 2026-09-11 校正：原枚举误列 `review`、漏 `phone_change`——**复盘不是审批类型**，手机号变更才是（`→需求§7.9`）。
  - 数字/状态字典以 `dict_item` 为准（`→架构A11`）。

### 2.7 分页 / 排序 / 过滤
- 查询统一 `page`（默认1）/`page_size`（默认20，最大100）/`order_by`（字段）/ `desc`（bool）。
- 时间范围 `start_at` / `end_at`（ISO8601，Asia/Shanghai）。
- 模糊搜 `keyword`（公司名走 ngram 全文索引，`→架构§十`）。

### 2.8 脱敏规则（[铁律] G4/G5）
- **金额跨业务线**：响应返回 `amount: null` + `amount_masked: "***"`，仅露非金额信息（已合作 + 签约日期）。库内永远明文（`→需求§4.3` `→架构§十一`）。
- **手机号**：非归属部门联系人返回 `phone_masked: "****1234"`（后4位），`phone` 字段缺省；归属本人/协同返回全号。申请解锁走 `L05` 审批，批后限时（24h）可见全号（`→需求§13.2`）。
- **报表 / 看板不脱敏**：经理 / 老板出口（`/reports/*`、`/targets/progress`）**返回真实金额**——脱敏只作用于"销售看他人私海 / 跨部门关系"的列表与详情（`→需求§4.3`）。

### 2.9 时间与时区
- 服务端统一 `Asia/Shanghai`；出入参 ISO8601（`2026-09-05T09:30:00+08:00`）。

### 2.10 文件上传（file_asset，[新增] `→架构B8`）
- 先 `POST /files/asset` 上传拿 `file_key`（存 key 不存 URL），再在业务接口传 `file_key`（如合同凭证 `payment_record.voucher_file_id`）。

### 2.11 版本与变更
- URL 含 `/v1`；破坏性变更升 `v2`。每次变更**走 git 提交留痕**（提交信息写清改了什么、为什么；**文档内不留「修改记录」章节**）+ 同步业务需求文档。

---

## 三、接口总览（★ 索引·非规范：契约以 §四 / §五 为准）

> **⚠ 本表是"目录"，不是"契约"。** §三 只给"有哪些端点"，**请求/响应字段、错误码、校验一律以 §四 分模块契约 与 §五 数据结构为准**；本表与 §四/§五 不一致时以 §四/§五 为准。

> 方法：G 查 / P 建 / U 改 / D 删（逻辑删为主，停用不删）。角色：S 销售 / M 经理 / B 老板 / A 全员。

| 域 | 分组 | 路径 | 方法 | 说明 |
|---|---|---|---|---|
| 认证 | account | /account/login | P | 登录 |
| 认证 | account | /account/refresh | P | 刷新 token |
| 认证 | account | /account/me | G | 当前人+角色+管辖部门 |
| 认证 | account | /account/preferences | U ★ | 个人主题（**白天/夜间**）与通知偏好（存账号，`→需求§13`）|
| 组织 | org | /org/departments | G/**P/U/D** ★ | 部门树（增/改/停用，`→需求§7.1`）|
| 组织 | org | /org/departments/:id/managers | G/P/D ★ | 部门经理（多对多，`→架构A3`）|
| 组织 | org | /org/employees | G/**P/U** ★ | 员工（入职/改主兼部门/改直属经理/离职停用）|
| 组织 | org | /org/employees/:id/roles | G/U ★ | 角色分配（多选，`→架构A5`）|
| 组织 | org | /org/employees/:id/offboard | P ★ | 离职：批量转交关系（管理员发起，走审批）|
| 组织 | org | /org/roles , /org/permissions | G | 角色/权限矩阵 |
| 组织 | org | /org/product-lines | G/**P**/U ★ | 产品线（固定配色、承接部门、服务周期）|
| 组织 | org | /org/dept-rule | G/U | 部门规则（掉海天数/灰度提醒/等级档/特质上限）|
| 组织 | dict | /dict/types , /dict/items | G/**P**/U ★ | 数据字典（builtin 不可删可停用）|
| 公司 | company | /companies | G/P | 公司档案列表/建档 |
| 公司 | company | /companies/:id | G/U | 详情/改 |
| 公司 | company | /companies/:id/profile-tags | G/P/D | 公司档案标签（身份/制度/决策链）|
| 公司 | company | /companies/search-dup | P | 撞库查重（手机/信用代码/名相似）|
| 公司 | company | /companies/:id/merge | P ★ | 撞码**墓碑合并**（单事务 6 步，`→需求§7.3`）|
| 公司 | company | /companies/:id/contacts | G ★ | 公司联系人（含历史/已离职标记，`→架构B5`）|
| 联系人 | contact | /contacts | G/P/U | 联系人 |
| 联系人 | contact | /contacts/:id | **D** ★ | 删除（**经理权限**，销售不可，`→需求§7.2`）|
| 联系人 | contact | /contacts/:id/traits | U | 谈判特质（≤3，部门可配）|
| 联系人 | contact | /contacts/:id/merge | P ★ | **墓碑合并**（经理权限，traits 并集、子记录零改动）|
| 联系人 | contact | /contacts/:id/employments | G ★ | 就职/跳槽历史（N:M 含历史，`→架构B5`）|
| 联系人 | contact | /contacts/phone-change/apply | P ★ | **手机号变更申请**（审批通过后冻结 24h，`→需求§7.2`）|
| 关系 | relation | /relations | G/P | 业务关系列表/激活 |
| 关系 | relation | /relations/:id | G/U | 详情/改（含 urgency / value_tier）|
| 关系 | relation | /relations/:id/stage | P ★ | **推进阶段**（建议态+限频≥3天/跨里程碑+留痕）|
| 关系 | relation | /relations/:id/members | G/P/U/D | owner/collaborator/ask_help |
| 关系 | relation | /relations/:id/stage-log | G | 阶段推进留痕 |
| 关系 | relation | /relations/:id/labels | G/P/D | 关系级标注（风险/价值/协同）|
| 关系 | relation | /relations/:id/transfer | P | 转交（审批）|
| 关系 | relation | /relations/batch-transfer | P ★ | 离职**批量**转交（管理员发起）|
| 关系 | relation | /relations/:id/competition | U | 竞品态（事件回写快照）|
| 公海 | sea | /sea/company , /sea/department | G | 系统/部门公海 |
| 公海 | sea | /sea/company/:id/claim | P | 领取到私海（幂等）|
| 公海 | sea | /sea/records | G | 入公海历史 |
| 公海 | sea | /sea/manager-todo | G | 超期经理决策待办 |
| 公海 | sea | /sea/manager-decision | P | 保留/删除关系 |
| 公海 | sea | /sea/rules | G/U ★ | **公海规则 L1-L4 配置**（`→架构F1`；改掉海天数走 7 天缓冲）|
| 行动 | commitment | /relations/:id/commitments | G/P/U | 承诺（me/them/verdict）|
| 行动 | event | /relations/:id/events | G/P | 跟单事件流（近1月默认）|
| 行动 | event | /events/quick-mark | P | 快速标记（未联系/未接/说两句，落库不更新 last_event_at）|
| 行动 | cadence | /cadence-rules | G/U | 节奏规则 |
| 行动 | agenda | /today-agenda | G | 今日动线（每日组装）|
| 行动 | agenda | /today-agenda/:id/action | P ★ | **处理反馈** done/snoozed/ignored（防逃逸：snooze≤3、ignored 必填原因）|
| 预约 | appointment | /appointments | G/P/U | 预约 |
| 预约 | appointment | /appointments/:id/complete | P | 完成预约（强制生成跟单事件，否则 422）|
| 外出 | visit | /visits | G/P | 外出登记（出去：时间+去干什么+可选关联关系）|
| 外出 | visit | /visits/:id/return | P ★ | **回来点一下**（记 `actual_return_at`，纯行政不产生事件）|
| 合同 | contract | /contracts | G/P/U | 合同 |
| 合同 | contract | /contracts/:id/payments | G/P | 回款流水 |
| 合同 | contract | /contracts/:id/splits | G/P/U | 合同业绩分配（默认 signer100%）|
| 合同 | contract | /contracts/suspected-duplicates | G ★ | **疑似重复合同清单**（只检测、不合并，经理判定；`→需求§7.6`）|
| 工单 | workorder | /workorders | G/P/U | 工单（售后/商机双分类）|
| 工单 | workorder | /workorders/:id/convert | P ★ | 商机↔工单**双向流转**（`→需求§6.4`）|
| 台账 | ledger | /ledgers | G | 客户台账（JSON 扩展列）|
| 台账 | ledger | /ledgers/:id | G/U | 台账详情（动态表单）|
| 台账 | field | /product-lines/:id/field-templates | G/P/U | 字段模板（先登记后写）|
| 审批 | approval | /approvals/todo , /approvals/mine | G | 待我审批/我发起 |
| 审批 | approval | /approvals/:id/approve , /reject | P | 通过/驳回（驳回必填原因）|
| 审批 | approval | /phone-unlock/apply | P | 手机号解锁申请（L05）|
| 报表 | report | /reports/dashboard , /reports/sales , /reports/dept | G | 看板/个人日报/部门月报 |
| 报表 | report | /reports/company | G ★ | 全公司月报（总经理）|
| 报表 | report | /reports/sea | G ★ | 公海报表（停留/领取率/流失原因）|
| 报表 | report | /reports/renewal | G ★ | 续约预警（30/60/90 天）|
| 报表 | report | /reports/workorder-sla | G ★ | 工单 SLA（处理时长/超时率）|
| 报表 | report | /reports/death-reason | G ★ | **死因看板**（客户为什么不要我们）|
| 报表 | report | /reports/churn-reason | G ★ | 流失原因分布（被撬/到期未续/服务不满/疏忽）|
| 目标 | target | /targets | G/P/U | 月目标（个人/部门/公司）|
| 目标 | target | /targets/progress | G ★ | 目标进度（回款额主 + 并列签约额 + 时间已过 X%）|
| 通知 | notice | /notifications | G/U | 消息中心（已读，同类合并）|
| 复盘 | review | /relations/:id/review | P | 出口复盘 win/loss/churn |
| 复盘 | review | /reviews/win-library | G ★ | **赢单弹药库**（本部门可见，gm 可全公司）|
| 复盘 | review | /reviews/defense | G ★ | **防守清单**（哪个竞品在反挖）|
| 竞品 | competitor | /competitors | G/P/U ★ | **竞品名册**（经理维护，销售只读引用，`→需求§11.1`）|
| 文件 | file | /files/asset | P ★ | 上传拿 `file_key`（合同附件/回款凭证，`→架构B8`）|
| 文件 | file | /files/:id | G ★ | 预览/下载（带鉴权，不落 URL）|
| 系统 | system | /system/config | G/U ★ | 系统级配置（gm 可改，留痕，`→架构A12`）|
| 系统 | system | /operation-logs | G ★ | 操作留痕审计（经理+/管理员，`→架构A10`）|

> ★ = V1.1 对齐校正新增/补全方法（原目录遗漏，需求已定义）。接口总数 **~50 → ~78**。

---

## 四、分模块关键契约

> 每模块只列「最易错 / 已拍板」的硬约束；完整字段以 `→架构表Y` 为准。

### 4.1 认证 account
- `POST /account/login`：`{phone, password}` → `{access_token, refresh_token, user:{id,name,role,dept_id,managed_dept_ids[]}}`。
- `GET /account/me`：返回角色 + 管辖部门集合（前端据此渲染菜单/数据范围）；`managed_dept_ids` 空 = 非经理。

### 4.2 组织与权限 org / dict
- `GET /org/employees`：**服务端按 `managed_dept_ids` 收敛**（G7）；销售只能看同部门。
- `GET /org/product-lines`：返回 `color_key`（7 线固定配色，前端照渲染，`→需求§13.3`）。
- `GET /org/dept-rule`：返回 `drop_days` / `gray_remind_days` / `level_tiers` / `contact_trait_max`（默认3）/ `ask_help_days`（默认7）。

### 4.3 公司档案 company / 联系人 contact
- `POST /companies/search-dup`：入 `{phone?, credit_code?, name?}` → 返回相似候选（手机 UNIQUE 为主入口；公司名归一化去噪声词后比字号，`→需求§6.3`）。命中分支：公海可直领 / 跨部门可并行激活 / 本人别线可直建 / 挂现有公司 / **疑似重复必须给强行新建出口**（防乱填公司名）。
- `GET /companies/:id`：出参含 `profile_tags`（身份/制度/决策链，`→架构B2`）、`contacts[]`（非归属部门 `phone_masked`）、`relations_summary`（各业务线签约日期，跨线金额 `amount_masked`）。
- `PUT /contacts/:id/traits`：超过 `contact_trait_max` → **422 / 20402**；未配部门走默认3（`→需求§9` `→架构B4`）。

### 4.4 业务关系 relation（[核心]）
- `POST /relations`（激活）：`{company_id, dept_id, product_line_id}` → 唯一约束 `uk_active_rel(company_id,dept_id,product_line_id,owner_active)` 撞则 **409 / 20401**（引导转交/协同）。
- `GET /relations`：列表出参含 `stage`（彩色点）、`urgency`、`value_tier`、逾期标红、`drop_in_x_days`（24h 掉公海⚠）、竞争徽标、跨线 `amount_masked`。
- `GET /relations/:id/events`：默认 `range=1m`（近1月）；出参按 `created_by == 当前人` 分 `main` / `branch`（树杈），带 `createdByName` + `contactName`（`→需求§7.5` `→设计规范§八`）。
- `POST /relations/:id/transfer`：跨部门转交 = **双方上级双签**；上级缺失上溯经理/总经理（`→需求§7.9` `→架构G1`）。

### 4.5 公海 sea
- `POST /sea/company/:id/claim`：**幂等（2.5）**；领取即继承原 owner 全文跟单（`→需求§6.3`）。
- `GET /sea/company/:id`：未领时只返概览（近30天 N 次 + 最后跟进 + 卡哪步），**不返跟单全文**（防跨部门策略泄露，`→需求§4.1`）。
- `POST /sea/manager-decision`：超期由部门经理决策保留/删除（删除=逻辑删 `deleted_at` 留痕，不自动流转）。

### 4.6 行动引擎 commitment / event
- `POST /relations/:id/events`：完成预约触发的事件由服务端生成（前端完成预约即调 `appointment/:id/complete`）；`event_type` 含 `meal/gift/greeting`（客情，`→架构D2`）。
- `POST /events/quick-mark`：三型（未联系/未接/说两句），**落库、可批量、但不算有效跟进、不更新 `last_event_at`**（防点一下保号刷倒计时，`→需求§十六`第二批）。
- `POST /relations/:id/commitments`：`type` ∈ `me/them/verdict`；`them` 催客户、`verdict` 给结论；豁免必填原因（`→需求§10.1`）。

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

### 4.11 审批中心 approval（四型一单）
- 审批人默认 = 直属上级；跨部门转交 = 双方上级双签；缺失上溯（`→需求§7.9`）。
- `POST /phone-unlock/apply`：L05，经理批后限时全号（`→需求§13.2`）。
- 驳回必填 `reject_reason`（前端弹窗强制）。

### 4.12 报表 / 目标 report / target
- 经理报表**只被动聚合**事件流/回款/工单，**绝不要求销售确认处境**（`→需求§2` `→架构D7`）。
- `GET /targets`：完成进度按**回款额**算，并列显示签约额（`→需求§7.11`）。
- 离职后业绩：历史照常显示；「人均」只按当月在职人数算分母（`→需求§十六`第三批）。

### 4.13 通知 / 复盘 notice / review
- `GET /notifications`：Tab 全部/待办/审批/系统；已读未读；「去处理」跳对应页。
- `POST /relations/:id/review`：win 经理主导（草稿→批注→published 进弹药库）；loss **死因点选必填 422**（T2 唯一例外，文字次日缓写）；churn **经理必须亲自回访**（`→需求§11.2`）。

---

### 4.14 V1.1 补齐端点契约（对齐校正新增，★）

> 以下为 2026-09-11 三方对账后补齐的端点。业务规则见 `→需求§`，表结构见 `→架构表`。

**4.14.1 组织与权限（原只有 G，补 CRUD，`→需求§7.1`）**
- `POST/PUT/DELETE /org/departments`：部门增/改/**停用不删**（名称、上级、关联产品线、启用客服开关、状态）。
- `GET/POST/DELETE /org/departments/:id/managers`：部门经理**多对多**（`dept_manager`，决定经理查数范围 `→架构A3`）。
- `POST/PUT /org/employees`：员工入职 / 改主部门·兼部门·关联产品线·**直属经理（审批链）**；`status` ∈ `active`/`resigned`/`disabled`。**离职用 `resigned`，物理不删**（历史业绩照常显示）。
- `PUT /org/employees/:id/roles`：角色多选分配（`employee_role` `→架构A5`）。
- `POST /org/employees/:id/offboard`：**离职批量转交**——管理员发起，把该员工名下关系批量转交接任人，走 `relation_reassign` 审批（直接上级批 `→需求§7.9`）；幂等。
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
- `POST /relations/:id/stage`：入 `{to_stage, confirm?}`。**动作驱动 + 建议态**：服务端按事件给 `suggested_stage`，**绝不自动改**，须销售确认。**限频**：距上次变更 <3 天且非跨里程碑 → 不重复建议（`422 / 20402`）。允许跳级与回退，**每次写 `relation_stage_log`**（谁/何时/从哪到哪）。`cooperated`(6)、`churned`(7) 为终态。**推进零证据、经理不审核**（`→需求§8.1`）；**回退（rollback）触发经理 `notification`（`biz_type=stage_revert`，→架构 A9）——经理只知会、不审核、不拦截**，流程照走。

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
- 审批人：一般＝申请人**直属上级**；跨部门转交＝**双方上级双签**；上级缺失或本人即上级 → 上溯部门经理/总经理；离职批量转交＝管理员发起、直接上级批。

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
- `PUT /account/preferences`：个人主题（**`light` 白天 / `dark` 夜间**，V1 两态；A/B/C 风格后置）与通知偏好，**存账号**。

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
// 非归属部门手机号
{ "phone_masked": "****1234" }   // 不给 phone
// 公海未领取：不返跟单全文
{ "try_count_30d": 5, "last_summary": "客户说下周答复", "stuck_stage": 3 }
```
**派生字段（出参算、库不存）**：`old_customer`（有历史合同）、`address_maintained`（address 或坐标为空→false）、`drop_in_x_days`、`overdue`、`is_weekly`、`pay_progress`、`expire_level`、`stat_unit`（`relation`｜`company`）。

### 5.2 认证 account
- `POST /account/login` req `{phone,password}` → resp `{access_token,refresh_token,user:UserVO}`
- `GET /account/me` → `UserVO` ＝ `{id,name,role,dept:{id,name},managed_dept_ids:[],permissions:{"perm_key":"level"}}`
- `PUT /account/preferences` req `{theme:"light"|"dark",notif?:{...}}`

### 5.3 组织与权限 org / dict
- 部门 `{id,name,parent_id,service_enabled,status,manager_ids:[],product_line_ids:[]}`
- 员工 `{id,work_no,name,phone,primary_dept:{id,name},extra_depts:[],product_lines:[],direct_manager:{id,name},roles:["sale"],status}`
- `POST/PUT /org/employees` req `{name,phone,work_no?,primary_dept_id,extra_dept_ids?:[],product_line_ids?:[],direct_manager_id?,role_codes:[],password?}`
- 部门规则 `{dept_id,level_tiers:[{level,min_amount}],gray_remind_days,s_social_days,newbie_first_follow_hours,ask_help_days,contact_trait_max,updated_at}`
- 产品线 `{id,name,code,color_key,dept_ids:[],service_cycle_days,status}`
- 角色 `{code,name,is_builtin}`；权限矩阵行 `{perm_key,role_code,level}`
- 字典 `type:{code,name}`、`item:{id,item_code,label,sort,builtin,status}`

### 5.4 公司档案 company
- 列表项 `{id,full_name,city,industry_l1,scale,credit_code?,relation_count,old_customer,address_maintained,updated_at}`
- 详情 `{...company字段, completeness:{c1,c2,c3}, profile_tags:{identity:[{tag_id,tag_code,label}],policy:[],decision_chain:{tag_id,label}?}, contacts:[ContactBrief], relations_summary:[{dept,product_line:{id,name,color_key},sign_date,amount|amount_masked}]}`
- 建档/改 req `{full_name,industry_l1?,industry_l2?,province?,city?,district?,scale?,website?,address?,bank_name?,invoice_title?,tax_no?,credit_code?,longitude?,latitude?,aliases?:[]}`
- `POST /companies/:id/profile-tags` req `{group_code,tag_id}`
- `POST /companies/search-dup` req `{phone?,credit_code?,name?}` → resp `{candidates:[{id,full_name,credit_code_masked,similarity,match_type:"same"|"high_sim"}],suggest:"use_exists"|"create_new"}`
- `POST /companies/:id/merge` req `{loser_id,decision_chain_tag_id?}`（survivor＝路径 `:id`）
- `GET /companies/:id/contacts` → `[ContactBrief]`（含历史/已离职标记）

### 5.5 联系人 contact
- `ContactBrief` `{id,name,position?,phone|phone_masked,decision_role,is_current}`
- 详情 `{id,name,phone|phone_masked,extra_phones:[{type,number,note}],wechat,email,gender,birthday,decision_role,tags:[],traits:[{trait_id,trait_code,label}],status,employments:[{company_id,company_name,position,joined_at,left_at,is_current}]}`
- 建档/改 req `{name,phone,extra_phones?:[],wechat?,email?,gender?,birthday?,decision_role?,tags?:[],company_id?,position?}`
- `PUT /contacts/:id/traits` req `{trait_ids:[]}`（**上限校验只拦「新增」**：更新后数量 > 当前已有数量且超 `contact_trait_max` → **422/20402**；不增量则放行）
- `POST /contacts/:id/merge` req `{winner_id}`（经理权限）
- `GET /contacts/:id/employments` → 就职/跳槽历史（同上 employments 形态）
- `POST /contacts/phone-change/apply` req `{contact_id,new_phone}` → `approval_id`
- 建号/改号命中历史号 → 出参 `phone_history_hint:"曾属于 XX"`（**提示不拦截**）

### 5.6 业务关系 relation（核心）
- **列表项** `{id,company:{id,name},dept:{id,name},product_line:{id,name,color_key},stage:1-7,urgency,value_tier,customer_level,owner:{id,name},last_event_at,drop_in_x_days,overdue,competition,amount|amount_masked,old_customer,is_weekly}`
- **详情** ＝ 列表项 ＋ `{next_action_hint,sea_status,round_no（当前轮次号＝已掉海次数+1，派生不落表）,prev_round?:{round_no,owner:{id,name},dead_or_churn?:reason,dropped_at,claimed_at?,event_count},competitors:[{id,name,positioning}],labels:{risk:[{label_id,label_code,label}],other:[]},members:[{employee:{id,name},member_type:"owner"|"collaborator",source,valid_until?}],stage_logs:[{from_stage,to_stage,action,reason?,operator:{id,name},created_at}],try_count_30d}`
- `POST /relations`（激活）req `{company_id,dept_id,product_line_id}`（撞 `uk_active_rel` → **409/20401**）
- `PUT /relations/:id` req `{urgency?,value_tier?,next_action_hint?,competition?,competitor_id?}`
- `PUT /relations/:id/stage` req `{to_stage,confirm?:true}` → resp `{suggested_stage?,stage_log}`
- `POST/DELETE /relations/:id/members` req `{employee_id,member_type,source:"collaborate"|"ask_help",valid_until?}`
- `POST/DELETE /relations/:id/labels` req `{group_code,label_id}`
- `POST /relations/:id/transfer` req `{to_employee_id,reason?}`
- `POST /relations/batch-transfer` req `{from_employee_id,to_employee_id,relation_ids?:[]}`
- `PUT /relations/:id/competition` req `{competition,competitor_id?,competition_note?}`
- **历史轮次（P0-④⑤，`→需求§8.1` / `→架构 F2/D2`）**：`GET /relations/:id/rounds` → `{rounds:[RelationRound]}`，`RelationRound{round_no,owner:{id,name},sea_record:{relation_id,reason,dropped_at,claimed_at?},event_count,stage_logs?:[...]}`；`round_no` 由 `sea_record` 计数派生（一轮＝一次私海→掉回公海）。
- **重新领取级联（P0-④⑤）**：`POST /sea/company/:id/claim` 领取瞬间，该关系所有 **open 承诺 `owner_id` 转新 owner**（承诺随关系走，与转交口径一致，→需求§8.1）；领取后新建跟单的 `owner_snapshot` 取新 owner，前主人轮次跟单保留旧 `owner_snapshot` 供归组。

### 5.7 行动引擎 commitment / event / cadence / agenda
- **事件项（跟单卡）** `{id,action_type,summary,outcome,pain_point:{id,label}?,competition?,actor:{id,name},owner_snapshot?（本条创建时关系归属人，用于按轮次归组）,contact:{id,name}?,duration_min?,event_at,branch:"main"|"sub",round_no（派生：本条所属轮次）,attachments:[]}`（**P0-④⑤**：前端按 `round_no` 分组、轮次内按 `owner_snapshot` 归组——先看本轮 owner 主线/树杈，前主人轮次标姓名；`branch` 仍按 `actor_id` 与 owner 比较，→需求§7.5 / §8.1）
- `POST /relations/:id/events` req `{contact_id?,action_type,summary?,outcome?,stage_forward?,pain_point_id?,competition?,competitor_id?,competition_note?,duration_min?,mentioned_user_ids?:[],promise?:{party,ctype,content,due_at?},appointment_id?,visit_log_id?}`
- **待关联阶段事件（无关系，配合 需求§6.1 模型 B）**：`POST /contacts/:id/events` req 同 `POST /relations/:id/events`（省 `relation_id`，由服务端置空）；**关联公司激活关系后，服务端批量把该联系人名下 `relation_id` 为空的事件挂到新关系**（`→架构 D2` `→需求§10.2`）。
- `POST /events/quick-mark` req `{relation_ids?:[],contact_ids?:[],outcome:"not_contacted"|"no_answer"|"brief_hangup"}`（`relation_ids` 与 `contact_ids` **至少一组非空**；**不更新 `last_event_at`**）
- 承诺 `{id,relation_id,party:"me"|"them"|"verdict",ctype,content,due_at,remind_at,status,done_at?}`
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
- **签约校验（创建前）**：`POST /contracts` 先按 `sign_checklist`（本 `product_line_id`）逐项校验；缺失任一 → **422 / `20402` 类** + 响应 `{missing:[{scope,field_key,label,goto}]}`（`goto` = 内联补/跳补锚点，见 §5.15）；全部齐备才落库。

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
- **payload 分型**：`transfer{to_employee_id,reason?}`｜`collaborate{employee_id,valid_until?}`｜`phone_change{contact_id,old_phone,new_phone}`｜`phone_unlock{contact_id,relation_id?}`
- `POST /approvals/:id/approve` req `{comment?}`；`POST /approvals/:id/reject` req `{comment}`（**必填**）
- `POST /phone-unlock/apply` req `{contact_id,relation_id?}` → resp `{approval_id}`；批准后目标联系人出参带 `phone` 与 `unlocked_until`

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

---

## 六、跨模块关键流程（实现务必对齐）

1. **撞单**：激活 `uk_active_rel` 撞 → 409/20401 → 前端提示「已有归属」并给转交/协同入口；同部门显归属人、跨部门只说「已有其他部门跟进」不露名（`→需求§6.3`）。
2. **协同**：`collaborator`（审批通过，可带 `valid_until`）可共同写跟单+看全文；`ask_help`（轻量临时，默认7天自动收回，不授读权）——两码事（`→需求§13` `→架构C2`）。
3. **领取公海**：幂等 + 继承全文；部门公海 = 公司公海映射视图（非独立一层，`→需求§6.3`）。
4. **脱敏三处**：跨线金额 `amount_masked`、非归属手机 `phone_masked`、公海未领不返跟单全文（`→需求§4.3`）。
5. **解锁**：非归属手机 → `phone-unlock/apply`（L05）→ 批后限时全号，留痕 `operation_log`（不新增表）。

---

## 七、修改记录

> **★ 本档版本沿革不在文档内复述**（2026-09-12 决定 → 《废止口径登记表》#22）。
> **原因**：历史行会以「当时的规范口吻」存放已废止说法，与正文并存即构成 **AI 误读源**——AI 按关键词命中，读到旧行就照旧行写。
> **查法**：`git log --follow -- 需求规格/销售CRM接口API文档.md` 看完整沿革；`git show <commit>` 看某版改了什么。
