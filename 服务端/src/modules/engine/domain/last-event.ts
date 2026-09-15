// =============================================================================
// D 域纯规则（M4-05）—— 「**只有有效沟通**才回写 `business_relation.last_event_at`」
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM数据架构文档》V1.31 C1：`last_event_at` ＝ 最近一次「**有效沟通**」事件时间
//     （**快速标记不计入**，见 D2）—— INDEX 供预警扫描与掉海倒计时。
//   · 同 D2「★ 快速标记口径」：⚠ **快速标记『不』更新 `last_event_at`**；
//     实现＝「回写逻辑中**排除** outcome ∈ 三型 quick_mark 的事件」。
//   · 《销售CRM业务需求文档》§6.3 / §10.2：这条是**防刷**的闸门 ——
//     否则销售每天对 100 个客户点一下快速标记，所有客户永不掉海。
//
// ★ 为什么单独一个文件（而不是并进 `event-effective.ts`）：
//   「什么算有效沟通」是**事件语义**（D2），「要不要回写关系上的时间」是**回写策略**（C1 的字段）。
//   两件事的规格出处不同、将来各自演进（如将来加「系统事件不回写」），合成一个函数会互相绑死。
//
// ★ 为什么**不**在这里判「比库里的时间新才写」：规格只说「最近一次有效沟通事件时间」，
//   没写「补录旧事件时不回退」。按字面实现＝直接写（→ 铁律坑 23：模糊处按最直白的字面读法，
//   不加码）；要不要防回退属**待确认项**，不由本批拍板。
//
// 分层约束（架构 §5.4）：`domain/**` 与框架 / ORM 解耦 —— 不 import `@nestjs/*` / `@prisma/client`。
// =============================================================================
import { isEffectiveCommunication } from './event-effective';

/** 回写决策（service 据此决定「要不要调 C 域回写 `last_event_at`」） */
export type LastEventUpdateDecision = {
  /** 是否回写（**快速标记＝ false**，→ M4-05 判据本体） */
  shouldUpdate: boolean;
  /** 要写进去的时间（＝事件发生时间 `event_at`）；`shouldUpdate=false` 时为 `null` */
  eventAt: Date | null;
};

/**
 * 这次事件要不要回写关系的 `last_event_at`。
 *
 * ★ 只看 `outcome`（事件自身的语义），**不看**关系当前状态、也不查库 —— 纯函数才测得住。
 */
export function decideLastEventUpdate(input: {
  outcome: string | null | undefined;
  eventAt: Date | null;
}): LastEventUpdateDecision {
  if (!isEffectiveCommunication(input.outcome)) return { shouldUpdate: false, eventAt: null };
  if (input.eventAt === null) return { shouldUpdate: false, eventAt: null };
  return { shouldUpdate: true, eventAt: input.eventAt };
}
