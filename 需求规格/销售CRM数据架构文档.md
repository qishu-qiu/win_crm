# 销售 CRM 数据架构文档 V1.0（现行有效）

> **本文件的角色**：只回答"**数据怎么存**"——表、字段、索引、字典、权限实现口径、定时任务。
> **业务规则一律不在此定义**：凡涉及"为什么这么设计、规则是什么"，一律见《销售CRM业务需求文档》对应章节（本文用 `→需求§X` 标注）。
> **元铁律**：**L0 变更联动**（需求改 → 本文件同批改）｜**L1 单一事实源**（规则只在需求文档定义一次，本文只写指针）。

---

## 一、文档信息

| 项目 | 内容 |
|---|---|
| 版本 / 日期 | **V1.0（现行有效）** / 2026-09-09 |
| 上游 | 《销售CRM业务需求文档》V1.0（业务规则唯一来源） |
| 下游 | 《销售CRM接口API文档》（待建）、《销售CRM前端页面与交互文档》（待建） |
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
product_line ─┬─< field_template（台账扩展字段元数据）
              └─< sea_rule（公海规则 L1-L4）

company ─┬─< company_contact >─ contact ─ contact_change_log
         │                        └─ contact_trait（谈判特质 ≤3）
         ├─ company_profile_tag（身份/制度/决策链，打标人留痕）
         ├─ 地理信息（longitude / latitude，GCJ-02）
         └─< business_relation ─┬─ relation_member（owner / collaborator）
                                 ├─ relation_stage_log（阶段推进留痕）
                                 ├─ relation_label（风险等人补标注，留痕）
                                 ├─< appointment（预约）
                                 ├─< commitment（承诺 ★心脏）
                                 ├─< action_event（事件流 ★谁·何时·对谁·结果）
                                 ├─< contract ─< payment_record
                                 ├─< workorder ─< workorder_log
                                 └─< sea_record（入公海历史）

commitment ─< daily_agenda（今日动线，ref 承诺/预约/节奏）
cadence_rule（节奏规则：经理配；含掉海/新客/S级客情/灰度）
competitor（竞品名册：经理维护，销售只读引用）
review（出口复盘 ★转已合作 / 判死 / 流失）
approval（转交 / 协同 / 手机号变更 / 手机号解锁 四型一单）
notification（站内/微信预留）｜ dict_type ─< dict_item
operation_log（操作留痕）｜ visit_log（外出登记：纯行政考勤）
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
| gray_remind_days | 灰度 N 天未定性 → 提醒下结论 |
| gray_release_days | 再 M 天未动 → 列为公海释放候选，经理确认后释放 |
| s_social_days | S 级客户客情节奏默认间隔（建议 45） |
| newbie_first_follow_hours | 新联系人/新关系首次跟进窗口（建议 48h） |
| ask_help_days | @求助临时协同默认有效期（建议 7 天） |
| nearby_radius_km | 预留：将来做附近客户时的默认半径（V1 不用） |

### A9 notification 通知
`user_id`、`title/content`、`biz_type`(commitment_due/cadence/drop_warn/gray/approval…)、`biz_id`、`channel`(site/wechat 预留)、`read_at`

### A10 operation_log 操作留痕
`operator_id`、`action`、`target_type/target_id`、`detail` JSON；激活/转交/审批/规则/字典/权限/字段模板等改动全量落

### A11 dict_type / dict_item 字典
- dict_type：`code` UNIQUE + `name`
- dict_item：`type_id` + `item_code` + `label` + `sort` + `builtin`(内置不可删，可停用) + `status`
- 修改写 operation_log；内置种子见 §十三

### A12 system_config 系统级配置（gm 可改，留痕）
`config_key` UNIQUE(如 `ammo_scope`: dept/company 赢单弹药库可见范围) + `value` JSON + `updated_by/updated_at`

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

### B2 company_profile_tag 公司档案标签（身份/制度/决策链）
`company_id` + `group_code`(company_identity_tag 多选 / company_policy_tag 多选 / decision_chain 单选) + `tag_id` + `tag_code`(冗余防字典改名) + `marked_by/marked_at`(打标人留痕)
- 联合唯一 `uk(company_id, group_code, tag_id)`；决策链每组仅 1 条（应用层保证）
- 建档人工勾一次、全公司共享、不随部门隔离；覆盖式更新，删除物理删行（留痕见 operation_log）

