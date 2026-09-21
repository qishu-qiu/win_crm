// =============================================================================
// C 域纯规则（M3-04）—— 「活跃唯一键」：公司 × 部门 × 产品线
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM数据架构文档》C1：唯一索引 `uk_active_rel` 由**生成列** `active_key` 实现 ——
//       **★ 2026-09-21 起（migration `0012`，口径变更 · D-53）**：
//       `IF(deleted_at IS NULL AND merged_into IS NULL,
//           CONCAT_WS('-', company_id, dept_id, product_line_id), NULL)`
//       —— **公海也占位**（同三元组至多一条关系；"重新开始一轮"走**领取同一条**，→ 需求 §6.3）。
//       ⚠ 旧表达式（`sea_status = 'private' AND merged_into IS NULL`）见 `migrations/0001_init`
//       文末 ③ 生成列段 —— **已被 `0012` 取代**，勿照旧口径理解。
//   · 同 C1「**★ `dept_id` 恒定不可变**」：掉公海只改「有没有 owner」，**不改部门** ⇒
//     别的部门想要同一家客户＝**自己激活一条本部门的关系**（唯一键含 `dept_id`，互不冲突，
//     → 废止口径 #9「跨部门捡公海」不存在；→ 需求 §6.3）。
//   · 《销售CRM接口API文档》§4.4：撞 `uk_active_rel` → **409 / 20401**。
//
// ★ 为什么应用层要再算一遍：service 的**预检**（先查一次库）才能给出「已有归属」这句人话，
//   且**不能只靠 DB 唯一键兜底**（→ 本域 service「预检 ＋ catch 再映射」两条都要，同 M2）。
//   ⚠ 本文件与 DB 生成列是**同一口径的两处落点**：格式一旦不一致，预检就会「查不到」，
//     整个链路静默退化成「靠 409 异常兜底」——销售看到的是报错而不是提示。
//     故格式在此**逐字写死**，并由单测钉住（→ `relation-active-key.spec.ts`）。
//
// 分层约束（架构 §5.4）：`domain/**` 须与框架 / ORM 解耦 —— 本文件不 import `@nestjs/*` /
//   `@prisma/client`，也不查库，用假数据即可单测。
// =============================================================================

/** 私海（＝**有 owner**）的 `sea_status` 值（→ C1：`sea_status` 语义＝「这条关系当前有没有主人」） */
export const PRIVATE_SEA_STATUS = 'private';

/** 公海（＝**无 owner**）的 `sea_status` 值（→ C1） */
export const COMPANY_SEA_STATUS = 'company_sea';

/** 活跃三元组（→ C1：公司 × 部门 × 产品线） */
export interface RelationTriple {
  companyId: bigint;
  deptId: bigint;
  productLineId: bigint;
}

/**
 * 生成活跃唯一键（**与 DB 生成列逐字同格式**：`CONCAT_WS('-', 公司, 部门, 产品线)`）。
 *
 * ⚠ `CONCAT_WS` 会**跳过 NULL**，但本函数三个入参都是非空 `bigint`（C1 三层均 required）
 *   —— 这个差异不可能发生，**不必**（也不该）在此模拟 SQL 的 NULL 语义。
 */
export function buildActiveKey(triple: RelationTriple): string {
  return `${triple.companyId}-${triple.deptId}-${triple.productLineId}`;
}

/**
 * 这条关系当前**是否占活跃位**（→ C1：**未删未并**即占位 —— ★ 2026-09-21 起**公海也占位**）。
 *
 * ★ 为什么公海也占位（口径变更 ·《欠账登记表》D-53）：同一「公司 × 部门 × 产品线」在业务上
 *   **只有一个跟进目标**，而"第几轮 / 前主人是谁"都按 `relation_id` 归集（`round_no` 由 `sea_record` 派生）。
 *   若掉公海就释放位子、允许另建一行，同一客户会出现**两条关系**、轮次与历史被割裂成两半；
 *   更直接的是：公海里那条旧行一旦被领，就会撞上新行占住的位 ⇒ **必 409**。
 *   ⇒ "重新开始一轮"的唯一动作 ＝ **领取同一条关系**（→ 需求 §6.3）。
 *
 * ★ 两种「不占位」各有用途：`deleted_at`（逻辑删除 ＝ 不再作为跟进目标，→ 需求 §6.3 经理删关系）
 *   让位给**重新激活**；`merged_into IS NOT NULL`（被并分支）让位给 survivor —— 其跟单 / 承诺
 *   仍挂原关系节点，展示层当分支呈现（→ 需求 §7.3 ⑦）。
 */
export function occupiesActiveSlot(input: {
  mergedInto: bigint | null;
  deletedAt: Date | null;
}): boolean {
  return input.mergedInto === null && input.deletedAt === null;
}

/** 两组三元组是否**同一活跃键**（`bigint` 全等比较；不做大小写 / 空白归一 —— 它们都是 id） */
export function isSameTriple(left: RelationTriple, right: RelationTriple): boolean {
  return (
    left.companyId === right.companyId &&
    left.deptId === right.deptId &&
    left.productLineId === right.productLineId
  );
}
