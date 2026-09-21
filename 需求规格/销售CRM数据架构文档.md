# 销售 CRM 数据架构文档（现行有效）

> **⚠ 开工前必读**：先读《**废止口径登记表**》（需求规格/）——已废止的旧说法不得作为实现依据（**尤其 #17**：DB 层虽报 MySQL 1062，**应用层捕获的是 Prisma `P2002`**；**#19 / #40**：表数为 **47 张**）。
> **本文件的角色**：只回答"**数据怎么存**"——表、字段、索引、字典、权限实现口径、定时任务。
> **业务规则一律不在此定义**：凡涉及"为什么这么设计、规则是什么"，一律见《销售CRM业务需求文档》对应章节（本文用 `→需求§X` 标注）。
> **元铁律**：**L0 变更联动**（需求改 → 本文件同批改）｜**L1 单一事实源**（规则只在需求文档定义一次，本文只写指针）。
> **版本沿革**：文档内不留「修改记录」章节（2026-09-12 决定 →《废止口径登记表》#22）；沿革查 `git log --follow -- 需求规格/销售CRM数据架构文档.md`。

---

## 一、文档信息

| 项目 | 内容 |
|---|---|
| 版本 / 日期 | **V1.39（现行有效）** / 2026-09-21 |
| 上游 | 《销售CRM业务需求文档》（业务规则唯一来源） |
| 下游 | 《销售CRM接口API文档》、《销售CRM设计规范》、《销售CRM前端页面与交互文档》 |
| 数据库 | MySQL 8.0+（InnoDB，utf8mb4）；JSON 用于扩展/柔性数据 |
| 缓存 | Redis（登录态 / 字典 / 管辖部门集合 / 规则缓存） |
| 外部依赖 | 高德开放平台：JS API（坐标拾取器）。坐标系统一 **GCJ-02**（见 §五 B7） |
| 性质 | **全新架构，Schema 唯一真相源**。旧档案式表结构仅为纸面设计、从未编码实现，**整体作废，不迁移、不并行、不做兼容层** |

### 通用约定
- 主键统一 `id` BIGINT UNSIGNED AUTO_INCREMENT
- 审计字段全表统一：`created_by / created_at / updated_by / updated_at`；逻辑删除 `deleted_at`（NULL=未删）
- 金额统一 `DECIMAL(12,2)`；时间统一 `DATETIME`；枚举/字典码存 `VARCHAR(32)` 英文码，展示文案走字典
- **★ 精度例外（2026-09-13）**：`company.registered_capital`（注册资本）用 **`DECIMAL(16,2)`、单位＝元**——12 位上限约 100 亿元，注册资本存在百亿级以上企业会溢出（`→§四 B1`）
- 表名/字段名统一 snake_case；索引 `idx_` 前缀、唯一 `uk_` 前缀
- 手机号唯一、公司信用代码唯一为**数据库级约束**（撞单兜底，不靠应用层自觉）

### 五铁律在本文件的落点（规则释义见 `→需求§2.1`）
| 铁律 | 落点 |
|---|---|
| T1 加规则=加行不加列 | `business_relation` 等主表永不新增判断列；判断一律进 `cadence_rule` / `dict` / `field_template` |
| T2 录入摩擦趋零 | 除"判死/流失死因点选"外，无任何其他必填（详见 `→需求§11.2`） |
| T3 经理出口只吃留下的 | 所有统计从 `action_event`/回款/工单被动聚合，不设任何"为报表而填"的字段 |
| T4 推导只建议 | `action_event.stage_forward` 为建议值，确认后才落 `relation_stage_log` |
| T5 停用不删 | 字典项/字段模板/规则一律 `status=disabled`，不物理删除 |

---

## 二、ER 总览

```
department ─┬─< employee >─┬─ employee_role ─ role ─ permission_matrix
            │              └─ dept_manager（管辖 N:M）
            └─ dept_rule（等级档位/灰度寿命/节奏默认，部门经理配）
system_config（gm 级全局开关：弹药库可见范围等）
target（月目标：公司/部门/人三层，完成进度按回款额算 →需求§7.11）
product_line ─┬─< field_template（台账扩展字段元数据）
              └─< sea_rule（公海规则 L1-L4）

company ─┬─< company_contact >─ contact ─┬─ contact_change_log
         │                              ├─ contact_trait（谈判特质·默认≤3 部门可配）
         │                              └─ extra_phones JSON（附加号，不撞单）
         ├─ company_profile_tag（身份/制度/决策链，打标人留痕）
         ├─ 地理信息（longitude / latitude，GCJ-02）
         └─< business_relation ─┬─ relation_member（owner / collaborator）
                                 ├─ relation_stage_log（阶段推进留痕）
                                 ├─ relation_label（风险等人补标注，留痕）
                                 ├─< appointment（预约）
                                 ├─< commitment（承诺 ★心脏）
                                 ├─< action_event（事件流 ★谁·何时·对谁·结果）
                                 ├─< contract ─┬─< payment_record
                                 │              └─< contract_split（业绩分配）
                                 ├─< workorder ─< workorder_log
                                 └─< sea_record（入公海历史）

commitment ─< daily_agenda（今日动线，ref 承诺/预约/节奏）
cadence_rule（节奏规则：经理配；含掉海/新客/S级客情/灰度）
competitor（竞品名册：经理维护，销售只读引用）
review（出口复盘 ★转已合作 / 判死 / 流失）
approval（转交 / 协同 / 手机号变更 / 联系方式解锁 / 关系重分配 五型一单）
notification（站内/微信预留）｜ dict_type ─< dict_item
action_event ─< stat_daily（日级行为汇总·派生预聚合）
operation_log（★全局审计日志）｜ job_run_log（定时任务执行日志）｜ visit_log（外出登记：纯行政考勤）
file_asset（文件资产：合同附件/回款凭证，多态 biz_type + biz_id）
```

---

## 三、域 A：组织与权限（`→需求§7.1` §4）

### A1 department 部门
`name`、`parent_id`(0=根)、`service_enabled`(客服开关)、`status`(active/disabled)

### A2 employee 员工
`work_no` UNIQUE、`name`、`phone` UNIQUE、**`username` UNIQUE（可空）**、`password_hash`、`primary_dept_id`、`extra_dept_ids` JSON、`product_line_ids` JSON、`direct_manager_id`(直属经理/审批链)、`status`(active/resigned/disabled)、**`theme`**、**`nav_open` JSON**

> **★ `username`（2026-09-14 新增 · migration `0003`）**：**登录账号名** —— 员工自定、**可空**（为空则只能手机号登录）、**全局唯一**（MySQL 唯一索引允许多个 NULL，故"可空 + 唯一"成立）、大小写不敏感。登录＝**手机号 或 账号名 二选一 ＋ 密码**，两通道共用 `password_hash`（`→需求§7.1` / 接口 §5.2）。V1 由管理员在员工编辑里维护，**不做员工自助改名**。

> **★ `theme` / `nav_open`（2026-09-18 新增 · migration `0009`）**：**个人偏好的唯一落点**。
> ① `theme` `VARCHAR(16)` **可空** ＝ 个人主题（`light` 白天 / `dark` 夜间，V1 两态；→ 设计规范 §八.1「**存账号**」/ 接口 §4.14.9）；
> ② `nav_open` JSON **可空** ＝ 侧栏展开的分组键集合（→ 需求 §13.4「折叠状态**按账号**持久化」）。
> **两列都可空的理由**：「**从未设置过**」与「**显式选了默认值**」是两件事 —— 前者应跟随默认值，后者是用户的明确选择（写 `NOT NULL DEFAULT` 会让两者不可区分，将来默认值一改，存量行就被错当成"用户选过"）。
> **不建索引**：只按主键读 / 写，没有「按 theme 筛人」这类用法。写入端＝`PUT /account/preferences`（**部分更新**）；读取端＝`GET /account/me` 随 `UserVO` 下发（→ 接口 §5.2）。

### A3 dept_manager 管辖部门（经理查数范围 = 本表集合）
`dept_id + employee_id` 联合唯一

### A4 role / A5 employee_role
- role：`code`(sale/service/delivery/admin/dept_manager/gm) + `name` + `is_builtin`；内置 6 条，builtin 不可删
- employee_role：`employee_id + role_code` 联合唯一（一人多角色）

### A6 permission_matrix 权限矩阵
`perm_key` × `role_code` → `level`(visible/masked/denied)。**⚠ 矩阵表达的是「越出本分范围时的兜底档」**；「经理管辖内可见」「销售看自己的」由**数据范围**承担，**不走本表**。

**★ 2026-09-14 重定（3 key × 6 角色 ＝ 18 行）**：

| perm_key | 管什么 | sale | service | delivery | admin | dept_manager | gm |
|---|---|---|---|---|---|---|---|
| `contact_phone` | 详情里的联系方式 | visible | visible | visible | visible | visible | visible |
| `relation_timeline` | 跨部门跟单全文 | denied | denied | denied | **visible**（只读） | denied | visible |
| `contract_amount` | 跨部门合同金额 | masked | masked | masked | masked | masked | visible |

- 旧 key `cross_dept_private`（看他人私海）/ `phone_unlock`（手机号解锁）**已废止**（`→《废止口径登记表》#31`）。
- **联系方式「锁」不进矩阵** —— 由 `contact.phone_locked_at / phone_locked_by` 单独管（`→B3`）。
- `level` 语义：`visible`＝原文 / `masked`＝打码（`amount: null` + `amount_masked`）/ `denied`＝字段不返回。

### A7 product_line 产品线
`name/code` UNIQUE、`color_key`、`dept_ids` JSON(承接部门)、`service_cycle_days`、`status`

> **★ `color_key`（2026-09-15 补，migration `0004`）**：产品线**固定配色键**（「7 条线各一色」，→ 需求 §13.3）。
> 需求 ＋ 接口 §4.1 / §5.3 / §5.6 一直要求该字段，**本表原漏落此列**（接口要返回、表里却没有）⇒ 本次补齐，
> 三处口径对齐，版本升 **V1.31**。**可空**：未配置给 `NULL`，由前端回落 —— **不填假默认色**
> （假默认色会让页面理直气壮地渲染错颜色，且没人会回来改）。
> ⚠ 同为 §13.3 要求的「**部门颜色**在【部门管理】配置」：`department` 表**同样没有色值列**，属**另一缺口**，
> 随组织架构 / 部门管理页（M6）补，本批**只解决产品线侧**（`/relations` 列表项眼前就要用）。

### A8 dept_rule 部门规则（经理可配，写入留痕）
| 字段 | 说明 |
|---|---|
| dept_id UNIQUE | 适用部门 |
| level_tiers JSON | 客户等级金额档位 `[{level:S/A/B/C/D, minAmount}]`——**每部门各自定义**，回款到账事务内自动算等级 |
| gray_remind_days | 灰度 N 天未定性 → 提醒下结论（**★ 2026-09-11：已取消 `gray_release_days` 与"释放候选"——灰度寿命只管提醒，到期照常掉公海**）|
| s_social_days | S 级客户客情节奏默认间隔（建议 45） |
| newbie_first_follow_hours | 新联系人/新关系首次跟进窗口（建议 48h） |
| ask_help_days | @求助临时协同默认有效期（建议 7 天） |
| contact_trait_max | 联系人谈判特质上限（默认 3，范围 1~5；部门经理可配，写入留痕）。调小后存量超限特质保留、仅对新写入/编辑生效（`→需求§9`） |
| nearby_radius_km | 预留：将来做附近客户时的默认半径（V1 不用） |

### A9 notification 通知
`user_id`、`title/content`、`biz_type`(commitment_due/cadence/drop_warn/gray/approval/stage_revert…)、`biz_id`、`channel`(site/wechat 预留)、`read_at`

