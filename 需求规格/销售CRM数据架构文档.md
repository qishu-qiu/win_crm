# 销售 CRM 数据架构文档 V1.17（现行有效）

> **本文件的角色**：只回答"**数据怎么存**"——表、字段、索引、字典、权限实现口径、定时任务。
> **业务规则一律不在此定义**：凡涉及"为什么这么设计、规则是什么"，一律见《销售CRM业务需求文档》对应章节（本文用 `→需求§X` 标注）。
> **元铁律**：**L0 变更联动**（需求改 → 本文件同批改）｜**L1 单一事实源**（规则只在需求文档定义一次，本文只写指针）。

---

## 一、文档信息

| 项目 | 内容 |
|---|---|
| 版本 / 日期 | **V1.17（现行有效）** / 2026-09-11 |
| 上游 | 《销售CRM业务需求文档》V1.13（业务规则唯一来源） |
| 下游 | 《销售CRM接口API文档》**V1.3**、《销售CRM设计规范》**V1.0**、《销售CRM前端页面与交互文档》**V1.4** |
| 数据库 | MySQL 8.0+（InnoDB，utf8mb4）；JSON 用于扩展/柔性数据 |
| 缓存 | Redis（登录态 / 字典 / 管辖部门集合 / 规则缓存） |
| 外部依赖 | 高德开放平台：JS API（坐标拾取器）。坐标系统一 **GCJ-02**（见 §五 B7） |
| 性质 | **全新架构，Schema 唯一真相源**。旧档案式表结构仅为纸面设计、从未编码实现，**整体作废，不迁移、不并行、不做兼容层** |

### 通用约定
- 主键统一 `id` BIGINT UNSIGNED AUTO_INCREMENT
- 审计字段全表统一：`created_by / created_at / updated_by / updated_at`；逻辑删除 `deleted_at`（NULL=未删）
- 金额统一 `DECIMAL(12,2)`；时间统一 `DATETIME`；枚举/字典码存 `VARCHAR(32)` 英文码，展示文案走字典
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
approval（转交 / 协同 / 手机号变更 / 手机号解锁 四型一单）
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
`work_no` UNIQUE、`name`、`phone` UNIQUE、`password_hash`、`primary_dept_id`、`extra_dept_ids` JSON、`product_line_ids` JSON、`direct_manager_id`(直属经理/审批链)、`status`(active/resigned/disabled)

### A3 dept_manager 管辖部门（经理查数范围 = 本表集合）
`dept_id + employee_id` 联合唯一

### A4 role / A5 employee_role
- role：`code`(sale/service/delivery/admin/dept_manager/gm) + `name` + `is_builtin`；内置 6 条，builtin 不可删
- employee_role：`employee_id + role_code` 联合唯一（一人多角色）

### A6 permission_matrix 权限矩阵
`perm_key`(如 cross_dept_private / contract_amount / phone_unlock) × `role_code` → `level`(visible/masked/denied)

### A7 product_line 产品线
`name/code` UNIQUE、`dept_ids` JSON(承接部门)、`service_cycle_days`、`status`

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
`user_id`、`title/content`、`biz_type`(commitment_due/cadence/drop_warn/gray/approval…)、`biz_id`、`channel`(site/wechat 预留)、`read_at`

### A10 operation_log 操作留痕（★ 全局审计日志 · 升级）
| 字段 | 说明 |
|---|---|
| occurred_at | 发生时间（**按月分区**依据） |
| req_id | 请求链路 id（一次操作多行可关联；与系统运行日志的 req_id 打通） |
| operator_id / operator_name | 操作人（**快照冗余**，防离职/改名后查不到人）；系统动作 `operator_id=0` |
| dept_id / product_line_id | 操作时所处上下文（供经理按部门查） |
| action | 统一编码 `模块.动词`：`approval.approve` / `phone.unlock.view` / `event.create` / `tag.update` … |
| target_type / target_id | 操作对象（多态） |
| before / after JSON | **本次变更前/后快照**（审计核心；新增/删除时一端为 null） |
| detail JSON | 补充说明（保留原设计） |
| ip / user_agent | 来源（**解锁看号/导出类必记**，防批量捞号） |

- **写入**：由应用层统一审计切面（如 `@Audit('模块.动作')`）在**业务事务内**写入——业务成功日志才落、业务回滚日志一并回滚；**不靠 DB 触发器**（拿不到操作人上下文）。
- **不可篡改**：**只 INSERT/SELECT，DB 账号无 UPDATE/DELETE 权限**。
- **保留策略**：普通操作日志热存 12 个月 → 冷归档；**敏感动作（`phone.unlock.*`、导出类）永久保留（≥3 年）**，查询本身也需经理级以上权限。
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

---

## 四、域 B：客户资产与公司档案（`→需求§7.2` §7.3 §9）

