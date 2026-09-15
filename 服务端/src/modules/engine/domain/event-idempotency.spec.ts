// =============================================================================
// D 域纯规则用例（M4-06）—— 幂等键生成
//
// 判据逐字（《过程产出/开发计划-V1.md》M4-06）：
//   「`domain/event-idempotency.ts`：幂等键生成纯函数」→ 单测：**同输入同键、异输入异键**。
// 口径：《销售CRM数据架构文档》V1.31 D2（`idempotency_key UNIQUE`，`VarChar(64)`）。
// =============================================================================
import { buildEventIdempotencyKey, type EventIdempotencyInput } from './event-idempotency';

const BASE: EventIdempotencyInput = {
  relationId: 11n,
  contactId: null,
  actorId: 7n,
  actionType: 'phone',
  outcome: 'advanced',
  summary: '客户说下周一再谈',
  durationMin: 10,
};

describe('event-idempotency（M4-06）', () => {
  it('同输入 → 同键（连调两次一致）', () => {
    expect(buildEventIdempotencyKey(BASE)).toBe(buildEventIdempotencyKey(BASE));
  });

  it('键长 64（＝ `idempotency_key` 的 `VarChar(64)`，不截断也不越界）', () => {
    expect(buildEventIdempotencyKey(BASE)).toHaveLength(64);
    expect(buildEventIdempotencyKey(BASE)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('内容很长的 summary 也不影响键长（哈希而非拼接可读串）', () => {
    const key = buildEventIdempotencyKey({ ...BASE, summary: '长'.repeat(200) });
    expect(key).toHaveLength(64);
  });

  describe('异输入 → 异键（**任一字段**变化都要换键）', () => {
    it.each([
      ['relationId', { relationId: 12n }],
      ['contactId', { contactId: 5n }],
      ['actorId', { actorId: 8n }],
      ['actionType', { actionType: 'visit' }],
      ['outcome', { outcome: 'stalled' }],
      ['summary', { summary: '客户说下周二再谈' }],
      ['durationMin', { durationMin: 11 }],
    ])('改 %s → 键不同', (_field, patch) => {
      expect(buildEventIdempotencyKey({ ...BASE, ...patch })).not.toBe(
        buildEventIdempotencyKey(BASE),
      );
    });

    it('summary 差一个字 → 键不同（销售要连写两条一样的话，改一个字即可）', () => {
      const a = buildEventIdempotencyKey({ ...BASE, summary: '已接通' });
      const b = buildEventIdempotencyKey({ ...BASE, summary: '已接通。' });
      expect(a).not.toBe(b);
    });

    it('「有值」与「可空」要分得开：`null` 与 `undefined` 视为同一种缺省', () => {
      expect(buildEventIdempotencyKey({ ...BASE, outcome: null })).toBe(
        buildEventIdempotencyKey({ ...BASE, outcome: undefined }),
      );
    });

    it('★ 分隔符歧义：`abc|d` 与 `ab|c|d` 不撞键（分隔符取 `U+0001`，业务文本里不会有）', () => {
      const a = buildEventIdempotencyKey({ ...BASE, actionType: 'a', summary: 'bc|d' });
      const b = buildEventIdempotencyKey({ ...BASE, actionType: 'ab', summary: 'c|d' });
      expect(a).not.toBe(b);
    });
  });
});
