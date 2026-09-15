-- ============================================================================
-- 002_dict_seed.sql —— 内置字典种子（A11/A12 `dict_type` / `dict_item`）
--   依据：《销售CRM数据架构文档》V1.31 §十三「内置字典种子（dict，builtin=1 不可删可停用）」18 个字典
--   执行令：七叔 2026-09-15「执行」
-- ----------------------------------------------------------------------------
-- ★ 幂等策略（可反复跑）：
--   `dict_type` 用 `ON DUPLICATE KEY UPDATE name`（`uk_code` 兜住）；
--   `dict_item` 用 `INSERT ... SELECT` 按 `type_id + item_code` 落，撞 `uk_type_item` 时只更新
--   `label / sort / builtin / status / updated_at` —— **不删行、不改 id**（id 被业务数据引用时不会断链）。
--   ⚠ 本文件**不做先清后插**（与 A 域 `001_dev_seed.sql` 的取舍不同）：字典会被 `system_config`
--     之外的业务行（如 `action_event.action_type`）以**码值**引用，清空重建会让历史行指向不存在的码。
--
-- ★ 依据分级（改数据前先看这里）：
--   [规格给定码] 规格里**明确列了英文码**的：action_type / pain_point / urgency / value_tier /
--                customer_level / party / commitment_ctype / competition / review_type /
--                review_loss_reason / review_churn_reason / workflow_stage（1~7）
--   [AI 起草码]  规格**只给了中文举例**、未给英文码的：company_identity_tag / company_policy_tag /
--                decision_chain / contact_trait / relation_risk_label / review_win_reason
--                → 这些 `item_code` 由 AI 按语义起草（全站要求「枚举一律英文码」）；
--                  **业务确认后可直接改 `item_code`**（改前先 grep 引用，见 prisma/README「字典维护」）。
--   [标签]       一律中文；`customer_level` 的 `S 级` 等写法为展示用，可改。
--
-- ★ 已裁定（2026-09-15，七叔）：
--   ① `workflow_stage` 的码 ＝ **数字 `1`~`7`**（＝ `business_relation.stage` 的**数值列**口径，
--      §十三 也是「1 初步建联 → 7 已流失」的编号写法）。
--      原《接口API文档》§2.6 举例的英文码（`first_contact / need_confirm / demo / objection /
--      closing / cooperated / churned`）**已作废**，接口文档同步升 **V1.17**，
--      登记见《废止口径登记表》**#37**。**中文名仍由本文件的 `label` 出**（接口只传数字）。
--   ② `urgency` 已按 2026-09-15 裁定取**数据架构**那套（`weekly/monthly/quarterly/long_term/gray`；
--      接口 §2.6 原 `week_key/month_key/quarter_follow` 作废，见《废止口径登记表》#36）。
-- ----------------------------------------------------------------------------
-- ⚠ 真库 `updated_at` 是 `datetime NOT NULL` **且无默认值** → 每条 INSERT 必须显式给值。
-- ⚠ 本文件只 INSERT / UPDATE 字典两张表，**不碰任何业务表**。
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) 字典类型（18 个）
-- ---------------------------------------------------------------------------
INSERT INTO dict_type (code, name, created_at, updated_at) VALUES
  ('action_type',          '跟进动作类型',   NOW(), NOW()),
  ('pain_point',           '客户痛点',       NOW(), NOW()),
  ('urgency',              '紧迫档',         NOW(), NOW()),
  ('value_tier',           '开发价值档',     NOW(), NOW()),
  ('customer_level',       '客户等级',       NOW(), NOW()),
  ('party',                '承诺方',         NOW(), NOW()),
  ('commitment_ctype',     '承诺类型',       NOW(), NOW()),
  ('company_identity_tag', '公司身份标签',   NOW(), NOW()),
  ('company_policy_tag',   '公司制度标签',   NOW(), NOW()),
  ('decision_chain',       '决策链',         NOW(), NOW()),
  ('contact_trait',        '联系人谈判特质', NOW(), NOW()),
  ('relation_risk_label',  '关系风险标签',   NOW(), NOW()),
  ('workflow_stage',       '工作流阶段',     NOW(), NOW()),
  ('competition',          '竞争态势',       NOW(), NOW()),
  ('review_type',          '复盘类型',       NOW(), NOW()),
  ('review_win_reason',    '赢单原因',       NOW(), NOW()),
  ('review_loss_reason',   '输单原因',       NOW(), NOW()),
  ('review_churn_reason',  '流失原因',       NOW(), NOW())
