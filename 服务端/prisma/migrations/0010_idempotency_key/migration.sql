-- =============================================================================
-- 0010_idempotency_key（2026-09-20）
--
-- 口径来源（★ 真相源）：
--   · 《销售CRM接口API文档》§2.5：「所有**非幂等写操作**请求头带 `Idempotency-Key: <uuid>`；
--     重复同 key → **返回首次结果（200），不重复执行**」—— 防网络重试导致的**双写 / 双领公海**。
--   · §2.4 错误码表 429 行补注：「**幂等键重复不算限流** —— 重复同 key 返回首次结果 200」。
--   ⇒ 2026-09-20 七叔拍板（→《欠账登记表》D-06）补齐 §2.5 未定的五件事，本次按拍板落地：
--     ① **不带头的写请求放行**（过渡期：带了才校验，前端逐步接）；
--     ② **作用域 ＝ 登录人 × 端点 × key**（防 A 的 key 被 B 重放）；
--     ③ **TTL 24h**（首次结果保留一天）；
--     ④ **同 key 但入参不同 → 409 / 20004**（静默返回旧结果会让人以为写成功了）；
--     ⑤ **存储走 MySQL 表**（不首接 Redis：`.env` 有 `REDIS_URL` 但 `src` 无客户端，
--        且本机 Redis 3.0 禁用 6/7 专有命令 —— 零新依赖更稳）。
--
-- 为什么是「独立一张表」而不是塞进 `operation_log`：
--   · 两者**生命周期不同** —— 幂等记录 24h 后可丢（本表 `idx_idem_created` 供清理），
--     而 `operation_log` 是等保审计（长期保留、还按 `occurred_at` 分区）；
--   · 写入时机不同 —— 幂等在**业务成功后**写、审计在**业务事务内**写。
--   混一张表会让"清理 24h 前的幂等行"变成"删审计"的高风险操作。
--
-- 为什么 `response_body` 用 JSON 列：出参形状**各端点不同**（列表 / 详情 / `{marked}`），
--   要给这张表定"通用出参列"就得上 N 个子表 —— JSON 列是这里唯一合理的选择
--   （→ `prisma/README.md` §七「JSON 列」条；本列**不做**反向 `JSON_CONTAINS` 查询）。
--
-- ⚠ `0001_init` 是**冻结基线**（已 `resolve --applied`）⇒ 一律走**新增量**。
-- 性质：**新增一张表**（第 47 张），不动既有表 / 不动数据。
--   ⚠ 表数从 46 → 47：同批须改《数据架构文档》§10.1 表清单 ＋ README §九（→ 废止口径 #19 同族）。
--
-- 字段口径：
--   · `endpoint` 存**路由模板**（`POST /relations`，不是 `/relations/5`）—— 否则每个 id 一行，
--     唯一键形同虚设（同一次提交带不同 id 会各自留一行）。
--   · `request_hash` ＝ `SHA-256(JSON.stringify(body))` 的 hex（64 字符）：
--     **只比对入参**，不比对 header / query —— 重试时网络层可能改 header，而 body 是业务意图。
--   · `created_at` 由 Prisma 显式写入（**UTC**，→ prisma/README §七「时间列一律 UTC 存」）。
-- =============================================================================

CREATE TABLE `idempotency_key` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `employee_id` BIGINT UNSIGNED NOT NULL
    COMMENT '登录人 id —— 作用域「人 × 端点 × key」的一半，防跨用户重放',
  `endpoint` VARCHAR(160) NOT NULL
    COMMENT '端点标识 `METHOD /路由模板`（如 `POST /relations`）；存模板不存实际路径',
  `idem_key` VARCHAR(64) NOT NULL
    COMMENT '请求头 Idempotency-Key 原值（uuid）',
  `request_hash` CHAR(64) NOT NULL
    COMMENT '入参指纹 SHA-256(hex)：同 key 但指纹不同 → 409 / 20004（防 key 复用）',
  `status_code` INT NOT NULL
    COMMENT '首次成功响应码（当前恒 200 —— §2.3「成功响应一律 200」；留列以便将来有 201/204 时正确重放）',
  `response_body` JSON NOT NULL
    COMMENT '首次出参（handler 原始 data；bigint 已转字符串，重放时原样返回）',
  `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP
    COMMENT '写入时刻（UTC；T-24h 内有效 —— 过期行由查询条件忽略，清理任务见《欠账登记表》） ★ 2026-09-20 migration 0010',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_idem_scope` (`employee_id`, `endpoint`, `idem_key`),
  KEY `idx_idem_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='幂等键（接口 §2.5；2026-09-20 拍板 D-06）：同 key 重放返回首次结果、不重复执行';
