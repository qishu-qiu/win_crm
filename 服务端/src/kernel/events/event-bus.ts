// =============================================================================
// 进程内领域事件总线（M0-29）—— pub / sub，订阅时**标注**同步 or 异步投递
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM架构设计说明》§5.2 跨域三条路之②：「我做完一件事，别人可能关心，
//     但**我不等结果** → 发领域事件」→ 故**默认投递＝`async`（不阻塞发射方）**。
//   · 同 §5.3 尾注：事件只带最小信息；拿到事件后要更多数据**回查对方 service**。
//   · 同 §六「消息队列」行：**进程内事件总线够用，接口先定好，将来换 MQ 不改业务代码**
//     → 故本类只暴露 `subscribe` / `publish` 两个方法，换实现不动调用方。
//   · CONSTRAINTS §二.5：跨域只走 service / 领域事件，**禁止跨域大事务** —— 默认 `async` 亦符合此约束。
//
// 分层约束（架构 §5.4）：`kernel/**` 零业务 —— 本文件**不许 import `modules/*`**，
// 也**刻意不 import `@nestjs/*`**（不用 `@Injectable`）：纯类更好测，DI 装配交给 M0-31 / app.module。
// =============================================================================
import type { DomainEvent, DomainEventNameValue, DomainEventPayload } from './domain-event';

/**
 * 投递方式（订阅时**必须想清楚**）：
 * · `sync`：`publish` 等它跑完（按注册顺序）——顺序有保证、失败直接抛给发射方；
 * · `async`：发出即返回，不等结果（默认）——失败不影响发射方，走 `onAsyncError` 兜底。
 */
export type DeliveryMode = 'sync' | 'async';

export type DomainEventHandler<TPayload = DomainEventPayload> = (
  event: DomainEvent<TPayload>,
) => void | Promise<void>;

/** 内部存储：擦掉 payload 泛型（订阅方按事件名自行保证类型；见 `publish` 处说明） */
type StoredHandler = (event: DomainEvent<never>) => void | Promise<void>;

interface Subscription {
  readonly handler: StoredHandler;
  readonly delivery: DeliveryMode;
}

export interface SubscribeOptions {
  /** 不传 ＝ `async`（不阻塞；→ 架构 §5.2「我不等结果」） */
  delivery?: DeliveryMode;
}

export interface EventBusOptions {
  /** 异步投递失败的兜底（默认 `console.error`）；日志设施落地后由调用方注入替换 */
  onAsyncError?: (error: unknown, event: DomainEvent<never>) => void;
}

/** 退订函数 */
export type Unsubscribe = () => void;

/** 兜底只做「不静默丢」——绝不 `catch {}` 把后台异常吞掉 */
function defaultAsyncErrorReporter(error: unknown, event: DomainEvent<never>): void {
  console.error(`[EventBus] 异步事件处理失败：${event.name}`, error);
}

export class EventBus {
  private readonly subscriptions = new Map<DomainEventNameValue, Subscription[]>();

  private readonly onAsyncError: (error: unknown, event: DomainEvent<never>) => void;

  constructor(options: EventBusOptions = {}) {
    this.onAsyncError = options.onAsyncError ?? defaultAsyncErrorReporter;
  }

  /**
   * 订阅事件；返回**退订函数**（测试 / 模块销毁时务必调用，避免重复注册）。
   * 同一事件可多次订阅，投递按**注册顺序**进行。
   */
  subscribe<TPayload = DomainEventPayload>(
    name: DomainEventNameValue,
    handler: DomainEventHandler<TPayload>,
    options: SubscribeOptions = {},
  ): Unsubscribe {
    const subscription: Subscription = { handler, delivery: options.delivery ?? 'async' };
    const list = this.subscriptions.get(name);
    if (list === undefined) {
      this.subscriptions.set(name, [subscription]);
    } else {
      list.push(subscription);
    }
    return () => {
      const current = this.subscriptions.get(name);
      if (current === undefined) return;
      const index = current.indexOf(subscription);
      if (index >= 0) current.splice(index, 1);
    };
  }

  /**
   * 发布事件：按注册顺序投递。
   * · `sync` 的 handler **被 `await`**，异常直接抛给调用方；
   * · `async` 的 handler **立即发起但不等完成**（其同步段照常执行），异常走 `onAsyncError`，不影响本次 `publish`。
   *
   * ⚠ 因为默认 `async` 的 handler 在**发射方事务之外**执行，handler 内**不得**假设发射方事务还在、更不得依赖它回滚。
   */
  async publish<TPayload = DomainEventPayload>(event: DomainEvent<TPayload>): Promise<void> {
    const list = this.subscriptions.get(event.name);
    if (list === undefined || list.length === 0) return;
    // 快照：handler 内部再 subscribe / 退订，也不会打乱本次投递
    for (const subscription of [...list]) {
      // 存储时用 `never` 逆变擦除泛型；此处按事件的真实类型还原（安全：订阅方提供同事件的 handler）
      const stored = event as DomainEvent<never>;
      if (subscription.delivery === 'sync') {
        await subscription.handler(stored);
      } else {
        this.fireAndForget(subscription.handler, stored);
      }
    }
  }

  private fireAndForget(handler: StoredHandler, event: DomainEvent<never>): void {
    try {
      void Promise.resolve(handler(event)).catch((error: unknown) => {
        this.onAsyncError(error, event);
      });
    } catch (error: unknown) {
      // handler 同步段就抛了（根本没返回 Promise）
      this.onAsyncError(error, event);
    }
  }
}