ON DUPLICATE KEY UPDATE name = VALUES(name), updated_at = NOW();

-- ---------------------------------------------------------------------------
-- 2) 字典项（builtin=1；status=active）
--    写法：把「(type_code, item_code, label, sort)」列成派生表 v，再按 code 关联 dict_type 取 type_id
-- ---------------------------------------------------------------------------
INSERT INTO dict_item (type_id, item_code, label, sort, builtin, status, created_at, updated_at)
SELECT t.id, v.item_code, v.label, v.sort, 1, 'active', NOW(), NOW()
FROM dict_type t
JOIN (
  -- ===== action_type：跟进动作类型（规格给定码）=====
  SELECT 'action_type' AS type_code, 'phone'     AS item_code, '电话'     AS label, 1 AS sort UNION ALL
  SELECT 'action_type', 'wechat',    '微信',      2 UNION ALL
  SELECT 'action_type', 'visit',     '拜访',      3 UNION ALL
  SELECT 'action_type', 'onsite',    '上门',      4 UNION ALL
  SELECT 'action_type', 'email',     '邮件',      5 UNION ALL
  SELECT 'action_type', 'meal',      '饭局',      6 UNION ALL
  SELECT 'action_type', 'gift',      '送礼',      7 UNION ALL
  SELECT 'action_type', 'greeting',  '问候',      8 UNION ALL
  SELECT 'action_type', 'ask_help',  '@求助',     9 UNION ALL
  SELECT 'action_type', 'note',      '备注',     10 UNION ALL
  SELECT 'action_type', 'system',    '系统',     11 UNION ALL
  -- ===== pain_point：客户痛点（规格给定码）=====
  SELECT 'pain_point', 'price',          '价格',       1 UNION ALL
  SELECT 'pain_point', 'effect',         '效果',       2 UNION ALL
  SELECT 'pain_point', 'trust',          '信任',       3 UNION ALL
  SELECT 'pain_point', 'decision_maker', '决策人',     4 UNION ALL
  SELECT 'pain_point', 'timing',         '时机',       5 UNION ALL
  SELECT 'pain_point', 'competitor',     '竞品',       6 UNION ALL
  SELECT 'pain_point', 'internal',       '内部',       7 UNION ALL
  SELECT 'pain_point', 'other',          '其他',       8 UNION ALL
  -- ===== urgency：紧迫档（★ 2026-09-15 裁定＝数据架构那套；登记表 #36）=====
  SELECT 'urgency', 'weekly',    '本周',  1 UNION ALL
  SELECT 'urgency', 'monthly',   '本月',  2 UNION ALL
  SELECT 'urgency', 'quarterly', '季度',  3 UNION ALL
  SELECT 'urgency', 'long_term', '长期',  4 UNION ALL
  SELECT 'urgency', 'gray',      '灰度',  5 UNION ALL
  -- ===== value_tier：开发价值档（默认未标＝pending；非灰度必标）=====
  SELECT 'value_tier', 'high',    '高',    1 UNION ALL
  SELECT 'value_tier', 'medium',  '中',    2 UNION ALL
  SELECT 'value_tier', 'low',     '低',    3 UNION ALL
  SELECT 'value_tier', 'pending', '待定',  4 UNION ALL
  -- ===== customer_level：客户等级（档位金额每部门自配）=====
  SELECT 'customer_level', 'S', 'S 级', 1 UNION ALL
  SELECT 'customer_level', 'A', 'A 级', 2 UNION ALL
  SELECT 'customer_level', 'B', 'B 级', 3 UNION ALL
  SELECT 'customer_level', 'C', 'C 级', 4 UNION ALL
  SELECT 'customer_level', 'D', 'D 级', 5 UNION ALL
  -- ===== party：承诺方 =====
  SELECT 'party', 'me',      '我方', 1 UNION ALL
  SELECT 'party', 'them',    '对方', 2 UNION ALL
  SELECT 'party', 'verdict', '裁决', 3 UNION ALL
  -- ===== commitment_ctype：承诺类型（规格给定码）=====
  SELECT 'commitment_ctype', 'reply',            '答复',       1 UNION ALL
  SELECT 'commitment_ctype', 'quote',            '报价',       2 UNION ALL
  SELECT 'commitment_ctype', 'meet',             '见面',       3 UNION ALL
  SELECT 'commitment_ctype', 'deliver',          '交付',       4 UNION ALL
  SELECT 'commitment_ctype', 'decision',         '决策',       5 UNION ALL
  SELECT 'commitment_ctype', 'followup',         '跟进',       6 UNION ALL
  SELECT 'commitment_ctype', 'social_meal',      '社交·饭局',  7 UNION ALL
  SELECT 'commitment_ctype', 'social_gift',      '社交·送礼',  8 UNION ALL
  SELECT 'commitment_ctype', 'social_greeting',  '社交·问候',  9 UNION ALL
  -- ===== company_identity_tag：公司身份标签（★ AI 起草码，业务可改）=====
  SELECT 'company_identity_tag', 'listed',     '上市公司', 1 UNION ALL
  SELECT 'company_identity_tag', 'soe',        '国企',     2 UNION ALL
  SELECT 'company_identity_tag', 'private',    '民企',     3 UNION ALL
  SELECT 'company_identity_tag', 'foreign',    '外资',     4 UNION ALL
  SELECT 'company_identity_tag', 'hightech',   '高新企业', 5 UNION ALL
  SELECT 'company_identity_tag', 'group_hq',   '集团总部', 6 UNION ALL
  -- ===== company_policy_tag：公司制度标签（★ AI 起草码）=====
  SELECT 'company_policy_tag', 'annual_frame', '年度框架采购', 1 UNION ALL
  SELECT 'company_policy_tag', 'per_order',    '按次采购',     2 UNION ALL
  SELECT 'company_policy_tag', 'tender',       '招标制',       3 UNION ALL
  SELECT 'company_policy_tag', 'boss_direct',  '老板直批',     4 UNION ALL
  -- ===== decision_chain：决策链（单选；★ AI 起草码）=====
  SELECT 'decision_chain', 'boss',          '老板拍板',              1 UNION ALL
  SELECT 'decision_chain', 'dept_then_boss','部门负责人推荐+老板批',  2 UNION ALL
  SELECT 'decision_chain', 'purchasing',    '采购部',                3 UNION ALL
  SELECT 'decision_chain', 'multi_sign',    '多人会签',              4 UNION ALL
  -- ===== contact_trait：联系人谈判特质（每人 ≤ 部门上限，默认 3；★ AI 起草码）=====
  SELECT 'contact_trait', 'price_sensitive', '价格敏感', 1 UNION ALL
  SELECT 'contact_trait', 'relationship',    '关系型',   2 UNION ALL
  SELECT 'contact_trait', 'solution',        '方案型',   3 UNION ALL
  SELECT 'contact_trait', 'expert',          '专业控',   4 UNION ALL
  SELECT 'contact_trait', 'hesitant',        '犹豫型',   5 UNION ALL
  SELECT 'contact_trait', 'fast_decision',   '快决策',   6 UNION ALL
  SELECT 'contact_trait', 'face',            '爱面子',   7 UNION ALL
  -- ===== relation_risk_label：关系风险标签（★ AI 起草码）=====
  SELECT 'relation_risk_label', 'churn_signal',   '流失信号',   1 UNION ALL
  SELECT 'relation_risk_label', 'payment_risk',   '回款风险',   2 UNION ALL
  SELECT 'relation_risk_label', 'competitor_in',  '竞品渗透',   3 UNION ALL
  SELECT 'relation_risk_label', 'contact_change', '换对接人',   4 UNION ALL
  SELECT 'relation_risk_label', 'org_change',     '组织变动',   5 UNION ALL
  -- ===== workflow_stage：工作流阶段（★ 码＝1~7，待裁：另有英文码一套，见文件头）=====
  SELECT 'workflow_stage', '1', '初步建联',        1 UNION ALL
  SELECT 'workflow_stage', '2', '需求确认',        2 UNION ALL
  SELECT 'workflow_stage', '3', '面访产品讲解',    3 UNION ALL
  SELECT 'workflow_stage', '4', '异议与卡点',      4 UNION ALL
  SELECT 'workflow_stage', '5', '逼单',            5 UNION ALL
  SELECT 'workflow_stage', '6', '已合作（终态）',  6 UNION ALL
  SELECT 'workflow_stage', '7', '已流失（终态）',  7 UNION ALL
  -- ===== competition：竞争态势（规格给定码）=====
  SELECT 'competition', 'none',      '无',     1 UNION ALL
  SELECT 'competition', 'in_use',    '在用',   2 UNION ALL
  SELECT 'competition', 'comparing', '比较中', 3 UNION ALL
  -- ===== review_type：复盘类型（规格给定码）=====
  SELECT 'review_type', 'win',   '赢单', 1 UNION ALL
  SELECT 'review_type', 'loss',  '输单', 2 UNION ALL
  SELECT 'review_type', 'churn', '流失', 3 UNION ALL
  -- ===== review_win_reason：赢单原因（★ AI 起草码；规格只给中文）=====
  SELECT 'review_win_reason', 'client_initiative',   '客户主动找', 1 UNION ALL
  SELECT 'review_win_reason', 'price_advantage',     '价格优势',   2 UNION ALL
  SELECT 'review_win_reason', 'relationship',        '关系到位',   3 UNION ALL
  SELECT 'review_win_reason', 'competitor_mistake',  '竞品失误',   4 UNION ALL
  SELECT 'review_win_reason', 'unclear',             '说不清',     5 UNION ALL
  -- ===== review_loss_reason：输单原因（规格给定码）=====
  SELECT 'review_loss_reason', 'no_need',            '没真需求',        1 UNION ALL
  SELECT 'review_loss_reason', 'lost_to_competitor', '输给竞品（不点名）', 2 UNION ALL
  SELECT 'review_loss_reason', 'not_followed',       '我们没跟住',      3 UNION ALL
  SELECT 'review_loss_reason', 'budget',             '预算问题',        4 UNION ALL
  SELECT 'review_loss_reason', 'chain_broken',       '决策链断了',      5 UNION ALL
  SELECT 'review_loss_reason', 'unsure',             '说不清',          6 UNION ALL
  -- ===== review_churn_reason：流失原因（规格给定码）=====
  SELECT 'review_churn_reason', 'poached',          '被竞品撬走',   1 UNION ALL
  SELECT 'review_churn_reason', 'expired_no_renew', '到期未续费',   2 UNION ALL
  SELECT 'review_churn_reason', 'service',          '服务不满',     3 UNION ALL
  SELECT 'review_churn_reason', 'neglect',          '我们疏忽',     4 UNION ALL
  SELECT 'review_churn_reason', 'client_biz_change','客户经营变故', 5 UNION ALL
  SELECT 'review_churn_reason', 'other',            '其他',         6
) v ON v.type_code = t.code
ON DUPLICATE KEY UPDATE
  label = VALUES(label), sort = VALUES(sort), builtin = VALUES(builtin),
  status = VALUES(status), updated_at = NOW();

-- ---------------------------------------------------------------------------
-- 3) 自检（Q1 每个字典的条数；Q2 urgency 取值＝数据架构那套；Q3 总数与 builtin 数）
-- ---------------------------------------------------------------------------
SELECT 'Q1 每字典条数' AS chk, t.code, t.name, COUNT(i.id) AS items
FROM dict_type t LEFT JOIN dict_item i ON i.type_id = t.id AND i.deleted_at IS NULL
WHERE t.deleted_at IS NULL
GROUP BY t.id, t.code, t.name ORDER BY t.code;

SELECT 'Q2 urgency' AS chk, item_code, label FROM dict_item i
JOIN dict_type t ON t.id = i.type_id
WHERE t.code = 'urgency' ORDER BY sort;

SELECT 'Q3 合计' AS chk, COUNT(*) AS items_total, SUM(builtin = 1) AS builtin_total
FROM dict_item WHERE deleted_at IS NULL;
