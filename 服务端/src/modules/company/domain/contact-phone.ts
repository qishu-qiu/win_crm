// =============================================================================
// B 域纯规则（M2-07）—— 联系人手机号规范化
//
// 口径来源（★ 真相源，勿自造）：
//   · 《开发计划-V1》M2-07 判据：「手机号规范化（去空格 / `+86` / `-`）纯函数；
//     单测：**≥5 种写法归一到同一号码**」。
//   · 《销售CRM数据架构文档》V1.30 §四 B3：`contact.phone` ＝ 当前主号，**撞单校验核心**；
//     唯一约束走**生成列 `phone_active`**（未删行才占号、软删 / 换号自动释放，§10.2-2）；
//     `extra_phones` 附加号**不参与撞单**、无唯一约束。
//   · 《销售CRM业务需求文档》§12.1：录入联系人时**按手机号查重**（撞库第 ① 个触发点）。
//
// ★ 为什么必须先规范化再入库 / 再比对：
//   撞单靠「同一个号只占一个位」；而销售手抄的号**写法五花八门**（`138 0000 0000` /
//   `+86-138-0000-0000` / `１３８００００００００` 全角）。若按原样入库，同一个号会被写成几行，
//   `uk_phone_active` 也拦不住 —— 那就不是「查重没查出来」，而是**查重永远查不出来**。
//
// ★ 边界（别越界）：本函数**只做归一、不做合法性拦截** ——
//   `contact.phone` 在规格里**没有**被限定为「11 位国内手机号」（座机 / 境外号都可能出现），
//   所以这里**绝不因为「不是 11 位」就丢掉或改写号码**。是否需要格式提示由调用方决定
//   （`isMainlandMobile` 只作提示用，不用于拦截）。
//
// 分层约束（架构 §5.4）：`domain/**` 不 import 框架 / ORM、不查库，用假数据即可单测。
// =============================================================================

/** 国内手机号（11 位、1 开头、第 2 位 3~9）—— 与 A 域 `login-account.ts` 同一判据，**仅用于提示** */
const MAINLAND_MOBILE = /^1[3-9]\d{9}$/;

/** 所有空白（含全角空格 U+3000、不换行空格 U+00A0） */
const WHITESPACE = /[\s\u3000\u00a0]+/g;

/** 分隔符：半角 / 全角连字符、圆括号（销售常写成 (0551)12345678 或 138-0000-0000） */
const SEPARATORS = /[-‐‑‒–—()（）]/g;

/** 全角数字 → 半角数字 */
function toHalfWidthDigits(value: string): string {
  return value.replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
}

/**
 * 归一联系人主号（→ M2-07）。
 *
 * 处理顺序（顺序有讲究）：全角→半角 → 去空白 → 去分隔符 → 去国家码前缀。
 * ★ 为什么「去 `+86`」要放在最后，且**只在剩下 11 位时**才去：
 *   若先把 `+8613800000000` 的前 3 位砍掉，遇到「本来就不带国家码、但恰好以 86 开头」的
 *   座机（如 `86123456`）就会**把真号改坏**。故先看整体长度：去完分隔符后若为 **13 位且以 86 开头**
 *   才剥掉国家码（13 = 2 位国家码 ＋ 11 位手机号）。
 */
export function normalizeContactPhone(raw: string): string {
  const compact = toHalfWidthDigits(String(raw))
    .replace(WHITESPACE, '')
    .replace(SEPARATORS, '')
    .replace(/^\+/, '');

  // 13 位且以 86 开头 → 视为带国家码的国内手机号（含 `+86` / `0086` 已在下面单独处理）
  if (compact.length === 13 && compact.startsWith('86')) return compact.slice(2);
  if (compact.length === 15 && compact.startsWith('0086')) return compact.slice(4);

  return compact;
}

/**
 * 是否像「11 位国内手机号」（→ **仅供提示**，不用于拦截；口径同 A 域登录判别）。
 * ⚠ 返回 `false` **不代表号码非法** —— 座机 / 分机 / 境外号在规格里都允许。
 */
export function isMainlandMobile(phone: string): boolean {
  return MAINLAND_MOBILE.test(normalizeContactPhone(phone));
}

/** 是否「归一后为空」（录入时提醒用：只有空白 / 分隔符的输入等于没填） */
export function isEmptyPhone(phone: string): boolean {
  return normalizeContactPhone(phone) === '';
}
