# Phase 0 · 后端就绪度核查（M8-06）

> 方法论：生产级工程生命周期技能（Define→Plan）。本文件是 M8-06 计划的 **Phase 0 交付物**：7 高频页端点清单 + 缺口表。
> 真相源：接口文档 §五（端点定义）/ §2.4 / §5.16；前端交互文档 §五（29 页）；控制器 = `服务端/src/modules/**/*.controller.ts`（共 8 个）。
> 联动铁律 L0：缺口→「进 M8-06 补做」则必须同批升版接口/前端/需求文档，进同一 git 提交。

## 一、已实现路由清单（8 个 controller，均为空 `@Controller()` 前缀）

- **company（B 域）**：`GET /companies` · `POST /companies` · `POST /companies/search-dup` · `POST /contacts` · `GET /companies/:id/contacts`
- **org（A 域）**：`POST /account/login` · `POST /account/refresh` · `GET /account/me` · `PUT /account/preferences` · `GET /org/departments` · `GET /org/product-lines` · `GET /org/employees` · `GET /org/roles` · `GET /org/permissions`
- **company-aggregate（聚合层）**：`GET /companies/:id` · `GET /contacts` · `GET /contacts/:id`
- **engine（D 域）**：`GET /today-agenda` · `GET /relations/:id/events` · `POST /relations/:id/events` · `POST /contacts/:id/events` · `POST /events/quick-mark` · `POST /contacts/:id/activate-relation` · `GET /relations/:id/commitments` · `POST /relations/:id/commitments` · `PUT /relations/:id/commitments` ⚠ **无 `POST /today-agenda/:id/action`**
- **relation（C 域）**：`POST /relations` · `GET /relations/:id` · `PUT /relations/:id` · `GET /relations/:id/members` · `POST /relations/:id/members` ⚠ **无 `/stage` `/transfer` `/labels` `/competition` `/rounds`**（属 M4+ 里程碑，本批未建）
- **relation-aggregate（聚合层）**：`GET /relations`（含 `tab=private|sea`、带 `drop_in_x_days`）
- **trade（E 域）**：`POST /contracts` · `GET /contracts` · `GET /contracts/:id` · `PUT /contracts/:id`
- **sea（F 域）**：`GET /sea/rules` · `PUT /sea/rules` · `POST /sea/company/:id/claim` ✅ ⚠ **无 `GET /sea/company` `/sea/department` `/sea/records` `/sea/manager-todo` `/sea/company/:id` `/sea/manager-decision`**

## 二、7 页端点需求 + 缺口（✅ 已实现 / ❌ 缺失）

**① 数据看板 /dashboard**
- ❌ `GET /reports/dashboard`（4 KPI / 僵尸榜 / 预警 / 等级分布）
- ❌ `GET /targets/progress`（目标进度，需求 §7.11）
- ❌ `GET /sea/manager-todo`（公海超期决策待办，经理）
- ✅ `GET /account/me`（已登录态）

**② 工作台 /workbench**
- ✅ `GET /today-agenda`（主数据源；但**非实时**：依赖 M7 每日 05:00 组装，库无当日行即空数组 → A1 缺陷）
- ❌ `POST /today-agenda/:id/action`（done/snoozed/ignored 闭环）
- ❌ `POST /visits` · `POST /visits/:id/return`（外出登记 / 回来点一下）
- ✅ `POST /events/quick-mark` · `POST /relations/:id/events` · `POST /contacts/:id/events`（写跟进）

**③ 预约管理 /appointment/:tab**
- ❌ `GET /appointments`（4 Tab 列表 + `drop_in_x_days` 倒计时）
- ❌ `POST /appointments` · `PUT /appointments/:id`（建 / 改期）
- ❌ `POST /appointments/:id/complete`（完成强制生成跟单，否则 422）

