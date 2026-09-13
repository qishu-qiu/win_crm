// =============================================================================
// Prisma 唯一冲突映射器（M0-23）—— P2002 → 409 + 人话
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM架构设计说明》V1.1 §7.5 异常映射（**本文件的对照表原始出处**）：
//       `P2002` + `uk_active_rel` → **409**（激活竞态）；`uk_phone_active` → **409**；`uk_owner` → **409**
//       并从 `meta.target` 读命中的约束名，返回人话，**不把「Duplicate entry」这种原话丢给销售**。
//   · 《销售CRM接口API文档》V1.12 §2.4：409 = 唯一冲突 / 竞态，code 用 `20004` 或具体 `204xx`
//       （撞单 = `20401`，→ §4.4 / §六.1）；`uk_contract_no` → 409（→ §4.8）；`uk_line_scope_field` → 409（→ §5.15）。
//   · 约束名与唯一键来源：`服务端/prisma/schema.prisma` 的 `map: "uk_*"`。
//
// ★ 刻意**不 import 生成物客户端**（`@/generated/prisma`）：① 它是 `prisma generate` 产物、不入 git；
//   ② 单测要能用「假 P2002」直接构造（M0-23 判据），走鸭子类型即可。
//
// ⚠ 未定项（待真库实测，见批次报告）：MySQL 下 Prisma 的 `meta.target` 究竟回**约束名**还是**列名**——
//   本文件两种形状都认（约束名优先，列名走别名表兜底），待 M0-10 Prisma 接入后实测收敛。
// =============================================================================
import { AppError, ErrorCode } from './app-error';

/** Prisma 唯一约束冲突错误码（**不是** MySQL 的 1062，→ 架构 §7.5 / 废止口径 #17） */
export const PRISMA_UNIQUE_CONFLICT = 'P2002';

/**
 * Prisma 已知请求错误的**结构形状**（鸭子类型）：本模块只需要 `code` 与 `meta.target`。
 */
export interface PrismaKnownErrorLike {
  code?: unknown;
  meta?: { target?: unknown } | null;
}

interface ConstraintRule {
  httpStatus: number;
  code: number;
  message: string;
}

/** 约束名 → 映射规则。**只登记规格里具名的约束**，未登记的一律走兜底（不猜业务含义） */
const CONSTRAINT_RULES: ReadonlyMap<string, ConstraintRule> = new Map<string, ConstraintRule>([
  [
    'uk_active_rel',
    {
      httpStatus: 409,
      code: ErrorCode.RELATION_DUPLICATED,
      // 架构 §7.5 示例是「已有归属：张三」——含归属人姓名需查库，映射器只给通用人话，
      // 要带姓名由 service 层补全（本层不查库）。
      message: '该公司在该部门·产品线下已有归属，请走转交或协同',
    },
  ],
  ['uk_phone_active', { httpStatus: 409, code: ErrorCode.UNIQUE_CONFLICT, message: '该手机号已存在' }],
  ['uk_owner', { httpStatus: 409, code: ErrorCode.UNIQUE_CONFLICT, message: '该业务关系已有归属销售' }],
  ['uk_contract_no', { httpStatus: 409, code: ErrorCode.UNIQUE_CONFLICT, message: '该合同编号已存在' }],
  ['uk_line_scope_field', { httpStatus: 409, code: ErrorCode.UNIQUE_CONFLICT, message: '该业务线·范围的字段项已存在' }],
]);

/**
 * 列名 → 约束名 别名表（兜底用）。
 * 用途：MySQL 下 Prisma 的 `meta.target` 可能是**列名数组**而非索引名，靠它仍能命中同一条人话规则。
 * ⚠ 只登记**单列、无歧义**的唯一索引（列名取自 `prisma/schema.prisma`）；
 *   复合唯一键（如 `uk_line_scope_field`）不参与别名匹配，避免「撞列名」误判。
 */
const CONSTRAINT_BY_COLUMN: ReadonlyMap<string, string> = new Map<string, string>([
  ['active_key', 'uk_active_rel'],
  ['phone_active', 'uk_phone_active'],
  ['owner_flag', 'uk_owner'],
  ['contract_no', 'uk_contract_no'],
]);

/** 从 `error.meta.target` 取出候选名（数组或单值都收），统一小写去空格 */
function collectTargetTokens(error: unknown): string[] {
  if (typeof error !== 'object' || error === null) return [];
  const meta: unknown = (error as { meta?: unknown }).meta;
  if (typeof meta !== 'object' || meta === null) return [];
  const target: unknown = (meta as { target?: unknown }).target;
  const raw: unknown[] = Array.isArray(target) ? target : [target];
  return raw.filter((v): v is string => typeof v === 'string' && v.trim() !== '').map((v) => v.trim().toLowerCase());
}

/** 候选名 → 命中规则（先按约束名，再按列名别名） */
function resolveRule(tokens: readonly string[]): { name: string; rule: ConstraintRule } | undefined {
  for (const token of tokens) {
    const rule = CONSTRAINT_RULES.get(token);
    if (rule !== undefined) return { name: token, rule };
    const constraint = CONSTRAINT_BY_COLUMN.get(token);
    if (constraint !== undefined) {
      const aliased = CONSTRAINT_RULES.get(constraint);
      if (aliased !== undefined) return { name: constraint, rule: aliased };
    }
  }
  return undefined;
}

/**
 * Prisma 已知错误 → `AppError`；**不是 P2002 时返回 `null`**（交全局过滤器兜底，绝不吞异常）。
 */
export function mapPrismaError(error: unknown): AppError | null {
  if (typeof error !== 'object' || error === null) return null;
  const code: unknown = (error as { code?: unknown }).code;
  if (code !== PRISMA_UNIQUE_CONFLICT) return null;

  const tokens = collectTargetTokens(error);
  const hit = resolveRule(tokens);
  if (hit !== undefined) {
    // ⚠ 构造签名顺序是 (code, httpStatus, message) —— 两个都是数字，别传反（单测已锁）
    return new AppError(hit.rule.code, hit.rule.httpStatus, hit.rule.message, {
      constraint: hit.name,
      cause: error,
    });
  }

  // 未登记的约束：没有对应的业务人话，此时**必须回带约束名**才可定位（也避免把 DB 原话透出去）
  const label = tokens.length > 0 ? tokens.join(',') : '未知约束';
  return new AppError(ErrorCode.UNIQUE_CONFLICT, 409, `数据唯一性冲突（${label}）`, {
    constraint: label,
    cause: error,
  });
}
