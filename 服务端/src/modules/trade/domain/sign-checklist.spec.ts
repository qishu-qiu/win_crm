// =============================================================================
// E 域签约校验清单纯函数单测（M9-E / B3）
//
// 口径来源（★ 真相源，勿自造）：数据架构 E8、接口 §5.15。零框架依赖 → 假数据即可单测。
// =============================================================================
import { describe, expect, it } from '@jest/globals';

import {
  buildFilledKeys,
  filledKey,
  gotoOf,
  parseScope,
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

  describe('parseScope（库列 VARCHAR → 三值层级收窄）', () => {
    it('三种合法值原样收窄', () => {
      expect(parseScope('company')).toBe('company');
      expect(parseScope('relation')).toBe('relation');
      expect(parseScope('ledger')).toBe('ledger');
    });

    it('非法值（脏数据 / 拼错）→ null，由调用方跳过该项', () => {
      expect(parseScope('Company')).toBeNull(); // 大小写不同也判非法，不"宽容匹配"
      expect(parseScope('contract')).toBeNull();
      expect(parseScope('')).toBeNull();
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

  describe('buildFilledKeys（B3-5 注入用：service 取数 → 本函数拼键）', () => {
    it('只把值为 true 的键收进集合', () => {
      const keys = buildFilledKeys({
        company: { credit_code: true, address: false, industry_l1: true, province: false },
        relation: { value_tier: true },
      });
      expect([...keys].sort()).toEqual(['company:credit_code', 'company:industry_l1', 'relation:value_tier']);
    });

    it('整层没传 ＝ 该层全部未填（不做"没查过就算过"的兜底）', () => {
      const keys = buildFilledKeys({ company: { credit_code: true } });
      expect(keys.has(filledKey('relation', 'value_tier'))).toBe(false);
      expect(keys.has(filledKey('ledger', 'any'))).toBe(false);
    });

    it('跨层同名字段不串（company:address ≠ relation:address）', () => {
      const keys = buildFilledKeys({ company: { address: true }, relation: { address: false } });
      expect(keys.has('company:address')).toBe(true);
      expect(keys.has('relation:address')).toBe(false);
    });

    it('与 validateSignChecklist 串起来：B3-6 默认清单 + 全缺 → 6 项全在 missing', () => {
      const defaultItems: SignChecklistItem[] = [
        item('company', 'credit_code', '统一社会信用代码'),
        item('company', 'address', '注册地址'),
        item('company', 'industry_l1', '行业（一级）'),
        item('company', 'province', '省份'),
        item('relation', 'value_tier', '开发价值'),
        item('relation', 'contact', '签约联系人'),
      ];
      expect(validateSignChecklist(defaultItems, buildFilledKeys({}))).toHaveLength(6);
      // 只补齐公司层四项 → 余 relation 两项（value_tier / contact）
      const partial = buildFilledKeys({
        company: { credit_code: true, address: true, industry_l1: true, province: true },
        relation: { contact: true },
      });
      const missing = validateSignChecklist(defaultItems, partial);
      expect(missing).toHaveLength(1);
      expect(missing[0].field_key).toBe('value_tier');
    });
  });
});
