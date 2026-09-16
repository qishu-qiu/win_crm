// =============================================================================
// C 域列表筛选（视图 / 紧迫档）—— **M6-07 补 · P-01 拍板（2026-09-16）**
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM前端页面与交互文档》§5 业务关系列表页：「seg 视图（我的全部 / 跟进中 /
//     已合作 / 已流失 / 逾期未跟进 ＋ 紧迫档 5 档）」—— **规格只给了这 5 个词，没给判定**。
//   · 故各档判定取 **需求 §8.1**（工作流 7 档，其中 6 / 7 为终态）：
//       `all`        ＝ 我的全部（**不过滤**）
//       `following`  ＝ 跟进中 ＝ **阶段 1~5**（＝还没到终态）
//       `cooperated` ＝ 已合作 ＝ **阶段 6**
//       `churned`    ＝ 已流失 ＝ **阶段 7**
//       `overdue`    ＝ 逾期未跟进 —— ⚠ **本批不落，见下方 ★**。
//   · 紧迫档 5 档 → 需求 §8.2 表格（周重点 / 月重点 / 季度跟 / 长期跟 / 灰度），口径明确。
//
// ★ `overdue`（逾期未跟进）**为什么现在不做**：它要判「逾期」，而逾期的唯一来源是
//   **承诺到期未处理 / 预约过期**（→ 需求 §10.1 / §10.4），属 **D 域**，`overdue` 字段
//   尚未落地（→《欠账登记表》D-10）。**宁可少一档，也不编一个假的「逾期」定义** ——
//   编了就等于替上游拍板（→ 铁律 §一 A），而且它会在 `total` 上装成"真的"。
//
// 分层约束（架构 §5.4）：`domain/**` **不 import 框架 / Prisma、不查库** ——
//   本文件的产物是**纯数据结构**（「按哪些阶段 / 哪些紧迫档过滤」），
//   由 `relation.repository.ts` 翻译成 Prisma `where`（那是唯一碰 Prisma 的层）。
// =============================================================================

/** 视图取值白名单（→ 接口 §5.6；**不含 `overdue`**，理由见文件头 ★） */
export const RELATION_VIEWS = ['all', 'following', 'cooperated', 'churned'] as const;
export type RelationView = (typeof RELATION_VIEWS)[number];

/** 视图默认值（=「我的全部」＝不过滤） */
export const RELATION_VIEW_DEFAULT: RelationView = 'all';

/** 「已合作」阶段（→ 需求 §8.1 终态） */
const COOPERATED_STAGE = 6;
/** 「已流失」阶段（→ 需求 §8.1 终态） */
const CHURNED_STAGE = 7;
/** 「跟进中」＝未到终态的阶段（→ 需求 §8.1：1 初步建联 … 5 逼单） */
const FOLLOWING_STAGES: readonly number[] = [1, 2, 3, 4, 5];

/**
 * 列表筛选条件（**纯数据**，不含任何 Prisma 形状）。
 * 两个字段都是「没给＝不过滤」：空数组与 `undefined` 同义（呼叫方不必区分）。
 */
export interface RelationListFilter {
  /** 只看这些阶段（视图翻译而来） */
  stages?: readonly number[];
  /** 只看这些紧迫档（多选） */
  urgencies?: readonly string[];
}

/** 不可识别的视图 → 当 `all`（DTO 已用白名单拦住非法值，此处只是**最后防线**） */
export function resolveViewStages(view: string | undefined): readonly number[] | undefined {
  switch (view) {
    case 'following':
      return FOLLOWING_STAGES;
    case 'cooperated':
      return [COOPERATED_STAGE];
    case 'churned':
      return [CHURNED_STAGE];
    // `all` / 缺省 / 未识别 → 不过滤
    default:
      return undefined;
  }
}

/**
 * 组装筛选条件。
 *
 * ★ 两个**都要判空**：`?view=all&urgency=`（前端把 chip 全取消时会送空串）等同于没筛 ——
 *   若把空数组原样传下去，SQL 会变成 `stage_id IN ()` / `urgency IN ()`，**一条都不返回**，
 *   页面看着像"数据没了"（真库会报语法错或恒假，两种都难查）。
 */
export function buildRelationListFilter(
  view: string | undefined,
  urgencies: readonly string[] | undefined,
): RelationListFilter {
  const stages = resolveViewStages(view);
  const picked = (urgencies ?? []).filter((code) => code !== '');
  return {
    ...(stages === undefined ? {} : { stages }),
    ...(picked.length === 0 ? {} : { urgencies: picked }),
  };
}