**④ 业务关系列表 /relation/list**
- ✅ `GET /relations`（`tab`/`view`/`urgency` 筛选、分页、`drop_in_x_days`）
- ✅ `POST /events/quick-mark`（批量标记，仅私海）
- ✅ `PUT /relations/:id`（公海唯一可写 = `value_tier`）

**⑤ 业务关系详情 /relation/detail/:id**
- ✅ 基础：`GET /relations/:id` · `GET /relations/:id/events` · `POST /:id/events` · `commitments` 三态 · `members` · `activate-relation` · `POST /relations` · `GET /contracts`
- ❌ `POST /relations/:id/stage`（阶段推进 / 判死 / 流失）
- ❌ `POST /relations/:id/transfer`（转交）
- ❌ `POST/DELETE /relations/:id/labels`（标签区）
- ❌ `PUT /relations/:id/competition`（竞品区）
- ❌ `GET /relations/:id/rounds`（历史轮次）
- ❌ `GET /workorders` · `POST /relations/:id/review`（工单 / 复盘 Tab）

**⑥ 录入 /entry/new**
- ✅ `POST /companies`（只建公司）· `POST /companies/search-dup`（撞号）· `POST /contacts` · `activate-relation` · `POST /relations` · `GET /companies/:id` · `GET /org/product-lines` · `GET /org/departments`
- ⚠ 已知缺陷 A2/A3 在**字段/出参**层（非缺端点）：`CreateContactDto.phone` 必填无微信入口；`search-dup` 不回联系人 `id` → 走 Phase 2 修

**⑦ 系统公海 + 部门公海 /sea/company · /sea/department**
- ❌ `GET /sea/company` · `GET /sea/department`（列表；当前由 `GET /relations?tab=sea` 临时顶替，D-33④）
- ✅ `POST /sea/company/:id/claim`（领取）
- ❌ `GET /sea/company/:id`（未领详情全号预览 + 每次写 `operation_log`）
- ❌ `GET /sea/records`（入海历史）
- ❌ `GET /sea/manager-todo` · `POST /sea/manager-decision`（经理超期决策）
- ✅ `GET/PUT /sea/rules`（规则配置）

## 三、缺口表

> ⚠ **欠账路由**：下表「登记欠账」5 项均已并入《欠账登记表》既有条目，**不新增行**（遵循「编号不动、不重复登记」）：
> `stage/transfer/labels/competition/rounds` → **D-11**（详情缺字段）/ **D-22**（八 Tab 未建）；
> `workorders` / `review` → **D-22**；`approvals/todo` → **D-04**（审批域未建）；`notifications` → **D-41②** / **D-42**。

| 所属页 | 缺失端点 | 用途 | 模块 | 建议 |
|---|---|---|---|---|
| 数据看板 | `GET /reports/dashboard` | 4 KPI / 僵尸榜 / 预警 / 等级 | report | **进 M8-06**（计划点名） |
| 数据看板 | `GET /targets/progress` | 目标进度条（§7.11） | target | **进 M8-06**（计划点名） |
| 数据看板 | `GET /sea/manager-todo` | 公海超期决策待办 | sea | **进 M8-06**（计划点名） |
| 工作台 | `POST /today-agenda/:id/action` | 动线闭环 | engine | **进 M8-06**（工作台闭环必需） |
| 工作台 | `POST /visits` · `POST /visits/:id/return` | 外出登记 / 回来 | visit | **进 M8-06**（计划点名延伸） |
| 预约管理 | `GET/POST /appointments` · `PUT /appointments/:id` · `POST /:id/complete` | 预约 CRUD + 完成强制跟单 | appointment | **进 M8-06**（计划点名：预约 CRUD） |
| 公海 | `GET /sea/company` · `GET /sea/department` | 公海列表 | sea | **进 M8-06**（替代 `?tab=sea` 临时方案，D-33④） |
| 公海 | `GET /sea/company/:id` | 未领详情全号预览 | sea | **进 M8-06**（点开看号/拨号必需） |
| 公海 | `GET /sea/records` | 入海历史 | sea | **进 M8-06** |
| 公海 | `POST /sea/manager-decision` | 超期保留/删除决策 | sea | **进 M8-06**（计划点名） |
| 关系详情 | `POST /:id/stage` · `/transfer` · `/labels` · `PUT /:id/competition` · `GET /:id/rounds` | 阶段/转交/标签/竞品/轮次 | relation | **待拍板**（属 M4+ 里程碑；但 关系详情是 7 高频页之一，Phase 3 含判死/流失） |
| 关系详情 | `GET /workorders` · `POST /:id/review` | 工单 / 复盘 Tab | workorder/review | **登记欠账**（独立模块未建） |
| 跨页 | `GET /approvals/todo` | 需我决策聚合卡 | approval | **登记欠账**（审批模块未建） |
| 跨页 | `GET /notifications` | 消息中心 | notification | **登记欠账**（通知模块未建） |
| 工作台(A1) | `GET /today-agenda` 实时兜底 | 当日无 `daily_agenda` 行时按活数据算 | engine | **待拍板**（实时兜底 vs 做 M7 定时组装，计划 §6） |

