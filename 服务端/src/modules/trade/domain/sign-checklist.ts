// =============================================================================
// E 域（签约校验清单）纯业务规则（M9-E / B3）
//
// 分层约束（架构 §5.4）：本文件**零框架依赖**——不 import `@nestjs/*`、不 import Prisma、
// 不查库。假数据即可单测（→ CODEBUDDY.md §5）。
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM数据架构文档》E8（`sign_checklist`：`scope` ∈ company/relation/ledger；
//     `product_line_id`/`scope`/`field_key` 保存后不可变；`required`/`sort`/`status` 可改）。
//   · 《销售CRM接口API文档》§5.15（配置端点）＋ §5.9（创建前硬卡：缺失 → 422 / `20403` ＋ 缺项清单）。
// =============================================================================

/** 校验层级（→ E8 / §5.15） */
export const SIGN_CHECKLIST_SCOPES = ['company', 'relation', 'ledger'] as const;
export type SignChecklistScope = (typeof SIGN_CHECKLIST_SCOPES)[number];

/** 配置项（→ §5.15 `SignChecklistItem`） */
export interface SignChecklistItem {
  scope: SignChecklistScope;
  field_key: string;
  label: string;
  required: boolean;
}

/** 缺项锚点（→ §5.15 `ContractSignMissing.goto`） */
export type SignChecklistGoto = 'inline_company' | 'goto_relation_value' | 'goto_ledger';

/** 层级 → 缺项锚点（company 级内联补；relation/ledger 级跳对应页） */
export function gotoOf(scope: SignChecklistScope): SignChecklistGoto {
  switch (scope) {
    case 'company':
      return 'inline_company';
    case 'relation':
      return 'goto_relation_value';
    case 'ledger':
      return 'goto_ledger';
  }
}

/** 构建「已填字段」集合的键（与 `validateSignChecklist` 的 `filledKeys` 同构） */
export function filledKey(scope: SignChecklistScope, fieldKey: string): string {
  return `${scope}:${fieldKey}`;
}

/** 缺项（→ §5.15 422 响应体 `missing[]`） */
export interface MissingCheckItem {
  scope: SignChecklistScope;
  field_key: string;
  label: string;
  goto: SignChecklistGoto;
}

/**
 * 签约校验：对每组 active＋required 项，逐一比对是否已在 `filledKeys`（＝该层级字段非空）。
 * 任一未填 → 记入缺失清单（带 `goto` 锚点，供前端内联补 / 跳补）。
 *
 * ★ `items` 入参＝该 `product_line_id` 下 `status=active AND required=true` 的项（service 已从库取出）；
 *   `filledKeys`＝ service 按层级查到的「非空字段」集合（`${scope}:${field_key}`）。
 * ★ 纯函数、无副作用、无 DB——分层归属在 service（查 company/relation/ledger），本函数只做判定。
 */
export function validateSignChecklist(
  items: readonly SignChecklistItem[],
  filledKeys: ReadonlySet<string>,
): MissingCheckItem[] {
  const missing: MissingCheckItem[] = [];
  for (const item of items) {
    if (!item.required) continue;
    if (!filledKeys.has(filledKey(item.scope, item.field_key))) {
      missing.push({
        scope: item.scope,
        field_key: item.field_key,
        label: item.label,
        goto: gotoOf(item.scope),
      });
    }
  }
  return missing;
}