### A10 operation_log 操作留痕（★ 全局审计日志 · 升级）
| 字段 | 说明 |
|---|---|
| occurred_at | 发生时间（**按月分区**依据） |
| req_id | 请求链路 id（一次操作多行可关联；与系统运行日志的 req_id 打通） |
| operator_id / operator_name | 操作人（**快照冗余**，防离职/改名后查不到人）；系统动作 `operator_id=0` |
| dept_id / product_line_id | 操作时所处上下文（供经理按部门查） |
| action | 统一编码 `模块.动词`。**★ 已实现清单（与代码同源，只增不改 —— 改名＝历史审计断链）**：`account.login.success` / `account.login.fail` / `account.login.rejected`（A 域登录）· `account.preferences.update`（个人偏好，D-37）· `relation.activate` · `relation.update` · `relation.add_member` · `company.create` · `contact.create` · `event.create` · `event.quick_mark` · `commitment.create` · `commitment.update` · `contact.event_create` · `contact.activate_relation` · `sea.claim`（领取公海，F-01）· **`sea.drop`（到期自动掉落，M9-F：**系统动作**`operator_id=0`、**一次任务一条**、批次明细在 `detail`，→ 架构 §7.4 ⑤）** · **`sea.rule_update`（公海规则配置 `PUT /sea/rules`，M9-F：⚠ **"只回预告"的那次调用也留痕** —— 切面按 HTTP 方法判定，落没落库看出参 `applied`）**；**查看类** `event.view`（管理员看跟单全文）· **安全类** `authz.denied`（401 / 403 越权尝试）。**待落（随各自接口）**：`sea.phone.view`（公海看号）· `phone.unlock.*` · `approval.approve` · `company.merge` · `tag.update` · 系统配置 / 字典 / 部门规则修改 |
| target_type / target_id | 操作对象（多态） |
| before / after JSON | **本次变更前/后快照**（审计核心；新增/删除时一端为 null） |
| detail JSON | 补充说明（保留原设计） |
| ip / user_agent | 来源（**解锁看号 / 公海看号 / 导出类必记**，防批量捞号） |

- **写入（2026-09-15 口径扩写 → 架构 §7.4）**——**三条并存、别互相替代**：
  ① **所有增删改**（需求 §4.2 ★ 全量留痕：符合等保、有迹可查）由**统一审计切面**（域 controller 标 `@Audit('模块.动词')` ＋ 全局拦截器）在端点**成功后**自动写：业务成功才落、业务失败不留；**不靠 DB 触发器**（拿不到操作人上下文）。
  ② **敏感动作**（登录 / 改手机号 / 审批 / 公海操作 / 金额改动）**额外**在**业务事务内**写（带 `before/after` 快照）——业务回滚日志一并回滚。
  ③ **查看类**（管理员「每次查看」）走**独立写入**（无业务事务、best-effort、写失败不阻断读）——读路径本就没有业务事务。
- **不可篡改**：**只 INSERT/SELECT，DB 账号无 UPDATE/DELETE 权限**。
- **保留策略**：普通操作日志热存 12 个月 → 冷归档；**敏感动作（`phone.unlock.*`、`sea.phone.view`、导出类）永久保留（≥3 年）**，查询本身也需经理级以上权限。
- **边界**：本表是"谁对什么做了什么"的**审计**，**不替代**领域状态史表（relation_stage_log / contact_change_log / workorder_log / sea_record，那些是业务页面时间线）。两者都写、语义与权限不同，**不合并**。

### A11 dict_type / dict_item 字典
- dict_type：`code` UNIQUE + `name`
- dict_item：`type_id` + `item_code` + `label` + `sort` + `builtin`(内置不可删，可停用) + `status`
- 修改写 operation_log；内置种子见 §十三

### A12 system_config 系统级配置（gm 可改，留痕）
`config_key` UNIQUE(如 `ammo_scope`: dept/company 赢单弹药库可见范围) + `value` JSON + `updated_by/updated_at`

### A13 job_run_log 定时任务执行日志
`job_name` + `run_at` + `status`(running/success/failed) + `rows_affected` + `cost_ms` + `watermark`(处理水位线) + `error`；供排查"今日动线为什么没组装"等；按 `run_at` 月分区、保留 90 天。
- **与 operation_log 分工**：job_run_log 记**系统任务自身**执行情况；operation_log 记**人/系统对业务对象的操作**。二者不可互相替代。

### A14 target 月目标 ★新增（2026-09-10，`→需求§7.11`）
| 字段 | 说明 |
|---|---|
| period | 目标月份 `YYYY-MM`（如 `2026-09`） |
| scope_type | **三层**：`company` 公司 / `dept` 部门 / `employee` 个人 |
| scope_id | 对应 id（company 层填 0） |
| amount | 目标金额 `DECIMAL(12,2)`，**回款额口径** |
| remark 可空 | 备注 |
| created_by / updated_by / 审计字段 | 填写人留痕 |
| 唯一索引 | **`uk_target(period, scope_type, scope_id)`**——同月同层同对象仅一条目标；另有 `idx_period(period)` |

- **目标调整 = UPDATE 本行 + operation_log 留痕**（before/after 存改前改后金额），不新增历史表。
- **★ 完成进度不落表**：完成额按 `period` 从 `payment_record`（JOIN `contract` → `business_relation` 取 `dept_id`/owner）实时 SUM；回款年增数万行，**直接聚合即毫秒级，无需预聚合**。**签约额**同法从 `contract`（`sign_date` 落在当月 + `amount`）取，**并列显示作参考**（回款有账期滞后，销售会感觉"签了单进度不动"）。
- **时间进度**（"时间已过 X%"）由应用层按当月天数计算，不落库。
- **权限**：老板看全部；经理看本部门 + 本部门每个人；销售**只看自己**（延续"销售互查不暴露业绩"）。
- **未来**：若回款量涨到需优化，再建月汇总表（同 `stat_daily` 手法），V1 不需要。

### A15 idempotency_key 幂等键 ★新增（2026-09-20 · migration `0010`，`→接口§2.5`）

> **它是什么**：写操作的「**同一笔请求重发**」记录 —— 同 key 重放**返回首次结果、不重复执行**（防网络重试造成双写 / 双领公海）。

| 字段 | 说明 |
|---|---|
| employee_id | 登录人 id —— **作用域的一半**（「**人 × 端点 × key**」，防跨用户重放） |
| endpoint | `METHOD /路由模板`（如 `POST /relations`）—— **存模板、不存实际路径**（存实际路径会让每个 id 各占一行，唯一键形同虚设） |
| idem_key | 请求头 `Idempotency-Key` 原值（**≤64 字符**；超长服务端 **400**，不静默截断） |
| request_hash | `SHA-256(body)` 的 hex（64 字符）—— **只比 body**；同 key 但指纹不同 → **409 / `20004`** |
| status_code | 首次成功响应码（当前恒 `200` —— §2.3「成功响应一律 200」） |
| response_body JSON | 首次出参（**bigint 已转字符串**）；重放时**原样返回** |
| created_at | 写入时刻（**UTC**，→ `服务端/prisma/README.md §七`）；**24h 内有效** —— 过期行由查询条件忽略 |
| 唯一索引 | **`uk_idem_scope(employee_id, endpoint, idem_key)`**；另有 `idx_idem_created(created_at)`（清理依据） |

- **写入时机**：⚠ **业务成功之后**才写（失败请求不占键）；且**必须等落库完成再放响应** —— 否则「响应已回、键未落」的**紧接着重试**会漏过幂等、直接撞业务唯一冲突（★ 2026-09-20 真库实测踩到，→ 案例库）。
- **为什么独立一张表、不塞进 `operation_log`**：两者**生命周期不同**（幂等 24h 可丢；审计长期留、还按月分区）、**写入时机不同**（幂等=业务成功后；审计=业务事务内）。混表会让"清理 24h 前的幂等行"变成"删审计"的高危操作。
- ⚠ **不防「并发同 key」的双执行**：两个**同时**首次到达的请求会各执行一次（第二个落库撞 `uk_idem_scope` 被忽略）；**竞态类双写（抢公海）由条件 UPDATE 兜底**（→ §10.2-3），不依赖本表。
- ⚠ **24h 过期行的清理任务尚未建**（当前只靠查询条件忽略；行数随写操作增长）→《欠账登记表》。

---

## 四、域 B：客户资产与公司档案（`→需求§7.2` §7.3 §9）

### B1 company 公司（唯一档案）
| 字段 | 说明 |
|---|---|
| full_name | 公司全称，INDEX |
| name_core | **★ 2026-09-12 新增（`→需求§7.3`）**：全称的**标准化核心词**——去地域 / 行业 / 公司类型词（安徽 / 信息技术 / 有限公司 / 股份 / 集团）、去括号与空格、全半角统一、英文大小写归一。**由服务端在建档 / 改名 / 合并时生成并落库**（生成规则见 `→需求§7.3`），INDEX。**两段式查重的第一段走本列**（精确匹配 / 前缀）**收缩候选集**，第二段才在候选集上算编辑距离——否则每录一个客户都要全表比一遍 |
| credit_code | 统一社会信用代码 UNIQUE（可空；撞码强制使用已有档案） |
| industry_l1/l2、province/city/district、scale | 行业/地区/规模 |
| completeness_1/2/3 | 三档完善度 0-100（写入重算） |
| website/address/bank_name/invoice_title/tax_no | **成交后可选补全**（**2026-09-13 起不再强制**；其中 `address` 同时是签约校验清单「注册地址」项的落点，`→E8`） |
| registered_capital | **★ 2026-09-13 新增**：**注册资本** `DECIMAL(16,2)`、**单位＝元**、可空。**可选扩展字段——不参与签约强制、不计入完善度**；用于档案留存与**按规模筛选**（如"注册资金 > 100 万"＝ `> 1000000`）。**录入 / 展示一律按「万元」**（前端换算，展示 `xx万`）。**不建索引**：区间筛选命中面大（选择性低），数据量增长后再按实际查询评估 |
| legal_person | **★ 2026-09-13 新增**：**法定代表人** `VARCHAR(64)`、可空。**可选扩展字段——不参与签约强制、不计入完善度**；姓名类长度，含少数民族 / 外籍译名余量 |
| longitude / latitude | **经纬度** DECIMAL(10,6)/DECIMAL(9,6)，可空。建档时人工调高德拾取器点选；**非必填**；坐标系 **GCJ-02** |
| merged_into | **合并墓碑**：自引用 FK（`company.id`，可空）。非 NULL = 本档案已并入该公司、物理不删、永远可审计（撞码合并流程见 `→需求§7.3`）。合并时 B.`merged_into`=A.id、B.`credit_code` 置 NULL（释放唯一位） |
| aliases | **曾用名/别名** JSON：`["安徽鑫中网网络有限公司"]`。合并时收进被并入方的全称，供查重兜底与展示 |

> **★「老客户」徽标（派生展示，不加字段 · `→需求§8.1`）**：公海卡片 / 公司抽屉上的「老客户」标记，判断依据 ＝ **该 `company` 下存在历史合同**（`contract.company_id` 有记录，**不限于当前活跃关系**）。**跨部门场景尤其重要**——A 部门签过约、B 部门重新领取时，B 的关系下没有合同，但**公司级**能查到。符合"系统能推导的不设标签"（`→需求§九`）。

### B2 company_profile_tag 公司档案标签（身份/制度/决策链）
`company_id` + `group_code`(company_identity_tag 多选 / company_policy_tag 多选 / decision_chain 单选) + `tag_id` + `tag_code`(冗余防字典改名) + `marked_by/marked_at`(打标人留痕)
- 联合唯一 `uk(company_id, group_code, tag_id)`；决策链每组仅 1 条（应用层保证）
- 建档人工勾一次、全公司共享、不随部门隔离；覆盖式更新，删除物理删行（留痕见 operation_log）

