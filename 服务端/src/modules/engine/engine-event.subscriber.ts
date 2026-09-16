// =============================================================================
// D 域事件订阅（M4-11）—— 别人做完事，本域该落什么
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM架构设计说明》§5.3 首批跨域事件清单：
//       `RelationCreated` ＝ **C 发 → D 落首条 `action_event`（建档）**。
//       ⚠ 本文件**只订这一个**：别的九条各有归属里程碑，**不提前订阅**（订了没处理就是空跑）。
//   · 同 §5.2 跨域路之②：订阅方决定投递方式 —— 本域选**默认 `async`（不等结果）**，
//     理由：C 域激活关系**没理由等 D 域写快照**（建档事件落库慢一秒，不影响激活成功）。
//     若改 `sync`，D 域的写库失败会顺着 `publish` 抛回 C 域 —— 那时关系已经提交了，
//     请求却报 500，等于「成功的事被报成失败」。
//
// ★ 为什么要单独一个类（而不是塞进 `EngineService`）：
//   订阅是**装配行为**（`onModuleInit` 注册、`onModuleDestroy` 退订），跟业务编排不是一回事；
//   放进 service 会让「service 只管编排」这条分层口径出现例外。
//
// ★ 退订是**必须**的：事件总线在**单测 / 热重载**里会被同一个进程反复初始化，
//   不退订就会重复注册（同一条建档事件被写两次）—— 幂等键能兜住写入，
//   但兜不住「记忆泄漏 + 重复执行」，故这里老老实实退订。
// =============================================================================
import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';

import {
  DomainEventName,
  // ⚠ `EventBus` 必须**值导入**：构造函数注入靠 `design:paramtypes`，类型导入会被擦除
  //   → 元数据变成 `Function` → 起服即「依赖解析失败」（同 C 域注记）。
  EventBus,
  type DomainEvent,
  type Unsubscribe,
} from '../../kernel/index';
import { EngineService, type RelationCreatedPayload } from './engine.service';

@Injectable()
export class EngineEventSubscriber implements OnModuleInit, OnModuleDestroy {
  private unsubscribe: Unsubscribe | undefined;

  constructor(
    private readonly events: EventBus,
    private readonly engine: EngineService,
  ) {}

  onModuleInit(): void {
    this.unsubscribe = this.events.subscribe<RelationCreatedPayload>(
      DomainEventName.RelationCreated,
      (event: DomainEvent<RelationCreatedPayload>) => this.engine.recordRelationCreated(event),
      { delivery: 'async' },
    );
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }
}
