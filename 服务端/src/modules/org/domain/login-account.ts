// =============================================================================
// A 域纯规则 —— 登录标识判别（手机号 / 登录账号名 双通道）
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM接口API文档》V1.18 §5.2：`POST /account/login` req `{account,password}` ——
//     **`account` ＝ 手机号 或 登录账号名（`employee.username`），二选一**，
//     **服务端判别**（**11 位手机号格式按手机号查，否则按账号名查**），两通道共用同一 `password_hash`。
//     ⚠ 2026-09-14 变更：入参由 `{phone,password}` 扩为 `{account,password}`。
//   · 《废止口径登记表》#32（旧口径：登录＝手机号 ＋ 密码，唯一登录键）——
//     照旧口径实现 = 用账号名登录**直接 400**、通道整条不可用。
//   · 账号名规则（同 §5.2）：`employee.username`、**可空**、**全局唯一**、**大小写不敏感**、
//     建议 4~32 位字母 / 数字 / 下划线。
//   · 《销售CRM数据架构文档》V1.32 域 A（A2 `employee`）：`phone` 与 `username` 各带唯一索引
//     （`uk_phone` / `uk_username`）；`0003_username_and_phone_lock` 注释明确
//     「**不区分大小写**（跟随库 / 表 `utf8mb4_unicode_ci`，**登录时无需额外处理**）」。
//
// 分层约束（架构 §5.4）：`domain/**` 须与框架 / ORM 解耦 ——
//   本文件**不 import `@nestjs/*` / `@prisma/client`**，也不查库，用假数据即可单测。
// =============================================================================

/** 国内手机号（11 位、1 开头、第 2 位 3~9）—— 「是不是手机号」的**唯一**判据 */
export const PHONE_PATTERN = /^1[3-9]\d{9}$/;

/**
 * 登录标识的两条通道。
 * `phone` → 查 `employee.phone`；`username` → 查 `employee.username`。
 */
export type LoginAccountChannel = 'phone' | 'username';

/** 账号名长度建议区间（→ 接口 §5.2「建议 4~32 位字母 / 数字 / 下划线」；**建议**，故只作提示不作拦截） */
export const USERNAME_SUGGESTED_LENGTH = { min: 4, max: 32 } as const;

/**
 * 判别「这一个输入框里填的是手机号还是账号名」（→ §5.2 服务端判别）。
 *
 * ★ 为什么**只用手机号格式**当判据（而不是「先查手机号、查不到再当账号名」）：
 *   后者会让「11 位纯数字的账号名」永远查不到自己（被手机号通道吃掉），且多一次无效查库；
 *   按格式判别是**确定性**的：同输入必得同一通道。
 * ★ 大小写：本函数**不做任何大小写转换**（→ A2 / migration 0003：比较由库的
 *   `utf8mb4_unicode_ci` 完成，登录时无需额外处理）；若将来库排序规则改成区分大小写，
 *   应在**仓储查询层**统一处理，而不是在这里悄悄改输入值（改了输入值就查不到了）。
 */
export function classifyLoginAccount(account: string): LoginAccountChannel {
  return PHONE_PATTERN.test(account) ? 'phone' : 'username';
}