### B1 company 公司（唯一档案）
| 字段 | 说明 |
|---|---|
| full_name | 公司全称，INDEX；查重（相似度应用层算） |
| credit_code | 统一社会信用代码 UNIQUE（可空；撞码强制使用已有档案） |
| industry_l1/l2、province/city/district、scale | 行业/地区/规模 |
| completeness_1/2/3 | 三档完善度 0-100（写入重算） |
| website/address/bank_name/invoice_title/tax_no | 成交后强制补组 |
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
| wechat/email/gender/birthday | 联系方式 |
| decision_role | decision/influence/execute（决策/影响/执行） |
| tags JSON | 个人自由标签（爱喝茶/老板亲戚…），与谈判特质分栏并存 |
| trait_summary JSON | 谈判特质冗余（从 contact_trait 派生展示） |
| status | active/left/freelance |
| merged_into | **联系人级合并墓碑**：自引用 FK（`contact.id`，可空）。非 NULL = 本联系人已并入该 winner；物理不删、traits **并集**、子记录零改动；统一视图聚合（见 `→需求§7.2` 合并联系人） |
| phone_frozen_until | 手机号变更审核冻结期（24h） |

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
| 唯一索引 | `uk_active_rel`：同 公司+部门+产品线 仅一条活跃私海关系（生成列 `active_key = IF(sea_status='private' AND merged_into IS NULL, 三元组, NULL)` 实现；**被并分支 `merged_into IS NOT NULL` 不占活跃位**） |

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
- **索引**：`uk(relation_id, employee_id, member_type)` 防重复授予；**`uk_owner(owner_flag)` 保证一关系仅一 owner**（生成列，见 §10.2-1）；`idx(employee_id, member_type, valid_until)` 供"我协同 / @我"列表与有效期扫描（§十七 A.3）；`idx(relation_id)` 供关系内成员查询

### C3 relation_stage_log 阶段推进留痕
`relation_id + from_stage/to_stage + action(normal/jump/rollback/lost) + reason + operator_id`

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
| created_by / updated_by | **只允许 manager/admin 维护**，销售只读引用 |
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
| status | open / done / expired / waived(豁免，必填原因) / cancelled |
| done_at / done_by | 兑现时间/人 |
| source_event_id / closed_event_id 可空 | 由哪条事件产生 / 哪条事件证明兑现 |

- 索引：`idx(owner_id, status, due_at)`、`idx(relation_id)`

### D2 action_event 事件流 ★
| 字段 | 说明 |
|---|---|
| relation_id / contact_id 可空 / actor_id | 关系、联系人、操作人（销售或 system） |
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

- 索引：`idx(relation_id, event_at)`、`idx(actor_id, event_at)`、`idx(pain_point_id)`
- **展示口径（决策 #30 · `→需求§7.5`；分界基准 2026-09-10 修正）**：跟单列表**默认近 1 个月**（按 `event_at` 倒序分页，可切"全部"）；**分界基准 = 该关系的主跟单人（owner），不是"当前登录人"**——`actor_id`=**该关系 owner** → **主线**，否则（协同同事 / 合并前其他销售）→ **树杈分支**（合并关系按 `C1.merged_into` 归类）。**经理 / 老板打开时看到的就是「主跟单人的视角」**（否则经理不是 owner，会看到全是树杈、没有主线）。**复用现有 `idx(relation_id, event_at)` / `idx(actor_id, event_at)`，不新增字段、不做"疑似重复"等智能判断**
- **★ 快速标记口径（`→需求§6.3` / §10.2，2026-09-10 定）**：无效沟通也**必须写一条事件**（`outcome` ∈ `not_contacted` / `no_answer` / `brief_hangup`；`summary` 可空），否则"这个客户打过多少次"统计失真。批量标记＝一次请求写多行，逐行落 `action_event`（行数不多，无需额外汇总）。
  - **⚠ 关键：快速标记『不』更新 `business_relation.last_event_at`**——只有**有效沟通**事件才更新它。否则销售对 100 个客户点一下快速标记，`sea_rule` 的跟进倒计时就被刷爆、客户永不掉海。
  - **实现**：`last_event_at` 回写逻辑中**排除** outcome ∈ 三型 quick_mark 的事件；"最近 30 天尝试联系 N 次"另行按这三型 COUNT（走现有 `idx(relation_id, event_at)`）。

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
- **生命周期**：按 `biz_date` 月分区；`done`/`ignored` 超期（建议 30/90 天）清理或分区归档。

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

> **统计口径**：所有"看数"走 stat_daily（读小表、毫秒级）；所有"看明细"回 action_event。这是经理统计从"每次扫几百万行"降到"读几万行"的关键一层。

---

## 七、域 E：交易与服务（`→需求§7.6` §7.7 §6.4）

### E1 contract 合同
`contract_no` UNIQUE + `relation_id` + `product_line_id` + `contact_id` + `signer_id`(**签单人锁定=业绩归属，终身不变**) + `amount` + `paid_amount` + `pay_type` + `sign_date` + `service_start/end` + `auto_renew` + `remind_days` JSON(30/60/90) + `attachments` JSON + `status`(unpaid/partial/running/done/terminated)

> **维护归属**：维护责任跟**业务关系当前 owner** 走（`→需求§5.2`），**不再单独设 maintainer 字段**——避免签单人/维护人/owner 三套归属打架。

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

---

## 八、域 F：公海与流转（`→需求§6.3` §12）

### F1 sea_rule 公海规则（L1-L4）
`level`(1=全局 2=产品线 3=部门 4=部门×产品线) + `dept_id/product_line_id`(按层可空) + `follow_freq_days` + `deal_cycle_days` + `stay_days` + `no_progress_max` + **`effective_from`（★ 2026-09-10 新增：规则生效时间＝变更提交日 + 7 天，用于"改天数不即时生效"的缓冲）** + `status`；命中解析 L4→L1 取第一条，应用层缓存、变更失效

