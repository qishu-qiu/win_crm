import {
  DomainEventName,
  createDomainEvent,
  type DomainEvent,
  type DomainEventNameValue,
} from './domain-event';
import { EventBus } from './event-bus';

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** 造一个事件（occurredAt 固定，保证可重复） */
function makeEvent(name: DomainEventNameValue = DomainEventName.RelationCreated): DomainEvent {
  return createDomainEvent({
    name,
    actorId: 1001n,
    aggregateId: 88n,
    payload: { note: 'test' },
    occurredAt: new Date('2026-09-14T10:00:00.000Z'),
  });
}

describe('M0-29 进程内事件总线（架构 §5.2 跨域三条路 / §5.3）', () => {
  it('计划判据：subscribe → publish 收得到', async () => {
    const bus = new EventBus();
    const received: DomainEvent[] = [];
    bus.subscribe(
      DomainEventName.RelationCreated,
      (event) => {
        received.push(event);
      },
      { delivery: 'sync' },
    );
    const published = makeEvent();
    await bus.publish(published);
    expect(received).toEqual([published]);
  });

  it('同一事件多订阅者都收到，且按注册顺序投递（sync 会被 await）', async () => {
    const bus = new EventBus();
    const order: string[] = [];
    bus.subscribe(
      DomainEventName.RelationCreated,
      async () => {
        await delay(10);
        order.push('first');
      },
      { delivery: 'sync' },
    );
    bus.subscribe(DomainEventName.RelationCreated, () => { order.push('second'); }, { delivery: 'sync' });
    await bus.publish(makeEvent());
    expect(order).toEqual(['first', 'second']);
  });

  it('默认 async：不等 handler 完成（不阻塞），但 handler 会被发起', async () => {
    const bus = new EventBus();
    const started: string[] = [];
    let finished = false;
    bus.subscribe(DomainEventName.RelationCreated, async () => {
      started.push('started');
      await delay(10);
      finished = true;
    });
    await bus.publish(makeEvent());
    expect(started).toEqual(['started']);
    expect(finished).toBe(false);
    await delay(30);
    expect(finished).toBe(true);
  });

  it('没人订阅的事件：publish 不报错、无副作用', async () => {
    const bus = new EventBus();
    await expect(bus.publish(makeEvent(DomainEventName.ContractSigned))).resolves.toBeUndefined();
  });

  it('退订函数生效（退订后收不到）', async () => {
    const bus = new EventBus();
    const received: DomainEvent[] = [];
    const unsubscribe = bus.subscribe(
      DomainEventName.RelationClaimed,
      (event) => {
        received.push(event);
      },
      { delivery: 'sync' },
    );
    await bus.publish(makeEvent(DomainEventName.RelationClaimed));
    expect(received).toHaveLength(1);
    unsubscribe();
    await bus.publish(makeEvent(DomainEventName.RelationClaimed));
    expect(received).toHaveLength(1);
  });

  it('sync handler 失败 → publish 直接抛给发射方（不吞）', async () => {
    const bus = new EventBus();
    bus.subscribe(
      DomainEventName.RelationReleased,
      () => {
        throw new Error('落库失败');
      },
      { delivery: 'sync' },
    );
    await expect(bus.publish(makeEvent(DomainEventName.RelationReleased))).rejects.toThrow('落库失败');
  });

  it('async handler 失败 → 不影响发射方，错误交 onAsyncError 兜底（同步抛 / 返回 rejected 两种都兜住）', async () => {
    const errors: unknown[] = [];
    const bus = new EventBus({ onAsyncError: (error) => { errors.push(error); } });
    bus.subscribe(DomainEventName.PaymentReceived, () => {
      throw new Error('同步抛');
    });
    bus.subscribe(DomainEventName.PaymentReceived, async () => {
      throw new Error('异步 reject');
    });
    await expect(bus.publish(makeEvent(DomainEventName.PaymentReceived))).resolves.toBeUndefined();
    await delay(0);
    expect(errors).toHaveLength(2);
    expect((errors[0] as Error).message).toBe('同步抛');
    expect((errors[1] as Error).message).toBe('异步 reject');
  });

  it('async handler 失败不影响同事件的其它订阅者', async () => {
    const errors: unknown[] = [];
    const bus = new EventBus({ onAsyncError: (error) => { errors.push(error); } });
    const received: string[] = [];
    bus.subscribe(DomainEventName.CollaborationGranted, async () => {
      await delay(0);
      throw new Error('后台炸了');
    });
    bus.subscribe(
      DomainEventName.CollaborationGranted,
      () => {
        received.push('ok');
      },
      { delivery: 'sync' },
    );
    await bus.publish(makeEvent(DomainEventName.CollaborationGranted));
    await delay(10);
    expect(received).toEqual(['ok']);
    expect(errors).toHaveLength(1);
  });

  it('未登记的事件名编不过（防手滑写错；由 `tsc --noEmit` 卡住）', () => {
    const bus = new EventBus();
    // @ts-expect-error 未在 DomainEventName 登记的事件名必须编不过
    const unsubscribe = bus.subscribe('RelationCreatedd', () => undefined);
    expect(typeof unsubscribe).toBe('function');
  });
});
