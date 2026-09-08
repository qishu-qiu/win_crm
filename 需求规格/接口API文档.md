# 销售 CRM 系统 —— 前后端接口 API 文档（V1.4）

---

## 一、文档信息

| 项目 | 内容 |
|---|---|
| 文档名称 | 销售 CRM 前后端接口 API 文档 |
| 版本 / 日期 | **V1.4** / 2026-09-08 |
| 编写人 / 审核人 | 产品组 / 前后端负责人（联调评审会签） |
| 受众 | 前端工程师、后端工程师、测试工程师 |
| 上游文档 | 《前端页面开发需求文档.md **V2.6**》（调用清单 + 页面×操作×接口映射）、《数据库设计文档.md **V1.2**》（字段与表）、《销售CRM开发需求.md V2.1》（业务规则） |
| 一致性承诺 | 本文档是**前后端唯一契约**：路径、字段名、类型、枚举、错误码以本文档为准；三方文档冲突时的优先级为 **业务规则 V2.1 > 本文档 > 前端需求文档 > 数据库文档** |

### 修改记录

| 版本 | 日期 | 修改内容 | 修改人 |
|---|---|---|---|
| V1.0 | 2026-09-05 | 首版：70 个接口，覆盖 A~O 共 15 组 | 产品组 |
| V1.1 | 2026-09-05 | **全页面操作对齐补漏**：① 新增 P 组「通用与支撑」（下拉数据源/操作日志/导出/埋点）、外出记录列表、当前外出中状态、录入预览、关系联系人、合同维护人变更、联系人删除、工作流阶段排序等端点；② 补齐 20 处缺失入参出参（`relationId` `companyId` `expiring` `stageList` 等，详见 4.3 缺口修复清单）；③ 消除字段模板**双真相源**（统一为 K03~K06，`/org/product-lines` 不再返回模板）；④ 字典类型清单补全；⑤ 新增 4.2 节「页面 × 操作 × 接口」反向索引，并新增 4.3 节缺口修复清单。**计数口径变更**：V1.0 标称 70 为路径合并口径，本版拆开合并行、改为**端点编号口径，总表共 99 个端点**，便于逐条追溯与联调打勾 | 产品组 |
| V1.2 | 2026-09-05 | **框架与标签体系补漏（+9，共 108）**：① 新增 P07/P08 消息通知（列表含未读数、标记已读，`channel` 预留微信/企微）、P09/P10 个人快捷入口读写（≤6，`action` 支持 `dialog:` 直接开弹窗）；② 新增 **E09/E10 客户标签读写**（`source=manual/auto`，自动标签不回传，focus 单选、`play`≤2 服务端校验）；③ 新增 O14~O16 标签字典与自动标签规则；④ 新增业务子码 `20401`（注意力非单选）、`20402`（打法特征超 2 个）；⑤ 明确"本周重点"降级由服务端定时任务执行，前端不做本地修正 | 产品组 |
| V1.3 | 2026-09-07 | **意向跟进体系（七轮定稿）对齐**：① E09/E10 语义重定义——从四维标签改为**跟进设置**（紧迫档单选 + 业务线价值 + 协同；风险=自动为主+人工可补，自动项只读），业务子码 `20401`（紧迫缺失/非单选）、`20402`（谈判特质超 3 个）随新语义重定义；② E06 阶段接口扩展**跳级/回退/异议无解双出路**（回退或判流失留痕）；③ 新增 G09/G10 **公司档案标签**（身份/制度/决策链，建档勾一次全公司共享，留痕打标人）、G11/G12 **联系人谈判特质**（价格敏感/关系型/方案型…，跟着人走换公司保留）；④ 新增 N12 **部门规则**（客户等级金额档位 A/B/C/D 阈值、灰度寿命 N/M 提醒与公海释放），部门经理级配置；⑤ 字典类型清单补充（urgency/value_level/company_identity_tag/company_policy_tag/decision_chain/contact_trait）。**总表端点计数校正**：历史记录行的 99/108 沿用路径合并口径、未含全部 CRUD 拆分行；本版按编号逐行实数为 **119**（本版新增 G09~G12、N12 共 +5） | 产品组 |
| V1.4 | 2026-09-08 | **协同共同跟进 + 跟单可见性 + 手机号解锁对齐（七叔裁决，对上游 V2.1/DB V1.2/前端 V2.6）**：① **协同语义升级**——E05 申请协同落成 `collaborator`（共同跟进，可共同写跟单，非只读），E02 返回关系成员列表增 `collaborators[]`（含有效截止）；② C02/B05 出参增 **`createdByName`/`contactName`**（跟单记录显示填单人+联系人）；③ C02 增加 `viewScope=overview`：公海客户仅返回"近 30 天跟进 N 次"概览而非全文；④ 新增 **`approval.type=phone_unlock`**（审批五型）与 **L05** 端点，用于非归属部门联系人"一键申请解锁"全号；⑤ E02 增 `phoneViewable`/`canCollaborate`。**总表端点计数**：119 → **120**（本版 +L05） | 产品组 |

---

## 二、通用约定（联调前必读）

### 2.1 请求

| 项 | 约定 |
|---|---|
| Base URL | `https://{host}/api/v1`（环境：dev / test / prod） |
| 协议 | HTTPS；JSON（`Content-Type: application/json`）；文件上传 `multipart/form-data` |
| 鉴权 | 登录后 `Authorization: Bearer {token}`；token 有效期 8 小时，静默刷新走 `/auth/profile` 401 后重登 |
| 幂等 | 写操作（跟单、创建合同、新增预约、领取公海、审批处理）请求头带 `Idempotency-Key: {uuid}`，服务端 24h 内同 Key 直接返回首次结果 |
| 时区 | 全部时间 `Asia/Shanghai`，格式 `YYYY-MM-DD HH:mm:ss`；纯日期 `YYYY-MM-DD` |
| 金额 | 数据库 `DECIMAL(12,2)`，接口返回**数字**（如 `120000.00`），千分位由前端格式化；脱敏时返回 `null` + `masked:true` |
| 枚举 | 一律返回**英文码**（如 `intent`），中文文案由前端通过 `/dict/{type}` 映射；字典随登录预加载并缓存 |
| 数据范围 | **服务端按登录者管辖部门强制过滤**，前端传 `deptIds` 只是体验层筛选；越权传参一律按管辖范围取交集，不报错但结果收敛 |

### 2.2 响应信封

```json
{
  "code": 0,
  "message": "success",
  "data": { },
  "traceId": "a1b2c3d4"
}
```

| 字段 | 说明 |
|---|---|
| code | `0` 成功；非 0 见第五章错误码表 |
| message | 用户可读提示；422 时 `data.errors` 携带字段级错误 |
| data | 业务数据；分页统一为 `{ list, total, page, pageSize }` |
| traceId | 链路 ID，联调报错时前端必须上报 |

### 2.3 分页与排序

| 参数 | 默认 | 说明 |
|---|---|---|
| page / pageSize | 1 / 20 | 可选 20/50/100；台账与公海为 24 |
| sort | — | 格式 `field:asc|desc`，如 `next_follow_at:asc`；仅文档标注"可排序"的字段生效，其余忽略 |

响应：
```json
{ "list": [], "total": 137, "page": 1, "pageSize": 20 }
```

### 2.4 脱敏约定（服务端实现，前端只渲染）

```json
"amount": null, "amountMasked": true
```
前端遇到 `xxxMasked: true` 一律渲染 `*** 🔒`。**库中永远明文存储**，脱敏只在出参层做，保证归属方可用。

### 2.5 并发与版本

写操作可选带 `version`（= 记录 `updatedAt` 时间戳）。服务端校验不一致返回 `409` + `data.current`，前端提示"数据已被他人修改，请刷新"。

---

## 三、错误码体系

| code | HTTP | 含义 | 前端标准处理 |
|---|---|---|---|
| 0 | 200 | 成功 | — |
| 401 | 401 | 未登录 / token 失效 | 清 token 跳 /login |
| 403 | 403 | 无权限（越权访问） | /403 占位页或按钮级禁用 |
| 404 | 404 | 资源不存在 | /404 占位页 |
| 409 | 409 | **业务冲突**（激活竞态、数据被改） | 弹窗展示冲突详情，不跳页 |
| 410 | 410 | 资源已失效（客户已掉公海） | "该客户已入公海，请重新领取" |
| 422 | 422 | 参数校验失败 | 字段级红字，定位首个错误 |
| 429 | 429 | 请求频繁 | "操作过于频繁，请稍后" |
| 500 | 500 | 服务端异常 | Message + 重试；连续失败跳 /500 |

**业务子码**（`code` 细分，HTTP 仍为 200/409/422）：

| code | 场景 | data |
|---|---|---|
| 10101 | 登录失败 | — |
| 10102 | 连续 5 次错误，锁定 10 分钟 | `lockedUntil` |
| 20101 | 手机号已存在 | `contactId, companyName, ownerName` |
| 20102 | 公司相似候选 | `candidates[{companyId, name, similarity, exactMatch}]` |
| 20103 | 统一社会信用代码已存在 | `companyId, companyName` |
| 20104 | 联系人存在关联业务/合同，不可删除 | `refCount` |
| 20201 | 业务关系已被他人激活 | `ownerName, ownerDept` |
| 20202 | 公司档案完善度不足 | `missingFields[]` |
| 20301 | 客户已掉公海 | — |
| 20401 | 紧迫档缺失/非单选（**V1.3 重定义**，原"注意力非单选"随四维标签废弃） | — |
| 20402 | 谈判特质超过 3 个（**V1.3 重定义**，原"打法特征超 2 个"随四维标签废弃） | — |
| 30101 | 台账含未登记字段 Key | `illegalKeys[]` |
| 30201 | 字段被引用不可删除 | `refCount` |

