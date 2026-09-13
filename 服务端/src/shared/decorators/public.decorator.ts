// =============================================================================
// `@Public()` —— 免鉴权路由标记（M0-32 配套）
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM接口API文档》V1.12 §2.2：「所有请求头 Authorization: Bearer <access_token>」
//     —— 即**默认全站要鉴权**；而登录 `POST /account/login`、刷新 `POST /account/refresh`
//     本身不可能带 token（→ §四 认证分组）。这两处必须能豁免，否则无人能登录。
//
// ⚠ 诚实标注：M0-32 的判据只要求「无 token → 401」，**没有要求**本装饰器。
//   但守卫自 M0-38 起是**全局**生效的（`APP_GUARD`）—— 若不在此刻留出豁免口，
//   M1（A 域登录）第一件事就是回头改守卫（返工）。留口子的成本是下面这 10 行。
//
// 用法（M1 起）：`@Public() @Post('login')`。**白名单式**：只有显式标注的才免鉴权，
//   新增接口忘标 = 需要 token（安全的默认方向），而不是「忘标 = 裸奔」。
// =============================================================================
import { type CustomDecorator, SetMetadata } from '@nestjs/common';

/** 元数据键名（守卫用 `Reflector` 读同一个常量，两边不许各写一份字符串） */
export const IS_PUBLIC_KEY = 'auth:is_public';

/** 标记「本路由免鉴权」—— 方法级或类级皆可 */
export function Public(): CustomDecorator {
  return SetMetadata(IS_PUBLIC_KEY, true);
}