### B3 contact 联系人
| 字段 | 说明 |
|---|---|
| name / phone | phone = 当前主号（撞单校验核心）。唯一约束**改走生成列 `phone_active`**：未删行才占号、软删/换号自动释放（见 §10.2-2） |
| extra_phones JSON | **附加号**：`[{type: mobile/tel/wechat, number, note}]`，可多个；仅作联系参考、**不参与撞单**、无唯一约束（`→需求§7.2`） |
| wechat/email/birthday | 联系方式 |
| gender | 性别。**值域 ＝ `male` / `female` / `unknown`**（★ 2026-09-20 定值域，→《欠账登记表》D-49②）：`unknown` ＝「**明确不便说**」，与「**从未填过**」（`NULL`）**不是一回事**（同 A2 `theme` 的"从未设置 ≠ 显式选默认"口径）；非法值服务端 **400** |
| decision_role | decision/influence/execute（决策/影响/执行） |
| tags JSON | 个人自由标签（爱喝茶/老板亲戚…），与谈判特质分栏并存 |
| trait_summary JSON | 谈判特质冗余（从 contact_trait 派生展示） |
| status | active/left/freelance |
| merged_into | **联系人级合并墓碑**：自引用 FK（`contact.id`，可空）。非 NULL = 本联系人已并入该 winner；物理不删、traits **并集**、子记录零改动；统一视图聚合（见 `→需求§7.2` 合并联系人） |
| phone_frozen_until | 手机号变更审核冻结期（24h） |
| **phone_locked_at / phone_locked_by** | ★ 2026-09-14 新增（migration `0003`）：**联系方式「锁」**。`phone_locked_at` NULL=未锁；`phone_locked_by`＝**落锁人**（＝解锁申请审批人）。锁**全局生效**（A 部门锁了 B 部门也看不到）、**仅该联系人归属关系的 owner 可上锁**（协同人 / 经理不能）；**落锁人不再持有该联系人任一活跃关系（离职 / 转岗 / 掉公海）→ 锁自动消失**；总经理 / 管理员可强制解锁（须留痕）。**无外键**（与 `created_by` 等审计列口径一致）（`→需求§4.3 二`） |
| **owner_id** | ★ 2026-09-16 新增（migration `0007`）：**待关联（未挂公司）联系人的归属人**。「先只有手机号、后来才问到公司」是常态（约 **30%**），故这批人要有明确归属 —— 建档时写**录入人**；**已挂公司的联系人不看本列**（归属走 `business_relation` 的 owner 成员）。**可空、无外键**（与 `created_by` 等审计列口径一致）；**归属可改**（经理分派 / 离职交接，**不走审批、只留痕**）；**未关联公司期间不占部门、不占产品线**（部门 × 产品线是**关系**的属性，→ 需求 §6.1 ⑦~⑪） |

### B4 contact_trait 联系人谈判特质（默认 ≤3，部门可配）
`contact_id` + `trait_id/trait_code` + `marked_by/marked_at`；联合唯一；**每人上限 = 所属部门 `dept_rule.contact_trait_max`（默认 3，范围 1~5）**（超出 **422+20402**）；**★ 2026-09-11 明确：422 只拦「新增」——更新后数量 ≤ 当前已有数量则放行**（否则经理调小上限后，存量超限特质连编辑都做不了）；**经理调小上限后存量超限特质保留**；特质跟着人走（换公司保留）

### B5 company_contact 就职关系（N:M 含历史）
`company_id + contact_id + is_current + joined_at + left_at + position`；一人多段就职全留痕

### B6 contact_change_log 联系人变更留痕
`contact_id + field + old_value + new_value + approval_id`；手机号变更必须关联审批单
- 旧号写入本表即成为**历史号**；撞单检测时可回查本表 → 命中则提示"该号曾属于 XX"（提示不拦截，`→需求§7.2`）

### B7 地理坐标（只存字段，地图应用不在本架构定义）
- **就两个字段**：`company.longitude/latitude`，**不建独立地址表、不加精度/来源/状态/行政区划等任何附属字段**（`→需求§7.3`）
- **一家公司一个地址一个坐标**（V1 单地址）
- 坐标一律**人工用高德坐标拾取器点选**，不做地址自动解析；非必填
- 坐标系统一 **GCJ-02**（换底图在出口层转，库内不动）
- 列表「地址是否维护」为**派生展示**（`address` 或 `longitude` 为空 → 显示"未维护"），**不新增字段**
- 索引 `idx_geo(latitude, longitude)` 预留，极低开销，供将来按经纬度范围检索

### B8 file_asset 文件资产 ★新增（2026-09-10，`→需求§7.6`）
| 字段 | 说明 |
|---|---|
| biz_type / biz_id | **多态归属**：`contract` 合同附件 / `payment` 回款凭证 / `workorder` 工单附件 / `company` 公司资料 / `review` 复盘附件 等 |
| file_name | 原始文件名（展示 / 下载用） |
| file_key | **对象存储 key 或相对路径**——**不存全 URL**（便于日后换存储、换域名不改数据） |
| file_size / mime_type | 大小、类型（前端预览用） |
| uploaded_by / uploaded_at | 上传人、时间 |
| status | active / deleted（**停用不删 T5**） |
| 索引 | `idx_biz(biz_type, biz_id, status)`（按对象取附件）、`idx_uploader(uploaded_by, uploaded_at)` |

- **为什么建表而不在各业务表塞 JSON**：① 附件要能**独立检索**（谁传的、何时、多大）；② 换存储（本地 → 对象存储）时**不动业务表**；③ 原设计 `payment_record.voucher_file_id` 是**悬空外键**（没有文件表），本表补上这个洞。
- **与跟单里 `action_event.attachments` JSON 的分工**：**要归档、要检索的正式资产**（合同扫描件、回款凭证）走本表；**跟单时随手拍的图**可继续走 JSON，二者不冲突。

---

## 五、域 C：业务关系与归属协同（`→需求§5` §8 §10）

### C1 business_relation 业务关系 ★收敛（只留归属与两轴）
| 字段 | 说明 |
|---|---|
| company_id / dept_id / product_line_id | 三元组。**★ `dept_id` 恒定不可变**（2026-09-10 定）：掉公海只改变"有没有 owner"，**不改部门**——因此不存在"跨部门领取导致改部门"、不存在历史归属断层；别的部门想要这个客户＝自己激活一条本部门的关系（因本表唯一约束含 `dept_id`，互不冲突）（`→需求§6.3`） |
| stage_id | 工作流阶段引用（**7 步**：1~6 见 `→需求§8.1`；**7 = 已流失**，churn 提交时置位，标记**本轮生命周期结束**）。**★ 判死与流失均掉回公海**（2026-09-10 定）：判死**阶段保留**（停在谈到那一步，接手人能接着谈）、流失**阶段置 7**；二者关系都转 `sea_status='company_sea'` 可被重新领取，**重新领取后阶段从 1 重新开始**，`relation_stage_log` 保留上一轮历史（`→需求§8.1`） |
| urgency | weekly/monthly/quarterly/long_term/gray(默认)。纯手动、无自动降级。**gray 不豁免掉海规则**（`→需求§8.2`） |
| value_tier | high/medium/low/pending(默认空)。手动。**★ 校验（2026-09-10 定）**：**`urgency != gray` 的关系必须已标 `value_tier`**——紧迫档离开灰度时服务端 422 拦截（一个点选，系统给建议值，`→需求§9`） |
| customer_level | S/A/B/C/D。**★ 口径写死（`→需求§8.3`）**：＝ **本关系（本部门 × 本产品线）滚动 12 个月回款额**；回款到账事务内按 `dept_rule.level_tiers` 自动算、**不手填**、每日重算、**跨年不清零**。**统计口径**：看板"S 级客户 N"默认按**关系数（条）**；按公司去重时取该客户全公司最高等级——**报表须标注"条/家"** |
| competition | **竞品态势快照**（可空=未知）：none/in_use/comparing。**录入不在此表**——写事件(D2)时顺手标记并回写；列表/推导读本字段 |
| competitor_id 可空 | 关联 `competitor` 名册（最近一次标记对象），由事件回写 |
| sea_status | **语义＝"这条关系当前有没有主人"**：`private` 私海（有 owner）/ `company_sea` 公海（无 owner）。**部门公海 = `company_sea` 中 `dept_id`=本部门的关系集合**（映射视图，非独立状态、非独立池）。**掉落只改本字段，`dept_id` 不变**（`→需求§6.3`） |
| last_event_at | **最近一次「有效沟通」事件时间**（**快速标记不计入**，见 D2）——INDEX 供预警扫描与掉海倒计时（`→需求§6.3`） |
| next_action_hint | 可空：一句话"上次说好下次干嘛"（从最近承诺/事件冗余） |
| merged_into | **关系级合并墓碑**：自引用 FK（`business_relation.id`，可空）。非 NULL = 本关系已并入该 survivor 关系、置**非活跃分支**（不占 `uk_active_rel` 活跃位）；其跟单/承诺等子表仍挂本关系节点，展示层作为分支（见 `→需求§7.3` ⑦ 树呈现）。公司合并时，与 A 同部门同产品线撞 `uk_active_rel` 的关系走此路径 |
| 唯一索引 | `uk_active_rel`：同 公司+部门+产品线 仅一条**未删未并**的关系（生成列 `active_key = IF(deleted_at IS NULL AND merged_into IS NULL, 三元组, NULL)` 实现 —— **★ 2026-09-21 起：公海也占位**（掉公海**不释放**；"重新开始一轮"走**领取同一条**，→ 需求 §6.3 /《欠账登记表》D-53）；**被并分支** `merged_into IS NOT NULL` 与**逻辑删除** `deleted_at` 均不占位） |

> **T1 落点**：本表不再新增任何判断列。判断一律走：承诺（行动）、cadence_rule（节奏）、事件流统计（健康度）。

### C2 relation_member 关系成员（owner / collaborator）
| 字段 | 说明 |
|---|---|
| relation_id / employee_id | 关联 |
| member_type | **owner**（主责销售，1）/ **collaborator**（协同人：正式协同或被@求助者，多） |
| source | `collaborate` 协同审批通过 / `ask_help` @求助即时授予 |
| valid_until | 仅 collaborator：有效期（到期自动失效，解除读写权与全号可见）；NULL=长期（仅正式协同） |
| added_by/added_at、revoked_by/revoked_at | 授予与撤销留痕 |

- **正式协同**：owner 或经理发起、审批通过（source=collaborate）
- **@求助（ask_help）= 轻量临时协同**（`→需求§3` 术语）：owner 写事件 @ 同事即时授予**与正式协同相同**的权限；默认 7 天自动收回（dept_rule.ask_help_days 可配）、owner 可随时撤销、全量留痕、**免审批**。想长期共同跟进必须走正式协同审批
- **主责变更**（`→需求§5.2`）：换人=transfer 审批；短期=带期限 collaborator；**离职=管理员批量转交**（payload 支持清单）
- **索引**：`uk(relation_id, employee_id, member_type)` 防重复授予；**`uk_owner(owner_flag)` 保证一关系仅一 owner**（生成列＝**只有在位（未撤销）的 owner** 占位，见 §10.2-1）；`idx(employee_id, member_type, valid_until)` 供"我协同 / @我"列表与有效期扫描（§十七 A.3）；`idx(relation_id)` 供关系内成员查询

### C3 relation_stage_log 阶段推进留痕
`relation_id + from_stage/to_stage + action(normal/jump/rollback/lost) + reason + operator_id`
- **★ 历史轮次与终态（P0-④⑤ 配套，`→需求§8.1`）**：判死（reason=dead）阶段**保留**、流失（reason=churn）阶段**置 7**，二者均掉回公海可被重新领取（V1.13）；**重新领取后新一轮从阶段 1 重来**，上一轮的阶段推进留痕保留在本表（按 `relation_id` 全量可读，配合 `sea_record` 还原各轮时间线）。`lost` 动作＝流失终态留痕；判死不新增动作行（由 `sea_record.reason=dead` 记载），避免与本表"阶段推进"语义混淆。
- **★ 回退知会经理（2026-09-11 七叔定，`→需求§8.1`）**：`action=rollback`（阶段往后退）时，除正常写本表留痕外，**额外触发经理 `notification`（`biz_type=stage_revert`，→A9）**——经理只收到知会、不审核、不拦截，流程照走。让经理知道"谁把哪单从哪退到哪"即可。（阶段往前推＝销售一键确认即生效、系统不要求证据、经理不审核，防糊弄靠「阶段 N 天未推进」闸门。）

