-- =============================================================================
-- 0008_owner_flag_in_seat（2026-09-16）
--
-- 口径来源（★ 真相源）：2026-09-16 七叔拍板（→《欠账登记表》D-26）
--   —— 「一条业务关系只有一个负责人」这把锁，改成「**只有在位的负责人才占位**」。
--
-- 问题（为什么必须改）：
--   原生成列 = `IF(member_type='owner', relation_id, NULL)` —— **只看"是不是 owner"，
--   不看"还在不在位"**。而撤销（掉公海 / 转交）在本项目里的定义是**置 `revoked_at`、
--   不物理删**（留痕，`→ domain/relation-owner.ts`）。
--   ⇒ 老 owner 被撤销后 `owner_flag` **仍非空**，`uk_owner` 那把唯一索引**还占着位子**：
--      · 掉海后关系被**重新领取** → 写新 owner **撞 `uk_owner`**，写不进去；
--      · **转交**换人 同理；
--      · 连"原 owner 自己回来"也被 `addMember` 挡住（现文案：「该成员曾被移除，暂不支持再次加入」）。
--   现在撞不到，是因为 **F 域（掉海 / 公海领取）与 G 域（转交）都还没建**（排 M9）——
--   **一开工就会正面撞上**，故趁现在（改动最小）改掉。
--
-- 改法：生成列加一个条件 `AND revoked_at IS NULL` —— 撤销即**自动释放位子**，
--   而撤销记录本身照旧留痕（不删行）。
--
-- ⚠ `0001_init` 是**冻结基线**（已 `resolve --applied`）⇒ 一律走**新增量**
--   （口径见 `服务端/prisma/README.md §六` / `CODEBUDDY.md §5`）。
-- ★ 生成列是**手写**的（Prisma schema 里该列标 `@ignore`，它不管理生成列 / 该索引）：
--   改完 `schema.prisma` **不需要**改（那边只有注释），但**必须重跑 `prisma:generate`**
--   前先确认 `migrate diff` 无意外输出（本笔不产生 drift，见 `prisma/README.md`）。
--
-- 性质：**重建一个生成列 ＋ 重建它的唯一索引**；不动数据、不动其它列。
--   索引先删后建（删列会连带删索引，故显式两步，顺序固定）。
-- =============================================================================

ALTER TABLE `relation_member`
  DROP INDEX `uk_owner`,
  DROP COLUMN `owner_flag`,
  ADD COLUMN `owner_flag` BIGINT UNSIGNED
    GENERATED ALWAYS AS (IF(`member_type` = 'owner' AND `revoked_at` IS NULL, `relation_id`, NULL)) STORED
    COMMENT '生成列：仅**在位**（未撤销）的 owner 占位；撤销后自动释放，保证一个关系只有一个负责人 ★ 2026-09-16 migration 0008',
  ADD UNIQUE INDEX `uk_owner` (`owner_flag`);
