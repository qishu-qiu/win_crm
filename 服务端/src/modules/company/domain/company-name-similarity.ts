// =============================================================================
// B 域纯规则（M2-06）—— **两段式**公司名查重的第二段（在候选集上判分级）
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM数据架构文档》V1.32 §四 B1：**第一段走 `name_core`（精确匹配 / 前缀）收缩候选集**，
//     **第二段才在候选集上算编辑距离** —— 否则每录一个客户都要全表比一遍（性能与正确性都靠这条）。
//   · 《开发计划-V1》M2-06 判据：「**两段式**（完全相同 → 疑似；编辑距离 ≤1 且长度相近 → 高度疑似）；
//     单测：分级命中 / 未命中各 ≥3 例」。
//   · 《销售CRM接口API文档》V1.18 §5.4：`POST /companies/search-dup` 的候选出参
//     `{id,full_name,credit_code_masked,similarity,match_type:"same"|"high_sim"}`，
//     并给 `suggest:"use_exists"|"create_new"`。
//     ⇒ **判级的码值以接口为准**：`same` / `high_sim`（计划里写的「疑似 / 高度疑似」是中文措辞，
//       不另造第三套码 —— 三处各一套码等于三处都能筛不出来，正是登记表 #36 那类坑）。
//   · 《销售CRM业务需求文档》§12.1 分支 4：**系统只提示、人点选**（可「确认新建」强行建），
//     ⇒ 故阈值**宁可宽**：多给一个候选让人扫一眼，比漏给候选人后建出重复档案强。
//
// ★ 注意本文件**只吃 `name_core`**（不是全称）：全称比对会把「安徽…有限公司」与「合肥…有限公司」
//   判成两家；core 由 `toNameCore()` 生成（M2-05），两步的分工别混。
//
// 分层约束（架构 §5.4）：`domain/**` 不 import 框架 / ORM、不查库，用假数据即可单测。
// =============================================================================

/** 判级结果码（→ 接口 §5.4 `match_type`；**只这两个值**） */
export type CompanyMatchType = 'same' | 'high_sim';

export interface CompanySimilarity {
  match_type: CompanyMatchType;
  /** 相似度 0~1（保留两位小数）：1 = 完全相同；供前端排序 / 展示 */
  similarity: number;
}

/**
 * 模糊匹配的**长度下限**：core 短于 2 字时**只认完全相同**。
 * ★ 为什么：一字 core（如「鑫」「汇」）之间的编辑距离必然 ≤1，等于把两家毫不相干的公司
 *   判成「高度疑似」—— 满屏假候选会让人直接无视提示（比不提示更糟）。
 */
const MIN_FUZZY_LENGTH = 2;

/** 允许的编辑距离上限（→ M2-06 判据「≤1」） */
const MAX_DISTANCE = 1;

/** 「长度相近」的定义：core 长度差 ≤1（→ M2-06 判据；再宽就会把「智汇」与「智汇天下」算近似） */
const MAX_LENGTH_GAP = 1;

/** 编辑距离（Levenshtein，两行滚动数组；中文按「字」计，符合直觉） */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a === '') return b.length;
  if (b === '') return a.length;

  const previous: number[] = Array.from({ length: b.length + 1 }, (_unused, i) => i);
  const current: number[] = new Array<number>(b.length + 1).fill(0);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j]! + 1, // 删
        current[j - 1]! + 1, // 增
        previous[j - 1]! + cost, // 改
      );
    }
    for (let j = 0; j <= b.length; j += 1) previous[j] = current[j]!;
  }

  return previous[b.length]!;
}

/** 相似度（0~1，两位小数）：1 - 距离 / 较长串长度 */
export function similarityOf(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  return Math.round((1 - levenshteinDistance(a, b) / longest) * 100) / 100;
}

/**
 * 判级：两个 **`name_core`** 之间是「完全相同」还是「高度疑似」，或**够不上**（`null`）。
 *
 * ```
 * 完全相同                      → 'same'（相似度 1）
 * 编辑距离 ≤1 且长度差 ≤1 且 core ≥2 字 → 'high_sim'
 * 其余                          → null（不进候选）
 * ```
 */
export function compareCompanyNameCore(a: string, b: string): CompanySimilarity | null {
  if (a === '') return null; // 空 core 不比：任何空值互相比较都是「完全相同」，那是噪音

  if (a === b) return { match_type: 'same', similarity: 1 };

  if (a.length < MIN_FUZZY_LENGTH || b.length < MIN_FUZZY_LENGTH) return null;
  if (Math.abs(a.length - b.length) > MAX_LENGTH_GAP) return null;

  const distance = levenshteinDistance(a, b);
  if (distance > MAX_DISTANCE) return null;

  return { match_type: 'high_sim', similarity: similarityOf(a, b) };
}