### C4 relation_label 关系级标注（风险等人补标签）
`relation_id + group_code(risk/other) + label_id/label_code + marked_by/marked_at + remark`；联合唯一 `uk(relation_id, group_code, label_id)`。自动风险信号不落库，由规则从事件流实时派生只读回传

### C5 appointment 预约
`relation_id + contact_id + appointment_at + note + status(pending/done/rescheduled/expired_archived) + action_event_id`(完成时强制关联事件，**422**)；改期留 `reschedule_log` JSON

### C6 visit_log 外出登记（纯行政考勤 · 2026-09-10 精简）
`employee_id` + `depart_at`（出去时间）+ `reason`（**去干什么，一句话**）+ `actual_return_at`（**回来点一下记时间**，可空＝还没回）+ `relation_ids` JSON 可选（去了哪些客户，**可不填**）
- **已删除字段**：`expect_return_at`（预计返回）、`transport`（交通方式）、`destination`（目的地，并入 reason）、`note`（并入 reason）——七叔要求"**不要扯其他乱七八糟的**"。
- **不自动产生任何业务事件、不关联报销**；拜访结果由销售**自行决定**是否写 `action_event(visit)` 或完成预约（422）。
- 索引：`idx_emp_time(employee_id, depart_at)`

### C7 competitor 竞品名册（轻量主数据，非"档案库"，`→需求§11.1`）
| 字段 | 说明 |
|---|---|
| name + product_line_id | 联合唯一 `uk(name, product_line_id)`——竞品按产品线归属 |
| positioning | 一句话定位（**不是**价格表/功能对照表） |
| note 可空 | 补充 |
| created_by / updated_by | **只允许 `dept_manager` 维护**（**2026-09-15 定版**：需求 §11.1「竞品名册**经理维护**」——**不含管理员**，管理员对业务数据一律只读，→ 需求 §4.2）；销售只读引用 |
| status | active/disabled（停用不删） |

---

## 六、域 D：行动引擎 ★（`→需求§10`）

### D1 commitment 承诺表 ★心脏
| 字段 | 说明 |
|---|---|
| relation_id / contact_id 可空 / owner_id | 所属关系、对着谁、承诺人 |
| party | **me**(我答应客户) / **them**(客户答应我) / **verdict**(我定的检查/判定点) |
| ctype | reply/quote/meet/deliver/decision/followup/social_meal/social_gift/social_greeting |
| content | 一句话承诺内容 |
| due_at / remind_at | 到期时间 / 提醒时间（默认到期当天清晨） |
| status | open / **done**(兑现) / **expired**(逾期，**派生态**：按 `due_at` 算) / **waived**(豁免) / **cancelled**(取消)。**★ 取消与豁免的分界（2026-09-15 定）**：`cancelled`＝**录错了 / 这事不成立了**（**不需原因**）；`waived`＝**确有其事但做不成**（客户变卦、特殊原因做不了…，**必填原因**）（`→需求§10.1`） |
| **waive_reason 可空** | **★ 豁免原因（2026-09-15 补列）**：`status=waived` 时**必填**（应用层 422），其余状态一律 `NULL`。**本列是「规格要求了、表里原先没有落点」的补齐**——`waived` 一直在 `status` 白名单里，但 D 域此前不敢开放写入（收下原因却无处可存＝假契约）（`→需求§10.1`） |
| done_at / done_by | 兑现时间/人 |
| source_event_id / closed_event_id 可空 | 由哪条事件产生 / 哪条事件证明兑现 |

- 索引：`idx(owner_id, status, due_at)`、`idx(relation_id)`

### D2 action_event 事件流 ★
| 字段 | 说明 |
|---|---|
| relation_id **可空** / contact_id **可空** / actor_id | 关系、联系人、操作人（销售或 system）。**CHECK 约束：`relation_id` 与 `contact_id` 至少一非空**（两皆可空＝跟单无主体，写入时服务端 422）。配合 需求§6.1 模型 B「待关联公司」——未激活关系时跟单/快速标记/承诺只绑 `contact_id`，关联公司激活关系后由服务端批量回填 `relation_id`。 |
| action_type | phone/wechat/visit/onsite/email/**meal**/**gift**/**greeting**/**ask_help**/note/system |
| summary | 一句话结果（≤200 字）。**快速标记（outcome ∈ 三型 quick_mark）时允许为空**——点一下即落库，不强制写字（`→需求§10.2`） |
| outcome 可空 | **有效沟通**：advanced / stalled / await_reply；**快速标记（无效沟通）**：**`not_contacted`（未联系）/ `no_answer`（未接电话）/ `brief_hangup`（说两句挂了）**；空＝中性（**非必填**）。快速标记**支持批量**（一次勾多个关系批量写入）（`→需求§6.3` / §10.2） |
| stage_forward 可空 | 系统建议的下一阶段（**限频**：距上次阶段变更 ≥3 天 或 跨里程碑才建议） |
| pain_point_id 可空 | 卡点字典项 |
| competition 可空 | 本次跟单竞品态势 none/in_use/comparing，事务回写 C1 快照。**UI 口径：折叠成一行，默认"无"跳过** |
| competitor_id / competition_note 可空 | 本次标记的竞品 / 一句话情况（≤100 字） |
| duration_min 可空 | 本次投入分钟（算单位时间价值） |
| mentioned_user_ids JSON | @求助的同事；**@ 即授予临时协同**（见 C2）。**仅用于跟单卡片展示"本条 @了谁"（正向读）；权限与可见性已由 C2 relation_member 承担，不拆关联表、禁止在该列做反向 `JSON_CONTAINS` 全表扫描**（详见 §十七 A.2） |
| source | manual / auto / import |
| visit_log_id / appointment_id 可空 | 关联外出/预约 |
| idempotency_key UNIQUE | 防重复提交 |
| attachments JSON | 附件 |
| owner_snapshot 可空 | **P0-④⑤ 新增**：本条跟单创建时该关系 `business_relation.owner_id` 的**冗余快照**——与 `actor_id`（操作人）区分：跟单"归属哪一轮、当时归谁所有"由本列定，支撑"按归属轮次分组 + 前主人归组"（→需求§7.5 / §8.1）。重新领取开启新一轮后，新 owner 写的跟单 `owner_snapshot`=新 owner；前主人轮次的跟单仍保留旧 `owner_snapshot`，据此归组并标姓名，无需新表。 |

- 索引：`idx(relation_id, event_at)`、`idx(actor_id, event_at)`、`idx(pain_point_id)`、`idx_contact(contact_id, event_at)`（供"待关联公司"的联系人查其孤儿跟单 / 补关联时批量回填）、`idx_rel_owner(relation_id, owner_snapshot, event_at)`（**P0-④⑤ 新增**，供"按归属轮次 + owner 分组"拉取某关系全部跟单）
- **展示口径（决策 #30 · #56 · `→需求§7.5` / §8.1；分界基准 2026-09-10 修正，P0-④⑤ 加轮次分组）**：跟单列表**默认近 1 个月**（按 `event_at` 倒序分页，可切"全部"）；**分界基准 = 该关系的主跟单人（owner），不是"当前登录人"**——`actor_id`=**该关系 owner** → **主线**，否则（协同同事 / 合并前其他销售）→ **树杈分支**（合并关系按 `C1.merged_into` 归类）。**经理 / 老板打开时看到的就是「主跟单人的视角」**（否则经理不是 owner，会看到全是树杈、没有主线）。**P0-④⑤ 新增"按归属轮次分组"**：以 `sea_record` 划分轮次（一轮＝一次从私海到掉回公海的完整周期；轮次号＝已掉海次数+1，派生不落表），跟单先按轮次分组、轮次内再按 `owner_snapshot` 归组——**本轮 owner 走主线/树杈，前主人轮次按 `owner_snapshot` 归组并标姓名**；新 owner 本轮尚无跟单时明确提示"以下是前主人记录供参考"。**复用现有 `idx(relation_id, event_at)` / `idx(actor_id, event_at)` / `idx_rel_owner`，不新增字段、不做"疑似重复"等智能判断**
- **★ 快速标记口径（`→需求§6.3` / §10.2，2026-09-10 定）**：无效沟通也**必须写一条事件**（`outcome` ∈ `not_contacted` / `no_answer` / `brief_hangup`；`summary` 可空），否则"这个客户打过多少次"统计失真。批量标记＝一次请求写多行，逐行落 `action_event`（行数不多，无需额外汇总）。
  - **⚠ 关键：快速标记『不』更新 `business_relation.last_event_at`**——只有**有效沟通**事件才更新它。否则销售对 100 个客户点一下快速标记，`sea_rule` 的跟进倒计时就被刷爆、客户永不掉海。
  - **实现**：`last_event_at` 回写逻辑中**排除** outcome ∈ 三型 quick_mark 的事件；"最近 30 天尝试联系 N 次"另行按这三型 COUNT（走现有 `idx(relation_id, event_at)`）。
- **★ 多联系人口径（2026-09-11 七叔定，`→需求§6.3` / §10.2；无表结构变更）**：一条 `relation_id` 下可**同时**存在多个 `contact_id` 的事件（老板 / 招商 / 财务各跟各的）——**见谁都算有效跟进**：`last_event_at` 回写与"跟进次数"统计**一律计入，不按 `contact.decision_role` 区分含金量**。
  - **不新增"关系级关键决策人"字段 / 关联表**：`decision_role` 是 `contact` 自身属性（跟人走、跨业务线复用）。若按关系再存一份，同一人在法律线是决策人、在财税线是影响人时会产生**双重维护与口径打架**。
  - **提醒触发同口径（对应需求 §6.3 / §10.3，2026-09-11 七叔定）**：关系下新增联系人触发首跟提醒（`dept_rule.newbie_first_follow_hours`，建议 48h）时，**以 `contact.decision_role` 作为是否催的判据**——决策人/影响人催，执行人/未定不催。提醒生成逻辑读 `contact.decision_role`，**不新增字段、不新增表、不新增索引**。
  - **防"吊着"的闸门是 `sea_rule` 的「N 天阶段未推进」，不是"见了谁"**——只见执行人刷跟单、阶段不动，照样掉海。**经理盯的是阶段/工作流变化**（复用 `relation_stage_log` 与 `business_relation.stage_id`，无需新数据）。
  - **录入**：`contact_id` 选填；关系下已有联系人时前端默认带出上次跟进的联系人（`idx(relation_id, event_at)` 取最近一条），**一点即选、不选也可提交**，不硬卡（T2）。
  - 查询复用现有 `idx(relation_id, event_at)`（时间线混排）与 `idx_contact(contact_id, event_at)`（按人回看），**不新增索引**。

### D3 cadence_rule 节奏规则（加提醒=加行）
| 字段 | 说明 |
|---|---|
| scope_dept_id / scope_line_id 可空 | 空=全局默认；部门可覆盖 |
| trigger JSON | 触发谓词：如 `urgency=weekly`、`urgency=gray & 距最近事件>gray_remind_days`、`新关系无事件>newbie_hours`、`已合作S级 & 距最近social>s_social_days`、`距掉海<=3天` |
| suggest_action | 到点给什么建议（文案 + 动作类型） |
| soft | 是否"仅提醒不催"（S 级客情=soft；掉海预警=非 soft） |
| enabled / sort | 启停 / 优先级（命中多条取最高） |

### D4 daily_agenda 今日动线（每日组装产物）
| 字段 | 说明 |
|---|---|
| user_id + biz_date | 谁、哪天 |
| ref_type / ref_id | commitment / appointment / cadence / relation(掉海硬提醒) |
| relation_id / contact_id | 冗余方便直达 |
| reason / priority / action_hint | 为什么今天该找 TA / 优先级 / 建议动作 |
| status | open / done / snoozed / ignored |
| action_reason | **★ 2026-09-11 补**：ignored 必填原因 / snoozed 备注（`→需求§10.4`，防逃逸） |
| snooze_count | **★ 2026-09-11 补**：本条被 snoozed 次数——支撑「同一条最多 snooze 3 次，第 4 次起强制 done / ignored」（`→需求§10.4`） |

