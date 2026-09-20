// =============================================================================
// F 域纯函数：掉海预警（M7-04）—— **三档阈值判定** ＋ 规则解析 ＋ 倒计时锚点
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM业务需求文档》§6.3「预警节奏（三级，硬约束，永远置顶，仅作用于 私海→公海 这一步）」：
//       倒计时 ≤3 天 → 进入今日动线；到期前 24 小时 → 推送销售；到期前 6 小时 → 标红 + 推送部门经理；
//       到期 → 执行掉落回公司公海，写 `sea_record`。
//     ⚠ **末行不在本片**：M7 只告警、不真掉（《开发计划-V1》M7-05「只告警、不真掉」）
//       ⇒ `overdue` 在**本文件里**只是"又急又高的一档告警"，本文件**不产生任何写动作**、
//       也**不判"该不该掉"**（真掉 ＋ `sea_record` ＋ reason 码归 M9-F）。
//   · 《销售CRM数据架构文档》F1（`sea_rule` L1-L4）：`level`(1=全局 2=产品线 3=部门 4=部门×产品线)
//       ＋ `follow_freq_days` / `deal_cycle_days` / `stay_days` / `no_progress_max`
//       ＋ `effective_from`（改天数走 **7 天缓冲**）＋ `status`；**命中解析 L4→L1 取第一条**。
//   · 同 §十二（定时任务清单）「掉海预警（私海→公海）｜每小时｜按 sea_rule」；
//     同 §十二「节奏提醒」段的实现口径：**「距掉海」谓词走 `idx_sea_scan(last_event_at, sea_status)`**。
//
// ★ **本片只覆盖「跟进频次」这一条触发**（决定倒计时锚点的那一步，唯一有规格依据的取法）：
//   需求 §6.3 的掉落触发有**三条**（跟进频次未达标 / 成单周期超时 / 推进进展停滞，**满足任一**），而：
//     · 触发①「最近 N 天无有效跟进」⇒ 锚点 ＝ `last_event_at`（**只有有效沟通才更新它**，
//       快速标记不计 —— 需求 §6.3 ★ / 数据架构 D2），从没跟进过则从建档时刻起算；
//     · 数据架构 §十二 又把「距掉海」谓词**明文指向** `idx_sea_scan(last_event_at, sea_status)`；
//   ⇒ **这一条的锚点是规格给死的**，本文件按它取。
//   ⚠ 触发②「成单周期超时（激活 N 天未签约）」的「激活」＝**首轮建档还是本轮领回**、
//     触发③「N 天内阶段未向前推进一格」的「向前」**包不包含回退**（`relation_stage_log.action=rollback`）
//     —— **规格都没写**；且《开发计划-V1》§八 铁律 4 把「停滞判定」明列为 **M9-F 掉海判定**的活。
//     ⇒ 本片**不猜、不替**：只覆盖触发①，另两条登记欠账（→《欠账登记表》**D-57**）。
//
// ★ 为什么"阈值"与"算到期时刻"放同一个文件：它们**必须一起用**（先算到期、再分档），
//   分两处写就会出现"一边改了天数、另一边还在按老口径分档"的漂移。
// =============================================================================

/**
 * 三档阈值（《需求》§6.3 预警节奏表**逐条对应**）。
 * ★ 单位混用（天 / 小时）是**照抄规格的语气**，不在代码里"统一成小时"——换算写在一处：
 *   见 `hoursOf`，免得读代码的人以为阈值被改过。
 */
export const SEA_WARNING_THRESHOLDS = {
  /** 倒计时 ≤3 天 → 进入今日动线 */
  agendaDays: 3,
  /** 到期前 24 小时 → 推送销售 */
  notifyOwnerHours: 24,
  /** 到期前 6 小时 → 标红 + 推送部门经理 */
  alertManagerHours: 6,
} as const;

/**
 * 预警档（**由急到缓**排列；`none` ＝ 还没进任何一档）。
 * ★ `overdue` ＝ 已到/已过到期时刻 —— 本片**只告警**（真掉属 M9-F，见文件头 ⚠）。
 */
export type SeaWarningTier = 'overdue' | 'alert_manager' | 'notify_owner' | 'agenda' | 'none';

/** 会"命中"的档（＝真正的告警），供扫描任务按固定顺序统计 / 打日志 */
export const SEA_WARNING_HIT_TIERS = ['overdue', 'alert_manager', 'notify_owner', 'agenda'] as const;

/** 一档要报的条数（**每个档位都在**，含 `none`；缺档会让"到底扫出几条"看不全） */
export type SeaWarningTierCounts = Record<SeaWarningTier, number>;

/** 一条 `sea_rule` 里本片用得上的列（仓储只 select 这几列，其余不读进来） */
export interface SeaRuleLike {
  /** 1=全局 2=产品线 3=部门 4=部门×产品线（F1；数值**越大越优先**） */
  level: number;
  deptId: bigint | null;
  productLineId: bigint | null;
  /** 跟进频次天数（触发①；`null` ＝ 该规则没配这一项） */
  followFreqDays: number | null;
  /** 生效时刻（F1：改天数走 7 天缓冲 ⇒ **晚于 `now` 的规则尚未生效**） */
  effectiveFrom: Date;
}