> **★ 7 天缓冲落库口径（`→需求§6.3`，2026-09-10 定）**：调整掉海天数时**插入新版本行**（旧行 `status=disabled`，**停用不删**，符合 T5），新行 `effective_from = 提交日 + 7 天`。生效瞬间，所有在途关系的倒计时**从 `effective_from` 重新起算**（＝每个关系至少再给一整轮）。提交变更时由应用层先算出"**本次将影响 X 个客户**"给经理确认。

> **公海粒度（`→需求§6.3`）**：`sea_status` 只有 `private`（**有 owner**）/ `company_sea`（**无 owner**），**掉海只改本字段、`dept_id` 恒定不变**；**部门公海 ＝ `company_sea` 中 `dept_id`=本部门的集合**（映射视图，非独立池）。`stay_days` 两类用途：① 私海掉落倒计时（自动触发）；② **公海停留超期 → 生成经理决策待办**（不自动删除、不自动流转）。

### F2 sea_record 入公海历史
`relation_id + from_sea/to_sea` + `reason`(follow_timeout/deal_timeout/stagnant/manual/dept_manager_delete) + `dropped_at + claimed_by + claimed_at`
> 私海掉落回公海、经理"删除关系"（reason=dept_manager_delete，逻辑删除）均写本表留痕；`to_sea` 仅 `company_sea`（公司公海）。

---

## 九、域 G：审批中心（四型一单；报销一期不做，`→需求§7.9`）

### G1 approval
`type`：**transfer** 转交（含离职批量转交）/ **collaborate** 协同 / **phone_change** 手机号变更 / **phone_unlock** 手机号解锁

| 字段 | 说明 |
|---|---|
| type / applicant_id / approver_id | 申请人≠审批人（DB CHECK + 应用双拦） |
| target_type / target_id | 对象（关系/联系人） |
| payload JSON | 转交目标人（含批量清单）/新旧手机号/协同人与有效期/解锁目标 |
| status | pending/approved/rejected |
| comment / handled_at | 驳回必填原因 |

- 手机号解锁：跨业务线/非归属部门看到 `****{后4位}` 可申请；经理批后**限时可见全号**（出参 unlockedUntil）；申请/批准留痕 operation_log 防批量捞号
- 手机号变更：审核通过后冻结 24h（contact.phone_frozen_until）才生效

---

## 十、关键索引与并发

| 场景 | 设计 |
|---|---|
| 撞单 | `contact.phone_active` 生成列唯一（未删行才占号）+ `company.credit_code`（撞码合并流程见 需求§7.3）；公司名**两段式**相似度（标准化+核心词，见 需求§7.3）。**历史号提示**：建号时回查 `contact_change_log`，命中旧号 → 提示"该号曾属于 XX"（**提示不拦截**） |
| 激活竞态 | `business_relation.active_key` 生成列唯一索引——后到者 INSERT 撞 1062 → 409 返回归属人 |
| 抢公海认领 | 条件 UPDATE（`WHERE sea_status='company_sea'`），影响 1 行才算抢到，否则 409（见 §10.2-3） |
| 一关系一 owner | `relation_member.owner_flag` 生成列唯一索引（见 §10.2-1） |
| 编辑并发 | 主表 `updated_at` 乐观锁版本戳，更新带条件，影响 0 行即 409 |
| 预警扫描 | `business_relation(last_event_at, sea_status)`、`contract(service_end, status)`、`workorder(sla_deadline, status)`、`commitment(owner_id, status, due_at)` |
| 管辖过滤 | 列表查询强制 `dept_id IN (管辖部门集合)`，登录注入缓存 |
| 事件写放大 | `last_event_at` / `next_action_hint` 由事件写入事务冗余更新 |
| 地理检索（预留） | `company.idx_geo(latitude, longitude)` |

### 10.1 全表索引清单（45 张 · 落库唯一依据）

> 约定：`uk`=唯一索引（业务不变量，撞则 409/422）；`idx`=普通索引（性能）；索引名 `uk_/idx_` 前缀 + 表意后缀。**加粗=业务关键约束，不可省**。本清单为落库/评审的**唯一索引依据**，实现时逐表比对，缺一不可。

**域 A 组织权限**

| 表 | 索引 |
|---|---|
| department | `idx_parent_id`（部门树） |
| employee | **`uk_work_no`**、**`uk_phone`**、`idx_primary_dept_id`、`idx_direct_manager_id` |
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

**域 B 客户资产**

| 表 | 索引 |
|---|---|
| company | **`uk_credit_code`**、`idx_full_name`、`idx_geo(latitude, longitude)`（预留）、`idx_merged(merged_into)`（墓碑查询：列出已并入某公司的档案） |
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
| relation_member | **`uk_member(relation_id, employee_id, member_type)`**、**`uk_owner(owner_flag)`（生成列 `owner_flag`：owner=relation_id，非 owner=NULL → 一关系仅一 owner）**、`idx_my(employee_id, member_type, valid_until)`、`idx_relation(relation_id)` |
| relation_stage_log | `idx_rel_time(relation_id, created_at)` |
| relation_label | **`uk_rel_label(relation_id, group_code, label_id)`**、`idx_label(label_id)` |
| appointment | `idx_rel_time(relation_id, appointment_at, status)`、`idx_contact(contact_id)`、`idx_due(appointment_at, status)`、`idx_event(action_event_id)` |
| visit_log | `idx_emp_time(employee_id, depart_at)` |
| competitor | **`uk_name_line(name, product_line_id)`**、`idx_line_status(product_line_id, status)` |

