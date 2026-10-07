-- ============================================================================
-- 003_sign_checklist_seed.sql —— 每条产品线的**默认签约校验清单**（E8）
--   依据：《销售CRM数据架构文档》E8「默认清单（系统播种）」＋ 接口 §5.15（配置端点）/ §5.9（创建前硬卡）
--   ⚠ 不写文档版本号（→《销售CRM接口API文档》§7）
--   执行令：七叔 2026-10-07「执行」（M9-E / B3-6）
-- ----------------------------------------------------------------------------
-- ★ 播种内容（E8 逐字，**不多不少**）：
--   `scope=company` 4 项：credit_code / address / industry_l1 / province，required=1
--   `scope=relation` 2 项：value_tier / contact，required=1
--   ⚠ `registered_capital` / `legal_person` **不播种**（E8 ★ 2026-09-13：二者是公司档案
--     可选扩展字段，**不做签约强制**；个别线要卡，管理员在「系统设置 → 产品线」自选加回，
--     `field_key` 填**真实列名**即可）。
--   ⚠ `scope=ledger` **不播种**：台账差异化字段须先登记 `field_template`（E6 / 接口 §5.15 的
--     `20410` 硬卡），而 `field_template` 应用层属 B8（未建）⇒ 现阶段无从登记，故不种。
--
-- ★ 幂等策略（可反复跑）＝ **`INSERT IGNORE`，只补缺、不覆盖已配**：
--   `uk_line_scope_field(product_line_id, scope, field_key)` 冲突即跳过。
--   ★ 为什么不用 `ON DUPLICATE KEY UPDATE`（与 `002_dict_seed.sql` 的取舍**故意不同**）：
--     字典项被业务以**码值**引用，重建会断链；而 `sign_checklist` 的 `required` / `sort` / `status`
--     正是**管理员会改的三个字段**（E8：可改），覆盖回去等于每次跑种子都抹掉线上配置。
--     故本表只负责"把没有的补上"，**不碰已存在的行**。
--
-- ★ 依据分级（改数据前先看这里）：
--   [规格给定] scope / field_key 六项、required=true、`sort` 顺序、`uk_line_scope_field`（E8）；
--   [AI 起草] `label` 中文显示名（E8 要求"中文显示名，弹窗用"，但**没给具体文案**）——
--               前端按 `label` 显示、不硬编码（→ 接口 §5.15），故改文案不影响逻辑，仅改种子。
--   [口径] 派生范围＝`product_line.deleted_at IS NULL`（不按 `status` 过滤：停用的线也应有默认清单，
--           启用后直接生效；`status='active'` 是清单项自己的开关，两件事别混）。
-- ----------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1) 播种：每条未删除产品线 6 项（4 company + 2 relation）
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO sign_checklist (
  product_line_id, scope, field_key, label, required, sort, status, created_at
)
SELECT
  p.id AS product_line_id,
  t.scope AS scope,
  t.field_key AS field_key,
  t.label AS label,
  1 AS required,
  t.sort AS sort,
  'active' AS status,
  NOW() AS created_at
FROM product_line p
CROSS JOIN (
  SELECT 'company' AS scope, 'credit_code' AS field_key, '统一社会信用代码' AS label, 1 AS sort
  UNION ALL SELECT 'company', 'address',      '注册地址',        2
  UNION ALL SELECT 'company', 'industry_l1',  '所属行业（一级）', 3
  UNION ALL SELECT 'company', 'province',     '所在省份',        4
  UNION ALL SELECT 'relation','value_tier',   '开发价值',        5
  UNION ALL SELECT 'relation','contact',      '签约联系人',      6
) t
WHERE p.deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2) 自检（Q1 每条线项数应 6；Q2 六项清单内容；Q3 悬空产品线）
--    ⚠ 判读：项数**少于** 6 说明该线有行被管理员改过（停用 / 删过）——这是允许的，别"顺手修回 6"。
-- ---------------------------------------------------------------------------
SELECT 'Q1 每线项数' AS chk, p.code AS product_line, p.name AS name, COUNT(sc.id) AS items
FROM product_line p LEFT JOIN sign_checklist sc ON sc.product_line_id = p.id
WHERE p.deleted_at IS NULL
GROUP BY p.id, p.code, p.name ORDER BY p.id;

SELECT 'Q2 清单内容' AS chk, pl.code AS product_line, sc.scope, sc.field_key, sc.label, sc.required, sc.sort, sc.status
FROM sign_checklist sc JOIN product_line pl ON pl.id = sc.product_line_id
ORDER BY pl.id, sc.scope, sc.sort;

SELECT 'Q3 悬空产品线' AS chk, COUNT(*) AS n FROM sign_checklist sc
LEFT JOIN product_line pl ON pl.id = sc.product_line_id
WHERE pl.id IS NULL;