- 组装规则与**降噪收敛**（逾期>3 天收入"逾期抽屉"、硬约束永远置顶、ignored 7 天不重复）及**防逃逸规则**（snoozed 上限 3 次、ignored 须填原因且经理可见、长期停滞自动降权）见 `→需求§10.4`
- **组装方式 = 结转 + 新增（禁止"清空重写"）**：每日组装时先处理昨日遗留（`open` 行按规则结转/失效，`snoozed` 到期行推今日），再插入今日新命中的条目；`done`/`ignored` 状态跨天保留、不重复推。**理由**：避免行数线性膨胀、重复提醒、以及"整表重写导致处理状态丢失"。
- **失败兜底**：本表是**预计算缓存**（真相源为 commitment/appointment/cadence/relation），05:00 任务失败时销售首页**实时用同一套组装逻辑现算兜底**，绝不返回空白；任务失败自动重试并告警（执行记录方案见日志设计）。
- **生命周期**：**不分区**（**2026-09-12 调整**：本表因「保外键」放弃分区，见 §十五.5 第 2 条）；`done`/`ignored` 超期（建议 30/90 天）定期清理。

### D5 卡点字典（走 dict，不建表）
组 `pain_point`，种子见 §十三

### D6 review 出口复盘 ★（`→需求§11.2`）
| 字段 | 说明 |
|---|---|
| relation_id / review_type | **win** 新签 / **loss** 判死 / **churn** 已合作流失 |
| why_code 可空 | 主因码，走字典（review_win_reason / review_loss_reason / review_churn_reason） |
| competitor_id 可空 | **可选、不点名**；未点名按"有竞品"归并统计 |
| detail 可空 | 复盘正文（≤200 字）。win 销售可填可不填；loss 可缓次日；churn 经理回访后填 |
| manager_note 可空 | 经理批注 / churn 回访结论 |
| status | open(win 待处理) / published(收录进弹药库) / dismissed(不收录) / closed(loss·churn 闭环) |
| created_by / manager_id / manager_done_at | 留痕 |

**三型流转**（完整规则见 `→需求§11.2`）：
- **win**：转已合作（stage→6）时**系统自动建档**（open）→ 经理可修订 detail、补批注 → published（进弹药库，默认本部门可见，gm 可设全公司）/ dismissed。S/A 级必须逐条处理，B/C/D 超 30 天未处理自动 dismissed
- **loss**：判死弹窗，**死因点选必填（422）**；文字次日缓写；status 直接 closed
- **churn**：流失统一出口，原因=标签（单选主因）；S/A 级经理必须回访并写结论

### D7 stat_daily 日级行为汇总（★ 派生 · 经理统计性能层）
| 字段 | 说明 |
|---|---|
| biz_date | 统计日期（**分区键**） |
| dept_id / product_line_id / owner_id | 维度（可按部门 / 产品线 / 人汇总） |
| action_type | 动作类型（phone/wechat/visit/…；可加 `_total` 汇总行） |
| cnt / first_at / last_at | 次数 / 当日首次 / 末次 |

- **性质**：`action_event` 的**派生预聚合**（非"为报表而填的字段"，不违反 T3）——真相源仍是事件流。
- **写入**：每日定时任务从 `action_event` 按 `biz_date × 维度 × action_type` GROUP BY 回填；**按 biz_date 可覆盖重跑**（幂等），并记 `job_run_log` 水位线。
- **用途**：经理看板、跟进频率/健康度等**按部门/产品线/人聚合**的统计**一律读本表**；只有"点进去看具体哪几条"才回 `action_event` 钻取。
- **不含关系（客户）维度**：单客户级统计（如**公海卡片"近 30 天 N 次"**）不走本表——按列表页的关系 id 集合做**一条 `GROUP BY relation_id` 批量查**（走 `action_event.idx(relation_id, event_at)`），一页一次查询即可，无需为此再建表。
- **索引**：`uk_stat(biz_date, dept_id, product_line_id, owner_id, action_type)`、`idx_owner_day(owner_id, biz_date)`；保留策略同 `daily_agenda`（分区 + 超期归档）。
- **★ 报表取数口径（2026-09-12 定，`→需求§7.10` / §十六 N10）**：本表只解决"**行为**"类统计。**关系状态变化类**指标（每日新增关系 / 成交 / 掉公海）**直接按基表时间戳按天聚合**——`business_relation.created_at` / `contract` 签约时间 / `sea_record.dropped_at`（各走自身索引），**不为报表另建快照表**。**"历史时点存量"类**（如"上月末各部门公海条数 / S 级客户家数"）**V1 不做**：`sea_status` / `customer_level` 只存当前值、历史时点无法回算；将来需要时由 V2 快照表解决——`sea_record` ＋ `relation_stage_log` ＋ `created_at` 时间轴完整，**历史可回填**。

> **统计口径**：所有"看数"走 stat_daily（读小表、毫秒级）；所有"看明细"回 action_event。这是经理统计从"每次扫几百万行"降到"读几万行"的关键一层。

---

## 七、域 E：交易与服务（`→需求§7.6` §7.7 §6.4）

### E1 contract 合同
`contract_no` UNIQUE + `relation_id` + `product_line_id` + `contact_id` + `signer_id`(**签单人锁定=业绩归属，终身不变**) + `amount` + `paid_amount` + `pay_type` + `sign_date` + `service_start/end` + `auto_renew` + `remind_days` JSON(30/60/90) + `attachments` JSON + `status`(unpaid/partial/running/done/terminated)

> **维护归属**：维护责任跟**业务关系当前 owner** 走（`→需求§5.2`），**不再单独设 maintainer 字段**——避免签单人/维护人/owner 三套归属打架。

> **★ 疑似重复合同（2026-09-12，`→需求§7.6`）**：**不新增表、不新增列**。`contract_no` 唯一约束（`uk_contract_no`）已在库层拦死"同号重复"；**"逻辑重复"（同一笔真合同两个不同编号）由应用层按规则检测**——`GET /contracts/suspected-duplicates`：**同 `company_id`（经 `relation_id` 归到同一家公司）＋同 `signer_id` ＋同 `amount` ＋`sign_date` 相近（默认 ≤7 天）** 分组返回可疑对。**系统只列清单给经理，不自动合并 / 不自动拦截 / 不自动删**（`→需求§十六` N7）：同公司同金额可能是两笔真合同（续费/增购），**判定重复是人的活**。

### E2 payment_record 回款流水
`contract_id + amount + paid_at + method + voucher_file_id + created_by`；事务内更新 contract.paid_amount/状态，按 dept_rule 重算 customer_level，写 ledger

### E3 workorder 工单
`order_no` UNIQUE + `type`(after_sale/opportunity) + `relation_id` + `title/content` + `source` + `priority`(P0-P3 仅售后) + `assignee_id` + `sla_deadline` + `est_effort_min` 可空(工时估算点选) + `status`(created/assigned/processing/confirming/closed) + `upgraded_from_id`(升级互链)

### E4 workorder_log
`workorder_id + action + from_status + to_status + reason + operator_id`（升级必填原因）

### E5 ledger 客户台账
`contract_id + company_id + product_line_id + customer_level + sign_date + expire_date` + **通用字段（★ 2026-09-11 明确落列：`contact_id` 联系人 / `sales_id` 销售对接人 / `delivery_id` 交付对接人 / `remark` 备注）** + `extra_fields` **JSON**（Key 必须已登记 field_template，未登记拒收）；索引 `(product_line_id, expire_date)`；高频统计 Key 走生成列+索引（DBA 逐个评估）

### E6 field_template 字段元数据（登记唯一入口）
`product_line_id + field_key`(`uk(product_line_id, field_key)`，保存后不可变) + `label` + `control_type`(text/number/date/select/multiselect/link，**不可变**) + `required/sort/show_in_list`(可改) + `options` JSON + `status`(active/disabled)

### E7 contract_split 合同业绩分配 ★新增（2026-09-10，`→需求§7.6`）
| 字段 | 说明 |
|---|---|
| contract_id | 关联合同 |
| employee_id | 参与业绩分配的人 |
| percent | 分配比例 `DECIMAL(5,2)`（**合计须 = 100**，应用层校验 422） |
| created_by / created_at | 留痕 |
| 索引 | **`uk_split(contract_id, employee_id)`**、`idx_employee(employee_id)`（按人汇总业绩） |

- **默认不写本表**：无分配记录 ＝ 业绩 **100% 归 `contract.signer_id`**（"谁签的算谁的"）。
- **已删除**：原"介绍费 10%"相关规则（费率配置表、分成审批流、跨部门介绍费）**一律不做**（`→需求§14.2`）。
- **★ 报表口径统一走视图**：建 `v_contract_performance` ＝ `contract × contract_split`（无 split 则 `signer_id` 占 100%），**业绩统计一律读这张视图**，避免每处 SQL 各写一遍 `COALESCE` 造成口径漂移。
- **业绩分配改不改签单人？** 不改。`contract.signer_id` 仍是签单人（锁历史）；`contract_split` 只影响**业绩怎么摊**（`→需求§5.2`）。

### E8 sign_checklist 签约校验清单 ★新增（2026-09-11，`→需求§7.3`）
`product_line_id` + `scope`(company/relation/ledger) + `field_key` + `label`(中文显示名，弹窗用，前端不硬编码) + `required`(bool，可改) + `sort` + `status`(active/disabled，T5 停用不删)
- **唯一约束** `uk_line_scope_field(product_line_id, scope, field_key)`——同产品线同层级同字段仅一条配置。
- **字段来源（三层）**：
  - `scope=company`：`field_key` ∈ {credit_code, address, industry_l1, province}；**公司级，补全一次全公司共享**——校验看 `company` 表该列非空即过，**不论谁、哪条线补的**。**★ 2026-09-13 收敛两处**：① 去掉 `registered_capital` / `legal_person`——二者改为公司档案**可选扩展字段**、不做签约强制（`→需求§7.3`）；② 原 `registered_address` / `industry` / `region` 是「逻辑名」，`company` 表**没有同名列**（原写法导致校验「逐项查字段非空」**写不出 SQL**）→ 一律改**真实列名**：注册地址 → `address`、行业 → `industry_l1`、地区 → `province`（**每项取主列判定**，二级 / 细分列不单独卡）。
  - `scope=relation`：`field_key` ∈ {value_tier, contact}；校验看 `business_relation.value_tier` 非空（开发价值已标）／ `company_contact` 有 `is_current=1` 记录（签约联系人已关联）。
  - `scope=ledger`：`field_key` ＝ 该线 `field_template.field_key`（台账差异化字段）；校验看 `ledger.extra_fields` 该 key 存在且非空。
- **默认清单（系统播种）**：每条产品线初始化 `scope=company` **4 项**（credit_code/address/industry_l1/province，`required=true`）+ `scope=relation` 的 value_tier 与 contact（`required=true`）。管理员可在「系统设置 → 产品线」增删改——`required`/`sort`/`status` 可改，`product_line_id`/`scope`/`field_key` 保存后不可变（参照 `field_template` 铁律）。
- **校验逻辑（服务端 `POST /contracts` 创建前）**：取该 `product_line_id` 下 `status=active AND required=true` 的全部项 → 逐项查对应层级字段是否非空 → 任一缺失 → **422（业务码 `20403` ＝ "必填未填"）＋ 返回缺失清单**（每项 `{scope, field_key, label, goto}` 供前端内联补 / 跳补：company 级内联补、relation/ledger 级跳对应页）。
- 索引：`uk_line_scope_field(product_line_id, scope, field_key)`、`idx_line_status(product_line_id, status, sort)`。
- **★ 2026-09-13 收口**：`registered_capital` / `legal_person` **不做签约强制**（＝公司档案可选扩展字段）→ **默认不播种**；两列已在 `company` 表（`→B1`），**个别产品线要卡，管理员可自选加回**（`field_key` 填真实列名即可）。即：清单里"公司级必填"的**默认下限**是上述 4 项，不是 6 项。

