// =============================================================================
// B 域纯规则（M2-05）—— 公司全称 → 标准化核心词 `name_core`
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM数据架构文档》V1.32 §四 B1：`name_core` ＝ 全称的**标准化核心词** ——
//     「去地域 / 行业 / 公司类型词（安徽 / 信息技术 / 有限公司 / 股份 / 集团）、去括号与空格、
//      **全半角统一、英文大小写归一**」，由**服务端在建档 / 改名 / 合并时生成并落库**。
//     ★ 用途写得很明确：**两段式查重的第一段走本列（精确匹配 / 前缀）收缩候选集**，
//       第二段才在候选集上算编辑距离 —— 否则每录一个客户都要全表比一遍。
//   · 《销售CRM业务需求文档》§12.1 分支 4：查重命中后**由人点选**（「挂现有公司」/「确认新建」），
//     系统**不自动合并、不自动拦截** ⇒ 故本函数**宁可宽一点**（多给候选比漏给候选安全）。
//   · 词表本体 → `company-name-words.ts`（**业务可编辑**，来源与取舍都写在那个文件头）。
//
// ★ 本函数**只做「归一 + 剥词」，不做「判定」**：
//   是不是同一家、要不要提示，属第二段（`company-name-similarity.ts`）与业务人判，
//   别把判定塞进来（否则以后想调宽松度就得改词表，两件事会缠在一起）。
//
// 分层约束（架构 §5.4）：`domain/**` 不 import 框架 / ORM、不查库，用假数据即可单测。
// =============================================================================
import {
  COMPANY_TYPE_WORDS,
  INDUSTRY_WORDS,
  LEADING_REGION_WORDS,
  REGION_SUFFIXES,
} from './company-name-words';

/**
 * 「任意位置剥」的词（行业 ＋ 类型，**长度降序**）。
 * ★ 地域词**不在这里**：`省 / 市 / 区 / 县` 是单字，任意位置剥会咬到字号 —— 见下 `stripLeadingRegion`。
 */
const INNER_STRIPPABLE_WORDS: readonly string[] = [...new Set<string>([
  ...INDUSTRY_WORDS,
  ...COMPANY_TYPE_WORDS,
])].sort((a, b) => b.length - a.length);

/** 全角字符 → 半角（含全角空格 U+3000）：`ＡＢＣ１２３（）` → `ABC123()` */
function toHalfWidth(value: string): string {
  return value
    .replace(/[\uFF01-\uFF5E]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ');
}

/** 括号及其内容：`鑫中网（合肥）` / `鑫中网(合肥)` / `鑫中网【合肥】` → `鑫中网` */
const BRACKETED = /[（(【\[〈《][^）)】\]〉》]*[）)】\]〉》]/g;

/** 标点与符号（去空格也在这里）：连接号、点、顿号、斜杠、加号等 —— 公司名里它们只起分隔作用 */
const PUNCTUATION = /[\s·．.,，、;；:：/\\|+&'"`~!！?？*#@%^_=<>{}，。—\-]/g;

/**
 * 基础归一（**不剥词**）：全角→半角 → 去括号内容 → 去标点空格 → 英文小写。
 *
 * ★ 它有两个身份，别混：
 *   ① `toNameCore` 的**第一步**；
 *   ② **兜底值** —— 当一个名字整串都是可剥词（如「安徽信息技术有限公司」）时，
 *      剥完会变空；此时回退到本函数的输出，**绝不让 `name_core` 为空**
 *      （空值会让所有此类公司互相「完全相同」，比漏判更坏）。
 */
export function normalizeCompanyName(raw: string): string {
  return toHalfWidth(String(raw))
    .replace(BRACKETED, '')
    .replace(PUNCTUATION, '')
    .toLowerCase();
}

/**
 * 反复剥掉**开头**的地域（「安徽省合肥市XX…」→「XX…」）。
 *
 * ★ 规则：先剥一个**地域词**，若其后紧跟一个**行政区划后缀**（省 / 市 / 区 …）再顺带剥掉；
 *   **不允许**单独剥开头的后缀 —— 否则「区块技术有限公司」会被咬成「块」（字号被毁）。
 */
function stripLeadingRegion(value: string): string {
  let result = value;

  for (let guard = 0; guard < 8; guard += 1) {
    const region = LEADING_REGION_WORDS.find((word) => result.startsWith(word));
    if (region === undefined) return result;

    result = result.slice(region.length);
    const suffix = REGION_SUFFIXES.find((word) => result.startsWith(word));
    if (suffix !== undefined) result = result.slice(suffix.length);
  }

  // 兜底：词表若被改成互相嵌套（如同时有「安徽」与「安徽省」且顺序反了），最多剥 8 轮就停
  return result;
}

/**
 * 全称 → 核心词（**建档 / 改名 / 合并时调用，结果落 `company.name_core`**）。
 *
 * 步骤：基础归一 → 剥开头地域词 → 任意位置剥行业 / 类型词 → 剥空则回退基础归一值。
 * ★ 为什么行业 / 类型词必须「从长到短」：否则「有限公司」会先被「公司」咬掉，剩下「有限」留在 core 里 ——
 *   于是「XX 有限公司」和「XX 有限责任公司」永远匹配不上（同类名字全漏判）。
 */
export function toNameCore(fullName: string): string {
  const normalized = normalizeCompanyName(fullName);
  let core = stripLeadingRegion(normalized);

  for (const word of INNER_STRIPPABLE_WORDS) {
    if (core.includes(word)) core = core.split(word).join('');
  }

  return core === '' ? normalized : core;
}
