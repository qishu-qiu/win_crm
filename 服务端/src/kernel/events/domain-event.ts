// =============================================================================
// 领域事件定义（M0-28）—— 10 个约定事件名常量 ＋ 事件基类形状
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM架构设计说明》§5.3「首批要落地的跨域事件清单」——
//     本文件的 10 个事件名**一字不改照抄该表**（含「谁发 / 谁听 / 干什么」）。
//   · 同 §5.3 尾注：「事件只带**最小信息**（谁、什么时候、对哪个对象做了什么）」→ 基类只留
//     `actorId`（谁）/ `occurredAt`（什么时候）/ `aggregateId`（对哪个对象）/ `payload`（做了什么）；
//     拿到事件后要更多数据，**回查对方的 service**，不把对方的表结构塞进事件里。
//   · ID 类型 `bigint`：46 张表主键统一 `BigInt @db.UnsignedBigInt`（schema.prisma）。
//
// 分层约束（架构 §5.4）：`kernel/**` 零业务 —— 本文件**不许 import `modules/*`**。
// =============================================================================

/**
 * 首批跨域事件名（→ 架构 §5.3，共 10 个）。
 * ★ 新增事件必须**先改架构 §5.3**再改这里（不得自行补全跨域事件）。
 */
export const DomainEventName = {
  /** C 发 → D 落首条 action_event（建档） */
  RelationCreated: 'RelationCreated',
  /** C 发 → D 落事件；**回退时**发经理 stage_revert 知会 */
  RelationStageAdvanced: 'RelationStageAdvanced',
  /** F / C 发 → D 落事件 ＋ A 通知 ＋ E 关系状态回写（掉海 / 判死 / 流失） */
  RelationReleased: 'RelationReleased',
  /** F 发 → D 落事件 ＋ A 通知前 owner（领公海） */
  RelationClaimed: 'RelationClaimed',
  /** D 发 → C **有效沟通才**回写 last_event_at（快速标记不算） */
  ActionEventRecorded: 'ActionEventRecorded',
  /** E 发 → D 落事件 ＋ C 阶段推进 ＋ 老客户徽标 */
  ContractSigned: 'ContractSigned',
  /** E 发 → D 落事件 ＋ C 触发客户等级重算 */
  PaymentReceived: 'PaymentReceived',
  /** G 发 → 各域执行审批通过后的动作（转交 / 解锁） */
  ApprovalApproved: 'ApprovalApproved',
  /** G 发 → 各域执行驳回后的动作（规格与 `ApprovalApproved` 并列，故同为独立事件名） */
  ApprovalRejected: 'ApprovalRejected',
  /** G 发 → C 写入 `relation_member.collaborator` */
  CollaborationGranted: 'CollaborationGranted',
} as const;

export type DomainEventNameValue = (typeof DomainEventName)[keyof typeof DomainEventName];

/** 事件最小载荷（→ §5.3 注：不塞对方的表结构；用不到就不传） */
export type DomainEventPayload = Readonly<Record<string, unknown>>;

/** 领域事件基类形状：谁 / 什么时候 / 对哪个对象 / 做了什么 */
export interface DomainEvent<TPayload = DomainEventPayload> {
  readonly name: DomainEventNameValue;
  /** 操作人 `employee.id`；**系统动作 / 定时任务填 `0n`**（→ schema.prisma `operation_log.operator_id`：系统动作=0） */
  readonly actorId: bigint;
  /** 何时发生（由发射方给，便于补录 / 重放） */
  readonly occurredAt: Date;
  /** 对哪个对象（聚合根 id，如 `business_relation.id` / `contract.id`）；纯通知类事件可省 */
  readonly aggregateId?: bigint;
  /** 做了什么的最小信息 */
  readonly payload: TPayload;
}

export interface CreateDomainEventInput<TPayload = DomainEventPayload> {
  name: DomainEventNameValue;
  actorId: bigint;
  payload: TPayload;
  aggregateId?: bigint;
  /** 缺省 `new Date()`；补录 / 重放 / 单测可显式给，保证可重复 */
  occurredAt?: Date;
}

/** 造事件：统一补齐 `occurredAt`，并保证「没给的字段**不出现该键**」（日志 / 断言都干净） */
export function createDomainEvent<TPayload = DomainEventPayload>(
  input: CreateDomainEventInput<TPayload>,
): DomainEvent<TPayload> {
  const base: DomainEvent<TPayload> = {
    name: input.name,
    actorId: input.actorId,
    occurredAt: input.occurredAt ?? new Date(),
    payload: input.payload,
  };
  return input.aggregateId === undefined ? base : { ...base, aggregateId: input.aggregateId };
}
