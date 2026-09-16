// =============================================================================
// 进程内领域事件总线的**装配点**（M4-11）
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM架构设计说明》§5.2 跨域三条路之②：「我做完一件事，别人可能关心，
//     但**我不等结果** → 发领域事件」（故订阅方默认 `async` 投递）。
//   · 同 §5.3 首批跨域事件清单：`RelationCreated` ＝ **C 发 → D 落首条 `action_event`（建档）**。
//     本模块只做装配，**不新增事件**（新增事件必须先改架构 §5.3）。
//   · 同 §六「消息队列」行：进程内总线够用，**接口先定好**（`subscribe` / `publish`），
//     将来换 MQ 时不动业务代码 —— 故调用方只认 `EventBus` 这个令牌。
//
// ★ 为什么是**独立 `@Global()` 模块**、而不是在某个业务域里 provide：
//   总线必须**全进程唯一一个实例** —— C 域发、D 域收，各装一个就等于「事件发给了空气」。
//   `@Global()` 让七域都不必逐个 `imports`（与 `ContextModule` 同理，架构 §5.2 把两者
//   都归为「跨域共享的横切设施」）。
//
// ★ 为什么用 `useFactory` 手搭、而不给 `EventBus` 加 `@Injectable()`：
//   `event-bus.ts` 文件头已定「**刻意不 import `@nestjs/*`**：纯类更好测」——
//   本文件是**装配层**，加装饰器属于把框架依赖塞进那张纯类，故令牌 + 工厂在这里解决。
// =============================================================================
import { Global, Module } from '@nestjs/common';

import { EventBus } from './event-bus';

/** 事件总线模块：`@Global()`；真正的装配发生在根模块（`app.module.ts`，M0-49） */
@Global()
@Module({
  providers: [{ provide: EventBus, useFactory: () => new EventBus() }],
  exports: [EventBus],
})
export class EventBusModule {}
