# 销售 CRM 接口 API 文档 V1.0

> 文档性质：四件套之三（①业务需求 ②数据架构 ③**接口 API** ④前端页面与交互）。
> 配套真相源：《销售CRM业务需求文档》V1.11（需求规格/）、《销售CRM数据架构文档》V1.14（需求规格/）。
> 生效日期：2026-09-10 ｜ 状态：V1.0 起步版（先锁约定 + 全量接口目录 + 关键契约，逐模块字段随开发回填）。

---

## 一、文档体系与铁律

### 1.1 与四件套的关系
- 本文件只定义「**怎么对话**」（REST 契约：路径 / 方法 / 入参 / 出参 / 错误码）。
- **业务规则**（谁、什么场景、什么校验）一律见 `→需求§X`；**表结构**（字段类型/索引/字典）一律见 `→架构表Y`。
- **同一事实只定义一次**（L1 单一事实源）：本文件不重复写业务规则原文，只写指针。

### 1.2 两条元铁律（L0 变更联动 / L1 单一事实源）
- **L0**：业务需求一改，本文件必须**同批**跟着改、同批升版；一次变更一张变更单，先改需求再改下游。
- **L1**：枚举值、错误码、脱敏口径在本文定义一次后，前端文档只写「见《接口 API 文档》§二」，不复制。

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
> 唯一冲突一律映射 **409（撞单/竞态/抢公海）或 422（业务校验）**，绝不直接透 MySQL 1062（`→架构§10.2` `→需求§十六`）。

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
  - 审批 `approval_type`：`transfer` / `collaborate` / `phone_unlock` / `review` / `relation_reassign`（四型一单，`→需求§7.9`）。
  - 数字/状态字典以 `dict_item` 为准（`→架构A11`）。

### 2.7 分页 / 排序 / 过滤
- 查询统一 `page`（默认1）/`page_size`（默认20，最大100）/`order_by`（字段）/ `desc`（bool）。
- 时间范围 `start_at` / `end_at`（ISO8601，Asia/Shanghai）。
- 模糊搜 `keyword`（公司名走 ngram 全文索引，`→架构§十`）。

### 2.8 脱敏规则（[铁律] G4/G5）
- **金额跨业务线**：响应返回 `amount: null` + `amount_masked: "***"`，仅露非金额信息（已合作 + 签约日期）。库内永远明文（`→需求§4.3` `→架构§十一`）。
- **手机号**：非归属部门联系人返回 `phone_masked: "****1234"`（后4位），`phone` 字段缺省；归属本人/协同返回全号。申请解锁走 `L05` 审批，批后限时（24h）可见全号（`→需求§13.2`）。

### 2.9 时间与时区
- 服务端统一 `Asia/Shanghai`；出入参 ISO8601（`2026-09-05T09:30:00+08:00`）。

### 2.10 文件上传（file_asset，[新增] `→架构B8`）
- 先 `POST /files/asset` 上传拿 `file_key`（存 key 不存 URL），再在业务接口传 `file_key`（如合同凭证 `payment_record.voucher_file_id`）。

### 2.11 版本与变更
- URL 含 `/v1`；破坏性变更升 `v2`。每次变更在 §六 留记录 + 同步业务需求修改记录。

---

## 三、接口总览（按域分组）

> 方法：G 查 / P 建 / U 改 / D 删（逻辑删为主，停用不删）。角色：S 销售 / M 经理 / B 老板 / A 全员。

