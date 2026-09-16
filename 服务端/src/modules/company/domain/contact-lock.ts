// =============================================================================
// 联系人「锁」的可见性判定（M5-04 的 B 域部分）—— 纯函数，**本域私有**
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM业务需求文档》§4.3 二「联系人「锁」＝ 销售的自我保护」：
//     只有该联系人**归属关系的 owner** 能上锁（协同人不能、经理也不能替谁上锁）；他人（**含同部门同事**）
//     查看该号 → 只见「已上锁」＋「申请解锁」；解锁走申请 → **落锁人本人审批** → 放行 24h；
//     **锁跟人：主号与 `extra_phones` 备用号一并锁**。
//   · 同 §4.3 二 ★「锁的消失条件」：只要**落锁人不再是该联系人任一活跃关系的 owner**，
//     锁即**自动消失**（离职 / 转岗 / 关系掉公海）。
//   · 《销售CRM数据架构文档》§十一 ① 出参形态：**「详情 · 被 owner 上锁、且查看者不是 owner」**
//     → `phone_locked: true` ＋ `phone_locked_by`，**不给 `phone`**（列表 / 卡片本就一律 `phone_masked`）。
//   · 同 B3 `contact.phone_locked_at / phone_locked_by`：`at` NULL ＝ 未锁；`by` ＝ **落锁人**。
//
// ★ 「查看者不是 owner」在本文件里等价实现为「**查看者不是落锁人**」，理由两条：
//   ① 能上锁的人**按定义就是**该联系人归属关系的 owner（协同人 / 经理都不能上锁）；
//   ② 锁**跟人**，且**落锁人一旦不再是 owner 锁即消失** ⇒ 锁存在期间，「(除落锁人外的)所有人」
//      与「非 owner」这两个集合重合 —— 同部门的另一位关系 owner 也看不到（§4.3 二「锁是全局的」）。
//   ⚠ **未覆盖的缺口（已登记，→ 交接说明「欠账」）**：「落锁人失去活跃关系 → 锁自动消失」要读
//     C 域（业务关系 / 成员）的数据，而 **B 域是第 2 层、不许反向依赖 C 域**（架构 §5.1 / §5.4 硬卡）
//     ⇒ 本批不做。在它落地前会**多锁一段时间** —— 方向是**偏严**（拿不到号），不是越权泄露。
//
// ★ 为什么住 `modules/company/domain/` 而不是 `kernel/`：它是**本域私有规则** —— 只认 B 域自己的列
//   （`phone_locked_at / by`），也只有 B 域的联系人出口会用它。架构 §5.4 原文「**业务规矩不准下沉进内核**」；
//   只有「跨业务线按部门脱敏」那种**所有域都要用**的判定才进 `kernel`（→ `kernel/common/desensitize.ts`）。
//
// 分层约束（架构 §5.4）：本文件**不 import `@nestjs/*` / `@prisma/client`、不查库**，假数据即可单测。
// =============================================================================

/** 判定所需的**事实**（＝ B 域查询时一并带出的联系人行片段，不是整行） */
export interface ContactLockFacts {
  /** `contact.phone_locked_at`：NULL ＝ 未锁（→ 数据架构 B3） */
  readonly phone_locked_at: Date | null;
  /** `contact.phone_locked_by`：落锁人（＝ 解锁申请的审批人，→ 数据架构 B3；**无外键**） */
  readonly phone_locked_by: bigint | null;
}

/**
 * 该联系人的手机号，**对这位查看者**是否处于「已上锁」态。
 *
 * @param lock     锁的事实（`phone_locked_at / by`）
 * @param viewerId 当前登录员工 id（`RequestContext.employeeId`）
 * @returns `true` ＝ 按「已上锁」渲染（**详情不给 `phone`、`extra_phones` 一并隐藏**）；
 *          `false` ＝ 照常给号（未锁，**或查看者本人就是落锁人**）
 *
 * ★ 只在**一处**判定：`phone_locked` 的取值全项目只由本函数决定（改口径只改这一处）。
 * ⚠ 本函数**只回答「该不该给号」**；「24h 解锁窗口（`unlocked_until`）」「总经理 / 管理员强制解锁」
 *   都要读**审批单**（G 域，尚未建）⇒ 不在本批，别在这里猜。
 */
export function isPhoneLockedForViewer(lock: ContactLockFacts, viewerId: bigint): boolean {
  if (lock.phone_locked_at === null) return false;
  // 落锁人本人：锁是「他的自我保护」，不是挡他自己（→ §4.3 二）
  if (lock.phone_locked_by === viewerId) return false;
  // `at` 有值但 `by` 为空 ＝ 数据异常：**从严**当作「对所有人都锁」，不因缺字段放行
  return true;
}
