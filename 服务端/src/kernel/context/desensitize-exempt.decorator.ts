// =============================================================================
// `@DesensitizeExempt()` —— 出口**豁免脱敏**标记（M5-06）
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM业务需求文档》V1.27 §4.3 四 ★：「**报表 / 看板 / 汇总金额不脱敏**」——
//     脱敏**只作用于「销售看他人私海 / 跨部门关系」的列表与详情**；**经理 / 老板出口的报表、
//     看板、汇总一律显示真实金额**（2026-09-11 定）。同 §7.3「规则写在一处」。
//   · 《销售CRM数据架构文档》V1.32 §十一 ③ ＋《接口API文档》V1.18 §2.8 末条：同口径。
//   · 《销售CRM架构设计说明》V1.3 §7.3 脱敏渲染（出口统一处理）。
//   · 同 §5.4：业务域**只许 import `kernel/**`**，不得直连 `shared/**`（横切能力全局生效）
//     ⇒ 要写在**域 controller** 上的标记必须住 `kernel/`（与 `@Public()` 同一理由，
//       见 `public.decorator.ts` 文件头 ★ 段）。
//
// ★ 用法（报表出口，`report/` 建好后）：
//     @DesensitizeExempt()
//     @Get('reports/sales')
//     salesReport() { … }
//   —— 标记的含义是「**本出口不适用脱敏口径**」，**不是**「跳过某项检查」。
//
// ★ 标记的**读法只有一个落点**（本文件）：横切层用 `isDesensitizeExempt(handler)` 读元数据，
//   出口侧（将来的报表 controller / 测试 / 审计）用 `readDesensitizeExempt(request)` 读请求上的标记。
//   ⚠ **不许在别处再写一遍 `'desensitize:exempt'`**（双真相源＝改一处漏一处，→ 踩坑 #9）。
//
// 分层约束（架构 §5.4）：本文件只依赖 `@nestjs/common` 的 `SetMetadata` ＋ 平台自带的 `Reflect`，
//   **不查库、不 import `modules/*`**。
// =============================================================================
import { type CustomDecorator, SetMetadata } from '@nestjs/common';

/** 元数据键名（横切层读元数据、出口读请求，两处都从这里取，**不许各写一份字符串**） */
export const DESENSITIZE_EXEMPT_KEY = 'desensitize:exempt';

/** 请求对象上的挂载键（横切层打标、出口侧读取） */
export const DESENSITIZE_EXEMPT_REQUEST_KEY = 'desensitizeExempt';

/** 标记「本出口**不脱敏**」（报表 / 看板 / 汇总）—— 方法级或类级皆可 */
export function DesensitizeExempt(): CustomDecorator {
  return SetMetadata(DESENSITIZE_EXEMPT_KEY, true);
}

/**
 * 读 handler（方法）上的豁免标记。
 *
 * ★ 为什么是「读方法」而不是「读类」：豁免是**逐个出口**的性质 —— 同一个 controller 上
 *   「列表要脱敏、汇总不脱敏」是常态（→ §4.3 四），类级标记会把两者混成一种。
 * ★ 只要显式标了 `true` 才算豁免：**没标 = 不豁免**（与 `@Public()` 同一条「白名单式」思路 ——
 *   忘标的安全方向是「按脱敏处理」，而不是「默认真金额」）。
 */
export function isDesensitizeExempt(handler: unknown): boolean {
  if (handler === null || (typeof handler !== 'function' && typeof handler !== 'object')) {
    return false;
  }
  return Reflect.getMetadata(DESENSITIZE_EXEMPT_KEY, handler) === true;
}

/**
 * 读**请求上**的豁免标记（横切层打标后，出口侧 / 调试 / 测试从这里取）。
 * 取不到（未打标 / 非对象）＝ 不豁免，**不猜**。
 */
export function readDesensitizeExempt(request: unknown): boolean {
  if (typeof request !== 'object' || request === null) {
    return false;
  }
  return (request as Record<string, unknown>)[DESENSITIZE_EXEMPT_REQUEST_KEY] === true;
}