> 注：HTTP 状态码与 `code` 保持一致，便于前端拦截器统一处理；业务子码用于弹窗分支。

---

## 四、接口清单总表（120 个端点）

> 计数口径：一个「方法 + 路径」= 1 个端点，按编号逐行计数（A01~P10，含 V1.2/V1.3/V1.4 新增行），联调按本表打勾。N/O 组的 CRUD 按端点拆分，便于逐条追溯。

| 编号 | 方法 | 路径 | 说明 |
|---|---|---|---|
| A01 | POST | /auth/login | 登录 |
| A02 | GET | /auth/profile | 当前用户+角色+管辖部门 |
| A03 | POST | /auth/logout | 登出 |
| A04 | GET | /notification/list | 通知列表+未读数 |
| A05 | PUT | /notification/read | 标记已读 |
| A06 | GET | /dict/{type} | 字典枚举 |
| A07 | GET | /dict/types | 字典类型清单 |
| A08 | POST | /file/upload | 文件上传 |
| A09 | POST | /track/report | 埋点上报（PV/点击，批量） |
| B01 | GET | /dashboard/summary | KPI 汇总 |
| B02 | GET | /dashboard/today-follow | 今日待跟进 |
| B03 | GET | /dashboard/distribution | 状态分布 |
| B04 | GET | /dashboard/alerts | 活跃预警 |
| B05 | GET | /workbench/today-records | 今日跟单记录 |
| B06 | GET | /workbench/today-appointments | 今日新建预约 |
| B07 | GET | /visit/current | 当前外出中记录（工作台状态条 + 归来入口） |
| C01 | POST | /follow/create | 写跟单 |
| C02 | GET | /follow/list | 跟单时间轴 |
| C03 | PUT | /follow/{id} | 编辑跟单（仅本人当日） |
| C04 | GET | /appointment/list | 预约四 Tab |
| C05 | POST | /appointment/create | 新增预约 |
| C06 | POST | /appointment/reschedule | 改期 |
| C07 | POST | /appointment/complete | 完成预约（强制关联跟单） |
| C08 | POST | /visit/create | 外出登记 |
| C09 | POST | /visit/finish | 外出归来 |
| C10 | GET | /visit/list | 外出登记记录（对账/报销关联） |
| D01 | POST | /entry/create | 录入联系人/公司 |
| D02 | GET | /contact/check-phone | 手机号查重 |
| D03 | POST | /company/match | 公司相似度匹配 + 信用代码强匹配 |
| D04 | POST | /entry/preview | 录入确认页完善度预览 |
| E01 | GET | /relation/list | 业务关系列表 |
| E02 | GET | /relation/detail/{id} | 业务关系详情 |
| E03 | POST | /relation/activate | 激活业务线 |
| E04 | POST | /relation/transfer | 转交 |
| E05 | POST | /relation/collaborate-apply | 申请协同 |
| E06 | PUT | /relation/{id}/stage | 阶段推进（支持跳级/回退/异议双出路，留痕） |
| E07 | POST | /relation/{id}/lost | 标记流失 |
| E08 | GET | /relation/{id}/contacts | 关系网联系人（含离职标记/就职历史） |
| F01 | GET | /sea/company/list | 系统公海 |
| F02 | GET | /sea/department/list | 部门公海 |
| F03 | POST | /sea/claim | 领取到私海 |
| G01 | GET | /company/list | 公司档案列表 |
| G02 | GET | /company/detail/{id} | 公司档案详情 |
| G03 | POST | /company/save | 公司档案保存/补全 |
| G04 | GET | /contact/list | 联系人档案列表 |
| G05 | GET | /contact/detail/{id} | 联系人详情 |
| G06 | POST | /contact/{id}/change-phone | 手机号变更申请 |
| G07 | PUT | /contact/{id} | 编辑联系人（手机号除外） |
| G08 | DELETE | /contact/{id} | 删除联系人（仅经理） |
| G09 | GET | /company/{id}/profile-tags | 公司档案标签读取（身份/制度/决策链+打标人） |
| G10 | PUT | /company/{id}/profile-tags | 公司档案标签保存（建档勾一次，全公司共享） |
| G11 | GET | /contact/{id}/traits | 联系人谈判特质读取（含打标人） |
| G12 | PUT | /contact/{id}/traits | 联系人谈判特质保存（≤3，留痕） |
| H01 | GET | /search/advanced | 高级搜索 |
| I01 | GET | /contract/list | 合同列表 |
| I02 | GET | /contract/detail/{id} | 合同详情 |
| I03 | POST | /contract/create | 创建合同 |
| I04 | POST | /contract/{id}/payment | 添加回款 |
| I05 | PUT | /contract/{id}/maintainer | 变更维护人 |
| J01 | GET | /workorder/list | 工单列表 |
| J02 | GET | /workorder/detail/{id} | 工单详情 |
| J03 | POST | /workorder/create | 创建工单 |
| J04 | POST | /workorder/{id}/upgrade | 工单升级 |
| J05 | POST | /workorder/{id}/action | 开始处理/关闭 |
| K01 | GET | /ledger/list | 台账列表（含字段模板） |
| K02 | POST | /ledger/save | 台账保存（扩展字段 JSON） |
| K03 | GET | /ledger/fields | 字段模板列表 |
| K04 | POST | /ledger/fields | 登记新字段 |
| K05 | PUT | /ledger/fields/{id} | 改字段（不含 key/类型） |
| K06 | PUT | /ledger/fields/{id}/disable | 停用字段 |
| L01 | GET | /approval/todo | 待我审批 |
| L02 | GET | /approval/mine | 我发起的 |
| L03 | POST | /approval/handle | 审批处理 |
| L04 | POST | /approval/reimburse | 报销登记 |
| L05 | POST | /approval/phone-unlock | 申请解锁联系人全号（V1.4） |
| M01 | GET | /report/overview | 综合概览 |
| M02 | GET | /report/funnel | 业务流转漏斗 |
| M03 | GET | /report/sea | 公海报表 |
| M04 | GET | /report/renewal | 续约预警 |
| M05 | GET | /report/sla | SLA 报表 |
| N01 | GET | /org/employees | 员工列表 |
| N02 | POST | /org/employees | 新增员工 |
| N03 | PUT | /org/employees/{id} | 编辑员工 |
| N04 | PUT | /org/employees/{id}/status | 停用/启用 |
| N05 | GET/POST/PUT | /org/departments[/{id}] | 部门 CRUD |
| N06 | GET | /org/product-lines | 产品线列表 |
| N07 | POST | /org/product-lines | 新增产品线 |
| N08 | PUT | /org/product-lines/{id} | 编辑产品线 |
| N09 | GET | /org/roles | 角色列表（V1 内置 6） |
| N10 | GET | /org/permission-matrix | 权限矩阵读取 |
| N12 | GET/PUT | /org/departments/{id}/rules | 部门规则（等级档位/灰度寿命，经理级） |
| N11 | PUT | /org/permission-matrix | 权限矩阵单元格写入 |
| O01 | GET | /setting/sea-rules | 公海规则列表 |
| O02 | POST | /setting/sea-rules | 新建规则 |
| O03 | PUT | /setting/sea-rules/{id} | 编辑规则 |
| O04 | GET | /setting/sea-rules/resolve | 规则命中解析（演示 L4→L1） |
| O05 | GET | /setting/workflow-stages | 阶段列表（按部门×产品线） |
| O06 | POST | /setting/workflow-stages | 新增阶段 |
| O07 | PUT | /setting/workflow-stages/{id} | 改名/改属性 |
| O08 | DELETE | /setting/workflow-stages/{id} | 删除阶段（被引用返回 30201） |
| O09 | PUT | /setting/workflow-stages/sort | **阶段拖拽排序**（批量提交 ids 顺序） |
| O10 | GET | /setting/dicts | 字典类型+选项 |
| O11 | POST | /setting/dicts/{id}/options | 新增选项 |
| O12 | PUT | /setting/dicts/options/{id} | 编辑选项 |
| O13 | PUT | /setting/dicts/options/{id}/disable | 停用选项（内置不可删） |
| P01 | GET | /operation/logs | 操作日志查询 |
| P02 | POST | /export/task | 创建导出任务（V2） |
| P03 | GET | /export/task/{id} | 导出任务状态/下载 |
| P04 | GET | /common/options/departments | **管辖部门下拉**（全局复用） |
| P05 | GET | /common/options/users | **成员下拉**（按部门，全局复用） |
| P06 | GET | /common/options/product-lines | **产品线下拉**（全局复用） |
| P07 | GET | /notification/list | 消息通知列表（含未读数） |
| P08 | PUT | /notification/read | 标记已读（单条/全部） |
| P09 | GET | /profile/quick-entries | 个人快捷入口（含可选库） |
| P10 | PUT | /profile/quick-entries | 保存快捷入口（≤6） |
| E09 | GET | /relation/{id}/follow-setup | 跟进设置读取（紧迫+价值+协同+风险只读） |
| E10 | PUT | /relation/{id}/follow-setup | 跟进设置保存（紧迫单选/价值/协同） |
| O14 | GET | /setting/tags?type= | 标签/特质选项字典（分 type：company_identity_tag / company_policy_tag / decision_chain / contact_trait） |
| O15 | POST/PUT | /setting/tags[/{id}] | 标签/特质选项新增/编辑/停用 |
| O16 | GET/PUT | /setting/tag-auto-rules[/{id}] | 风险自动标签规则读写（超管启停） |

