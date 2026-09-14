// =============================================================================
// 公司名归一用例（M2-05）
// 判据逐字（《开发计划-V1》）：「标准化（括号 / 全半角 / 大小写 / 空格）纯函数；
//   单测：**≥6 组等价名归一后相同**」—— 本文件第一组用例就是 8 个写法的「同一家」。
// ★ 这条守的是**查重的第一段**：core 算不一致，候选集里就永远找不到那家已有公司，
//   于是同一家公司被建两遍（且撞码合并也救不回来——两条档案都「看起来不一样」）。
// =============================================================================
import { normalizeCompanyName, toNameCore } from './company-name';
import { STRIPPABLE_WORDS } from './company-name-words';

describe('公司名归一（domain/company-name · M2-05）', () => {
  describe('≥6 组等价名 → 同一个核心词（判据本体）', () => {
    it.each([
      ['全称', '安徽鑫中网信息技术有限公司'],
      ['换城市', '合肥鑫中网网络科技有限公司'],
      ['括号写法', '鑫中网（合肥）信息技术有限公司'],
      ['全角括号 ＋ 空格', '鑫中网 （ 合肥 ） 信息技术有限公司'],
      ['括号里写「中国」', '鑫中网信息技术（中国）有限公司'],
      ['多加「省」', '安徽省鑫中网信息技术有限公司'],
      ['类型不同（有限责任）', '安徽鑫中网信息技术有限责任公司'],
      ['股份公司', '安徽鑫中网信息技术股份有限公司'],
      ['只有字号（销售手打）', '鑫中网'],
    ])('%s：%s', (_name, fullName) => {
      expect(toNameCore(fullName)).toBe('鑫中网');
    });

    it('**所有写法归一后彼此相同**（不只「各自等于期望」——那是两回事）', () => {
      const names = [
        '安徽鑫中网信息技术有限公司',
        '合肥鑫中网网络有限公司',
        '鑫中网（合肥）信息技术有限公司',
        '安徽省鑫中网信息技术有限责任公司',
        '鑫中网',
      ];

      expect(new Set(names.map((name) => toNameCore(name))).size).toBe(1);
    });

    it('英文只做小写、**不当行业词剥**：字号里的 `IT` 不许被吃掉', () => {
      expect(toNameCore('鑫中网（合肥）ＩＴ有限公司')).toBe('鑫中网it');
    });

    it('地域**只在开头剥**：以「区 / 县」开头的字号不许被咬掉（`区块` ≠ `块`）', () => {
      expect(toNameCore('区块技术有限公司')).toBe('区块');
      expect(toNameCore('县通物流有限公司')).toBe('县通');
    });

    it('另一组：行业词 / 城市 / 类型都换掉，仍归到同一个字号', () => {
      const names = [
        '安徽智汇数据科技有限公司',
        '合肥智汇数据有限公司',
        '智汇数据科技（合肥）有限公司',
        '安徽省智汇数据咨询有限责任公司',
      ];

      expect(new Set(names.map((name) => toNameCore(name)))).toEqual(new Set(['智汇']));
    });
  });

  describe('兜底：剥完为空时绝不返回空（否则同类公司会互相「完全相同」）', () => {
    it('整串都是可剥词（「安徽＋信息技术＋有限公司」）→ 回退到基础归一值', () => {
      const core = toNameCore('安徽信息技术有限公司');

      expect(core).not.toBe('');
      expect(core).toBe(normalizeCompanyName('安徽信息技术有限公司'));
      expect(core).toBe('安徽信息技术有限公司');
    });

    it('空串 / 纯标点 → 空串（不抛错；「空」与「撞上别人」是两件事）', () => {
      expect(toNameCore('')).toBe('');
      expect(toNameCore('   ')).toBe('');
      expect(toNameCore('（）')).toBe('');
    });
  });

  describe('基础归一（normalizeCompanyName）', () => {
    it('全角 → 半角（含全角空格）', () => {
      expect(normalizeCompanyName('ＡＢＣ　１２３')).toBe('abc123');
    });

    it('去括号及其内容（圆 / 方 / 尖 / 书名号）', () => {
      expect(normalizeCompanyName('鑫中网（合肥）')).toBe('鑫中网');
      expect(normalizeCompanyName('鑫中网[合肥]')).toBe('鑫中网');
      expect(normalizeCompanyName('鑫中网〈合肥〉')).toBe('鑫中网');
    });

    it('去标点 / 空格 / 连接号 / 间隔号', () => {
      expect(normalizeCompanyName('鑫·中 网-科技')).toBe('鑫中网科技');
    });

    it('英文大小写归一（大小写在查重里没有意义）', () => {
      expect(normalizeCompanyName('ABC 科技')).toBe('abc科技');
    });
  });

  describe('词表约束（防止以后手改词表踩坑）', () => {
    it('词表按**长度从长到短**排好（否则「有限公司」会被「公司」先咬掉，剩下「有限」）', () => {
      const lengths = STRIPPABLE_WORDS.map((word) => word.length);

      for (let i = 1; i < lengths.length; i += 1) {
        expect(lengths[i]!).toBeLessThanOrEqual(lengths[i - 1]!);
      }
    });

    it('词表去重（同词出现两次只会多跑一遍循环）', () => {
      expect(new Set(STRIPPABLE_WORDS).size).toBe(STRIPPABLE_WORDS.length);
    });

    it('`有限公司` 与 `有限责任公司` 都在表里（最常见的两种组织形式，缺一就会漏判）', () => {
      expect(STRIPPABLE_WORDS).toContain('有限公司');
      expect(STRIPPABLE_WORDS).toContain('有限责任公司');
    });
  });
});