### B3 contact 联系人
| 字段 | 说明 |
|---|---|
| name / phone | phone **UNIQUE**（撞单校验核心） |
| wechat/email/gender/birthday | 联系方式 |
| decision_role | decision/influence/execute（决策/影响/执行） |
| tags JSON | 个人自由标签（爱喝茶/老板亲戚…），与谈判特质分栏并存 |
| trait_summary JSON | 谈判特质冗余（从 contact_trait 派生展示） |
| status | active/left/freelance |
| phone_frozen_until | 手机号变更审核冻结期（24h） |

### B4 contact_trait 联系人谈判特质（≤3）
`contact_id` + `trait_id/trait_code` + `marked_by/marked_at`；联合唯一；**每人 ≤3**（超出 422）；特质跟着人走（换公司保留）

### B5 company_contact 就职关系（N:M 含历史）
`company_id + contact_id + is_current + joined_at + left_at + position`；一人多段就职全留痕

### B6 contact_change_log 联系人变更留痕
`contact_id + field + old_value + new_value + approval_id`；手机号变更必须关联审批单

### B7 地理坐标（只存字段，地图应用不在本架构定义）
- **就两个字段**：`company.longitude/latitude`，**不建独立地址表、不加精度/来源/状态/行政区划等任何附属字段**（`→需求§7.3`）
- **一家公司一个地址一个坐标**（V1 单地址）
- 坐标一律**人工用高德坐标拾取器点选**，不做地址自动解析；非必填
- 坐标系统一 **GCJ-02**（换底图在出口层转，库内不动）
- 列表「地址是否维护」为**派生展示**（`address` 或 `longitude` 为空 → 显示"未维护"），**不新增字段**
- 索引 `idx_geo(latitude, longitude)` 预留，极低开销，供将来按经纬度范围检索

---

## 五、域 C：业务关系与归属协同（`→需求§5` §8 §10）

### C1 business_relation 业务关系 ★收敛（只留归属与两轴）
| 字段 | 说明 |
|---|---|
| company_id / dept_id / product_line_id | 三元组 |
| stage_id | 工作流阶段引用（6 步，`→需求§8.1`） |
| urgency | weekly/monthly/quarterly/long_term/gray(默认)。纯手动、无自动降级 |
| value_tier | high/medium/low/pending(默认空)。手动 |
| customer_level | S/A/B/C/D（回款到账事务内按 dept_rule 自动算，**不手填**） |
| competition | **竞品态势快照**（可空=未知）：none/in_use/comparing。**录入不在此表**——写事件(D2)时顺手标记并回写；列表/推导读本字段 |
| competitor_id 可空 | 关联 `competitor` 名册（最近一次标记对象），由事件回写 |
| sea_status | private/dept_sea/company_sea |
| gray_release_at | 灰度寿命释放候选时间戳 |
| last_event_at | 最近一次事件时间，INDEX 供预警扫描 |
| next_action_hint | 可空：一句话"上次说好下次干嘛"（从最近承诺/事件冗余） |
| 唯一索引 | `uk_active_rel`：同 公司+部门+产品线 仅一条活跃私海关系（生成列 active_key 实现） |

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

### C3 relation_stage_log 阶段推进留痕
`relation_id + from_stage/to_stage + action(normal/jump/rollback/lost) + reason + operator_id`

### C4 relation_label 关系级标注（风险等人补标签）
`relation_id + group_code(risk/other) + label_id/label_code + marked_by/marked_at + remark`；联合唯一 `uk(relation_id, group_code, label_id)`。自动风险信号不落库，由规则从事件流实时派生只读回传

### C5 appointment 预约
`relation_id + contact_id + appointment_at + note + status(pending/done/rescheduled/expired_archived) + action_event_id`(完成时强制关联事件，**422**)；改期留 `reschedule_log` JSON

