-- ============================================================================
-- 0002_company_capital_legal_person（增量 migration · 2026-09-13）
--   口径来源：《需求规格/销售CRM数据架构文档》V1.28 §四 B1（company）
--   需求依据：《需求规格/销售CRM业务需求文档》V1.24 §7.3（2026-09-13 拍板）
-- ----------------------------------------------------------------------------
-- 做什么：
--   ① `company` 新增 2 列 —— `registered_capital`（注册资本）/ `legal_person`（法定代表人）。
--      二者均为**公司档案「可选扩展字段」**：**不做签约强制、不计入完善度**，
--      仅作档案信息留存与**按规模筛选**（如"注册资金 > 100 万"）。
--   ② 注释口径收口：原 4 列注释里的「成交后强制补」改为「成交后可选补全，不强制」。
-- 为什么这样存（口径，勿改）：
--   - `registered_capital` 存**元**（`DECIMAL(16,2)`），**不存「万元」**：
--     工商登记口径即「元」，不丢精度、无单位歧义，筛选就是纯数值比较（> 100 万 ＝ > 1000000）。
--     前端按「万元」录入 / 展示并做一次换算（口径见数据架构 B1、前端 公司档案页）。
--   - 位数取 16 位而非通用约定的 12 位：`DECIMAL(12,2)` 上限约 100 亿元，
--     而注册资本存在百亿级以上企业（会溢出）→ 本列为例外，已在数据架构 §二「通用约定」登记。
--   - `legal_person` 取 `VARCHAR(64)`：姓名类，含少数民族 / 外籍译名余量。
--   - **不建索引**：按注册资金区间筛选命中面大（选择性低）、V1 数据量小，等真慢了再按实际查询评估。
-- 注意：
--   - `0001_init` 已 `migrate resolve --applied` 登记为**基线**（M0-21）→ 本文件是**增量**，
--     **禁止并入 0001、禁止改动 0001**（改基线文件会与 `_prisma_migrations` 的校验和不一致）。
--   - 重建库的执行顺序：`0001_init` → `0002_company_capital_legal_person`（见 `服务端/prisma/README.md`）。
--   - **✅ 2026-09-13 已在真库 `win_crm` 执行**（`npx prisma migrate deploy`，取证见 `服务端/prisma/README.md` 的「✅ 0002 验收结果」）；属纯 `ALTER TABLE` 加列 + 改注释，不回填数据、无破坏性。
-- ============================================================================

-- ① 新增两列（位置显式指定，与 schema.prisma 声明顺序一致）
ALTER TABLE `company`
    ADD COLUMN `registered_capital` DECIMAL(16, 2) NULL COMMENT '注册资本（单位：元；可选扩展字段，不参与签约强制与完善度；录入/展示按「万元」）' AFTER `tax_no`,
    ADD COLUMN `legal_person` VARCHAR(64) NULL COMMENT '法定代表人（可选扩展字段，不参与签约强制与完善度）' AFTER `registered_capital`;

-- ② 注释口径收口（2026-09-13）：下列 4 列原注释含「成交后强制补」的表述已废止 ——
--    现口径 = **不做签约强制**，仅作档案信息（可选补全）。
--    ⚠ `address` 一列同时是签约校验清单里「注册地址」项的落点（`→数据架构 E8` / `→需求§7.3`）。
ALTER TABLE `company`
    MODIFY COLUMN `address` VARCHAR(255) NULL COMMENT '地址（V1 单地址；亦为签约校验清单「注册地址」项的落点）',
    MODIFY COLUMN `bank_name` VARCHAR(120) NULL COMMENT '开户行（成交后可选补全，不强制）',
    MODIFY COLUMN `invoice_title` VARCHAR(200) NULL COMMENT '发票抬头（成交后可选补全，不强制）',
    MODIFY COLUMN `tax_no` VARCHAR(64) NULL COMMENT '税号（成交后可选补全，不强制）';
