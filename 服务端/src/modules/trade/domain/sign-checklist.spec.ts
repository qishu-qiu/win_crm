// =============================================================================
// E 域签约校验清单纯函数单测（M9-E / B3）
//
// 口径来源（★ 真相源，勿自造）：数据架构 E8、接口 §5.15。零框架依赖 → 假数据即可单测。
// =============================================================================
import { describe, expect, it } from '@jest/globals';

import {
  filledKey,
  gotoOf,
  SIGN_CHECKLIST_SCOPES,
  validateSignChecklist,
  type SignChecklistItem,
  type SignChecklistScope,
} from './sign-checklist';

function item(scope: SignChecklistScope, fieldKey: string, label: string, required = true): SignChecklistItem {
  return { scope, field_key: fieldKey, label, required };
}

describe('domain/sign-checklist 纯业务规则', () => {
  describe('SIGN_CHECKLIST_SCOPES', () => {
    it('三层 company / relation / ledger', () => {
      expect([...SIGN_CHECKLIST_SCOPES]).toEqual(['company', 'relation', 'ledger']);
    });
  });

  describe('gotoOf', () => {
    it('层级 → 锚点', () => {
      expect(gotoOf('company')).toBe('inline_company');
      expect(gotoOf('relation')).toBe('goto_relation_value');
      expect(gotoOf('ledger')).toBe('goto_ledger');
    });
  });

  describe('validateSignChecklist', () => {
    const items: SignChecklistItem[] = [
      item('company', 'credit_code', '统一社会信用代码'),
      item('company', 'address', '注册地址'),
      item('relation', 'value_tier', '开发价值'),
      item('relation', 'contact', '签约联系人'),
    ];

    it('全部已填 → 空缺失', () => {
      const filled = new Set(items.map((i) => filledKey(i.scope, i.field_key)));
      expect(validateSignChecklist(items, filled)).toHaveLength(0);
    });

    it('缺一项 company → 记该缺项（goto=inline_company）', () => {
      const filled = new Set<string>([
        filledKey('company', 'address'),
        filledKey('relation', 'value_tier'),
        filledKey('relation', 'contact'),
      ]);
      const missing = validateSignChecklist(items, filled);
      expect(missing).toHaveLength(1);
      expect(missing[0]).toEqual({
        scope: 'company',
        field_key: 'credit_code',
        label: '统一社会信用代码',
        goto: 'inline_company',
      });
    });

    it('缺 relation 级 → goto=goto_relation_value', () => {
      const filled = new Set<string>([
        filledKey('company', 'credit_code'),
        filledKey('company', 'address'),
        filledKey('relation', 'value_tier'),
      ]);
      const missing = validateSignChecklist(items, filled);
      expect(missing).toHaveLength(1);
      expect(missing[0].scope).toBe('relation');
      expect(missing[0].goto).toBe('goto_relation_value');
    });

    it('非必填项缺失 → 不计入（required=false 跳过）', () => {
      const withOptional: SignChecklistItem[] = [...items, item('ledger', 'extra_a', '扩展A', false)];
      const filled = new Set<string>([filledKey('company', 'credit_code'), filledKey('company', 'address'), filledKey('relation', 'value_tier'), filledKey('relation', 'contact')]);
      const missing = validateSignChecklist(withOptional, filled);
      expect(missing).toHaveLength(0);
    });

    it('空 items → 空缺失（未配置清单不卡创建）', () => {
      expect(validateSignChecklist([], new Set(['company:credit_code']))).toHaveLength(0);
    });
  });
});