### C6 visit_log 外出登记（纯行政考勤）
`employee_id + depart_at + expect_return_at + actual_return_at + destination + transport + note`；relation_ids JSON 可选（仅备注去了哪些客户）
- **不自动产生任何业务事件、不关联报销**；拜访结果由销售写 `action_event(visit)` 或完成预约（422）

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
| summary | 一句话结果（≤200 字） |
| outcome 可空 | advanced/stalled/await_reply；空=中性（**非必填**） |
| stage_forward 可空 | 系统建议的下一阶段（**限频**：距上次阶段变更 ≥3 天 或 跨里程碑才建议） |
| pain_point_id 可空 | 卡点字典项 |
| competition 可空 | 本次跟单竞品态势 none/in_use/comparing，事务回写 C1 快照。**UI 口径：折叠成一行，默认"无"跳过** |
| competitor_id / competition_note 可空 | 本次标记的竞品 / 一句话情况（≤100 字） |
| duration_min 可空 | 本次投入分钟（算单位时间价值） |
| mentioned_user_ids JSON | @求助的同事；**@ 即授予临时协同**（见 C2） |
| source | manual / auto / import |
| visit_log_id / appointment_id 可空 | 关联外出/预约 |
| idempotency_key UNIQUE | 防重复提交 |
| attachments JSON | 附件 |

- 索引：`idx(relation_id, event_at)`、`idx(actor_id, event_at)`、`idx(pain_point_id)`

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
| status | open / done / snoozed / ignored（可选原因） |

- 组装规则与**降噪收敛**（逾期>3 天收入"逾期抽屉"、硬约束永远置顶、ignored 7 天不重复）见 `→需求§10.4`

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

---

## 七、域 E：交易与服务（`→需求§7.6` §7.7 §6.4）

### E1 contract 合同
`contract_no` UNIQUE + `relation_id` + `product_line_id` + `contact_id` + `signer_id`(**签单人锁定=业绩归属，终身不变**) + `amount` + `paid_amount` + `pay_type` + `sign_date` + `service_start/end` + `auto_renew` + `remind_days` JSON(30/60/90) + `attachments` JSON + `status`(unpaid/partial/running/done/terminated)

> **维护归属**：维护责任跟**业务关系当前 owner** 走（`→需求§5.2`），**不再单独设 maintainer 字段**——避免签单人/维护人/owner 三套归属打架。

### E2 payment_record 回款流水
`contract_id + amount + paid_at + method + voucher_file_id + created_by`；事务内更新 contract.paid_amount/状态，按 dept_rule 重算 customer_level，写 ledger

### E3 workorder 工单
`order_no` UNIQUE + `type`(aftersale/opportunity) + `relation_id` + `title/content` + `source` + `priority`(P0-P3 仅售后) + `assignee_id` + `sla_deadline` + `est_effort_min` 可空(工时估算点选) + `status`(created/assigned/processing/confirming/closed) + `upgraded_from_id`(升级互链)

### E4 workorder_log
`workorder_id + action + from_status + to_status + reason + operator_id`（升级必填原因）

### E5 ledger 客户台账
`contract_id + company_id + product_line_id + customer_level + sign_date + expire_date + 通用字段 + extra_fields` **JSON**（Key 必须已登记 field_template，未登记拒收）；索引 `(product_line_id, expire_date)`；高频统计 Key 走生成列+索引（DBA 逐个评估）

### E6 field_template 字段元数据（登记唯一入口）
`product_line_id + field_key`(`uk(product_line_id, field_key)`，保存后不可变) + `label` + `control_type`(text/number/date/select/multiselect/link，**不可变**) + `required/sort/show_in_list`(可改) + `options` JSON + `status`(active/disabled)

---

## 八、域 F：公海与流转（`→需求§6.3` §12）

### F1 sea_rule 公海规则（L1-L4）
`level`(1=全局 2=产品线 3=部门 4=部门×产品线) + `dept_id/product_line_id`(按层可空) + `follow_freq_days` + `deal_cycle_days` + `stay_days` + `no_progress_max` + `status`；命中解析 L4→L1 取第一条，应用层缓存、变更失效