---

## 八、域 F：公海与流转（`→需求§6.3` §12）

### F1 sea_rule 公海规则（L1-L4）
`level`(1=全局 2=产品线 3=部门 4=部门×产品线) + `dept_id/product_line_id`(按层可空) + `follow_freq_days` + `deal_cycle_days` + `stay_days` + `no_progress_max` + **`effective_from`（★ 2026-09-10 新增：规则生效时间＝变更提交日 + 7 天，用于"改天数不即时生效"的缓冲）** + `status`；命中解析 L4→L1 取第一条，应用层缓存、变更失效

> **★ 7 天缓冲落库口径（`→需求§6.3`，2026-09-10 定）**：调整掉海天数时**插入新版本行**（旧行 `status=disabled`，**停用不删**，符合 T5），新行 `effective_from = 提交日 + 7 天`。生效瞬间，所有在途关系的倒计时**从 `effective_from` 重新起算**（＝每个关系至少再给一整轮）。提交变更时由应用层先算出"**本次将影响 X 个客户**"给经理确认。

> **公海粒度（`→需求§6.3`）**：`sea_status` 只有 `private`（**有 owner**）/ `company_sea`（**无 owner**），**掉海只改本字段、`dept_id` 恒定不变**；**部门公海 ＝ `company_sea` 中 `dept_id`=本部门的集合**（映射视图，非独立池）。
> **★ 2026-09-20 修正（拍板 P-10）**：`stay_days` **只用于「公海停留超期」**（→ 下句②），**不参与私海掉落倒计时**；私海倒计时由需求的**三条掉落触发**决定 —— `follow_freq_days`（跟进频次未达标）/ `deal_cycle_days`（成单周期超时）/ `no_progress_max`（推进停滞），**规则本体与锚点一律见 `→需求§6.3`，本文件不复述**。⚠ 原文写「`stay_days` 两类用途：① 私海掉落倒计时」与需求 §6.3 的字段口径冲突，做 M7-03/04（掉海预警）时当场发现（→《欠账登记表》**D-57**），按"上游优先"改本文件。
> ② **公海停留超期 → 生成经理决策待办**（不自动删除、不自动流转）。

