import { DomainEventName, createDomainEvent } from './domain-event';

/** 《架构设计说明》§5.3 清单原文（10 个，逐字） */
const SPEC_NAMES = [
  'RelationCreated',
  'RelationStageAdvanced',
  'RelationReleased',
  'RelationClaimed',
  'ActionEventRecorded',
  'ContractSigned',
  'PaymentReceived',
  'ApprovalApproved',
  'ApprovalRejected',
  'CollaborationGranted',
];

describe('M0-28 领域事件定义（架构 §5.3 首批事件清单）', () => {
  it('计划判据：常量含 RelationCreated…CollaborationGranted 共 10 个', () => {
    const names = Object.values(DomainEventName);
    expect(names).toHaveLength(10);
    expect(names).toEqual(expect.arrayContaining(SPEC_NAMES));
  });

  it('与规格清单一个不多一个不少（Set 防重复／防漏抄）—— ★ 「首批」非穷尽：增补事件须先改架构 §5.3，再同步此处', () => {
    // ★ 2026-09-15 审计注记：§5.3 标题是「**首批**要落地的跨域事件清单」（**首批**＝将来还会加），
    //   本断言锁的是「**当前这一批不许自行增减**」（防 AI 自造事件，这是**正当**的封闭断言）；
    //   但**增补的正确路径**是先改架构 §5.3 的清单、再同步本常量与 SPEC_NAMES —— 不是"事件永远只有 10 个"。
    const names = Object.values(DomainEventName);
    expect(new Set(names).size).toBe(10);
    expect([...names].sort()).toEqual([...SPEC_NAMES].sort());
  });

  it('键名与值同名（防手抄错位：常量改了值没改）', () => {
    for (const [key, value] of Object.entries(DomainEventName)) {
      expect(value).toBe(key);
    }
  });

  it('createDomainEvent：补齐 occurredAt、payload 原样带出', () => {
    const occurredAt = new Date('2026-09-14T10:00:00.000Z');
    const created = createDomainEvent({
      name: DomainEventName.RelationCreated,
      actorId: 1001n,
      aggregateId: 88n,
      payload: { companyId: 7n },
      occurredAt,
    });
    expect(created.name).toBe('RelationCreated');
    expect(created.actorId).toBe(1001n);
    expect(created.aggregateId).toBe(88n);
    expect(created.occurredAt).toBe(occurredAt);
    expect(created.payload).toEqual({ companyId: 7n });
  });

  it('occurredAt 缺省＝当前时间（是 Date）', () => {
    const before = Date.now();
    const created = createDomainEvent({ name: DomainEventName.ContractSigned, actorId: 1n, payload: {} });
    expect(created.occurredAt).toBeInstanceOf(Date);
    expect(created.occurredAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('aggregateId 没给就不出现该键（日志 / 断言干净），给了就带上', () => {
    const without = createDomainEvent({ name: DomainEventName.RelationClaimed, actorId: 1n, payload: {} });
    expect('aggregateId' in without).toBe(false);
    const withId = createDomainEvent({
      name: DomainEventName.RelationClaimed,
      actorId: 1n,
      aggregateId: 5n,
      payload: {},
    });
    expect('aggregateId' in withId).toBe(true);
    expect(withId.aggregateId).toBe(5n);
  });

  it('系统动作 actorId = 0n（→ schema.prisma operation_log.operator_id：系统动作=0）', () => {
    const created = createDomainEvent({ name: DomainEventName.PaymentReceived, actorId: 0n, payload: {} });
    expect(created.actorId).toBe(0n);
  });
});