### F2 sea_record 入公海历史
`relation_id + from_sea/to_sea + reason`(follow_timeout/deal_timeout/stagnant/manual/gray_release) + `dropped_at + claimed_by + claimed_at`

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
| 撞单 | `contact.phone` UNIQUE + `company.credit_code` UNIQUE；公司名相似度应用层 |
| 激活竞态 | `business_relation.active_key` 生成列唯一索引——后到者 INSERT 撞 1062 → 409 返回归属人 |
| 编辑并发 | 主表 `updated_at` 乐观锁版本戳，更新带条件，影响 0 行即 409 |
| 预警扫描 | `business_relation(last_event_at, sea_status)`、`contract(service_end, status)`、`workorder(sla_deadline, status)`、`commitment(owner_id, status, due_at)` |
| 管辖过滤 | 列表查询强制 `dept_id IN (管辖部门集合)`，登录注入缓存 |
| 事件写放大 | `last_event_at` / `next_action_hint` 由事件写入事务冗余更新 |
| 地理检索（预留） | `company.idx_geo(latitude, longitude)` |

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

- 数据范围：销售=本人私海(owner/collaborator)+公海；经理=dept_manager 管辖部门；总经理=全部；他人私海不可见（除非协同/@求助授权）
- 赢单弹药库（review published）：**默认本部门可见**；gm 经 system_config(ammo_scope=company) 改全公司；未收录的（open/dismissed）仅本人+直属经理可见
- 坐标属公司档案基础信息（非敏感）；将来做地图时必须走同一套权限过滤
- 协同/转交走审批；解锁/变更走审批且留痕；合同水印、操作日志为应用层责任

---

## 十二、定时任务清单

| 任务 | 频次 | 逻辑 |
|---|---|---|
| 组装今日动线 | 每日 05:00 | 承诺到期/逾期 + 预约 + cadence 命中 + 掉海倒计时 → 写 daily_agenda |
| 承诺提醒 | 到点/每日 | remind_at 到 → notification；逾期未办 → 次日动线置顶红（>3 天收进逾期抽屉） |
| 节奏提醒 | 每日 | cadence_rule 逐条命中（新客 48h / S 级客情 / 灰度定性 / 周重点周五清点） |
| 掉海预警 | 每小时 | 按 sea_rule：≤3 天进动线；到期前 24h 推销售；6h 标红+推经理；超期落 sea_record 转公海 |
| 灰度寿命 | 每日 | urgency=gray 超 remind_days → 提醒下结论；再超 release_days → 置 gray_release_at |
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
| workflow_stage | 6 步种子：1 初步建联 → 2 需求确认 → 3 面访产品讲解 → 4 异议与卡点 → 5 逼单 → 6 已合作(is_final)；按部门×产品线初始化 |
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
| B1 company / B7 坐标 | 需求 §7.3 公司档案 | 完善度三档、坐标人工拾取 |
| B2 公司档案标签 | 需求 §9 标签体系 | 身份/制度/决策链 |
| B3-B6 联系人 | 需求 §7.2 联系人档案 | 跳槽留历史、手机号冻结 |
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
| 前端交互（待建） | 需求 §13 全局交互规范 | **实体可点铁律、一层抽屉、悬浮卡** |

> **L0 执行提示**：需求文档任一小节变更 → 按本表反查受影响的表 → 同批改本文件并升版。

---

## 十五、实施起点与开发顺序

1. **全新起点**：旧档案式表结构仅停留在纸面设计、从未编码实现，**不保留、不迁移、不做兼容层**，直接按本文档 §二～§十三 从零建库
2. 本文档为 Schema 唯一真相源：任何表/字段/字典/规则以本文档为准；实现中如发现需增补，**先回《业务需求文档》确认规则、再回本文档登记版本**，最后才落代码
3. 无历史生产数据可迁；如有少量手工试录数据，人工补录即可
4. **开发顺序**（依依赖）：域 A/B/C（组织与客户底座）→ 域 D 行动引擎（commitment / action_event / daily_agenda）→ 域 E/G（交易与审批）→ 域 F（公海）→ 定时任务与三出口视图

---

## 十六、修改记录

| 版本 | 日期 | 修改内容 |
|---|---|---|
| V1.0 | 2026-09-09 | 首版：从《数据库设计文档-助理版》V1.0.7 拆出**纯数据层**（表/字段/索引/字典/权限/任务），业务规则全部改为指针 `→需求§X` 指向新《销售CRM业务需求文档》，杜绝两处定义同一事实（L1）。新增 §十四 需求追溯索引，供 L0 变更联动对账。原助理版 V1.0.7 同步归档。 |

---

**文档结束**