**域 D 行动引擎**

| 表 | 索引 |
|---|---|
| commitment | `idx_owner_due(owner_id, status, due_at)`、`idx_relation(relation_id)`、`idx_due(status, due_at)`、`idx_contact(contact_id)` |
| action_event | `idx_rel_time(relation_id, event_at)`、`idx_actor_time(actor_id, event_at)`、`idx_pain(pain_point_id)`、**`uk_idem(idempotency_key)`**、`idx_appointment(appointment_id)`；**按 event_at 月分区** |
| cadence_rule | `idx_scope(scope_dept_id, scope_line_id, enabled)` |
| daily_agenda | `idx_user_day(user_id, biz_date, status)`、`idx_ref(ref_type, ref_id)`、`idx_relation(relation_id)`；**按 biz_date 月分区** |
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

**域 F 公海**

| 表 | 索引 |
|---|---|
| sea_rule | `idx_level(level, dept_id, product_line_id, status)` |
| sea_record | `idx_rel_time(relation_id, dropped_at)`、`idx_claimer(claimed_by, claimed_at)`、`idx_drop(dropped_at, to_sea)` |

**域 G 审批**

| 表 | 索引 |
|---|---|
| approval | `idx_approver(approver_id, status, created_at)`、`idx_applicant(applicant_id, created_at)`、`idx_target(target_type, target_id)`、`idx_type_status(type, status)` |

### 10.2 并发与唯一性兜底（已采纳 · 生成列 + 条件更新）

> 本节三项为 DB 级兜底，**统一手法**：用生成列把"不参与约束的行"变 NULL（MySQL 唯一索引忽略 NULL），或对状态列做条件 UPDATE 保证原子性。与 C1 `active_key` 同源，实现照抄。

| # | 目标 | 实现 |
|---|---|---|
| 1 | **一关系仅一 owner** | `relation_member` 加生成列 `owner_flag = IF(member_type='owner', relation_id, NULL)`（STORED），`UNIQUE uk_owner(owner_flag)`。owner 唯一、collaborator 多行不受限；重复 owner 撞 1062 → 409 |
| 2 | **活跃手机号唯一**（软删/换号后号码释放） | `contact` 加生成列 `phone_active = IF(deleted_at IS NULL, phone, NULL)`（STORED），`UNIQUE uk_phone_active(phone_active)`。未删行占号、软删行变 NULL 放行；换号=改 phone 自动释放旧号。`company.credit_code`、`employee.work_no` **同理** |
| 3 | **抢公海原子认领** | 认领 = 条件 UPDATE：`UPDATE business_relation SET sea_status='private', owner_id=? WHERE id=? AND sea_status='company_sea'`（同一事务写 relation_member owner + sea_record）。**影响行数=1 才算抢到**；=0 → 409「已被领走」 |
| 4 | 撞单（已有） | `contact.phone`（→ 改为 `phone_active` 生成列唯一）+ `company.credit_code`；公司名相似度应用层；**撞码合并流程（信用代码撞重→墓碑合并）见 `→需求§7.3`**：B 打 `merged_into`→A、B.`credit_code` 置 NULL（UNIQUE 可空放行）、子表随 `relation_id`/`company_id` 重定向零改动 |
| 5 | 激活竞态（已有） | `business_relation.active_key` 生成列唯一索引——后到者撞 1062 → 409 返回归属人 |

> **注意**：生成列唯一索引上线前须**先清理存量重复**（否则 `ADD UNIQUE` 直接失败）。

---

## 十一、数据权限与脱敏（实现口径，业务规则见 `→需求§4`）

**库中永远明文全量**；脱敏在应用层按 permission_matrix 渲染。

| 查看场景 | 联系方式 | 事件可见度 |
|---|---|---|
| 归属本人 | 完整手机号 | 全文（可写） |
| 协同人（正式协同 / @求助有效期内） | 完整手机号 | 全文（可共同写） |
| 公司抽屉·非归属部门联系人 | `****{后4位}` +「申请解锁」 | 不显示具体事件 |
| 公海卡片/列表 | 脱敏 `xxx****xxxx` | 仅「近 30 天 N 次」概览 |
| 跨业务线金额 | 完全脱敏 | 仅"N 个工单进行中"概览 |

> ★ **脱敏口径只作用于「销售看他人私海 / 跨部门关系」的列表与详情**；**报表 / 看板 / 汇总不脱敏**（经理、老板出口返回真实金额，2026-09-11 定）。

- 数据范围：销售可见客户全集 = **本人 owner 私海 ∪ 我作为 collaborator 的关系（含正式协同 collaborate 与 @求助 ask_help，valid_until 未过期）∪ 公海**；经理=dept_manager 管辖部门；总经理=全部；他人私海不可见（除非协同/@求助授权）。客户列表提供"@我 / 我协同 / 全部关联"筛选视图，底层即 relation_member 中 employee_id=当前用户 的 collaborator 集合，与 owner 私海取并集后按筛选裁剪（口径见 §十七 A.3）
- 赢单弹药库（review published）：**默认本部门可见**；gm 经 system_config(ammo_scope=company) 改全公司；未收录的（open/dismissed）仅本人+直属经理可见
- 坐标属公司档案基础信息（非敏感）；将来做地图时必须走同一套权限过滤
- 协同/转交走审批；解锁/变更走审批且留痕；合同水印、操作日志为应用层责任

