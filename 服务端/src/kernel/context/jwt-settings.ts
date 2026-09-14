// =============================================================================
// JWT 密钥口径（M1-01 从 `shared/shared.module.ts` 抽出）—— 密钥强度的**唯一事实源**
//
// ★ 为什么要抽到 kernel（而不是留在 shared、或让 org 自己再写一份）：
//   守卫（`shared/guards/jwt-auth.guard.ts`）与**登录签发**（`modules/org/**`）都要 `JwtService`，
//   但 `modules/**` 被 ESLint 硬卡**不许 import `shared/**`**（架构 §5.4 第 1/0 层 ＋ 规则 M0-44c）。
//   若两处各写一份 `requireJwtSecret`，就成了「密钥强度」的**第二真相源** ——
//   哪天只改一处，就会出现「守卫收 32 位、签发收 16 位」这种只在联调才炸的错位。
//   `kernel` 是第 0 层、人人可依赖且它不依赖任何人，故密钥口径放这里最合适。
//
// ★ 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM架构设计说明》V1.1 §8.1：`JWT_SECRET` 用**真随机**，**宁可起不来也不带默认值**。
//   · 《销售CRM接口API文档》V1.12 §2.2：`access_token` 为 Bearer JWT。
//
// 分层约束（架构 §5.4）：`kernel/**` 零业务 —— 本文件**不许 import `modules/*` / `shared/**`**，
//   也**不依赖 `@nestjs/*`**（纯配置读取，方便 domain / spec 直接引用而不拉进框架）。
// =============================================================================

/** `JWT_SECRET` 最短长度：太短的密钥可被暴力枚举（→ 架构 §8.1 硬口径「用真随机」） */
export const JWT_SECRET_MIN_LENGTH = 32;

/**
 * 取 JWT 密钥：**缺失或过短直接抛错、拒绝启动**。
 * ★ 绝不设默认值兜底 —— 带默认密钥的服务一旦被部署，任何人都能自己签一枚「总经理」令牌进来，
 *   而这类事故在日志里**看不出异常**。宁可起不来，也不带默认密钥跑。
 *
 * @param env 便于单测注入假环境；生产一律用 `process.env`。
 */
export function requireJwtSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.JWT_SECRET;
  if (typeof secret !== 'string' || secret.trim().length < JWT_SECRET_MIN_LENGTH) {
    throw new Error(
      `缺少 JWT_SECRET 或长度不足 ${JWT_SECRET_MIN_LENGTH} 位：请在 .env 里配置真随机串（→ 架构说明 §8.1）`,
    );
  }
  return secret;
}
