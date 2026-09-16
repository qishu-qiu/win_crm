-- =============================================================================
-- 0006_perm_key_comment（2026-09-16）
--
-- 口径来源（★ 真相源）：《销售CRM数据架构文档》A6 权限矩阵 —— `perm_key` 现行三值：
--   `contact_phone`（详情联系方式，全角色 visible）/ `relation_timeline`（跨部门跟单全文，
--   仅 admin/gm visible）/ `contract_amount`（跨部门金额，仅 gm visible、其余 masked）。
--   重定于 2026-09-14，见《废止口径登记表》**#31**。
--
-- ★ 本迁移**只改列 COMMENT** —— 不动表结构、不动数据、不动索引、不动约束。
--   `0001_init` 第 93 行建列时，COMMENT 里举的是两个**已废止**的 key
--   （`cross_dept_private` 看他人私海 / `phone_unlock` 手机号解锁）。
--   `0001_init` 是**冻结基线**（已 `resolve --applied`），改动它会与 `_prisma_migrations`
--   的校验和不一致 ⇒ 一律走**新增量**（口径见 `服务端/prisma/README.md §六` / `CODEBUDDY.md §5`）。
--
-- ⚠ Prisma **不管理** MySQL 列 COMMENT（`schema.prisma` 的 `///` 是文档注释、不落库），
--   故本笔只能手写；`migrate diff` 对此不产生任何输出（＝不会被判 drift）。
--
-- ★ 性质：元数据级改动，**幂等**（重复执行结果相同），无破坏性。
-- =============================================================================

ALTER TABLE `permission_matrix`
  MODIFY COLUMN `perm_key` VARCHAR(64) NOT NULL
    COMMENT '权限键：contact_phone / relation_timeline / contract_amount（2026-09-14 重定，→ 数据架构 A6）';