---

## 十二、定时任务清单

| 任务 | 频次 | 逻辑 |
|---|---|---|
| 组装今日动线 | 每日 05:00 | 承诺到期/逾期 + 预约 + cadence 命中 + 掉海倒计时 → **结转昨日遗留（open 结转/snoozed 到期推今日）+ 插入今日新增** 写 daily_agenda（**禁止清空重写**，D4）；失败则首页实时兜底 |
| 动线清理 | 每日 | daily_agenda 中 done/ignored 超期（建议 30/90 天）行清理或分区归档 |
| 日级行为汇总 | 每日 05:00 | 从 action_event 按 `biz_date×部门×产品线×人×动作类型` GROUP BY 回填 `stat_daily`（可按 biz_date 覆盖重跑）；供经理看板/健康度读取；记 job_run_log |
| 承诺提醒 | 到点/每日 | remind_at 到 → notification；逾期未办 → 次日动线置顶红（>3 天收进逾期抽屉） |
| 节奏提醒 | 每日 | cadence_rule 逐条命中（新客 48h / S 级客情 / 灰度定性 / 周重点周五清点） |
| 掉海预警（私海→公海） | 每小时 | 按 sea_rule：≤3 天进动线；到期前 24h 推销售；6h 标红+推经理；超期落 sea_record 转**公司公海**（部门映射保留，仍显示于部门公海） |
| 公海停留超期（经理决策） | 每日 | 扫描 `company_sea` 中归口本部门、停留超期的无主关系 → 生成**经理决策待办**（保留 / 删除关系）；**不自动删除、不自动流转**（`→需求§6.3`） |
| 灰度寿命 | 每日 | urgency=gray 超 `gray_remind_days` → **提醒下结论**（**不产生释放候选、不落 `gray_release_at`**；灰度到期由掉海任务照常处理） |
| 协同到期 | 每日 | relation_member.collaborator.valid_until 到期 → 自动失效并通知双方 |
| 判死教训缓写提醒 | 每日 | loss review 已 closed 但 detail 空 → 次日动线提醒补写 |
| win 复盘超时 | 每日 | B/C/D 级 win review open 超 30 天 → 自动 dismissed |
| 事件冗余回写 | 事件写入时 | 更新 last_event_at / next_action_hint / 建议销承诺 |

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

## 十四、需求追溯索引（本文件 ↔ 业务需求文档，变更时按此对账）

| 本文件 | 对应业务需求 | 说明 |
|---|---|---|
| 域 A 组织权限 | 需求 §7.1 / §4 角色与权限 | 部门规则各项阈值 |
| **A14 target 月目标** | **需求 §7.11 目标与进度** | 三层月目标（公司/部门/人），完成进度按回款额、并列签约额、显示时间进度对比，可改但留痕 |
| B1 company / B7 坐标 | 需求 §7.3 公司档案 | 完善度三档、坐标人工拾取 |
| B2 公司档案标签 | 需求 §9 标签体系 | 身份/制度/决策链 |
| B3-B6 联系人 | 需求 §7.2 联系人档案 | 跳槽留历史、手机号冻结、一人多号（附加号）、旧号回收提示 |
| A10 operation_log / A13 job_run_log | 需求 §4.3 权限脱敏 / §10.4 | 全局审计日志、任务执行日志 |
| D7 stat_daily | 需求 §10.4（统计口径派生） | 日级行为汇总（经理统计性能层） |
| C1 business_relation | 需求 §5 三层模型 / §8 意向体系 | 阶段、紧迫、两轴 |
| C2 relation_member | 需求 §5.2 归属 / §10.2 @求助 | owner 唯一、临时协同 |
| C5 appointment | 需求 §10.2 | 完成必留事件 |
| C7 competitor | 需求 §11.1 竞品三层 | 禁建档案库 |
| D1 commitment | 需求 §10.1 承诺 | me/them/verdict |
| D2 action_event | 需求 §10.2 事件流 | 动作类型含客情三型 |
| D3 cadence_rule | 需求 §10.3 节奏 | 加提醒=加行 |
| D4 daily_agenda | 需求 §10.4 今日动线 | 降噪规则 |
| D6 review | 需求 §11.2 出口复盘 | win/loss/churn 三型 |
| 域 E 交易服务 | 需求 §7.6 / §7.7 / §6.4 | 合同、台账、工单 |
| 域 F 公海 | 需求 §6.3 / §12 | 掉落规则与撞单 |
| 域 G 审批 | 需求 §7.9 | 四型一单 |
| §11 权限脱敏 | 需求 §4.3 | 分档口径一致 |
| 前端交互 | 需求 §13 全局交互规范 | **《销售CRM前端页面与交互文档》V1.2**（需求规格/）：设计系统（Design Tokens + 组件 + 状态 + 响应式）+ 实体可点铁律、一层抽屉、悬浮卡 |

> **L0 执行提示**：需求文档任一小节变更 → 按本表反查受影响的表 → 同批改本文件并升版。

