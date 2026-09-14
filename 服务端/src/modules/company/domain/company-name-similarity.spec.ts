// =============================================================================
// 公司名相似度判级用例（M2-06）
// 判据逐字（《开发计划-V1》）：「两段式（完全相同 → 疑似；编辑距离 ≤1 且长度相近 → 高度疑似）；
//   单测：**分级命中 / 未命中各 ≥3 例**」。
// ★ 码值取接口 §5.4 的 `match_type`（`same` / `high_sim`），**不另造中文码**。
// =============================================================================
import { toNameCore } from './company-name';
import {
  compareCompanyNameCore,
  levenshteinDistance,
  similarityOf,
} from './company-name-similarity';

describe('公司名查重判级（domain/company-name-similarity · M2-06）', () => {
  describe('levenshteinDistance —— 基础工具（判级全靠它，先自证）', () => {
    it.each([
      ['相同', 'abc', 'abc', 0],
      ['空 vs 非空', '', 'abc', 3],
      ['经典例子', 'kitten', 'sitting', 3],
      ['中文按字计', '智汇', '智会', 1],
      ['多一字', '智汇', '智汇通', 1],
      ['完全不同', '智汇', '宏图', 2],
    ])('%s：%s / %s → %i', (_name, a, b, expected) => {
      expect(levenshteinDistance(a, b)).toBe(expected);
    });

    it('相似度：完全相同 1；差一字按较长串长度折算', () => {
      expect(similarityOf('鑫中网', '鑫中网')).toBe(1);
      expect(similarityOf('智汇', '智会')).toBe(0.5);
      expect(similarityOf('', '')).toBe(1);
    });
  });

  describe('判级命中（≥3 例）', () => {
    it.each([
      ['完全相同 → same', '鑫中网', '鑫中网', 'same'],
      ['错一字 → high_sim', '智汇', '智会', 'high_sim'],
      ['多一字 → high_sim', '智汇', '智汇通', 'high_sim'],
      ['少一字 → high_sim', '鑫中网', '鑫中', 'high_sim'],
    ])('%s', (_name, a, b, expected) => {
      expect(compareCompanyNameCore(a, b)?.match_type).toBe(expected);
    });

    it('`same` 的相似度恒为 1（前端排序要按它排，不能靠调用方自己算）', () => {
      expect(compareCompanyNameCore('鑫中网', '鑫中网')).toEqual({ match_type: 'same', similarity: 1 });
    });

    it('**端到端**（先归一、再判级）：两个不同写法的「同一家」判 same', () => {
      const left = toNameCore('安徽鑫中网信息技术有限公司');
      const right = toNameCore('合肥鑫中网网络有限公司');

      expect(compareCompanyNameCore(left, right)?.match_type).toBe('same');
    });

    it('**端到端**：字形差一字的「疑似同一家」判 high_sim', () => {
      const left = toNameCore('安徽智汇数据科技有限公司');
      const right = toNameCore('安徽智会数据有限公司');

      expect(compareCompanyNameCore(left, right)?.match_type).toBe('high_sim');
    });
  });

  describe('判级未命中（≥3 例）', () => {
    it.each([
      ['长度差 >1（智汇 / 智汇天下）', '智汇', '智汇天下'],
      ['距离 ≥2（智汇 / 宏图）', '智汇', '宏图'],
      ['一字 core 之间**不模糊**（否则满屏假候选）', '智', '汇'],
    ])('%s → null', (_name, a, b) => {
      expect(compareCompanyNameCore(a, b)).toBeNull();
    });

    it('空 core 不参与比较（空 vs 空 = 完全相同，那是纯噪音）', () => {
      expect(compareCompanyNameCore('', '')).toBeNull();
      expect(compareCompanyNameCore('', '鑫中网')).toBeNull();
      expect(compareCompanyNameCore('鑫中网', '')).toBeNull();
    });

    it('长度相等但差两字 → 不进候选（阈值是「编辑距离 ≤1」）', () => {
      expect(compareCompanyNameCore('智汇科技', '宏图天下')).toBeNull();
    });
  });
});
