-- ============================================================================
-- 0003_username_and_phone_lock（增量 migration · 2026-09-14）
--   口径来源：《需求规格/销售CRM数据架构文档》§三 A2（employee）/ §四 B3（contact）
--   需求依据：《需求规格/销售CRM业务需求文档》§4.3（联系方式口径重写，2026-09-14 拍板）
--             ＋ §7.9（联系方式解锁的审批人例外）
-- ----------------------------------------------------------------------------
-- 做什么（两件事，互不相干）：
--   ① `employee` 新增 `username`（登录账号名）：**员工自定、可空、唯一**。
--      登录通道由「手机号 ＋ 密码」单通道，扩为「手机号 / 账号名 二选一 ＋ 密码」
--      （前端只给一个输入框，服务端判别）。
--   ② `contact` 新增 `phone_locked_at` / `phone_locked_by`（联系方式「锁」）：
--      联系方式默认**全可见**；该联系人的归属 owner 可「上锁」自我保护；
--      上锁后他人查看需**申请解锁**，**由落锁人审批**（→ 需求 §7.9 的例外：不默认走直属上级），
--      批准后**限时可见 24 小时**。
-- 为什么这样存（口径，勿改）：
--   - `username` **可空 ＋ 唯一**：MySQL 唯一索引允许多个 NULL → 「老员工可以没有账号名」
--     与「账号名不许重」两件事同时成立。取 64 位够放中英文 / 邮箱式账号名；
--     **不区分大小写**（跟随库 / 表 `utf8mb4_unicode_ci`，登录时无需额外处理）。
--   - 锁**挂在联系人上、全局生效**（不是挂在关系上）：手机号是**人**的属性 ——
--     A 部门上锁，B 部门同样看不到；否则同一个号会出现「一半可见一半不可见」，无法对用户解释。
--   - `phone_locked_by` 存**落锁人**（而非审批链）：解锁申请的审批人 ＝ 落锁人本人
--     （落点 `approval.approver_id`，`type=phone_unlock`）。**不建外键** —— 与 `created_by`
--     等审计列口径一致，避免「删员工被引用挡住」。
--   - **锁的消失条件（应用层实现，DB 不加触发器 / 不加约束）**：落锁人只要
--     **不再是该联系人任一活跃关系的 owner**（离职 / 转岗 / 关系掉公海）→ 锁即自动消失。
--     掉公海后关系无 owner → 锁自动消失 → **公海联系方式全可见**；这与「公海**列表**仍脱敏
--     （防批量截图）、**详情**可见」并不冲突 —— 列表脱敏是**出参形态**，不是权限。
-- 注意：
--   - `0001_init`（基线）与 `0002_company_capital_legal_person` 均已登记 → 本文件是**增量**，
--     **禁止改动 / 并入前两份**（改了会与 `_prisma_migrations` 的校验和不一致）。
--   - 本文件为**纯 `ALTER TABLE` 加列**，**不回填数据、无破坏性**：
--     `username` 全部为 NULL、`phone_locked_at` / `phone_locked_by` 全部为 NULL（＝未锁）。
--   - 重建库顺序：`0001_init` → `0002_company_capital_legal_person` → `0003_username_and_phone_lock`
--     （再各自 `npx prisma migrate resolve --applied <目录名>`）。
--   - ⚠ 本文件**不含** `migrate diff` 输出的 `DROP INDEX uk_*` / `DROP PRIMARY KEY` 6 条 ——
--     那是「设计使然」的 drift（生成列唯一索引 + 分区表主键含分区列），**执行即破坏**
--     （→ `服务端/prisma/README.md` 的「drift 清单」）。
-- ============================================================================

-- ① employee：登录账号名（可空唯一）
ALTER TABLE `employee`
    ADD COLUMN `username` VARCHAR(64) NULL COMMENT '登录账号名（员工自定、可空、唯一；登录＝手机号或账号名二选一＋密码）' AFTER `phone`,
    ADD UNIQUE KEY `uk_username` (`username`);

-- ② contact：联系方式「锁」
ALTER TABLE `contact`
    ADD COLUMN `phone_locked_at` DATETIME(0) NULL COMMENT '联系方式上锁时间（NULL=未锁；全局锁：任一部门被 owner 上锁后全部部门都看不到）' AFTER `phone_frozen_until`,
    ADD COLUMN `phone_locked_by` BIGINT UNSIGNED NULL COMMENT '落锁人（＝解锁申请审批人；其离职/转岗或不再持有任一活跃关系时锁自动消失）' AFTER `phone_locked_at`;