---

## 十五、实施起点与开发顺序

1. **全新起点**：旧档案式表结构仅停留在纸面设计、从未编码实现，**不保留、不迁移、不做兼容层**，直接按本文档 §二～§十三 从零建库
2. 本文档为 Schema 唯一真相源：任何表/字段/字典/规则以本文档为准；实现中如发现需增补，**先回《业务需求文档》确认规则、再回本文档登记版本**，最后才落代码
3. 无历史生产数据可迁；如有少量手工试录数据，人工补录即可
4. **开发顺序**（依依赖）：域 A/B/C（组织与客户底座）→ 域 D 行动引擎（commitment / action_event / daily_agenda）→ 域 E/G（交易与审批）→ 域 F（公海）→ 定时任务与三出口视图 → **A14 target 目标层**（依赖 contract/payment 与部门树，放最后）
5. **★ Prisma 落库口径（2026-09-10 ORM 定案为 Prisma）**：本项目重度依赖 MySQL 原生特性（生成列 / 分区表 / JSON / 递归 CTE），Prisma 并非全部原生支持。落库按以下五条执行：

| # | 场景 | 做法 |
|---|---|---|
| 1 | **生成列**<br>（`business_relation.active_key`、`relation_member.owner_flag`、`contact.phone_active`） | schema.prisma 中定义为**可选字段并加 `@ignore`**（Prisma Client 不暴露、不进入 create/update input，**杜绝"试图写入生成列"的运行时报错**）；**在 migration SQL 里手写** `ADD COLUMN x GENERATED ALWAYS AS (...) STORED` ＋ 唯一索引。应用层**不读不写**这些列——唯一性由 DB 兜底，冲突靠错误码识别（见第 3 条） |
| 2 | **分区表**<br>（action_event / daily_agenda / stat_daily / operation_log / job_run_log） | Prisma 不支持 `PARTITION BY`：migration 中手写 `CREATE TABLE ... PARTITION BY RANGE ...`，schema.prisma 保持普通表定义（可能产生 drift 警告，可接受）。**⚠ 注意 §10.1 已确认：`action_event` 的 `uk_idem` 必须含分区键 `event_at`**，否则建表报 ERROR 1503 |
| 3 | **唯一约束冲突 → 409 / 422** | Prisma 唯一冲突错误码是 **P2002**（不是 MySQL 的 1062）。统一在异常过滤器映射：P2002 → 409（撞单 / 激活竞态 / 抢公海）/ 422（业务校验），并从 `meta.target` 读出命中的约束名，返回对应提示（如"已有归属：张三"） |
| 4 | **复杂查询 / 报表 / 递归 CTE** | 经理看板、合并树递归（`WITH RECURSIVE`）、`GROUP BY` 聚合一律走 `$queryRaw` ＋ `Prisma.sql` 参数化防注入。**不为迁就 Client API 而牺牲 SQL 表达力** |
| 5 | **JSON 字段**<br>（`ledger.extra_fields`、`contact.extra_phones`、`dept_rule.level_tiers` 等） | Prisma `Json` 类型原生支持 ✓。但**禁止在 JSON 列上做 `JSON_CONTAINS` 反向查询**（全表扫描，见 §十七 A.2）；高频检索的 key 走生成列或提升为正式字段 |

> **一句话分工**：**Prisma 管"类型安全 ＋ 日常 CRUD"，MySQL 原生特性（生成列 / 分区 / CTE）交给手写 migration 与 `$queryRaw`。** 二者不冲突，但必须在**第一次建库时就把 migration 写对**——后期再改成本高。
>
> **对账便利（选 Prisma 的理由之一）**：`schema.prisma` 是纯文本、**45 张表**全集中在一个文件里，七叔可直接对照本文档 §二～§九 逐表检查，与《数据架构文档》保持一一对应。

---

## 十六、修改记录

