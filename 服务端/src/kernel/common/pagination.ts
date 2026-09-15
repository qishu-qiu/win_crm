// =============================================================================
// 分页（M0-24）—— `page/pageSize` → `skip/take` ＋ 统一分页 VO
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM接口API文档》V1.16 §2.7：查询统一 `page`（默认 1）/ `page_size`（默认 20、**最大 100**）。
//   · 同 §2.3 / §五 PageResult：分页固定字段 `list / total / page / page_size`（G2）。
//   · 同 §2.6：**入参出参 snake_case** —— 故 VO 的键名是 `page_size`，不是 `pageSize`。
//
// 分层约束（架构 §5.4）：kernel 零业务、谁都能用 —— 本文件**不许 import `modules/*`**。
// =============================================================================

/** 页码默认值（→ §2.7） */
export const PAGE_DEFAULT = 1;
/** 每页条数默认值（→ §2.7） */
export const PAGE_SIZE_DEFAULT = 20;
/** 每页条数上限（→ §2.7「最大 100」）；超出**夹紧**，不报错 */
export const PAGE_SIZE_MAX = 100;

/**
 * 列表通用入参（内部 camelCase；HTTP 上的 `page_size` → `pageSize` 由 DTO/pipe 负责，§2.6）。
 * 同时收数字与数字字符串 —— HTTP query 下来的本来都是字符串，DTO 转换前也要安全。
 */
export interface PaginationQuery {
  page?: number | string;
  pageSize?: number | string;
}

/** 解析后的分页参数：可直接喂 Prisma 的 `skip` / `take` */
export interface Pagination {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
}

/** 统一分页 VO（→ §2.3 / §五 PageResult；出参 snake_case，§2.6） */
export interface PageResult<T> {
  list: T[];
  total: number;
  page: number;
  page_size: number;
}

/** 取有限整数：数字或数字字符串 → 向下取整；其余（NaN / 空串 / undefined）→ undefined */
function toFiniteInt(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? Math.floor(n) : undefined;
}

/** `page`：缺省 / 非法 / < 1 → 默认 1（§2.7） */
function normalizePage(value: unknown): number {
  const n = toFiniteInt(value);
  return n === undefined || n < PAGE_DEFAULT ? PAGE_DEFAULT : n;
}

/** `pageSize`：缺省 / 非法 / < 1 → 默认 20；超 100 → 夹紧到 100（§2.7） */
function normalizePageSize(value: unknown): number {
  const n = toFiniteInt(value);
  if (n === undefined || n < 1) return PAGE_SIZE_DEFAULT;
  return Math.min(n, PAGE_SIZE_MAX);
}

/** `page/pageSize` → `skip/take`（含归一与夹紧） */
export function resolvePagination(query: PaginationQuery = {}): Pagination {
  const page = normalizePage(query.page);
  const pageSize = normalizePageSize(query.pageSize);
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

/** 组装统一分页 VO：键名固定 `list / total / page / page_size`（§2.3） */
export function buildPageResult<T>(
  list: T[],
  total: number,
  pagination: Pick<Pagination, 'page' | 'pageSize'>,
): PageResult<T> {
  return { list, total, page: pagination.page, page_size: pagination.pageSize };
}