### F2 sea_record 入公海历史
`relation_id + owner_id + from_sea/to_sea` + `reason`(follow_timeout/deal_timeout/stagnant/manual/dept_manager_delete/**dead(判死)/churn(流失)**) + `dropped_at + claimed_by + claimed_at`
> 私海掉落回公海、经理"删除关系"（reason=dept_manager_delete，逻辑删除）均写本表留痕；`to_sea` 仅 `company_sea`（公司公海）。**`owner_id` ＝本次掉海时该关系的归属人（每轮回海的归属人快照）**——与 `business_relation.owner_id` 同步写入，支撑"历史轮次展示"与"前主人归组"（→需求§7.5 / §8.1；P0-④⑤）。判死（reason=dead）阶段保留、流失（reason=churn）阶段置 7，二者均掉回公海可被重新领取（V1.13）。
> **索引**：`idx_rel_time(relation_id, dropped_at)`、`idx_owner(owner_id, dropped_at)`（P0-④⑤ 新增，供"某销售名下曾掉海过哪些客户"查询）、`idx_claimer(claimed_by, claimed_at)`、`idx_drop(dropped_at, to_sea)`。

---

## 九、域 G：审批中心（五型一单；报销一期不做，`→需求§7.9`）

### G1 approval
`type`：**transfer** 转交（单人换主责）/ **collaborate** 协同 / **phone_change** 手机号变更 / **phone_unlock** 联系方式解锁 / **relation_reassign** 关系重分配（**离职批量转交**，2026-09-14 定：**经理发起**、**一单多关系**、可分派不同业务员）

| 字段 | 说明 |
|---|---|
| type / applicant_id / approver_id | 申请人≠审批人（DB CHECK + 应用双拦） |
| target_type / target_id | 对象（关系/联系人） |
| payload JSON | 转交目标人（单人）/ 新旧手机号 / 协同人与有效期 / 解锁目标（含 `locked_by`）/ **`relation_reassign`：`items:[{relation_id, to_employee_id\|null}]`（`null` ＝ 回公海）**（2026-09-14 定） |
| status | pending/approved/rejected |
| comment / handled_at | 驳回必填原因 |

- **联系方式解锁（`phone_unlock`，2026-09-14 重写）**：联系人被 owner **上锁**后，他人查看详情只见 `phone_locked` → 可申请；**`approver_id` ＝ 该联系人的落锁人**（⚠ **例外于"默认直属上级"**，并**知会其直属上级**）；批后 **24h** 内可见全号（出参 `unlocked_until`）；申请 / 批准留痕 `operation_log` 防批量捞号。落锁人已离职 / 转岗 / 关系已掉公海 → **锁自动消失，无需审批**
- 手机号变更：审核通过后冻结 24h（contact.phone_frozen_until）才生效

---

## 十、关键索引与并发

| 场景 | 设计 |
|---|---|
| 撞单 | `contact.phone_active` 生成列唯一（未删行才占号）+ `company.credit_code`（撞码合并流程见 需求§7.3）；公司名**两段式**相似度（标准化+核心词，见 需求§7.3）——**第一段走 `company.idx_name_core` 精确 / 前缀收缩候选集，第二段才在候选集上算编辑距离**（2026-09-12 定）。**历史号提示**：建号时回查 `contact_change_log`，命中旧号 → 提示"该号曾属于 XX"（**提示不拦截**） |
| 激活竞态 | `business_relation.active_key` 生成列唯一索引——后到者 INSERT 撞唯一索引（MySQL 1062 → **Prisma 暴露为 P2002**）→ 409 返回归属人 |
| 抢公海认领 | 条件 UPDATE（`WHERE sea_status='company_sea'`），影响 1 行才算抢到，否则 409（见 §10.2-3） |
| 一关系一 owner | `relation_member.owner_flag` 生成列唯一索引（见 §10.2-1） |
| 编辑并发 | 主表 `updated_at` 乐观锁版本戳，更新带条件，影响 0 行即 409 |
| **时间列时区** | **「UTC 存、出口换算」**（2026-09-20 定，落地细节 →`服务端/prisma/README.md §七`）：库中一律 **UTC**；裸 SQL 直读须 `CONVERT_TZ`；**分区键边界按 UTC**（`job_run_log.run_at` 等）—— 排查时"表里的钟比人记得的少 8 小时"**是口径、不是故障** |
| 预警扫描 | `business_relation(last_event_at, sea_status)`、`contract(service_end, status)`、`workorder(sla_deadline, status)`、`commitment(owner_id, status, due_at)` |
| 管辖过滤 | 列表查询强制 `dept_id IN (管辖部门集合)`，登录注入缓存 |
| 事件写放大 | `last_event_at` / `next_action_hint` 由事件写入事务冗余更新 |
| 地理检索（预留） | `company.idx_geo(latitude, longitude)` |

### 10.1 全表索引清单（47 张 · 落库唯一依据）

> 约定：`uk`=唯一索引（业务不变量，撞则 409/422）；`idx`=普通索引（性能）；索引名 `uk_/idx_` 前缀 + 表意后缀。**加粗=业务关键约束，不可省**。本清单为落库/评审的**唯一索引依据**，实现时逐表比对，缺一不可。

**域 A 组织权限**

| 表 | 索引 |
|---|---|
| department | `idx_parent_id`（部门树） |
| employee | **`uk_work_no`**、**`uk_phone`**、**`uk_username`**（可空唯一，2026-09-14 加）、`idx_primary_dept_id`、`idx_direct_manager_id` |
| dept_manager | **`uk_dept_emp(dept_id, employee_id)`**、`idx_employee_id` |
| role | **`uk_code`** |
| employee_role | **`uk_emp_role(employee_id, role_code)`**、`idx_role_code` |
| permission_matrix | **`uk_perm_role(perm_key, role_code)`** |
| product_line | **`uk_code`** |
| dept_rule | **`uk_dept_id`** |
| notification | `idx_user_read(user_id, read_at, created_at)`、`idx_biz(biz_type, biz_id)` |
| operation_log | `idx_operator(operator_id, occurred_at)`、`idx_target(target_type, target_id)`、`idx_action(action, occurred_at)`；**按月分区** |
| dict_type | **`uk_code`** |
| dict_item | **`uk_type_item(type_id, item_code)`**、`idx_type_sort(type_id, status, sort)` |
| system_config | **`uk_config_key`** |
| job_run_log | `idx_job_time(job_name, run_at)`；**按 run_at 月分区** |
| target | **`uk_target(period, scope_type, scope_id)`**（同月同层同对象仅一条）、`idx_period(period)` |
| idempotency_key | **`uk_idem_scope(employee_id, endpoint, idem_key)`**、`idx_idem_created(created_at)`（24h 过期行清理依据；→ 接口 §2.5 / §A15） |

**域 B 客户资产**

| 表 | 索引 |
|---|---|
| company | **`uk_credit_code`**、`idx_full_name`、**`idx_name_core(name_core)`（★ 2026-09-12 新增：两段式查重第一段，按标准化核心词收缩候选集）**、`idx_geo(latitude, longitude)`（预留）、`idx_merged(merged_into)`（墓碑查询：列出已并入某公司的档案） |
| company_profile_tag | **`uk_cpt(company_id, group_code, tag_id)`**、`idx_tag(tag_id)`（用量统计） |
| contact | `idx_name`、**`uk_phone_active`（生成列 `phone_active`：未删=phone，已删=NULL → 仅活跃行唯一，软删后号码释放）**、`idx_merged_contact(merged_into)`（被并分支查询） |
| contact_trait | **`uk_ct(contact_id, trait_id)`**、`idx_trait(trait_id)` |
| company_contact | `idx_company_cur(company_id, is_current)`、`idx_contact_cur(contact_id, is_current)` |
| contact_change_log | `idx_contact_time(contact_id, created_at)`、`idx_approval(approval_id)` |
| **file_asset** | `idx_biz(biz_type, biz_id, status)`、`idx_uploader(uploaded_by, uploaded_at)` |

**域 C 业务关系**

| 表 | 索引 |
|---|---|
| business_relation | **`uk_active_rel`**（生成列）、`idx_company(company_id)`、`idx_sea_scan(last_event_at, sea_status)`、`idx_dept_sea(dept_id, product_line_id, sea_status)`、`idx_merged_rel(merged_into)`（被并分支查询） |
| relation_member | **`uk_member(relation_id, employee_id, member_type)`**、**`uk_owner(owner_flag)`（生成列 `owner_flag`：**在位的** owner=relation_id，其余=NULL → 一关系仅一 owner；「在位」＝未撤销，见 §10.2-1）**、`idx_my(employee_id, member_type, valid_until)`、`idx_relation(relation_id)` |
| relation_stage_log | `idx_rel_time(relation_id, created_at)` |
| relation_label | **`uk_rel_label(relation_id, group_code, label_id)`**、`idx_label(label_id)` |
| appointment | `idx_rel_time(relation_id, appointment_at, status)`、`idx_contact(contact_id)`、`idx_due(appointment_at, status)`、`idx_event(action_event_id)` |
| visit_log | `idx_emp_time(employee_id, depart_at)` |
| competitor | **`uk_name_line(name, product_line_id)`**、`idx_line_status(product_line_id, status)` |

**域 D 行动引擎**

| 表 | 索引 |
|---|---|
| commitment | `idx_owner_due(owner_id, status, due_at)`、`idx_relation(relation_id)`、`idx_due(status, due_at)`、`idx_contact(contact_id)` |
| action_event | `idx_rel_time(relation_id, event_at)`、`idx_actor_time(actor_id, event_at)`、`idx_pain(pain_point_id)`、**`uk_idem(idempotency_key)`**、`idx_appointment(appointment_id)`、`idx_contact(contact_id, event_at)`、`idx_rel_owner(relation_id, owner_snapshot, event_at)`（P0-④⑤ 新增）；**不分区**（**2026-09-12 调整**：因「保外键」放弃分区，见 §十五.5 第 2 条） |
| cadence_rule | `idx_scope(scope_dept_id, scope_line_id, enabled)` |
| daily_agenda | `idx_user_day(user_id, biz_date, status)`、`idx_ref(ref_type, ref_id)`、`idx_relation(relation_id)`；**不分区**（**2026-09-12 调整**：因「保外键」放弃分区，见 §十五.5 第 2 条） |
| review | `idx_status_time(status, created_at)`、`idx_relation(relation_id)`、`idx_type_status(review_type, status)` |
| stat_daily | **`uk_stat(biz_date, dept_id, product_line_id, owner_id, action_type)`**、`idx_owner_day(owner_id, biz_date)`；**按 biz_date 月分区** |

**域 E 交易服务**

| 表 | 索引 |
|---|---|
| contract | **`uk_contract_no`**、`idx_relation(relation_id)`、`idx_company(company_id)`、`idx_signer(signer_id)`、`idx_expire(service_end, status)`、`idx_line_status(product_line_id, status)` |
| payment_record | `idx_contract(contract_id)`、`idx_paid_at(paid_at)` |
| workorder | **`uk_order_no`**、`idx_relation(relation_id)`、`idx_assignee(assignee_id, status, sla_deadline)`、`idx_sla(status, sla_deadline)`、`idx_upgraded(upgraded_from_id)` |
| workorder_log | `idx_wo_time(workorder_id, created_at)` |
| ledger | `idx_line_expire(product_line_id, expire_date)`、`idx_contract(contract_id)`、`idx_company(company_id)`；高频统计 key 走生成列（逐个评估） |
| field_template | **`uk_line_key(product_line_id, field_key)`**、`idx_line_sort(product_line_id, status, sort)` |
| **contract_split** | **`uk_split(contract_id, employee_id)`**、`idx_employee(employee_id)` |
| **sign_checklist** | **`uk_line_scope_field(product_line_id, scope, field_key)`**、`idx_line_status(product_line_id, status, sort)` |

**域 F 公海**

| 表 | 索引 |
|---|---|
| sea_rule | `idx_level(level, dept_id, product_line_id, status)` |
| sea_record | `idx_rel_time(relation_id, dropped_at)`、`idx_owner(owner_id, dropped_at)`（P0-④⑤ 新增）、`idx_claimer(claimed_by, claimed_at)`、`idx_drop(dropped_at, to_sea)` |

**域 G 审批**

| 表 | 索引 |
|---|---|
| approval | `idx_approver(approver_id, status, created_at)`、`idx_applicant(applicant_id, created_at)`、`idx_target(target_type, target_id)`、`idx_type_status(type, status)` |

### 10.2 并发与唯一性兜底（已采纳 · 生成列 + 条件更新）

> 本节三项为 DB 级兜底，**统一手法**：用生成列把"不参与约束的行"变 NULL（MySQL 唯一索引忽略 NULL），或对状态列做条件 UPDATE 保证原子性。与 C1 `active_key` 同源，实现照抄。

| # | 目标 | 实现 |
|---|---|---|
| 1 | **一关系仅一 owner** | `relation_member` 加生成列 `owner_flag = IF(member_type='owner' AND revoked_at IS NULL, relation_id, NULL)`（STORED），`UNIQUE uk_owner(owner_flag)`。owner 唯一、collaborator 多行不受限；重复 owner 撞唯一索引（MySQL 1062 → **Prisma 暴露为 P2002**）→ 409。**★ 2026-09-16 修正（migration `0008`）：条件加 `revoked_at IS NULL`** —— 撤销（掉公海 / 转交）在本项目里的定义是**置 `revoked_at`、不物理删**（留痕），旧条件只看"是不是 owner"，会让**被撤销的 owner 继续占位** ⇒ 掉海后重新领取、转交换人时**落不下新 owner**（撞 `uk_owner`）。改成"**只有在位的 owner 才占位**"后，撤销即自动释放位子（→《欠账登记表》D-26 已闭环） |
| 2 | **活跃手机号唯一**（软删/换号后号码释放） | `contact` 加生成列 `phone_active = IF(deleted_at IS NULL, phone, NULL)`（STORED），`UNIQUE uk_phone_active(phone_active)`。未删行占号、软删行变 NULL 放行；换号=改 phone 自动释放旧号。`company.credit_code`、`employee.work_no` **同理** |
| 3 | **抢公海原子认领** | 认领 = 条件 UPDATE：`UPDATE business_relation SET sea_status='private', owner_id=? WHERE id=? AND sea_status='company_sea'`（同一事务写 relation_member owner + sea_record）。**影响行数=1 才算抢到**；=0 → 409「已被领走」 |
| 4 | 撞单（已有） | `contact.phone`（→ 改为 `phone_active` 生成列唯一）+ `company.credit_code`；公司名相似度应用层；**撞码合并流程（信用代码撞重→墓碑合并）见 `→需求§7.3`**：B 打 `merged_into`→A、B.`credit_code` 置 NULL（UNIQUE 可空放行）、子表随 `relation_id`/`company_id` 重定向零改动 |
| 5 | 激活竞态（已有） | `business_relation.active_key` 生成列唯一索引——后到者撞唯一索引（MySQL 1062 → **Prisma 暴露为 P2002**）→ 409 返回归属人。**★ 2026-09-21 修正（migration `0012`）：生成列条件由「`sea_status='private'` 且未并」改为「**未删未并**」—— 公海行**也占位**，同一三元组只允许一条关系**（不论公私海）**。「同三元组已有公海行时再激活」＝ **409**，人话**分档**引导"去领取"（已有私海 → 走转交 / 协同；→ 需求 §6.3 /《欠账登记表》D-53）。缓存量重复行在 `0012` 里**先清理**（保留 `private` 优先、同状态取 `updated_at` / `id` 最新；其余置 `deleted_at`） |

> **注意**：生成列唯一索引上线前须**先清理存量重复**（否则 `ADD UNIQUE` 直接失败）。

---

## 十一、数据权限与脱敏（实现口径，业务规则见 `→需求§4`）

**库中永远明文全量**；脱敏在应用层按 `permission_matrix` 渲染。

> **★ 2026-09-14 口径重写**：联系方式**不再按角色 / 场景分档脱敏** → 改为「**详情默认全可见 ＋ 联系人可上锁**」（`→需求§4.3`）。

**① 联系方式（手机号）** —— 本表只管**字段级出参形态**（"能看 / 能锁"的业务规则见 `→需求§4.3 一·二`，不复述）

| 出参形态 | 字段 |
|---|---|
| **详情** | `phone` —— 一律全号，与角色 / 场景无关 |
| **列表 / 卡片**（含公海、公司抽屉的联系人列表） | `phone_masked`（`xxx****xxxx`）—— 是出参形态、**不是权限** |
| **详情 · 被 owner 上锁、且查看者不是 owner** | `phone_locked:true` ＋ `phone_locked_by`，**不给 `phone`** |
| 公海未领**详情** | 全号（锁随掉公海自动消失）＋ 概览，**不返跟单全文**；写 `operation_log`(`sea.phone.view`) |

**② 跟单内容（跨部门互不可见）** —— 可见范围一律 `→需求§4.3 三`（不复述）；出参形态：**跨部门 / 非归属不返跟单全文**，只给「近 30 天 N 次」概览；管理员另加"**只读** ＋ 每次查看写 `operation_log`"。

**③ 金额（跨业务线）** —— 判定**按部门**、可见范围与例外见 `→需求§4.3 四`；出参形态：**不可见者一律 `amount: null` ＋ `amount_masked: "***"`**（库内永远明文）。**脱敏只作用于「销售看他人私海 / 跨部门关系」的列表与详情；报表 / 看板 / 汇总一律真实金额**（经理 / 老板出口，2026-09-11 定）。

- 数据范围：销售可见客户全集 = **本人 owner 私海 ∪ 我作为 collaborator 的关系（含正式协同 collaborate 与 @求助 ask_help，valid_until 未过期）∪ 公海**；经理=dept_manager 管辖部门；总经理=全部；**交付/客服＝仅「在合同服务期内」的客户（只读、不进公海；2026-09-14 定）**；**管理员＝可查看业务数据，但一律只读、每次查看写 `operation_log`、不解除金额脱敏（2026-09-11 定）**；他人私海不可见（除非协同/@求助授权）。客户列表提供"@我 / 我协同 / 全部关联"筛选视图，底层即 relation_member 中 employee_id=当前用户 的 collaborator 集合，与 owner 私海取并集后按筛选裁剪（口径见 §十七 A.3）
- 赢单弹药库（review published）：**默认本部门可见**；gm 经 system_config(ammo_scope=company) 改全公司；未收录的（open/dismissed）仅本人+直属经理可见
- 坐标属公司档案基础信息（非敏感）；将来做地图时必须走同一套权限过滤
- 协同 / 转交 / **上锁 / 解锁申请 / 手机号变更** 均走审批且留痕（`phone_unlock` 的**审批人＝落锁人** ＋ 知会其直属上级，口径 `→需求§4.3 二`）；**公海看号留痕（`sea.phone.view`，不设次数上限）**；合同水印、**公海页水印**、操作日志为应用层责任

---

## 十二、定时任务清单

| 任务 | 频次 | 逻辑 |
|---|---|---|
| 组装今日动线 | 每日 05:00 | 承诺到期/逾期 + 预约 + cadence 命中 + 掉海倒计时 → **结转昨日遗留（open 结转/snoozed 到期推今日）+ 插入今日新增** 写 daily_agenda（**禁止清空重写**，D4）；失败则首页实时兜底 |
| 动线清理 | 每日 | daily_agenda 中 done/ignored 超期（建议 30/90 天）行清理或分区归档 |
| 日级行为汇总 | 每日 05:00 | 从 action_event 按 `biz_date×部门×产品线×人×动作类型` GROUP BY 回填 `stat_daily`（可按 biz_date 覆盖重跑）；供经理看板/健康度读取；记 job_run_log |
| 承诺提醒 | 到点/每日 | remind_at 到 → notification；逾期未办 → 次日动线置顶红（>3 天收进逾期抽屉） |
| 节奏提醒 | 每日 | **★ 实现口径写死（2026-09-12 定，`→需求§10.3` / §十六 N9）**：**每条 cadence_rule ＝ 一条集合式 SQL（WHERE ＋ 走索引），禁止"规则 × 客户"双层遍历**——各谓词均可收缩为索引范围扫（新客 48h 走 `business_relation.created_at` / `contact.created_at`；S 级客情、灰度定性、距掉海走 `idx_sea_scan(last_event_at, sea_status)`）。命中结果按 D4 组装进 `daily_agenda`；覆盖 5 类：新客 48h / S 级客情 / 灰度定性 / 周重点周五清点 / 待关联补全。**「增量扫描 / 到期队列（`next_cadence_at` 列）」＝ V2 选项，V1 不做** |
| 掉海预警（私海→公海） | **每日**（固定间隔 24h；与「组装今日动线 05:00」的整点对齐待那条任务落地时统一） | 按 sea_rule，**一律按自然日判定**（Asia/Shanghai，→需求§6.3）：**≤3 天进动线；到期前 1 天推销售；到期当天标红+推经理；到期日已过** ⇒ 落 sea_record 转**公司公海**（部门映射保留，仍显示于部门公海）。★ 2026-09-21 改：原「每小时 / 到期前 24h / 6h」作废（→《废止口径登记表》**#41**）——**最小单位是天** |
| 公海停留超期（经理决策） | 每日 | 扫描 `company_sea` 中归口本部门、停留超期的无主关系 → 生成**经理决策待办**（保留 / 删除关系）；**不自动删除、不自动流转**（`→需求§6.3`） |
| 灰度寿命 | 每日 | urgency=gray 超 `gray_remind_days` → **提醒下结论**（**不产生释放候选、不落 `gray_release_at`**；灰度到期由掉海任务照常处理） |
| 协同到期 | 每日 | relation_member.collaborator.valid_until 到期 → 自动失效并通知双方 |
| 判死教训缓写提醒 | 每日 | loss review 已 closed 但 detail 空 → 次日动线提醒补写 |
| win 复盘超时 | 每日 | B/C/D 级 win review open 超 30 天 → 自动 dismissed |
| 事件冗余回写 | 事件写入时 | 更新 last_event_at / next_action_hint / 建议销承诺 |
| **分区滚动（运维）** | 每月 | **★ 2026-09-14 补录（原清单遗漏）**：三张分区表（`stat_daily` / `operation_log` / `job_run_log`）建库时只预置到 `p202712`（真实上界 `202801`）＋ `pmax(MAXVALUE)` 兜底 —— **有兜底 → 不会插失败**，但 **2028-01 起全部新行落入单一 `pmax` 分区**，且老分区**无法用 `DROP PARTITION` 清理**。故须**提前 N 个月**自动 `ALTER TABLE … ADD PARTITION` 续期，并把「建库预置月数 ≥ 3 年」写进部署清单（→ `服务端/prisma/README.md`「⬆ 上服务器时必做」）。**触发条件不是"快满了"，而是"每月固定续期"** |

---

## 十三、内置字典种子（dict，builtin=1 不可删可停用）

| 字典 | 种子项 |
|---|---|
| action_type | phone / wechat / visit / onsite / email / meal / gift / greeting / ask_help / note / system |
| pain_point | price / effect / trust / decision_maker / timing / competitor / internal / other |
| urgency | weekly / monthly / quarterly / long_term / gray |
| value_tier | high / medium / low / pending |
| customer_level | S / A / B / C / D（S=头部大额回款；档位金额每部门自配） |
| party | me / them / verdict |
| commitment_ctype | reply / quote / meet / deliver / decision / followup / social_meal / social_gift / social_greeting |
| company_identity_tag | 上市公司 / 国企 / 民企 / 外资 / 高新企业 / 集团总部…（业务线自定义） |
| company_policy_tag | 年度框架采购 / 按次采购 / 招标制 / 老板直批…（业务线自定义） |
| decision_chain | 老板拍板 / 部门负责人推荐+老板批 / 采购部 / 多人会签… |
| contact_trait | 价格敏感 / 关系型 / 方案型 / 专业控 / 犹豫型 / 快决策 / 爱面子… |
| relation_risk_label | 流失信号 / 回款风险 / 竞品渗透 / 换对接人 / 组织变动… |
| workflow_stage | **7 步种子**：1 初步建联 → 2 需求确认 → 3 面访产品讲解 → 4 异议与卡点 → 5 逼单 → 6 已合作(is_final) → **7 已流失**。7 由 churn 提交时置位，标记**本轮生命周期结束**——**但不等同"不再回流公海"**：关系仍转 `company_sea` 可被重新领取，重新领取后阶段从 1 重新开始（`→需求§8.1` / §11.2） |
| competition | none / in_use / comparing |
| review_type | win / loss / churn |
| review_win_reason | 客户主动找 / 价格优势 / 关系到位 / 竞品失误 / 说不清 |
| review_loss_reason | no_need 没真需求 / lost_to_competitor 输给竞品(不点名) / not_followed 我们没跟住 / budget 预算问题 / chain_broken 决策链断了 / unsure 说不清 |
| review_churn_reason | poached 被竞品撬走(可带竞品) / expired_no_renew 到期未续费 / service 服务不满 / neglect 我们疏忽 / client_biz_change 客户经营变故 / other 其他 |

---

## 十四、需求追溯（★ 已下沉）

> **本节原「需求追溯索引」表已于 2026-09-15 下沉** —— 理由：本项目文档读者是 AI，而**索引类章节对 AI 无导航收益、只增加"误把索引当规范"的命中风险**（见 `README §八` 权威落点总表）。**表 / 字段 / 索引 / 字典的权威落点始终是 §三~§九 与 §10.1。**

> **★ L0 执行提示（保留）**：需求文档任一小节变更 → **检查受影响的表** → 同批改本文件并升版。
> 需要"表 ↔ 需求章节"对照时用 **`grep` 反查**，例如：`grep -n "需求§7\." 需求规格/销售CRM业务需求文档.md`（或按表名反查数据架构 §三~§十）。

---

## 十五、实施起点与开发顺序

1. **全新起点**：旧档案式表结构仅停留在纸面设计、从未编码实现，**不保留、不迁移、不做兼容层**，直接按本文档 §二～§十三 从零建库
2. 本文档为 Schema 唯一真相源：任何表/字段/字典/规则以本文档为准；实现中如发现需增补，**先回《业务需求文档》确认规则、再回本文档登记版本**，最后才落代码
3. 无历史生产数据可迁；如有少量手工试录数据，人工补录即可
4. **开发顺序**（依依赖）：域 A/B/C（组织与客户底座）→ 域 D 行动引擎（commitment / action_event / daily_agenda）→ 域 E/G（交易与审批）→ 域 F（公海）→ 定时任务与三出口视图 → **A14 target 目标层**（依赖 contract/payment 与部门树，放最后）
5. **★ Prisma 落库口径（2026-09-10 ORM 定案为 Prisma）**：本项目重度依赖 MySQL 原生特性（生成列 / 分区表 / JSON / 递归 CTE），Prisma 并非全部原生支持。**数据架构侧的五条口径如下；Prisma / MySQL 的实现细节（手写 SQL、CLI 参数、实测踩坑）一律见 `服务端/prisma/README.md §六`：**

| # | 场景（数据架构侧） | 口径 |
|---|---|---|
| 1 | **生成列** —— `business_relation.active_key` / `relation_member.owner_flag` / `contact.phone_active` | schema 中声明为**可选字段 ＋ `@ignore`**（Client 不暴露、不进 create/update input）；**应用层不读不写**，唯一性由 DB 兜底。**⚠ 生成列引用的 FK 列必须 `ON UPDATE RESTRICT`**（否则 ERROR 1215）—— 这 **4 条**：`business_relation.company_id / dept_id / product_line_id` ＋ `relation_member.relation_id` |
| 2 | **分区表** —— 恰 **3 张**：`stat_daily` / `operation_log` / `job_run_log` | 按 `biz_date` / `occurred_at` / `run_at` **月分区**；主键须含分区列（ERROR 1503）。**🚫 `action_event` / `daily_agenda` 已放弃分区**（分区表不能参与外键，ERROR 1506）→ `action_event.uk_idem` 回退为**全局唯一 `(idempotency_key)`** |
| 3 | **唯一约束冲突 → 409 / 422** | Prisma 唯一冲突码是 **`P2002`**（不是 MySQL 1062）→ 异常过滤器映射 409（撞单 / 激活竞态 / 抢公海）/ 422（业务校验）。**约束名取值位置与实测溯源 → `服务端/prisma/README.md §七`** |
| 4 | **复杂查询 / 报表 / 递归 CTE** | 一律走 `$queryRaw` ＋ `Prisma.sql` 参数化防注入。**不为迁就 Client API 牺牲 SQL 表达力** |
| 5 | **JSON 字段**（`ledger.extra_fields` / `contact.extra_phones` / `dept_rule.level_tiers` 等） | Prisma `Json` 原生支持；但**禁止在 JSON 列上做 `JSON_CONTAINS` 反向查询**（全表扫描，见 §十七 A.2）；高频检索的 key 走生成列或提升为正式字段 |

> **一句话分工**：**Prisma 管"类型安全 ＋ 日常 CRUD"，MySQL 原生特性（生成列 / 分区 / CTE）交给手写 migration 与 `$queryRaw`** —— 必须在**第一次建库时就把 migration 写对**，后期再改成本高。
>
> **对账便利（选 Prisma 的理由之一）**：`schema.prisma` 是纯文本、**47 张表**集中在一个文件，可直接对照 §二～§九 逐表检查。



---

## 十七、设计问答与常见陷阱（FAQ）

> 本节沉淀评审中反复被问到的"为什么这么存"与边界拍板，便于后续开发与审计对齐，正文不再重复展开。

### A.1 字段归类判据（事件级 vs 关系级）
每张行动表字段先问一句：**"这是这次跟进发生的事，还是客户现在的状态？"**
- **事件级（只存 action_event）**：action_type / summary / duration_min / attachments / outcome / visit_log_id / appointment_id / source——无"客户当前状态"语义，天然不扫全表。
- **关系级·高频回写**：competition / competitor_id（写事件时事务回写 C1 快照）；stage（由 stage_forward 建议、确认后落 relation_stage_log 与 business_relation.stage）。当前值直接读 business_relation，不碰 action_event。
- **关系级·低频实时派生**：当前主卡点 pain_point 不落库，查询时按 `idx(relation_id, event_at)` 取最新一条带卡点事件派生（D4 铁律：自动风险信号不落库）。
- **多对多且需反向查**：见 A.2 / A.3。

### A.2 mentioned_user_ids 为何保留 JSON、不拆关联表
早期曾考虑拆 `action_event_mention(event_id, user_id)` 关联表承载"@谁"。评审拍板后明确：
- **@求助的权限与可见性已由 C2 relation_member 实现**：owner 写事件 @ 同事，即时在 relation_member 插入 collaborator 行（source=ask_help，valid_until 默认 7 天），授予与正式协同相同的读写权（§五 C2）。
- 因此 `action_event.mentioned_user_ids` JSON **仅用于跟单卡片展示"本条 @了谁"**（正向读，无反向索引需求），不必为它建表、加索引。
- 若未来需按单条事件审计"是谁 @ 的"，可从 relation_member（source=ask_help + 事件时间窗）推导，无需事件级冗余表。
- **结论**：mentioned_user_ids 维持 JSON，不拆表；严禁在该列做反向 `JSON_CONTAINS` 全表扫描查询。

### A.3 客户列表"@我 + 我协同"并集查询口径（2026-09-09 拍板）
销售需一处列表查看所有"@我"和"我协同"的客户。实现口径：
- **销售可见客户全集** = 本人 owner 私海（business_relation + relation_member owner）
                    ∪ 我作为 collaborator 的关系（relation_member WHERE employee_id=当前用户 AND member_type=collaborator，含 source=collaborate 正式协同 与 source=ask_help @求助，valid_until 未过期）
                    ∪ 公海（§十一）。
- 列表提供筛选视图：**"@我"**（source=ask_help）/ **"我协同"**（source=collaborate）/ **"全部关联"**，底层即 relation_member 中 employee_id=当前用户 的 collaborator 集合，与 owner 私海取并集后按筛选条件裁剪。
- **权限**：协同人（含 @求助有效期内）对关系内跟单全文可读写、全号可见（§十一）；valid_until 过期自动失效（定时任务 §十二 协同到期）。
- **性能**：不涉及 action_event 反查，走 relation_member 索引 `idx(employee_id, member_type, valid_until)`（C2 已补），毫秒级。

### A.4 掉公海为什么不动 `dept_id`（2026-09-10 定，`→需求§6.3`）
早期设想过"别的部门来公海把这个客户领走"，评审后**明确否决**，理由：

1. **改 dept_id = 历史归属断层**：原部门积累的跟单 / 承诺 / 合同全挂在关系上，改部门后这些历史说不清属于谁。
2. **会造成客户数翻倍**：同一家公司允许在两个部门各有一条活跃关系，看板上的"客户数"会虚增。
3. **唯一约束要重建**：`uk_active_rel`（公司+部门+产品线）本就允许不同部门各建一条，不需要靠"改部门"来实现。

**正确做法**：别的部门想要这个客户 = **INSERT 一条本部门自己的业务关系**（因 `uk_active_rel` 含 `dept_id`，与原有关系不冲突）。这正是"跨部门同产品线**竞争并行**、**各签各的（互不干扰）**"的落点。

**实现要点**：掉海定时任务**只 UPDATE `sea_status`，严禁 UPDATE `dept_id`**；建议把这一条列为代码评审检查项（或在同一事务里加断言）。

---

**文档结束**