/** 待告警关系的"算倒计时要用到的三点"（其余列**一律不取**：出口只给调用方要的那点信息） */
export interface SeaWarningAnchor {
  /** 最近一次**有效沟通**时间；`null` ＝ 从没跟进过（⇒ 从建档时刻起算） */
  lastEventAt: Date | null;
  /** 关系建档时刻（本轮 / 首轮不再区分，见文件头 ★） */
  createdAt: Date;
}

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/** 阈值 → 毫秒（天/小时的换算是**本文件唯一一处**，别处只许用毫秒） */
function hoursOf(hours: number): number {
  return hours * MS_PER_HOUR;
}

function daysOf(days: number): number {
  return days * MS_PER_DAY;
}

/**
 * 三档阈值判定（M7-04 的**核心纯函数**）。
 *
 * 边界取法：规格写的是「**≤3 天**」「到期前 **24 小时**」「到期前 **6 小时**」⇒ **闭区间**
 *   （正好 3 天整 / 正好 24h / 正好 6h **算命中**）—— 少判一分钟就会漏掉一个客户，
 *   而多提示一次只是多一条提醒，代价不对等。
 *
 * 档位从急到缓逐级降：`overdue` → `alert_manager` → `notify_owner` → `agenda` → `none`。
 */
export function classifySeaWarning(input: { dropAt: Date; now: Date }): SeaWarningTier {
  const remainingMs = input.dropAt.getTime() - input.now.getTime();

  if (remainingMs <= 0) return 'overdue';
  if (remainingMs <= hoursOf(SEA_WARNING_THRESHOLDS.alertManagerHours)) return 'alert_manager';
  if (remainingMs <= hoursOf(SEA_WARNING_THRESHOLDS.notifyOwnerHours)) return 'notify_owner';
  if (remainingMs <= daysOf(SEA_WARNING_THRESHOLDS.agendaDays)) return 'agenda';
  return 'none';
}

/**
 * 公海规则解析：**L4→L1 取第一条命中**（F1 逐字：「命中解析 L4→L1 取第一条」）。
 *
 * 命中条件＝**层级语义**（不是"字段相等"）：L1 全局（两个 key 都空）/ L2 产品线 / L3 部门 /
 *   L4 部门×产品线。⚠ 只认 `status='active'` **且** `effective_from <= now` 的规则 ——
 *   后者是 F1「7 天缓冲」的落点（新版本行插进来、`effective_from` 还在未来 ⇒ 这段时间**照旧用老规则**）。
 *
 * @param rows 仓储读出的规则行（**顺序不重要**：本函数自己按 `level` 排，避免"谁的 SQL 排序变了"就改口径）
 * @returns 命中的规则；一条都没有 ⇒ `null`（⇒ 调用方跳过该关系，**不许拿别的天数顶替**）
 */
export function resolveSeaRuleFor(
  rows: readonly SeaRuleLike[],
  scope: { deptId: bigint; productLineId: bigint },
  now: Date,
): SeaRuleLike | null {
  const candidates = rows
    .filter((row) => row.effectiveFrom.getTime() <= now.getTime())
    .filter((row) => matchesLevel(row, scope))
    // 同层多行（历史版本）时取 `level` 更高者；再同层按传入顺序（仓储已按新→旧排）
    .sort((a, b) => b.level - a.level);

  return candidates[0] ?? null;
}

/** 层级语义命中判定（L1 全局 / L2 产品线 / L3 部门 / L4 部门×产品线） */
function matchesLevel(
  row: SeaRuleLike,
  scope: { deptId: bigint; productLineId: bigint },
): boolean {
  switch (row.level) {
    case 4:
      return row.deptId === scope.deptId && row.productLineId === scope.productLineId;
    case 3:
      return row.deptId === scope.deptId;
    case 2:
      return row.productLineId === scope.productLineId;
    case 1:
      return row.deptId === null && row.productLineId === null;
    // 未知层级：宁可**不命中**（走全局兜底），也不许蒙一个当成命中
    default:
      return false;
  }
}

/**
 * 算出「到期时刻」（触发①，→ 文件头 ★ 为什么只有这一条）。
 *
 * 锚点 ＝ `last_event_at`（有效沟通）**否则** `created_at` —— 需求 §6.3「最近 N 天**无有效跟进**」：
 *   从没跟进过的人不是"永不掉海"，而是**从建档那一刻开始倒计时**（否则新客户永远不预警）。
 *
 * @returns 到期时刻；`followFreqDays` 没配（或不是正数）⇒ `null` ＝ **本片判不了这条**，
 *          由调用方计入"跳过"（**不许**用别的天数 / 默认天数顶替 —— 那等于自造口径）
 */
export function resolveDropDeadline(input: SeaWarningAnchor & { followFreqDays: number | null }): Date | null {
  const days = input.followFreqDays;
  if (days === null || days <= 0) return null;

  const anchor = input.lastEventAt ?? input.createdAt;
  return new Date(anchor.getTime() + days * MS_PER_DAY);
}