---

### 4.2 页面 × 操作 × 接口 反向索引

> 用途：前端按页面逐按钮取接口，后端按此表自查是否每个前端动作都有契约。**凡此表中标「—」的单元格，即属于前端有按钮、后端无接口的缺口，禁止出现。**

**页面 1 登录 /login**

| 操作 | 接口 |
|---|---|
| 登录提交 | A01 |
| 登录成功后注入全局（角色/权限/管辖部门） | A02 |
| 字典预加载缓存 | A07 → A06 |

**页面 2 数据看板 /dashboard**

| 操作 | 接口 |
|---|---|
| 消息铃铛未读数 | A04（标记已读 A05） |
| KPI ×4 | B01 |
| 今日待跟进列表 → 点"写跟进" | B02 → C01 |
| 状态环形图 + 洞察 | B03 |
| 活跃预警 ×3 → 点击跳转 | B04 → I01 `expiring=30` / E01 `view=overdue` / J01 `type=opportunity` |

**页面 3 工作台 /workbench**

| 操作 | 接口 |
|---|---|
| 快捷卡①填写跟单记录（D1） | C01（编辑 C03） |
| 快捷卡②新增预约（D2） | C05（改期 C06） |
| 快捷卡③外出登记（D3） | C08 |
| **外出归来（D4）** | **C09**（可发起报销 L04） |
| 快捷卡④录入客户 | 跳 /entry/new → D02/D03/D01 |
| 今日跟单记录列表 | B05（附件 A08） |
| 今日新建预约列表 | B06 → E02 |

**页面 4 预约管理 /appointment/:tab**

| 操作 | 接口 |
|---|---|
| 四 Tab 列表 | C04 |
| 写跟进 | C01 |
| 改期（D2 预填） | C06 |
| 完成预约（强制留跟单） | C07 |
| 查看详情 | E02 |

**页面 5 业务关系列表 /relation/list**

| 操作 | 接口 |
|---|---|
| 列表 + 5 快捷视图 | E01 |
| 筛选下拉（部门/产品线/销售/维护人） | **P04 / P06 / P05 / P05** |
| 行：标签列"＋"打开跟进设置（D18） | **E09 / E10** |
| 行：详情 | E02 |
| 行：写跟进 | C01 |
| 行：更多→转交（D7） | E04 |
| 行：更多→创建合同 | I03 |
| 行：更多→创建工单（D11） | J03 |

**页面 6 业务关系详情 /relation/detail/:id**

| 操作 | 接口 |
|---|---|
| 顶部信息卡 + 权限码 | E02 |
| 写跟进 / 新增预约 | C01 / C05 |
| 激活业务线（D6） | E03 |
| 转交（D7）/ 申请协同（D8） | E04 / E05 |
| 创建合同（完善度不足禁用） | I03（前置 G02 校验 20202） |
| 创建工单 / **创建商机** | J03（`type=opportunity` 即商机） |
| 工作流推进 / **标记流失（D12）** | E06 / E07 |
| 详情标签区"＋"打开跟进设置（D18） | **E09 / E10** |
| Tab 跟单记录 | C02 |
| Tab 合同信息 | I01 `relationId` |
| Tab 工单 | J01 `relationId` |
| Tab 关系网联系人 | **E08** |
| Tab 基础信息（公司完善度 + 同公司其他关系） | G02 + E02 |

**页面 7 录入 /entry/new**

| 操作 | 接口 |
|---|---|
| 手机号失焦查重（D10） | D02 |
| 公司名相似度匹配（D9） | D03 |
| 第三步确认页完善度预览 | **D04** |
| 提交 | D01 |
| 成功后"立即激活业务关系" | E03 |

**页面 8 高级搜索 /search/advanced**

| 操作 | 接口 |
|---|---|
| 部门筛选器（仅管辖部门） | P04（服务端取交集） |
| 成员下拉（按部门） | P05 |
| 结果列表 | H01 |
| 查看详情 | E02 |

**页面 9/10 公海**

| 操作 | 接口 |
|---|---|
| 系统/部门公海卡片流 | F01 / F02 |
| 筛选下拉 | P06 |
| 查看详情 | E02 |
| 领取到私海（D5） | F03（冲突→E05/E04） |

**页面 11~13 公司档案**

| 操作 | 接口 |
|---|---|
| 列表（相似度提示） | G01 + D03 |
| 详情 4 Tab | G02（关系 E01 `companyId` / 联系人 G04 `companyId` / 跟单聚合 C02 `companyId`） |
| 补全保存（信用代码唯一性） | G03 + **D03（creditCode 强匹配）** |
| 建档/详情「公司档案」标签组（身份/制度/决策链+打标人） | **G09 / G10** |

**页面 14/15 联系人档案**

| 操作 | 接口 |
|---|---|
| 卡片列表 | G04 |
| 详情（就职历史/变更历史/关系网络） | G05 |
| 编辑姓名/邮箱/微信 | G07 |
| 手机号变更（D14） | G06 |
| 删除（仅经理） | **G08** |
| 详情「谈判特质」结构化多选（≤3，跟着人走） | **G11 / G12** |

**页面 16~18 合同管理**

| 操作 | 接口 |
|---|---|
| 列表 | I01 |
| 创建（前置完善度校验） | I03 + G02 |
| 详情 4 KPI / 付款流水 | I02 |
| 添加回款（D16） | I04 |
| 变更维护人（D17） | **I05** |
| 签单人下拉 | P05 |

**页面 19/20 工单管理**

| 操作 | 接口 |
|---|---|
| 列表 | J01 |
| 新建工单（D11） | J03 |
| 详情 + SLA + 阶段流 | J02 |
| 开始处理 / 分派 / 客户确认 / 关闭 | **J05**（`action=start/assign/confirm/close`） |
| 升级（售后↔商机） | J04 |
| 处理人下拉 | P05 |

**页面 21 客户台账 /delivery/ledger**

| 操作 | 接口 |
|---|---|
| 列表（通用列 + 字段模板动态扩展列） | K01 |
| 行点击抽屉 → 保存 | K02 |
| 字段模板读取（产品线管理页编辑器） | K03 |
| 字段登记 / 改 / 停用 | K04 / K05 / K06 |

**页面 22 审批中心 /approval/center**

| 操作 | 接口 |
|---|---|
| 待我审批 / 我发起的 | L01 / L02 |
| 通过 / 驳回（D13） | L03 |
| 报销登记（D15） | L04（关联 C10 外出记录） |

**页面 23 报表分析**

| 操作 | 接口 |
|---|---|
| 5 Tab | M01 / M02 / M03 / M04 / M05 |
| 下钻（部门×产品线） | 入参 `deptIds` + `productLineId` |
| 导出 Excel（V2） | P02 → P03 |

**页面 24 组织架构**

| 操作 | 接口 |
|---|---|
| 员工 CRUD + 停用/启用 | N01 / N02 / N03 / N04 |
| 部门 CRUD | N05 |
| 产品线 CRUD（**不返回字段模板**） | N06 / N07 / N08 |
| 角色列表 | N09 |
| 权限矩阵读 / 单元格写 | N10 / N11 |
| 部门卡片「部门规则」入口（等级档位/灰度寿命） | **N12** |

**页面 25 系统设置**