| 域 | 分组 | 路径 | 方法 | 说明 |
|---|---|---|---|---|
| 认证 | account | /account/login | P | 登录 |
| 认证 | account | /account/refresh | P | 刷新 token |
| 认证 | account | /account/me | G | 当前人+角色+管辖部门 |
| 组织 | org | /org/departments | G | 部门树 |
| 组织 | org | /org/employees | G | 员工列表（按管辖收敛）|
| 组织 | org | /org/roles , /org/permissions | G | 角色/权限矩阵 |
| 组织 | org | /org/product-lines | G/U | 产品线（固定配色）|
| 组织 | org | /org/dept-rule | G/U | 部门规则（掉海天数/灰度提醒/等级档/特质上限）|
| 组织 | dict | /dict/types , /dict/items | G/U | 数据字典 |
| 公司 | company | /companies | G/P | 公司档案列表/建档 |
| 公司 | company | /companies/:id | G/U | 详情/改 |
| 公司 | company | /companies/:id/profile-tags | G/P/D | 公司档案标签（身份/制度/决策链）|
| 公司 | company | /companies/search-dup | P | 撞库查重（手机/信用代码/名相似）|
| 联系人 | contact | /contacts | G/P/U | 联系人 |
| 联系人 | contact | /contacts/:id/traits | U | 谈判特质（≤3，部门可配）|
| 关系 | relation | /relations | G/P | 业务关系列表/激活 |
| 关系 | relation | /relations/:id | G/U | 详情/改 |
| 关系 | relation | /relations/:id/members | G/P/U/D | owner/collaborator/ask_help |
| 关系 | relation | /relations/:id/stage-log | G | 阶段推进留痕 |
| 关系 | relation | /relations/:id/labels | G/P/D | 关系级标注（风险等）|
| 关系 | relation | /relations/:id/transfer | P | 转交（审批）|
| 关系 | relation | /relations/:id/competition | U | 竞品态（事件回写快照）|
| 公海 | sea | /sea/company , /sea/department | G | 系统/部门公海 |
| 公海 | sea | /sea/company/:id/claim | P | 领取到私海（幂等）|
| 公海 | sea | /sea/records | G | 入公海历史 |
| 公海 | sea | /sea/manager-todo | G | 超期经理决策待办 |
| 公海 | sea | /sea/manager-decision | P | 保留/删除关系 |
| 行动 | commitment | /relations/:id/commitments | G/P/U | 承诺（me/them/verdict）|
| 行动 | event | /relations/:id/events | G/P | 跟单事件流（近1月默认）|
| 行动 | event | /events/quick-mark | P | 快速标记（未联系/未接/说两句，落库不更新 last_event_at）|
| 行动 | cadence | /cadence-rules | G/U | 节奏规则 |
| 行动 | agenda | /today-agenda | G | 今日动线（每日组装）|
| 预约 | appointment | /appointments | G/P/U | 预约 |
| 预约 | appointment | /appointments/:id/complete | P | 完成预约（强制生成跟单事件，否则 422）|
| 外出 | visit | /visits | G/P | 外出登记（纯行政，不产生事件）|
| 合同 | contract | /contracts | G/P/U | 合同 |
| 合同 | contract | /contracts/:id/payments | G/P | 回款流水 |
| 合同 | contract | /contracts/:id/splits | G/P/U | 合同业绩分配（默认 signer100%）|
| 工单 | workorder | /workorders | G/P/U | 工单（售后/商机双分类）|
| 台账 | ledger | /ledgers | G | 客户台账（JSON 扩展列）|
| 台账 | ledger | /ledgers/:id | G/U | 台账详情（动态表单）|
| 台账 | field | /product-lines/:id/field-templates | G/P/U | 字段模板（先登记后写）|
| 审批 | approval | /approvals/todo , /approvals/mine | G | 待我审批/我发起 |
| 审批 | approval | /approvals/:id/approve , /reject | P | 通过/驳回（驳回必填原因）|
| 审批 | approval | /phone-unlock/apply | P | 手机号解锁申请（L05）|
| 报表 | report | /reports/dashboard , /reports/sales , /reports/dept | G | 看板/个人/部门 |
| 目标 | target | /targets | G/P/U | 月目标（个人/部门/公司）|
| 通知 | notice | /notifications | G/U | 消息中心（已读）|
| 复盘 | review | /relations/:id/review | P | 出口复盘 win/loss/churn |

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
- 签约校验：点「签合同」时按**本条业务线必填清单**卡（完善度百分比只展示不卡，`→需求§7.3` `→需求§十六`）。

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

## 五、跨模块关键流程（实现务必对齐）

1. **撞单**：激活 `uk_active_rel` 撞 → 409/20401 → 前端提示「已有归属」并给转交/协同入口；同部门显归属人、跨部门只说「已有其他部门跟进」不露名（`→需求§6.3`）。
2. **协同**：`collaborator`（审批通过，可带 `valid_until`）可共同写跟单+看全文；`ask_help`（轻量临时，默认7天自动收回，不授读权）——两码事（`→需求§13` `→架构C2`）。
3. **领取公海**：幂等 + 继承全文；部门公海 = 公司公海映射视图（非独立一层，`→需求§6.3`）。
4. **脱敏三处**：跨线金额 `amount_masked`、非归属手机 `phone_masked`、公海未领不返跟单全文（`→需求§4.3`）。
5. **解锁**：非归属手机 → `phone-unlock/apply`（L05）→ 批后限时全号，留痕 `operation_log`（不新增表）。

---

## 六、修改记录

| 版本 | 日期 | 说明 |
|---|---|---|
| V1.0 | 2026-09-10 | 起步版：锁通用约定 + 全量接口目录（约 50 接口）+ 分模块关键契约；逐接口字段随开发回填，业务规则以 `→需求` / `→架构` 指针为准 |