**已核验「不缺」**：公海领取 `POST /sea/company/:id/claim` ✅；录入页 6 端点 ✅；`GET /relations`、`quick-mark`、`commitments` 三态、`members`、`contracts`、`activate-relation`、公海规则 ✅。

## 四、结论

后端缺口**集中在 5 个未建控制器模块**：`report` / `target` / `appointment` / `visit` / `sea`（列表·决策·历史），以及 `relation` 详情侧的 M4+ 端点。**计划点名的「看板 4KPI、目标进度、僵尸榜、公海决策待办、预约 CRUD、公海领取」均确属缺口**（公海领取已完工属例外）。

**阻塞判定**：上述缺口会直接阻塞 ——
- Phase 2：关系详情的 stage/transfer/labels/competition/rounds 不可用（若拍板「关系详情纳入 M8-06」则必补）；A1 取决于 today-agenda 兜底拍板。
- Phase 4（看板）：dashboard / targets/progress / sea.manager-todo 全缺 → **硬阻塞**。
- Phase 5（预约）：appointments 全缺 → **硬阻塞**。
- Phase 6（公海）：sea 列表/详情/历史/决策全缺 → **硬阻塞**。

## 五、待拍板（四要素 · ✅ P0-①②③ 已拍板 2026-09-28）

> ① 关系详情 M4+ 端点 → 登记欠账（并入 D-11/D-22，不新增行）；② A1 → 实时兜底；③ 进 M8-06 端点 → 拆入 M8-06 计划 Phase 1~6 任务卡，实现时同批升版接口/前端/需求文档（铁律 L0）。

| 项 | 谁 | 干什么 | 建议 | 影响范围 |
|---|---|---|---|---|
| **P0-① 关系详情 M4+ 端点去留** | 七叔 | 关系详情是 7 高频页之一，Phase 3 含判死/流失，但 `stage/transfer/labels/competition/rounds` 属 M4+ 里程碑未建 | 本期只做「能跑通的 Tab」，M4+ 端点**登记欠账**，Phase 3 不强行依赖判死/流失 | 关系详情页 8 Tab 可用性；决定 M8-06 是否触碰 relation 域 |
| **P0-② A1 修法** | 后端 engine | `GET /today-agenda` 实时兜底 vs 做 M7 定时组装 | 实时兜底（快、立即可用），M7 仍排期 | engine.service；工作台 A1 缺陷 |
| **P0-③ 缺口落账** | 全栈 | 上表「登记欠账」5 项（workorders/review/approvals/notifications + M4+ 端点）写入《欠账登记表》；「进 M8-06」项在 Phase 1~6 实现时同批升版接口/前端/需求文档 | 采纳（铁律 L0） | 版本沿革、欠账台账 |

**请确认 P0-①/②/③ 后，我开始把「进 M8-06」端点拆进 Phase 1~6 的任务卡并同批升版文档。**