| 操作 | 接口 |
|---|---|
| 公海规则 CRUD + 命中解析 | O01 / O02 / O03 / O04 |
| 工作流阶段查/增/改/删/**排序** | O05 / O06 / O07 / O08 / **O09** |
| 数据字典查/增/改/停用 | O10 / O11 / O12 / O13 |
| 标签/特质选项字典查/增/改/停用 | **O14 / O15** |
| 风险自动标签规则启停 | **O16** |
| 最近修改日志 | **P01** |

**全局**

| 操作 | 接口 |
|---|---|
| 文件上传（附件/凭证） | A08 |
| 埋点 PV/点击 | **A09** |
| 登出 | A03 |

### 4.3 V1.1 缺口修复清单（相对 V1.0）

| # | 类型 | 问题 | 修复 |
|---|---|---|---|
| 1 | **致命** | `C04` 预约列表出参无 `relationId`，行操作"写跟进"无法调用 | 出参补 `relationId` |
| 2 | **致命** | `B06` 今日新建预约出参无 `relationId`，点击跳详情失败 | 出参补 `relationId` |
| 3 | **致命** | 前端工作台无"外出归来"入口，`C09` 无触发点 | 前端补 D4 弹窗；接口补 `C10` 外出记录列表 |
| 4 | **致命** | 字段模板双真相源：前端 8.4 说 `/org/product-lines` 返回 JSON Schema，本文档说 `/ledger/fields` | 统一 K03~K06 为唯一入口，`N06-N08` 不再返回模板（仅返回 `templateVersion` 计数） |
| 5 | 缺接口 | 各页筛选下拉（部门/成员/产品线/签单人/处理人）无轻量数据源 | 新增 P04/P05/P06 |
| 6 | 缺接口 | 业务关系详情"关系网 Tab"无联系人数据 | 新增 E08 |
| 7 | 缺接口 | 合同"维护人可变更"无接口 | 新增 I05 |
| 8 | 缺接口 | 联系人"删除（仅经理）"无接口 | 新增 G08 |
| 9 | 缺接口 | 工作流阶段拖拽排序无接口 | 新增 O09 |
| 10 | 缺接口 | 录入第三步"完善度预览"无接口 | 新增 D04 |
| 11 | 缺接口 | 操作日志只写不查（数据字典页需展示） | 新增 P01 |
| 12 | 缺接口 | 埋点只写在前端文档，无上报契约 | 新增 A09 |
| 13 | 缺接口 | 导出（Excel/PDF）无契约 | 新增 P02/P03（V2 启用） |
| 14 | 缺入参 | `E01/G04/C02` 不支持 `companyId`，公司档案 3 个 Tab 取不到数 | 补 `companyId` |
| 15 | 缺入参 | `I01/J01` 不支持 `relationId`，业务关系详情 2 个 Tab 取不到数 | 补 `relationId` |
| 16 | 缺入参 | 看板预警跳 `/contract/list?expiring=30` 无对应入参 | `I01` 补 `expiring` |
| 17 | 缺入参 | 报表漏斗"按部门/产品线下钻" | `M02` 补 `productLineId` |
| 18 | 缺出参 | `E02` 无工作流阶段列表，工作流 Tab 需另调 | 补 `stageList[]` |
| 19 | 缺出参 | `L01/L02` 未列 `id`/`detail`，D13 弹窗无法回显与提交 | 补 `id` + `detail{}`（按 type 异构） |
| 20 | 动作缺失 | 工单 5 阶段含"客户确认"，`J05.action` 仅 start/close/assign | `action` 增加 `confirm` |
| 21 | 不一致 | 前端 `B01` 写入参 `roleScope`，接口未定义 | 接口补 `roleScope`（服务端亦可忽略，取登录者角色） |
| 22 | 不一致 | `K01` 示例缺分页信封 | 统一 `{list,total,page,pageSize}` |
| 23 | 语义 | "创建商机"未定义 | 明确为 `J03` with `type=opportunity`，前端文档同步 |
| 24 | 扩充 | 字典类型清单不全（缺在职状态/优先级/审批类型/流失原因等） | `A07` 清单补全 |

---

## 五、接口详述

> 权限列角色：S=销售 K=客服 D=交付 M=部门经理 G=总经理 A=行政。

### 5.1 认证与通用（A）

**A01 POST /auth/login**
- 入参：`account`(工号/手机号) `password`
- 出参：`token` `user{id,name,workNo,avatar}` `roles[]` `permissions[]` `managedDeptIds[]`
- 异常：`10101` 账号或密码错误；`10102` 锁定 10 分钟
- 备注：`managedDeptIds` 是"管辖部门"唯一来源，前端登录后注入全局 Store

**A02 GET /auth/profile** — 返回同上（用于刷新/静默续期）；401 时前端跳登录
**A03 POST /auth/logout** — 服务端失效 token
**A04 GET /notification/list** — 入参 `unreadOnly,page,pageSize`；出参 `list[{id,title,content,bizType,bizId,channel,createdAt,readAt}]` + `unreadCount`；`channel` 固定 `site`（微信通道已在数据层预留，前端零改动）
**A05 PUT /notification/read** — 入参 `ids[]`（空=全部已读）
**A06 GET /dict/{type}** — 出参 `[{code,label,sort,disabled,builtin}]`
**A07 GET /dict/types** — 字典类型清单。`type` 全集（V1.1 补全）：

| type | 说明 | 使用场景 |
|---|---|---|
| `industry` | 行业（二级） | 公司档案/录入 |
| `region` | 地区（省市） | 公司档案/录入 |
| `scale` | 规模（微型~集团） | 公司档案 |
| `follow_method` | 跟进方式：phone/wechat/visit/onsite/email | 写跟进 D1 |
| `attitude` | 客户态度：positive/neutral/negative | 写跟进 D1 |
| `progress` | 意向进展：forward/flat/back | 写跟进 D1 |
| `customer_level` | 客户等级：A/B/C/D | 台账 |
| `decision_role` | 决策权：decision/influence/execute | 联系人 |
| `contact_status` | 在职状态：active/resigned | 联系人列表/关系网 |
| `workorder_source` | 工单来源（按类型联动） | D11 |
| `workorder_priority` | 优先级：P0/P1/P2/P3 | 工单 |
| `sea_reason` | 掉公海原因：follow_timeout/deal_timeout/stagnant/release | 公海卡片 |
| `lost_reason` | 流失原因 | 标记流失 D12 |
| `pay_type` | 付款方式：once/installment/monthly/yearly | 合同创建 |
| `approval_type` | 审批类型：transfer/collaborate/phone_change/phone_unlock/reimburse（V1.4 增 phone_unlock） | 审批中心 |
| `reimburse_type` | 报销类型：transport/meal/other | 报销登记 D15 |
| `visit_purpose` | 外出事由 | 外出登记 D3 |
| `control_type` | 台账控件类型：text/number/date/select/multi_select/link | 字段模板编辑器 |
| `urgency` | 紧迫档：weekly/monthly/quarterly/long_term/gray（默认 gray） | 跟进设置 D18 / 列表标签列 |
| `value_level` | 业务线价值：high/medium/low/pending（默认空=pending） | 跟进设置 D18 |
| `company_identity_tag` | 公司身份标签：local_well_known/listed/state_owned/chain_group/group_type/…（可自定义） | 公司档案 G09/G10 |
| `company_policy_tag` | 公司制度标签：need_bidding/used_competitor/group_procurement/…（可自定义） | 公司档案 G09/G10 |
| `decision_chain` | 决策链：short（老板直拍）/long（多层评审）/unknown | 公司档案 G09/G10 |
| `contact_trait` | 联系人谈判特质：price_sensitive/relationship/case_oriented/professional/…（≤3，可自定义） | 联系人特质 G11/G12 |

**A08 POST /file/upload** — multipart；限制 PDF/图片/录音，≤20MB，单次 ≤5 个；出参 `fileId,url,size,name`
**A09 POST /track/report** — 入参 `events[{eventType(pv/click),pageId,elementId,roleCode,occurredAt,extra?}]`，支持批量（建议前端攒 10 条或 30s 上报一次）；出参 `{accepted}`。**上报失败静默丢弃，不得阻塞业务交互**。

### 5.2 看板与工作台（B）

**B01 GET /dashboard/summary** — 入参 `roleScope?`（sales/manager/gm/admin，服务端以登录者角色为准，传入不一致时以服务端为准）；出参 `todayNew`(int) `todayFollow`(int) `todayOverdue`(int) `monthSignAmount`(number) `monthSignRatio`(number，正=涨) `relationCount`(int)
**B02 GET /dashboard/today-follow** — 出参 `list[{relationId,companyName,productLineName,appointmentAt,overdueHours}]`，逾期置顶；点击"写跟进"用 `relationId` 调 C01
**B03 GET /dashboard/distribution** — 出参 `items[{status,count}]`（data/intent/customer/renew/lost）+ `insight`(string)
**B04 GET /dashboard/alerts** — 出参 `expiringContracts{count30,count60,count90}` `droppingSoon[{relationId,companyName,hoursLeft}]` `newOpportunity{count}`；三卡点击分别跳 `/contract/list?expiring=30`、`/relation/list?view=overdue`、**`/workorder/list?type=opportunity&createdRange=7d`**
**B05 GET /workbench/today-records** — 出参 `list[{id,followAt,companyName,contactName,contactId,createdByName,method,summary,attitude,progress,visitLogId,visitNo,editable}]`；`visitLogId` 非空即渲染 🚗 外出标记；`editable`=仅本人当日记录为 true；`contactId/createdByName` 为 V1.4 补充（跟单记录显示跟进联系人 + 填单人）
**B06 GET /workbench/today-appointments** — 出参 `list[{id,relationId,appointmentAt,note,companyName,status}]`；**`relationId` 为 V1.1 补充**——点击跳业务关系详情必需
**B07 GET /visit/current**（外出中状态条）— 出参 `visitLogId? visitNo? departAt expectReturnAt`（无外出中记录返回 `null`）；工作台据此显示"外出中"状态条与"外出归来"按钮

### 5.3 跟单 / 预约 / 外出（C）

**C01 POST /follow/create**
- 入参：`relationId* contactId followTime method*(phone/wechat/visit/onsite/email) summary* attitude(positive/neutral/negative) progress(forward/flat/back) nextAction nextFollowAt attachments[] visitLogId`
- 出参：新记录 `id`；副作用：回写关系 `last_follow_at / next_follow_at / no_progress_count=0`
- 异常：`20201` 关系已被他人激活；`410` 关系已掉公海
- 幂等：`Idempotency-Key`，落库写入 `follow_record.idempotency_key` 唯一索引

**C02 GET /follow/list** — 入参 `relationId companyId viewScope(page/overview) page pageSize`（`relationId` 与 `companyId` 二选一：业务关系详情传前者，公司档案"跟单聚合"Tab 传后者即可跨关系聚合）；滚动分页 20 条/次；出参含 `visitLogId`
- **出参每条增**：`createdBy/createdByName`（谁填的）、`contactId/contactName`（跟的联系人，可点悬浮卡）——V1.4
- **`viewScope=overview`（公司公海/部门公海概览，V1.4）**：对非本人关系只返回 `{relationId, companyName, followCount30}`（**近 30 天跟进次数**），不返回逐条全文，用于公海卡片"值不值得领"判断；`viewScope=page`（默认）= 本人关系/协同关系的全文分页
**C03 PUT /follow/{id}** — 仅本人当日记录可改，隔天返回 `403`
**C04 GET /appointment/list**
- 入参：`tab*(today/future/expired/none) memberId page pageSize`
- 出参：`list[{id,relationId,companyName,productLineName,appointmentAt,note,status,relationStatus,ownerName,dropHoursLeft,expiredDays,dropDaysLeft}]`
- 口径：today=预约在今天；future>今天；expired<今天且未完成（返回 `expiredDays`）；none=名下关系 `next_follow_at IS NULL`（返回 `dropDaysLeft`）
- ⚠ **`relationId` 为 V1.1 补充**：行操作"写跟进"需 `relationId` 调 C01、"查看详情"需 `relationId` 调 E02，缺此字段行操作全部失效
**C05 POST /appointment/create** — 入参 `relationId* appointmentAt* note`；成功写 `appointment`
**C06 POST /appointment/reschedule** — 入参 `id* appointmentAt* reason`；不新建记录，写 `reschedule_log`
**C07 POST /appointment/complete** — 入参 `id* followRecordId*`；**强制关联跟单记录**，未关联返回 `422`
**C08 POST /visit/create** — 入参 `relationIds[]* departAt* expectReturnAt purpose transport companions[]`；出参 `visitLogId,visitNo`；登记期间写的跟单自动带 `visitLogId`；**同一用户同时仅允许 1 条未归来记录**，重复登记返回 `409`
**C09 POST /visit/finish** — 入参 `visitLogId* actualReturnAt`；前端触发点=工作台"外出中"状态条的"外出归来"按钮（D4）；归来后可一键发起报销（L04）
**C10 GET /visit/list** — 入参 `range(起止) memberId? page pageSize`；出参 `list[{visitNo,departAt,actualReturnAt,duration,relationCount,followCount,reimburseNo?}]`；用途：月底报销对账、经理核查外勤

### 5.4 录入与查重（D）

**D01 POST /entry/create**
- 入参：`contact{name*,phone*,wechat,email,gender,birthday,decisionRole,tags[],remark} company{fullName?,creditCode?,industry,region,scale}? target*(private/dept_sea)`
- 出参：`contactId companyId?`
- 前置：前端先调 D02/D03；服务端二次校验手机号唯一与信用代码唯一
- 异常：`20101` 手机号已存在（返回归属人）
**D02 GET /contact/check-phone** — 入参 `phone`；出参 `exists` + `contactId` + `ownerName` + `companyName`；前端据此弹 D10
**D03 POST /company/match** — 入参 `fullName creditCode?`
- 出参 `candidates[{companyId,name,similarity,exactMatch}]`
- 命中规则：① `creditCode` 存在且库中有相同代码 → `exactMatch=true`，**前端强制使用已有**（不允许新建）；② 名称相似度 ≥90% → 弹 D9 列候选；③ 均不命中 → 正常新建
- 同时服务于「录入页公司名校验」与「公司档案补全页信用代码唯一性校验」
**D04 POST /entry/preview** — 入参同 D01（不落库）；出参 `completeness{level1,level2,level3,missingFields[]}` + `willCreateCompany`(bool) + `duplicateRisk`；用于录入第三步确认页的完善度预览，避免用户提交后才发现要补全

### 5.5 业务关系（E）

**E01 GET /relation/list**
- 入参：`view(mine/weekly/following/cooperated/lost/overdue/gray_alert) companyId deptId productLineId ownerId maintainerId keyword page pageSize sort`
- 出参：`list[{id,companyName,productLineName,status,deptName,ownerName,maintainerName,stageName,nextFollowAt,valueEstimate,valueEstimateMasked,competitorFlag,seaStatus,urgency,valueLevel,riskTags[],lostReason}]`
- 口径：mine=我的全部（默认）；**weekly=紧迫档=周重点（本人名下，V2.5 主攻清单）**；following=status in(data,intent)；cooperated=status in(customer,renew)；lost=status=lost；overdue=`next_follow_at < now`；**gray_alert=灰度寿命预警候选（命中本部门 N12 规则 N/M，销售/经理可见）**
- 列表标签列渲染（V1.3）：紧迫档 `urgency`（最前）+ 业务线价值 `valueLevel` + 风险 `riskTags[]`（系统自动，带 ⚙ 灰显）；三字段源于 E09 follow-setup，列表接口内联返回避免逐行再查
- 脱敏：跨部门/跨业务线时 `valueEstimateMasked=true`
- **`companyId` 为 V1.1 补充**：公司档案详情"业务关系"Tab 按公司过滤；`lostReason` 补充给"已流失"快捷视图展示流失原因列
**E02 GET /relation/detail/{id}**
- 出参：
  - `base{}`（公司/产品线/主对接/维护人/共同跟进人/当前阶段/下次跟进/价值评估）
  - `collaborators[{userId,name,deptName,validUntil?}]`（**V1.4**：共同跟进人列表，来自 `relation_member.member_type=collaborator`；前端在人员区展示，协同人可全文看跟单）
  - `phoneViewable{boolean}`（**V1.4**：当前用户对该关系联系人是否可见全号——归属本人/协同/已申请解锁= true，否则仅后 4 位）
  - `permissions{canFollow,canTransfer,canContract,canWorkorder,canActivate,canLost,canCollaborate}`
  - `company{completeness1/2/3,missingFields[]}`
  - `sameCompanyOthers[{productLineName,ownerName,amountMasked,followCount30d}]`
  - **`stageList[{stageId,stageName,sort,isCurrent,isTerminal}]`**（V1.1 补充，工作流 Tab 直接渲染，无需二次调用 O05）
  - **`currentVisit{visitLogId,visitNo}?`**（V1.1 补充：若该关系归属人正在外出中，写跟单时自动带 `visitLogId`）
**E03 POST /relation/activate** — 入参 `companyId* deptId* productLineId*`；**冲突返回 409 + `data.ownerName`**（DB 层 `active_key` 唯一索引兜底）
**E04 POST /relation/transfer** — 入参 `relationId* toUserId* reason*`；生成审批单 `approval.type=transfer`
**E05 POST /relation/collaborate-apply** — 入参 `relationId* toUserId* reason* validUntil?`；生成审批单 `approval.type=collaborate`
- **V1.4 协同语义 = 共同跟进**：审批通过后，服务端将申请人写入 `relation_member.member_type=collaborator`（可带 `validUntil` 有效期，到期自动解除其跟单可见/写权），**非只读**——协同人可共同写跟单（C01）并全文查看（C02 page）
**E06 PUT /relation/{id}/stage** — 入参 `stageId* note?`；写 `workflow_stage` 推进记录
- **V1.3 扩展**：允许**跳级**（如 2→5）与**回退**（如 5→2，须填 `note*` 理由）；每次变动留痕 `{operatorId,fromStage,toStage,reason,createdAt}`（前端进度条可点任意阶段格发起）
- **异议无解双出路**：阶段 4（异议与卡点）处服务端返回可选项 `resolveOptions[{code:rollback_to_longterm（回落"长期跟"档 + 阶段回 2）,code:judge_lost（判流失，转 E07）}]`，人工选择其一后由 E06 或 E07 完成落地；两路均写留痕
- 动作驱动建议（服务端旁路返回 `suggestedStageId?`）：写跟单（C01）带特定语义时建议下一阶段，前端弹"建议阶段：异议与卡点 → [确认/修改]"
**E07 POST /relation/{id}/lost** — 入参 `reason*`；`lost_reason` 必填（枚举见 `lost_reason` 字典）；前端触发点=工作流 Tab 拖拽到"流失"或详情页 D12 弹窗
**E08 GET /relation/{id}/contacts**（V1.1 新增）
- 出参：`list[{contactId,name,decisionRole,phoneMasked,status,isPrimary,employHistory[{companyName,isCurrent}],canDelete}]`
- 用途：业务关系详情"关系网"Tab（主对接人置顶、"对接人已离职"标记）、D11 创建工单的联系人下拉
- 与 G04 的区别：G04 是全公司联系人档案视角；E08 是**单一业务关系维度**的联系人，`isPrimary` 与离职标记只在此接口维护

> **E09/E10（跟进设置）** 属 E 组端点，完整契约见 5.18 节（跟进设置与分层标签）。

### 5.6 公海（F）

**F01/F02 GET /sea/company/list、/sea/department/list** — 入参 `productLineId enterReason enteredRange page pageSize`；卡片出参 `{relationId,companyName,region,scale,industry,contactNameMasked,enteredAt,enterReason,dropDaysLeft,lineTags[]}`（部门公海带 `dropDaysLeft`）
**F03 POST /sea/claim** — 入参 `relationId* deptId activateNow productLineId?`；成功回 `relationId`；冲突 `409 + ownerName`

### 5.7 公司 / 联系人档案（G）

**G01 GET /company/list** — 入参 `industry region lineStatus keyword page pageSize`；出参含 `businessLineCount totalValue(totalValueMasked) firstSignAt`；**普通角色隐藏 `totalValue`**
**G02 GET /company/detail/{id}** — 出参 `company{}` `completeness{1,2,3,missingFields[]}` + `relations[] contacts[] lines[]`
> 四个 Tab 数据来源：业务关系=E01(`companyId`)、联系人=G04(`companyId`)、业务线=本接口 `lines[]`、跟单聚合=C02(`companyId`)
**G03 POST /company/save** — 入参 `id? + 三档字段`；出参 `companyId completeness`；`redirect` 由前端回跳；信用代码重复返回 `20103`
**G04 GET /contact/list** — 入参 `companyId decisionRole status(active/resigned) keyword page pageSize`；卡片：`{id,name,status,decisionRole,companyCount,phoneMasked,email,tags[],currentCompany,historyCompany?}`；**`companyId` 为 V1.1 补充**（公司档案联系人 Tab）
**G05 GET /contact/detail/{id}** — 出参 `contact{} employHistory[] changeLogs[] follows[] relatedCompanies[] referral{}`；`phoneFrozenUntil` 非空时前端显示"审核中，原号码冻结至 X"
**G06 POST /contact/{id}/change-phone** — 入参 `newPhone* reason*`；生成审批 `phone_change`，审核期 `phone_frozen_until = now+24h`；前端触发点=D14 弹窗
**G07 PUT /contact/{id}** — 姓名/邮箱/微信/标签直接生效（手机号除外）
**G08 DELETE /contact/{id}**（V1.1 新增）— 仅部门经理及以上；**存在关联业务关系/合同时不允许删除**，返回 `409 + data.refCount`；删除为软删（`status=deleted`），历史跟单留痕保留

**G09 GET /company/{id}/profile-tags**（V1.3 新增）— 公司档案标签读取：`groups[{code(company_identity_tag/company_policy_tag/decision_chain),name,multi,max,options[{tagId,code,label,selected,markedByName,markedAt}]}]`；`decision_chain` 单选，其余多选；建档勾一次、全公司共享，打标留痕
**G10 PUT /company/{id}/profile-tags**（V1.3 新增）— 入参 `groups[{code,selectedTagIds[]}]` 全量覆盖；可后补；写 `operation_log`
**G11 GET /contact/{id}/traits**（V1.3 新增）— 联系人谈判特质读取：`traits[{tagId,code,label,markedByName,markedAt}]` + `personalTags[]`（个人自由标签分栏）；特质存 contact 层，**换公司保留**
**G12 PUT /contact/{id}/traits**（V1.3 新增）— 入参 `traitIds[]*`（≤3，超出 `422`+`20402`）全量覆盖；写留痕

> G09~G12 完整契约见 5.18 节（跟进设置与分层标签）。

### 5.8 高级搜索（H）

**H01 GET /search/advanced**
- 入参：`keyword deptIds[]（默认取 managedDeptIds[0]） memberId productLineId status level lastFollowRange valueRange page pageSize sort`
- 出参：`list[{companyName,status,deptName,ownerName,productLineName,stageName,lastFollowAt,nextFollowAt,valueEstimate}]`
- 规则：`deptIds` 与管辖部门取交集；无权部门静默忽略；不支持导出

### 5.9 合同（I）

**I01 GET /contract/list** — 入参 `status productLineId signerId keyword relationId expiring(30/60/90) page pageSize sort`
- 出参 `{id,contractNo,companyName,productLineName,signerName,amount,amountMasked,paidAmount,paidRatio,signDate,serviceEnd,status}`
- **`relationId` 补充**：业务关系详情"合同信息"Tab；**`expiring` 补充**：看板"签约到期"预警卡跳 `/contract/list?expiring=30`
**I02 GET /contract/detail/{id}** — 出参 `contract{} payments[] attribution{signerId,signerName,maintainerId,maintainerName,canChangeMaintainer}` `renewalAlerts[]` `crossLineContracts[{lineName,signDate,amountMasked}]`；页面带水印（前端）
**I03 POST /contract/create** — 入参 `relationId* productLineId* contactId signerId amount* payType paidAmount signDate serviceStart serviceEnd autoRenew remindDays[] attachments[]`；前置校验完善度，不达标返回 `20202 + missingFields[]`；成功后业务关系自动置 `customer`
**I04 POST /contract/{id}/payment** — 入参 `amount* paidAt* method voucherFileId`；事务更新 `paid_amount` 与状态；**已收款=合同金额时状态自动转 `executing`**
**I05 PUT /contract/{id}/maintainer**（V1.1 新增）— 入参 `maintainerId*`；前端需二次确认（MessageBox 写明"变更将影响交付对接与提成归属"）；签单人不可变更（服务端拦截，返回 `403`）

### 5.10 工单（J）

**J01 GET /workorder/list** — 入参 `type(all/aftersale/opportunity) status priority relationId createdRange(7d/30d) page pageSize sort`；出参含 `slaDeadline slaRemainSec slaRatio`
- **`relationId` 补充**：业务关系详情"工单"Tab
- **`createdRange` 补充**：看板"新商机"预警卡跳 `/workorder/list?type=opportunity&createdRange=7d`
**J02 GET /workorder/detail/{id}** — 出参 `workorder{} stageFlow[] logs[] relation{} crossLineCard{} upgradedFromId`；`slaRemainSec <= 0` 时前端进度条转红并显示"已超时 X 小时"
**J03 POST /workorder/create** — 入参 `type*(aftersale/opportunity) relationId* contactId title* content* source priority（仅售后） assigneeId attachments[]`
- **"创建商机"= 本接口 `type=opportunity`**（前端页面 6 的"创建商机"按钮即打开 D11 并预设 type=opportunity，无独立接口）
- 处理人默认规则服务端兜底：售后→交付部门负责人，商机→当前用户
**J04 POST /workorder/{id}/upgrade** — 入参 `targetType*(aftersale/opportunity) reason*`；售后↔商机双向，写 `workorder_log` + `upgraded_from_id`
**J05 POST /workorder/{id}/action** — 入参 `action*(start/assign/confirm/close) assigneeId?`
- `start` 开始处理 → 阶段"处理中"
- `assign` 分派（`assigneeId` 必填）
- **`confirm` 客户确认**（V1.1 补充，对应 5 阶段流程的"客户确认"节点）
- `close` 关闭（终态，需有确认记录，否则返回 `422`）

### 5.11 台账与字段模板（K）—— 铁律落地点

**K01 GET /ledger/list**
- 入参：`productLineId* keyword expireRange page pageSize`
- 出参：
```json
{
  "list": [
    { "id": 1, "companyName": "杭州云启科技", "level": "A", "signDate": "2025-09-28",
      "expireDate": "2026-09-28", "contactName": "张**", "deliveryOwner": "陈交付",
      "salesOwner": "张销售", "remark": "", "expireInDays": 23,
      "extraFields": { "domain": "yunqi.com", "serverExpire": "2026-12-01" } }
  ],
  "total": 42,
  "page": 1,
  "pageSize": 20,
  "fieldTemplate": {
    "commonFields": [ { "key": "companyName", "label": "客户名称", "type": "text", "required": true, "sort": 1, "showInList": true, "locked": true } ],
    "extFields": [
      { "id": 11, "key": "domain", "label": "域名", "type": "text", "required": true, "sort": 1, "showInList": true, "status": "active" },
      { "id": 12, "key": "aiRate", "label": "AI 推荐率", "type": "number", "required": false, "sort": 9, "showInList": true, "status": "disabled" }
    ]
  }
}
```
> ⚠ 分页信封统一 `{list,total,page,pageSize}`（V1.0 示例缺 `page/pageSize`，V1.1 修正）；`fieldTemplate` 置于 `data` 下与 `list` 平级；`status=disabled` 的字段前端渲染为灰色列头 + "（已停用）"，历史值照常展示。
> 台账记录**由合同签约/服务开通时自动生成**，前端不提供手工新增入口；K02 仅用于编辑（传 `id`）。
**K02 POST /ledger/save**
- 入参：`id? 通用字段... extraFields{...}`
- 校验：`extraFields` 的 Key 必须存在于该产品线 `field_template` 且 status=active；否则 `422 + code 30101 + data.illegalKeys[]`
- 停用字段的历史值原样保留，未在模板中的旧 Key 允许随记录原样回传（不做删除），但**新增必须登记**
**K03 GET /ledger/fields** — 入参 `productLineId*`；返回通用字段（只读）+ 扩展字段列表
**K04 POST /ledger/fields** — 入参 `productLineId* label* controlType* required sort showInList options[]?`；`field_key` 服务端生成，保存后不可变
**K05 PUT /ledger/fields/{id}** — 仅可改 `label required sort showInList options`；传 `key/controlType` 一律忽略
**K06 PUT /ledger/fields/{id}/disable** — 停用（不删除）；`status=disabled`

### 5.12 审批（L）

**L01 GET /approval/todo**（M/G）— 入参 `type range page pageSize`
- 出参 `list[{id,type,applicantName,objectName,reason,createdAt,waitHours,detail{},canHandle}]`
- `waitHours > 24` 前端标黄；`canHandle=false` 表示自审（服务端已拦截），通过/驳回按钮禁用并 Tooltip 提示"不可审批自己发起的申请"
- **`detail{}` 为 V1.1 补充**，按 `type` 异构，D13 弹窗直接回显：
  - `transfer`：`{relationId,companyName,fromOwner,toOwner,toDept}`
  - `collaborate`：`{relationId,companyName,ownerName,applicantName}`
  - `phone_change`：`{contactId,contactName,oldPhone,newPhone,frozenUntil}`（新旧号码对比）
  - `phone_unlock`：`{contactId,contactName,companyName,phoneMasked,reason}`（V1.4：申请查看非归属部门联系人全号）
  - `reimburse`：`{visitNo,totalAmount,items[{type,amount,occurredAt,fileName}]}`
**L02 GET /approval/mine**（全员）— 入参同上；出参增加 `status(pending/approved/rejected)`、`approverName`、`rejectReason`
**L03 POST /approval/handle** — 入参 `approvalId* action*(approve/reject) comment*（驳回必填）`；后置：写站内通知；转交/协同即时变更归属（协同写入 `relation_member.collaborator` 并写 `validUntil`）；手机号变更写 `contact_change_log`；**phone_unlock 通过则对该联系人开通限时全号可见（`unlockedUntil`，如 24h），留痕写 `operation_log` 防批量捞号**；禁止自审（服务端拦截返回 `403`）
**L04 POST /approval/reimburse** — 入参 `visitLogId? items[{type,amount,occurredAt,fileId}]* totalAmount* remark`；生成 `approval.type=reimburse`；前端触发点=审批中心"报销登记"按钮（D15）或外出归来后的"发起报销"快捷入口（关联 C10 记录）
**L05 POST /approval/phone-unlock** — 入参 `contactId* relationId* reason*`（V1.4 新增）；生成 `approval.type=phone_unlock`；前端触发点=公司抽屉/联系人悬浮卡/联系人列表 `****{后4位}` 旁的「申请解锁」按钮（见前端 V2.6 §4.3）

### 5.13 报表（M）

全部入参 `dateRange(起,止) deptIds? productLineId?`；数据范围强制按管辖部门过滤。
- M01 `kpi{newRelation,signCount,signAmount,signRatio,dropCount}` + `lineCompare[]` + `top5[]` + `trend12[]`
- M02 `funnel[{stage,count,convertRate}]`；**`productLineId` 为 V1.1 补充**（支持"按部门/产品线下钻"）
- M03 `kpi{} + lineStock[] + lostReasons[]`
- M04 `kpi{d30,d60,d90} + list[]`（销售仅自己客户）
- M05 `kpi{} + slaByPriority[]`

### 5.14 组织（N）

- N01 GET /org/employees — 表格数据；N02 POST 新增；N03 PUT 编辑；N04 PUT `/{id}/status` 停用/启用（离职员工待审批单自动转直属经理）
- N05 /org/departments — CRUD，含 `serviceEnabled`、`managerIds[]`
- N06 GET /org/product-lines（列表）／N07 POST 新增／N08 PUT 编辑 — 含 `seaDefaultFreq/Deal/Stay` 与 `serviceCycleDays`
  - ⚠ **V1.1 修正（消除双真相源）**：本组**不返回台账字段模板 JSON Schema**，仅返回 `templateFieldCount`（已登记扩展字段数）供卡片展示；字段模板的**唯一读写入口为 K03~K06**
- N09 GET /org/roles — V1 固定返回 6 条内置角色（不提供新增）
- N10 GET /org/permission-matrix — `{perms[], roles[], matrix{permKey:{roleCode:visible|masked|denied}}}`；N11 PUT 单元格三态，即时保存（写 `operation_log`）
- **N12 GET/PUT /org/departments/{id}/rules**（V1.3 新增）— 部门规则读写，**仅该部门经理可配**：
  - `levelTiers`：客户等级金额档位阈值 `[{level:A/B/C/D,minAmount}]`（**每部门各自定义**，用于回款金额自动算等级）
  - `grayLife`：灰度寿命 `{remindDays}(N 天未定性→提醒销售下结论)、{releaseDays}(再 M 天未动→列为公海释放候选，经理确认后释放)`
  - 保存写 `operation_log`；规则变更失效相关缓存；前端触发点=部门卡片「部门规则」入口
- 灰度寿命执行=服务端定时任务：到 `remindDays` 发通知（P07 `type=risk`）、到 `releaseDays` 将关系标为公海释放候选并在部门公海/经理待办呈现

### 5.15 系统设置（O）

- O01 GET /setting/sea-rules（列表）／O02 POST（新建）／O03 PUT `/{id}`（编辑）：字段 `level(1-4) deptId productLineId followFreqDays dealCycleDays stayDays noProgressMax`；保存返回 `affectedCount`（前端确认弹窗展示"将影响 N 条业务关系掉落判定"）
- O04 GET /setting/sea-rules/resolve：入参 `companyId deptId productLineId`；出参 `hitLevel` + `rule{}` + `path[L4→L1]`（前端演示命中路径）
- O05 GET /setting/workflow-stages：入参 `deptId* productLineId*`；出参 `[{stageId,stageName,sort,isTerminal,refCount}]`（`refCount>0` 时前端删除图标置灰）
- O06 POST 新增／O07 PUT `/{id}` 改名改属性／O08 DELETE `/{id}`（被引用返回 `30201 + refCount`）
- **O09 PUT /setting/workflow-stages/sort**（V1.1 新增）：入参 `deptId* productLineId* stageIds[]*`（按目标顺序）；整体重排，服务端校验 ids 完整，缺漏返回 `422`
- O10 GET /setting/dicts（类型+选项）／O11 POST `/{id}/options`（新增）／O12 PUT `/options/{id}`（编辑）／O13 PUT `/options/{id}/disable`（停用）
  - 内置项 `builtin=true` 不可删，仅可停用；修改即时生效并写 `operation_log`

### 5.16 通用与支撑（P）—— V1.1 新增

**P01 GET /operation/logs** — 入参 `module bizType range operatorId page pageSize`；出参 `list[{operatorName,module,action,bizDesc,before,after,createdAt}]`；用途：数据字典页"最近修改日志"、管理页审计追溯。**只读，不提供删除**

**P02 POST /export/task**（V2 启用）— 入参 `bizType(contract/relation/ledger/report) params{} columns[]`；出参 `taskId`；>1 万行必须走异步
**P03 GET /export/task/{id}** — 出参 `status(pending/running/success/failed)` `progress` `downloadUrl` `expireAt`；前端轮询间隔 ≥2s，成功后自动下载

**P04 GET /common/options/departments** — 出参 `[{id,name,parentName}]`；**仅返回当前用户管辖部门**（总经理返回全部）；用于高级搜索部门筛选器、业务关系/合同/工单筛选、组织架构选择
**P05 GET /common/options/users** — 入参 `deptId? roleCode? keyword?`；出参 `[{id,name,workNo,deptName,roleCodes[],status}]`，默认返回管辖部门内成员；用于"主对接销售/维护人/签单人/处理人/转交对象"全部人员下拉
**P06 GET /common/options/product-lines** — 出参 `[{id,name,code}]`；用于台账 Tab、筛选器、字段模板编辑器产品线选择

> 设计说明：P04~P06 是**轻量只读选项接口**，与 N 组管理 CRUD 接口分离——避免筛选下拉背负分页/权限/审计逻辑，也避免管理接口被高频调用。前端 `<DeptScopeSelect>` 全局组件固定绑定 P04。

### 5.17 通知与个性化（P07~P10）—— V1.2 新增

**P07 GET /notification/list**
- 入参：`tab(all/todo/approval/system/risk) unreadOnly page pageSize`
- 出参：`unreadCount{total,todo,approval,system}` + `list[{id,type,title,summary,bizType,bizId,targetUrl,channel,readAt,createdAt,createdAtText}]`
- `targetUrl` 为前端路由，点击"去处理"直接跳转（如 `/appointment/expired?relationId=`）
- `channel`：**V1 恒为 `site`**；字段结构预留 `site|wecom|wechat` 数组，V2 接入微信/企微时前端零改动
- 前端顶栏铃铛未读角标固定调用本接口（轮询 ≥60s 或登录后拉一次）

**P08 PUT /notification/read** — 入参 `ids[]?`（空=全部已读）；出参 `affected`；乐观更新角标，失败回滚并 toast

**P09 GET /profile/quick-entries**
- 出参：`selected[{id,icon,text,action,sort}]`（≤6）、`library[{id,icon,text,action}]`（10 项可选库）、`roleDefault[]`
- `action` 形如 `dialog:follow` / `route:/entry/new` / `dialog:appointment` —— **动作型入口直接开弹窗，不跳页**
- 未配置时返回 `roleDefault`（销售 4 项、经理+追加"待我审批"）

**P10 PUT /profile/quick-entries** — 入参 `ids[]*`（≤6）；校验超长返回 `422`；出参 `selected[]`
> V1 可先存 localStorage 过渡，但**接口契约现在就定**，避免 V2 多端同步时返工。

---

### 5.18 跟进设置与分层标签（E09/E10、G09~G12、O14~O16）—— V1.3 重写

> **V1.3 语义说明**：V1.2 的"四维标签（focus/play/risk/coop）"体系废弃。标签改**按判断主体分层**：公司档案（身份/制度/决策链=G09/G10）、联系人档案（谈判特质=G11/G12，≤3，跟着人走）、业务关系（跟进设置=E09/E10：紧迫档单选 + 业务线价值单选 + 协同勾选，风险=系统自动只读）。前端页面与 D18 弹窗均按此新结构渲染。

**E09 GET /relation/{id}/follow-setup**
- 出参：`urgency`（weekly/monthly/quarterly/long_term/gray，默认 gray）、`valueLevel`（high/medium/low/pending，默认空=pending）、`coopTags[{tagId,code,label}]`（协同勾选，手动，可 @ 同事）、`riskTags[{tagId,code,label,source(manual/auto),autoRuleId}]`（风险：系统自动为主、人工可补；**auto 项只读**带 ⚙ 灰显）、`updateLogs[]`（操作人+时间留痕）
- 字典：`urgency` / `value_level` 走 A07 字典类型，中文文案由前端映射；风险/协同标签选项走 O16 规则 + O14 字典

**E10 PUT /relation/{id}/follow-setup**
- 入参：`urgency*`（必须且只能 1 个，否则 `422` + 子码 `20401`）、`valueLevel?`（可空）、`coopTagIds[]?`（协同手动全量覆盖）、`riskManualTagIds[]?`（**人工补风险**，全量覆盖；传 auto 规则标签 ID 时忽略）
- **auto 风险不回传**：系统自动风险由 O16 规则计算、条件消失自动摘除，前端传 auto 标签 ID 忽略并返回提示
- 后置：写 `operation_log`（留痕"XX 于 09-07 将紧迫档改为 周重点 / 补风险标签 流失信号"）；转交/协同时服务端提示前端"是否重置跟进设置"

**G09 GET /company/{id}/profile-tags**
- 出参：`groups[{code(company_identity_tag/company_policy_tag/decision_chain),name,multi,max,options[{tagId,code,label,selected,markedByName,markedAt}]}]`
- `decision_chain` 单选；其余多选；**建档时勾一次、全公司共享**；打标留痕 `markedByName/markedAt`

**G10 PUT /company/{id}/profile-tags**
- 入参：`groups[{code,selectedTagIds[]}]`；只回传当前勾选集合（全量覆盖）；可后补（非建档时也可改）
- 权限：所有可见该公司档案的角色可打标；写 `operation_log` 留痕

**G11 GET /contact/{id}/traits**
- 出参：`traits[{tagId,code,label,markedByName,markedAt}]`、`personalTags[]`（个人自由标签，与特质分栏展示）
- 特质走 `contact_trait` 字典（预设可自定义）；**跟着人走——换公司后保留**（存 contact 层，不存 company_contact）

**G12 PUT /contact/{id}/traits**
- 入参：`traitIds[]*`（≤3，超出返回 `422` + 子码 `20402`）；全量覆盖；写留痕

**O14 GET /setting/tags?type=** — 入参 `type(company_identity_tag/company_policy_tag/decision_chain/contact_trait)*`；出参选项字典：`[{id,code,label,sort,enabled,usageCount,builtin}]`（`builtin=true` 预设项仅可停用不可删）
**O15 POST/PUT /setting/tags[/{id}]** — 标签/特质选项新增/编辑/停用；被引用（usageCount>0）时不可删，仅可停用；写 `operation_log`
**O16 GET/PUT /setting/tag-auto-rules[/{id}]** — 风险自动标签规则：`{id,desc,conditionExpr,tagId,enabled}`；超管可启停，规则体系统内置（V1 不提供条件自定义）
- 内置规则（对应前端需求 5.6.5）：`连续 7 天无跟进且阶段∈(1,2,3) → 流失信号`、`合同回款逾期 15 天 → 回款风险`、`工单超时未处理（SLA 超标）→ 交付风险`、`联系人离职/在职变更 → 对接人变动`
- 条件消失后服务端自动摘除，前端不做判断；命中结果写入 E09 的 `riskTags` 只读回传

> 紧迫档为**纯手动标签，无自动降级**（V2.4 的"周一自动降级"规则随四维标签一并废弃）；灰度寿命（N 天未定性→提醒、再 M 天→公海释放候选）由 N12 部门规则配置，服务端定时任务执行。

---

## 六、权限与脱敏的服务端实现规则

| 规则 | 实现 |
|---|---|
| 数据范围 | 全部列表接口默认 `dept_id IN managedDeptIds`；总经理=全公司；前端传 `deptIds` 时取交集 |
| 按钮权限 | `/auth/profile` 下发 `permissions[]`；服务端每个写接口二次校验，禁止只靠前端禁用 |
| 脱敏字段 | 出参层按 `permission_matrix` 判定；三大类：跨业务线合同金额、跨部门跟单/工单、普通角色公司总价值 |
| 手机号 | 列表接口统一 `138****6677`；详情按权限返回全量 |
| 自审拦截 | 审批 `applicant_id == approver_id` 返回 403 |
| 操作日志 | 激活/转交/规则/字典/权限矩阵/字段模板变更全部写 `operation_log` |

---

## 七、前后端一致性检查表（联调验收依据）

| # | 检查项 | 通过标准 |
|---|---|---|
| 1 | 路径与字段名 | 与本文档四、五章逐条一致，无下划线/驼峰混用（**统一 snake_case**） |
| 2 | 分页结构 | 所有列表返回 `{list,total,page,pageSize}` |
| 3 | 枚举 | 返回英文码；前端通过字典映射文案，无硬编码中文判断 |
| 4 | 时间 | 统一 `YYYY-MM-DD HH:mm:ss`，无时间戳混用 |
| 5 | 金额 | 数字类型，脱敏返回 `null + xxxMasked:true` |
| 6 | 错误码 | 401/403/404/409/410/422/500 与业务子码按第三章执行 |
| 7 | 数据范围 | 越权传参结果收敛，不报错 |
| 8 | 幂等 | 写接口支持 `Idempotency-Key`，重复提交返回首次结果 |
| 9 | 台账字段 | 未登记 Key 返回 `422/30101 + illegalKeys[]` |
| 10 | 激活竞态 | 并发激活仅一条成功，其余 409 返回归属人 |
| 11 | 完成预约 | 未关联跟单记录返回 422 |
| 12 | 通知 | `channel` 字段存在，V1 恒为 `site` |
| 13 | **行操作前置字段** | 列表出参必须携带下游操作所需 ID（`C04/B06` 的 `relationId`、`I01` 的 `id`），否则行按钮全部失效 |
| 14 | **下拉数据源** | 全系统人员/部门/产品线下拉统一走 P04~P06，不得复用管理 CRUD 接口 |
| 15 | **字段模板唯一入口** | 台账字段模板读写只走 K03~K06；`/org/product-lines` 返回模板视为缺陷 |
| 16 | **埋点** | `A09` 上报失败静默丢弃，不得弹错、不得阻塞业务 |
| 17 | **台账新增** | 前端无手工新增入口，记录由合同签约生成；`K02` 仅编辑 |
| 18 | **外出闭环** | 工作台必须有"外出归来"入口（B07 状态条 + C09），否则 `visitLog` 永远不闭合 |
| 19 | **Tab 数据归属** | 详情/档案类页面的每个 Tab 都能在 4.2 反向索引中找到接口，不出现"Tab 无数据源" |
| 20 | **弹窗可提交性** | D13 审批弹窗依赖 `L01.detail{}`；缺 `detail` 时弹窗应 loading 失败提示而非空白提交 |

---

## 八、待确认

| # | 问题 | 建议 |
|---|---|---|
| 1 | 列表默认排序字段是否服务端定死 | 建议服务端定默认，前端只覆盖用户显式排序 |
| 2 | 报表是否需要异步导出（大数据量） | >1 万行走任务+回调（P02/P03），V2 实现 |
| 3 | 文件是否接对象存储直传 | 建议前端直传 OSS，接口只回 `fileId`；若直传则 A08 退化为"换取上传凭证"接口 |
| 4 | `confirm`（客户确认）动作是否需要客户侧参与（如短信确认链接） | V1 先由处理人代确认并留痕，V2 再接客户侧确认 |
| 5 | 埋点是否接入第三方（神策/GrowingIO） | V1 先落自研 A09；若接第三方则 A09 转为服务端转发 |

---

## 九、接口变更流程

1. 任何字段增删、路径调整、错误码变更，**必须先改本文档再改代码**，并同步更新《前端页面开发需求文档》4.2 反向索引与修改记录。
2. 破坏性变更（删字段、改语义、改枚举码）需走评审，并在 `code` 或路径上加版本隔离，禁止静默覆盖。
3. 联调期间发现契约缺口，**当日补录本文档**，不接受"口头约定"或"临时加字段"。

---

**文档结束**
> 前后端联调以本文档为唯一契约。任何字段变更需走接口变更评审并同步更新本文档版本号（V1.x）。
