-- =============================================================================
-- 0012 · M9-F / D-53：同三元组至多一条关系（**公海也占位**）＋ 存量清理
--
-- 口径来源（★ 真相源，勿自造）：
--   · 《销售CRM业务需求文档》§6.3「同三元组的『新一轮』＝ 领取同一条关系」（2026-09-21 定）
--     —— 同一「公司 × 部门 × 产品线」在库里**至多一条关系**；掉公海**不释放**这个位子，
--        "重新开始一轮"走 `POST /sea/company/:id/claim` **承接同一条**；
--   · 《销售CRM数据架构文档》C1 `uk_active_rel` ＋ §10.2-5（同批修正）。
--
-- 为什么改（《欠账登记表》D-53）：旧表达式只对 `sea_status='private'` 占位 ⇒ 同一三元组可
--   并存「公海行 ＋ 私海行」；公海那条一旦被领就撞上私海行占住的位 ⇒ **必 409**
--   （销售看到的是"点了就报错"的客户）。根因在**激活侧**：`POST /relations` 允许同三元组再建一行。
--
-- ⚠ 顺序**不可颠倒**：先清存量，再 `ADD UNIQUE`（否则直接失败 —— 数据架构 §10.2 尾注）。
-- ⚠ 本文件**不重生成 `0001_init`**（它已 `resolve --applied` 登记为基线，改动会与
--   `_prisma_migrations` 校验和不一致）；生成列在此**重建**，`0001_init` 文末 ③ 保持原样。
-- ⚠ 时区一律 `UTC_TIMESTAMP()`（口径 → `服务端/prisma/README.md` §七：UTC 存、出口换算）。
-- ⚠ 本机（2026-09-21）存量实测：恰好 **1 组**重复（三元组 `(3,3,3)`：`id=2 company_sea` ＋
--   `id=4 private`）—— 按下面的优先级会**保留 `id=4`（private，正在跟的那条）**、
--   逻辑删除 `id=2`（公海残留）。生产未上线，其余环境按同一 SQL 幂等处理。
-- =============================================================================

-- ---------- ① 存量清理：同三元组多条「未删未并」→ 只留一条，其余逻辑删除 ----------
-- 保留优先级：**`private` 优先**（"有人正在跟的那条"），同状态取 `updated_at` / `id` 最新。
--   ⚠ 为什么不是单纯"取 `updated_at` 最新"：真实数据里"公海残留行"的 `updated_at` 未必更旧
--     （边界：掉海后又激活、旧行的 `updated_at` 被别的写动作刷新过）—— 按状态优先才选得对，
--     否则会把**销售正在跟的客户**删掉、留下没人领的残留。
-- 被清理行**不写 `sea_record`**：它不是"一次掉海"（没有"掉海时的归属人"快照可写）；它若曾在
--   公海，那一轮的掉海史本来就在 `sea_record` 里（→ 数据架构 §164：两表都写、语义不同、不合并）。
-- 走窗口函数而不是 `GROUP BY MAX(updated_at)`：秒精度下 `updated_at` 可能并列，靠 `id` 才定得死。
UPDATE `business_relation` AS `r`
  JOIN (
    SELECT `id`
      FROM (
        SELECT `id`,
               ROW_NUMBER() OVER (
                 PARTITION BY `company_id`, `dept_id`, `product_line_id`
                 ORDER BY (`sea_status` = 'private') DESC, `updated_at` DESC, `id` DESC
               ) AS `rn`
          FROM `business_relation`
         WHERE `deleted_at` IS NULL AND `merged_into` IS NULL
      ) AS `ranked`
     WHERE `rn` > 1
  ) AS `losers` ON `losers`.`id` = `r`.`id`
   SET `r`.`deleted_at` = UTC_TIMESTAMP();

-- ---------- ② 重建生成列 `active_key`：条件由「private 且未并」改为「未删未并」 ----------
-- ⚠ 先 DROP 索引再 DROP 列（索引只挂在 `active_key` 上）。
ALTER TABLE `business_relation`
  DROP INDEX `uk_active_rel`,
  DROP COLUMN `active_key`;

ALTER TABLE `business_relation`
  ADD COLUMN `active_key` VARCHAR(128)
    GENERATED ALWAYS AS (
      IF(`deleted_at` IS NULL AND `merged_into` IS NULL,
         CONCAT_WS('-', `company_id`, `dept_id`, `product_line_id`),
         NULL)
    ) STORED
    COMMENT '生成列：未删未并即占位（★ 公海也占位 —— 同 公司-部门-产品线 至多一条关系；重新开始一轮走"领取"同一条，→需求§6.3）';

CREATE UNIQUE INDEX `uk_active_rel` ON `business_relation` (`active_key`);
