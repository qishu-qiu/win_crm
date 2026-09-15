// =============================================================================
// BigInt ↔ string 序列化（M0-25）—— 防 JSON 精度丢失
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM数据架构文档》V1.31：主键统一 `BigInt @db.UnsignedBigInt`（46 张表一致）。
//   · **为什么必须转**（这不是洁癖，是两个真会炸的坑）：
//       ① `JSON.stringify` 遇到 BigInt 直接抛 `TypeError` —— 接口会 500；
//       ② JS 的 `JSON` 只有 Number（IEEE754 双精度），`2^53` 以上的 id 一旦落进 Number
//          就**永久丢精度**：`9007199254740993` → `9007199254740992`（两个不同的客户变成同一个）。
//     故 id 进出接口一律走字符串。
//   · 《销售CRM接口API文档》V1.16 §2.4：参数非法 → **400 / 20001**（给人话，不抛 DB 原话）。
//   · 同 §2.6 入参出参 snake_case —— 本文件只动**类型**（bigint ↔ string），不动键名。
//
// 分层约束（架构 §5.4）：kernel 零业务 —— 本文件只做「类型转换」，
//   **不做业务范围校验**（「该 id 是否存在 / 是否 > 0」属 DTO/pipe 与各域 repository 的事）。
// =============================================================================
import { AppError, ErrorCode } from '../errors/app-error';

/** 只接受十进制整数串（允许前导 `-`；全角数字 / 小数点 / 科学计数一律不收） */
const INTEGER_PATTERN = /^-?\d+$/;

/** BigInt → 字符串（**出参方向**：接口里的 id 一律以字符串下发） */
export function bigintToJson(value: bigint): string {
  return value.toString();
}

/**
 * 字符串 → BigInt（**入参方向**：前端传来的 id）。
 * 非法（空 / 小数点 / 科学计数 / 夹字母）→ **400 / 20001**。
 */
export function jsonToBigint(value: string, field = 'id'): bigint {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!INTEGER_PATTERN.test(text)) {
    throw new AppError(ErrorCode.PARAM_INVALID, 400, `${field} 必须是整数`);
  }
  return BigInt(text);
}

/**
 * 普通对象判定 —— **必须查原型**，不能只看 `typeof === 'object'`：
 * `Date` / `Map` / `Prisma.Decimal`（金额 `Decimal(12,2)` 就是它）都是 object，
 * 一旦当普通对象展开，`Object.entries(date)` 会得到 `[]` → **Date 被吃成 `{}`**（真踩过）。
 * 只展开字面量 / `Object.create(null)` 造的对象，其余原样交给 `JSON.stringify`（它认得 Date / toJSON）。
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * 深度把 BigInt 换成字符串，让整棵树能被 `JSON.stringify` 安全序列化。
 * · `bigint` → `string`；数组 / 普通对象**递归**；其余（Date / null / number / boolean）原样返回。
 * · 放 kernel 的目的＝**一处收口**：M0-33 统一响应包对出参过一遍它，
 *   各接口不必逐个手转 id（逐个手转 = 必漏，漏一个就丢精度）。
 */
export function toJsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map((item) => toJsonSafe(item));
  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = toJsonSafe(item);
    }
    return result;
  }
  return value;
}