| 版本 | 日期 | 修改内容 |
|---|---|---|
| V1.0 | 2026-09-09 | 首版：从《数据库设计文档-助理版》V1.0.7 拆出**纯数据层**（表/字段/索引/字典/权限/任务），业务规则全部改为指针 `→需求§X` 指向新《销售CRM业务需求文档》，杜绝两处定义同一事实（L1）。新增 §十四 需求追溯索引，供 L0 变更联动对账。原助理版 V1.0.7 同步归档。 |
| V1.1 | 2026-09-09 | 新增 §十七 设计问答与常见陷阱：明确字段归类判据（事件级/关系级回写/实时派生）；`mentioned_user_ids` 维持 JSON 不拆表（权限已由 C2 relation_member 覆盖）；客户列表"@我 + 我协同"并集查询口径拍板；C2 补 relation_member 索引、§十一 数据范围明确并集与筛选视图。 |
| V1.2 | 2026-09-09 | 公海池模型修正（L0 联动需求 V1.1，`→需求§6.3`）：`sea_status` 收敛为 `private/company_sea` 两态（删除 `dept_sea` 状态字面量），**部门公海 = 公司公海中归口本部门无主关系的映射视图**；F1/F2 补"公海停留超期→经理决策待办（保留/删除关系，reason=dept_manager_delete 留痕），不自动流转"；掉海定时任务拆分：私海→公海（每小时自动）与 公海超期经理决策（每日扫描）。 |
| V1.3 | 2026-09-10 | 联系人谈判特质上限改为部门可配（L0 联动需求 V1.2，`→需求§9`）：A8 `dept_rule` 新增 `contact_trait_max`（默认 3，范围 1~5）；B4 `contact_trait` 每人上限改读部门配置（超出 422+20402），**调小上限后存量超限特质保留、仅对新写入/编辑生效**；ER 总览同步。 |
| V1.4 | 2026-09-10 | 新增 **§10.1 全表索引清单**（40 张表逐表列全 uk/idx，作为落库/评审的唯一索引依据，补此前"仅 4 张核心表列索引"的缺口）与 **§10.2 待确认项**（一关系一 owner、活跃手机号唯一、抢公海原子认领——三项方案挂账待拍板后并入清单）。 |
| V1.5 | 2026-09-10 | 七叔采纳四项并发/一致性兜底，**§10.2 由"待确认项"转为"已采纳"**：①`relation_member.owner_flag` 生成列唯一（一关系一 owner）；②`contact.phone_active` 生成列唯一（软删/换号释放号码，`credit_code`/`work_no` 同理）；③抢公海条件 UPDATE 原子认领；并同步 §十 场景表、§10.1 索引清单、B3/B4 字段说明、C2 索引说明。另 **D4 daily_agenda 组装方式定案为"结转+新增"**（禁止清空重写）+ 失败实时兜底 + 分区清理，§十二 同步。 |
| V1.6 | 2026-09-10 | 七叔采纳四项（L0 联动需求 V1.3）：①B3 `contact.extra_phones` JSON（一人多号·附加号不撞单）；②B6/§十 撞单检测补"历史号提示（回查 change_log，提示不拦截）"；③**A10 operation_log 升级为全局审计日志**（新增 req_id/操作人快照/before-after/ip/UA；业务事务内写入、只增不改、敏感动作永久留痕），新增 **A13 job_run_log** 任务执行日志；④新增 **D7 stat_daily 日级行为汇总表**（经理统计性能层，每日 GROUP BY 回填、可重跑）。§10.1 索引清单、§十二、§十四 追溯索引同步。 |
| V1.7 | 2026-09-10 | L0 联动需求 V1.4（范围决策：外部工商数据源后置开发，**无表结构变更**）。`credit_code` UNIQUE(可空) 已天然支持"老数据无代码可迁入、补上才占唯一位"；仅更新上游版本引用至 V1.4，供对齐追溯。 |
| V1.8 | 2026-09-10 | L0 联动需求 V1.5：①§10 撞单行公司名查重改为"两段式"（标准化+核心词，向前指 需求§7.3）；②D4 daily_agenda 补"防逃逸规则见 需求§10.4"前向引用。 |
| V1.9 | 2026-09-10 | L0 联动需求 V1.6（**撞码合并流程**）：①B1 `company` 新增 `merged_into`（自引用 FK 可空·墓碑）+ `aliases`（JSON 曾用名）；②`company` 索引补 `idx_merged(merged_into)`；③§10.2 撞单行前向指 需求§7.3，写明"合并时子表随 `relation_id`/`company_id` 重定向、零改动"。 |
| V1.10 | 2026-09-10 | L0 联动需求 V1.7（**关系碰撞子合并 + 合并联系人**）：①C1 `business_relation` 新增 `merged_into`（关系级自引用 FK 可空），`active_key` 生成列加 `AND merged_into IS NULL`（被并分支不占活跃位）；②B3 `contact` 新增 `merged_into`（联系人级自引用 FK 可空）；③索引补 `idx_merged_rel(merged_into)` / `idx_merged_contact(merged_into)`。 |
| V1.11 | 2026-09-10 | L0 联动需求 V1.8（**跟单显示原则**，**无表结构变更**）：D2 `action_event` 补展示口径说明——跟单列表默认近 1 个月（按 `event_at`）、以"当前登录人"（`actor_id`）分界（本人主线 / 他人树杈），复用现有 `idx(relation_id, event_at)`/`idx(actor_id, event_at)`，**不加字段、不做"疑似重复"智能判断**。 |
| **V1.12** | **2026-09-10** | L0 联动需求 **V1.9**（七叔拍板第一批 8 条 + 目标层）：①**C1 `dept_id` 标注"恒定不可变"**——掉公海只改"有无 owner"、不改部门，别的部门想要＝自己激活本部门关系（唯一约束含 dept_id，互不冲突），**"跨部门领取"问题消解**；②**C1 `sea_status` 语义改写为"这条关系当前有没有主人"**，部门公海＝`company_sea` 中 `dept_id`=本部门的集合；③**C1 `customer_level` 口径写死**＝本关系（本部门×本产品线）**滚动 12 个月回款额**、每日重算、跨年不清零，并补"看板统计按条/按家"口径；④**C1 `stage_id` 由 6 步扩为 7 步**，新增 **7 已流失（终态）**；⑤**D2 `outcome` 新增 `no_answer`**（快速标记专用，`summary` 可空），补"快速标记必须落库 + 支持批量"口径；⑥**D2 展示口径分界基准由"当前登录人"改为"该关系 owner"**（经理/老板看主跟单人视角）；⑦**新增 A14 `target` 月目标表**（三层：公司/部门/人，`uk_target(period, scope_type, scope_id)`；**进度不落表**、按回款实时 SUM、签约额并列、时间进度应用层算）；⑧字典 `workflow_stage` 补第 7 步"已流失"；⑨§二 ER 总览补 target、§10.1 索引清单补 target（**42 → 43 张**）、§十四 追溯索引补 target；⑩**ORM 定案 Prisma**（2026-09-10 七叔拍板），**§十五 新增第 5 条「Prisma 落库口径」**：生成列在 schema.prisma 中 `@ignore` ＋ migration 手写 `GENERATED ALWAYS AS ... STORED`（应用层不读不写）、分区表手写 `PARTITION BY RANGE`、唯一约束冲突映射 **P2002 → 409/422**、复杂查询/递归 CTE 走 `$queryRaw`、JSON 列禁止反向 `JSON_CONTAINS`。 |
| **V1.13** | **2026-09-10** | L0 联动需求 **V1.10**（七叔拍板第二批 8 条）：①**D2 `outcome` 由单值扩为两组**——有效沟通 `advanced/stalled/await_reply`；**快速标记三型 `not_contacted`/`no_answer`/`brief_hangup`**（`summary` 可空、支持批量）；②**★ 明确"快速标记不更新 `business_relation.last_event_at`"**（否则点一下就能刷爆掉海倒计时），C1 `last_event_at` 字段说明同步改为"最近一次**有效沟通**事件时间"；③**C1 `stage_id` 的"7 已流失"语义修正**——**判死与流失均掉回公海可被重新领取**（判死阶段保留、流失置 7；重新领取后阶段从 1 重新开始，`relation_stage_log` 留上一轮），取代 V1.12 的"不回流公海终态"；④**C1 `value_tier` 加校验**——`urgency != gray` 的关系必须已标价值（服务端 422）；⑤**F1 `sea_rule` 新增 `effective_from`**——掉海天数变更 **7 天后生效**（插新版本行、旧行 disable 停用不删），生效时在途倒计时从生效日重新起算；⑥**B1 补「老客户」徽标派生口径**——依据＝该公司存在历史合同（跨部门也能查到），**不加字段**；⑦字典 `workflow_stage` 第 7 步说明同步（"本轮结束"≠"不回流公海"）。 |
| **V1.14** | **2026-09-10** | L0 联动需求 **V1.11**（第三批中"开工前该定"的 7 条）：①**新增 B8 `file_asset` 文件资产表**（多态 biz_type/biz_id，存 file_key 不存 URL，`idx_biz` + `idx_uploader`）——补上原 `payment_record.voucher_file_id` 的悬空外键；②**新增 E7 `contract_split` 合同业绩分配表**（`uk_split(contract_id, employee_id)`、`idx_employee`；无记录＝100% 归 signer；建议建 `v_contract_performance` 视图统一报表口径）；③**C6 `visit_log` 字段精简**——删 `expect_return_at`/`transport`/`destination`/`note`，只留 `depart_at` + `reason` + `actual_return_at` + 可选 `relation_ids`；④**§10.1 索引清单 43 → 45 张**（补 file_asset、contract_split）；⑤§二 ER 总览同步补两张表。**介绍费相关规则一律不建**（`→需求§14.2`）。 |
| **V1.15** | **2026-09-11** | **L0 联动 `schema.prisma` 落地**（写 schema 时发现两处"规则落不了地"的缺口，补齐）：①**D4 `daily_agenda` 新增 `action_reason` / `snooze_count`**——支撑「ignored 必填原因」与「同一条最多 snooze 3 次」防逃逸规则（`→需求§10.4`）；②**E5 `ledger` 明确"通用字段"落列**＝`contact_id`（联系人）/ `sales_id`（销售对接人）/ `delivery_id`（交付对接人）/ `remark`（备注）（`→需求§7.7`）。同步：`服务端/prisma/schema.prisma`（45 张表）已含这些字段并通过 Prisma 6.19 校验。 |
| **V1.16** | **2026-09-11** | **开发前自查校正（L0 联动需求 V1.12）**：①**A8 `dept_rule` 删除 `gray_release_days`**、**C1 `business_relation` 删除 `gray_release_at`**——灰度寿命规则只管提醒、**取消"释放候选"**（与需求 §8.2 对齐）；②**F2 `sea_record.reason` 枚举删除 `gray_release`**；③**§十二 定时任务「灰度寿命」行**改为"只提醒下结论，不落 `gray_release_at`"；④**E3 工单 `type` 枚举 `aftersale` → `after_sale`**（与接口 §2.6 统一）；⑤§一「上游」→ 需求 V1.12、「下游」→ 接口 V1.3 / 设计规范 V1.0 / 前端 V1.4；⑥§十七 FAQ A.4 删"谁先签约谁得"（改"各签各的（互不干扰）"）。**同步：`schema.prisma` + `migrations/0001_init` 删这两个字段。** |
| **V1.17** | **2026-09-11** | **B 组澄清落地（L0 联动需求 V1.13）**：①**B4 `contact_trait`** 补口径——**422 只拦「新增」**，更新后数量 ≤ 当前已有数量则放行（防"调小上限后存量超限特质无法编辑"）；②**§十一 权限脱敏** 补口径——**脱敏只作用于"销售看他人私海 / 跨部门关系"的列表与详情；报表/看板/汇总不脱敏**（经理、老板出口返回真实金额）；③§一「上游」→ 需求 V1.13。 |

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
