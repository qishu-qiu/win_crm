// =============================================================================
// E 域合同纯业务规则单测（M9-E / B2）
//
// 口径来源（★ 真相源，勿自造）：
//   · 数据架构 E1（status 取值 / 金额口径）、接口 §5.9（pay_progress / expire_level）。
//
// ★ domain/ 层零框架依赖 → 假数据即可单测，无需真库（→ CODEBUDDY.md §5 / 架构 §5.4）。
// =============================================================================
import { describe, expect, it } from '@jest/globals';

import { computePayProgress, deriveContractStatus, expireLevelOf, isContractStatus } from './contract';

describe('domain/contract 纯业务规则', () => {
  describe('isContractStatus', () => {
    it('接受合法状态', () => {
      expect(isContractStatus('unpaid')).toBe(true);
      expect(isContractStatus('terminated')).toBe(true);
    });
    it('拒绝非法值 / 非字符串', () => {
      expect(isContractStatus('foo')).toBe(false);
      expect(isContractStatus(123)).toBe(false);
      expect(isContractStatus(null)).toBe(false);
    });
  });

  describe('deriveContractStatus（金额派生，不含人工终态 terminated）', () => {
    it('未回款 / 金额为 0 → unpaid', () => {
      expect(deriveContractStatus('100', '0')).toBe('unpaid');
      expect(deriveContractStatus('0', '0')).toBe('unpaid');
    });
    it('部分回款 → partial', () => {
      expect(deriveContractStatus('100', '40')).toBe('partial');
    });
    it('足额 / 超额回款 → done', () => {
      expect(deriveContractStatus('100', '100')).toBe('done');
      expect(deriveContractStatus('100', '120')).toBe('done');
    });
    it('非法金额不崩 → unpaid', () => {
      expect(deriveContractStatus('abc', '0')).toBe('unpaid');
    });
  });

  describe('computePayProgress', () => {
    it('0 / 全额边界', () => {
      expect(computePayProgress('100', '0')).toBe(0);
      expect(computePayProgress('100', '100')).toBe(100);
    });
    it('向下取整', () => {
      expect(computePayProgress('100', '33')).toBe(33);
      expect(computePayProgress('100', '34')).toBe(34);
    });
    it('超额封顶 100', () => {
      expect(computePayProgress('100', '150')).toBe(100);
    });
    it('非法金额 → 0', () => {
      expect(computePayProgress('abc', '0')).toBe(0);
    });
  });

  describe('expireLevelOf（到期预警档 0/30/60/90）', () => {
    const now = new Date('2026-09-23T00:00:00Z');
    it('无到期日 → 0', () => {
      expect(expireLevelOf(null, now)).toBe(0);
    });
    it('已过到期日 → 0', () => {
      expect(expireLevelOf(new Date('2026-09-01T00:00:00Z'), now)).toBe(0);
    });
    it('窗口映射 30 / 60 / 90', () => {
      expect(expireLevelOf(new Date('2026-10-20T00:00:00Z'), now)).toBe(30); // 27 天（≤30）
      expect(expireLevelOf(new Date('2026-11-15T00:00:00Z'), now)).toBe(60); // 53 天（≤60）
      expect(expireLevelOf(new Date('2026-12-01T00:00:00Z'), now)).toBe(90); // 69 天（≤90）
    });
    it('>90 天 → 0（不预警）', () => {
      expect(expireLevelOf(new Date('2027-02-01T00:00:00Z'), now)).toBe(0);
    });
  });
});
