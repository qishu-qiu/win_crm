// =============================================================================
// E 域疑似重复分组纯函数单测（M9-E / B6）
//
// 口径来源（★ 真相源，勿自造）：数据架构 E1（逻辑重复检测口径）、接口 §4.8。
// ★ domain/ 层零框架依赖 → 假数据即可单测，无需真库（→ CODEBUDDY.md §5 / 架构 §5.4）。
// =============================================================================
import { describe, expect, it } from '@jest/globals';

import { findSuspectedDuplicates, normalizeWindowDays, type DuplicateCheckContract } from './contract-duplicate';

/** 构造一条检测行（sign_date 用 UTC 零点，避免时区漂移） */
function row(
  id: number,
  companyId: number,
  signerId: number,
  amount: string,
  signDate: string | null,
): DuplicateCheckContract {
  return {
    id: BigInt(id),
    contract_no: `CN${id}`,
    company_id: BigInt(companyId),
    signer_id: BigInt(signerId),
    amount,
    sign_date: signDate === null ? null : new Date(`${signDate}T00:00:00Z`),
  };
}

describe('domain/contract-duplicate 疑似重复检测', () => {
  describe('normalizeWindowDays', () => {
    it('非正整数 → 默认 7', () => {
      expect(normalizeWindowDays(undefined)).toBe(7);
      expect(normalizeWindowDays(null)).toBe(7);
      expect(normalizeWindowDays('abc')).toBe(7);
      expect(normalizeWindowDays(0)).toBe(7);
      expect(normalizeWindowDays(-3)).toBe(7);
    });
    it('正整数向下取整', () => {
      expect(normalizeWindowDays(7)).toBe(7);
      expect(normalizeWindowDays(7.9)).toBe(7);
      expect(normalizeWindowDays('10')).toBe(10);
    });
  });

  describe('findSuspectedDuplicates', () => {
    it('同公司+同签单人+同金额+签约日相近 → 记一对', () => {
      const rows = [
        row(1, 10, 5, '100.00', '2026-09-01'),
        row(2, 10, 5, '100.00', '2026-09-05'), // 差 4 天 ≤7
      ];
      const result = findSuspectedDuplicates(rows, 7);
      expect(result).toHaveLength(1);
      expect(result[0].company_id.toString()).toBe('10');
      expect(result[0].contracts.map((c) => c.id.toString()).sort()).toEqual(['1', '2']);
    });

    it('签约日相差 > 窗口 → 不记', () => {
      const rows = [
        row(1, 10, 5, '100.00', '2026-09-01'),
        row(2, 10, 5, '100.00', '2026-09-20'), // 差 19 天 >7
      ];
      expect(findSuspectedDuplicates(rows, 7)).toHaveLength(0);
    });

    it('金额不同 / 签单人不同 / 公司不同 → 不归同组', () => {
      const rows = [
        row(1, 10, 5, '100.00', '2026-09-01'),
        row(2, 10, 5, '200.00', '2026-09-02'), // 金额不同
        row(3, 10, 6, '100.00', '2026-09-02'), // 签单人不同
        row(4, 11, 5, '100.00', '2026-09-02'), // 公司不同
      ];
      expect(findSuspectedDuplicates(rows, 7)).toHaveLength(0);
    });

    it('任一 sign_date 为空 → 跳过该配（无法比对）', () => {
      const rows = [
        row(1, 10, 5, '100.00', null),
        row(2, 10, 5, '100.00', '2026-09-05'),
      ];
      expect(findSuspectedDuplicates(rows, 7)).toHaveLength(0);
    });

    it('组内三条两两相近 → 记两对（i<j 全组合）', () => {
      const rows = [
        row(1, 10, 5, '100.00', '2026-09-01'),
        row(2, 10, 5, '100.00', '2026-09-02'),
        row(3, 10, 5, '100.00', '2026-09-03'),
      ];
      const result = findSuspectedDuplicates(rows, 7);
      expect(result).toHaveLength(3);
    });

    it('空输入 → 空结果', () => {
      expect(findSuspectedDuplicates([], 7)).toHaveLength(0);
    });

    it('出参 sign_date 为 ISO 字符串（带 Z）', () => {
      const rows = [row(1, 10, 5, '100.00', '2026-09-01'), row(2, 10, 5, '100.00', '2026-09-03')];
      const result = findSuspectedDuplicates(rows, 7);
      for (const pair of result[0].contracts) {
        expect(pair.sign_date).toBe('2026-09-01T00:00:00.000Z');
      }
    });
  });
});
