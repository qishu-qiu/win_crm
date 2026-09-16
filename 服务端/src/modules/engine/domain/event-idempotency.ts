// =============================================================================
// D 域纯规则（M4-06）—— 跟单事件幂等键生成（**同输入同键、异输入异键**）
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM数据架构文档》D2：`idempotency_key UNIQUE` —— **防重复提交**。
//   · 《销售CRM接口API文档》§2.5：非幂等写操作应带 `Idempotency-Key` 请求头
//     —— ⚠ 该**横切能力尚未实现**（M2 起同一现状，已记入交接说明 §三 #13），
//       故本批由**服务端按内容**生成键，横切落地后改走请求头（届时本函数是它的兜底）。
//
// ★ 为什么**不把 `event_at`（当前时刻）放进键里**：
//   放进去＝每次提交都是新键，销售手抖连点两次会落两条一模一样的跟单 —— 那就失去了
//   `uk_idem` 的意义。故键只由**内容**决定：内容相同即视为同一次提交（→ 409 人话
//   「这条跟单刚刚已经记过了」）；销售真要连续写两条一样的话，改一个字即可。
//
// ★ 为什么用 SHA-256 而不是自己拼字符串：
//   ① `idempotency_key` 是 `VarChar(64)`，而内容（尤其 `summary` 200 字）远超 64；
//   ② 直接截断可读串会撞键。SHA-256 十六进制恰好 64 字符，**不用截断也不越界**。
//
// 分层约束（架构 §5.4）：`domain/**` 与框架 / ORM 解耦 —— 不 import `@nestjs/*` / `@prisma/client`。
//   `node:crypto` 是 Node 标准库（纯函数、无副作用、结果确定），**不属于框架或 ORM**。
// =============================================================================
import { createHash } from 'node:crypto';

/** 参与哈希的字段（顺序即协议：改顺序＝换一套键，会**放掉**旧键，勿随意调整） */
export interface EventIdempotencyInput {
  /** 关系 id（`null`＝待关联阶段只绑联系人，→ D2） */
  relationId: bigint | null;
  /** 联系人 id（可空） */
  contactId: bigint | null;
  /** 操作人 `employee.id` */
  actorId: bigint;
  /** 动作类型（→ `ACTION_TYPES`） */
  actionType: string;
  /** 结果（可空＝中性） */
  outcome?: string | null;
  /** 一句话结果（可空＝快速标记） */
  summary?: string | null;
  /** 本次投入分钟（可空） */
  durationMin?: number | null;
}

/**
 * 字段分隔符：取 `U+0001`（**写成 `String.fromCharCode(1)`**，不在源文件里放不可见控制字符），
 * 它不可能出现在正常业务文本里 —— 否则 `abc|d` 与 `ab|c|d` 会算出同一个键。
 */
const FIELD_SEPARATOR = String.fromCharCode(1);

function part(value: string | number | bigint | null | undefined): string {
  if (value === null || value === undefined) return '';
  return typeof value === 'bigint' ? value.toString() : String(value);
}

/**
 * 生成跟单事件的幂等键（64 位十六进制）。
 * ★ 纯函数：相同输入**必**得相同键；任一字段不同**必**得不同键（→ M4-06 判据，单测钉死）。
 */
export function buildEventIdempotencyKey(input: EventIdempotencyInput): string {
  const raw = [
    part(input.relationId),
    part(input.contactId),
    part(input.actorId),
    part(input.actionType),
    part(input.outcome),
    part(input.summary),
    part(input.durationMin),
  ].join(FIELD_SEPARATOR);
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}
