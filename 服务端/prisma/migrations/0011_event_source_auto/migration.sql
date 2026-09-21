-- =============================================================================
-- 0011_event_source_auto（2026-09-21）
--
-- 口径来源（★ 真相源）：
--   · 《销售CRM数据架构文档》**D2** `action_event.source` 值域 ＝ `manual / auto / import`
--     （本列一直没有 DB 层约束，值域是给"写事件的人"看的）。
--   ⇒ 《欠账登记表》**D-65**：实现里**建档 / 领取**两条**系统事件**写的是 `source = 'system'` ——
--     **那个值不在 D2 的值域内**。2026-09-21 拍板：
--       · **改码**（本笔）而不是"把 `system` 补进 D2 值域" —— 值域里 `auto` 与 `system` 在这里同义，
--         让两个同义码并存＝"同一事实两个落点"（本项目一号坑）；
--       · 代码侧同批改：`engine.service.ts` 两处改用 `AUTO_EVENT_SOURCE`（＝`'auto'`，
--         → `engine/domain/event-effective.ts`）。
--   ⚠ `action_type = 'system'` **不动** —— 那一码**在** D2 值域内（phone / … / note / system），
--     且 D 域的「近 30 天跟单条数」正是按 `action_type <> 'system'` 排除系统事件（→ 接口 §5.4）。
--
-- 性质：**纯数据订正**（无 DDL、无索引、无约束、表数不变）—— 幂等（`WHERE source = 'system'`，
--   重跑影响 0 行）；对**新库**影响 0 行（新库本就没有 `system` 行）。
-- =============================================================================

UPDATE `action_event`
SET `source` = 'auto'
WHERE `source` = 'system';
