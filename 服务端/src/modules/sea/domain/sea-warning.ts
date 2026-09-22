// =============================================================================
// F 域纯函数：掉海预警（M7-04）—— **三档阈值判定** ＋ 规则解析 ＋ 倒计时锚点
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM业务需求文档》§6.3「预警节奏（三级，硬约束，永远置顶，仅作用于 私海→公海 这一步）」：
//       倒计时 ≤3 天 → 进入今日动线；**到期前 1 天** → 推送销售；**到期当天** → 标红 + 推送部门经理；
//       **到期日已过** → 执行掉落回公司公海，写 `sea_record`。
//     ★ **2026-09-21 口径变更（七叔：「最小单元是天，系统是助手不是催命系统」）**：
//       三档与掉落**一律按自然日判定**，原「到期前 24 小时 / 6 小时」两档**作废**
//       （→《废止口径登记表》**#41** / 数据架构 §十二）。**本文件不再有任何"小时"阈值。**
//     ⚠ **末行（掉落）不在本文件的写路径里**：本文件**不产生任何写动作**、也**不判"该不该掉"**
//       —— 真掉 ＋ `sea_record` ＋ reason 码在 `sea.service.ts` 的 `dropRelation`（M9-F）。
//   · 《销售CRM数据架构文档》F1（`sea_rule` L1-L4）：`level`(1=全局 2=产品线 3=部门 4=部门×产品线)
//       ＋ `follow_freq_days` / `deal_cycle_days` / `stay_days` / `no_progress_max`
//       ＋ `effective_from`（改天数走 **7 天缓冲**）＋ `status`；**命中解析 L4→L1 取第一条**。
//   · 同 §十二（定时任务清单）「掉海预警（私海→公海）｜**每日**｜按 sea_rule」；
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
//
// ★ **2026-09-22 起本文件多一个消费方：列表页的 `drop_in_x_days`**（→ 接口 §4.4 / §5.6，
//   由聚合层 `relation-aggregate` 拼装）。它取的是 `countDaysUntilDrop` —— 也就是分档用的**同一个数**，
//   故"天数"这个口径**依然只有本文件一处**（多一个出口不等于多一份算法）。
//   ⚠ 本文件仍**不产生任何写动作**：列表页只是把"还剩几天"显示出来，不判该不该掉（→ 文件头末行）。
//
// ★ M9-F（规则配置片）起，`resolveDropDeadline` 多收一个 `ruleEffectiveFrom`（规则的生效时刻）：
//   「规则变更 → 生效时在途倒计时从生效日重新起算」（需求 §6.3 / F1）落在它身上。
//   口径与边界（含"哪些关系算重新起算"）→ `sea-rule.ts` 文件头 ★ 段。
// =============================================================================

/**
 * 三档阈值（《需求》§6.3 预警节奏表**逐条对应**；**单位一律「天」**）。
 *
 * ★ 2026-09-21 起**不再有小时阈值**：口径＝「**最小单位是天，系统是助手不是催命系统**」
 *   （→《废止口径登记表》#41）。三者都是**"距到期日还有几天"**（自然日）：
 *   `0` ＝ 到期当天、`1` ＝ 到期前一天、`3` ＝ 还剩三天。
 */
export const SEA_WARNING_THRESHOLDS = {
  /** 距到期 ≤3 天 → 进入今日动线 */
  agendaDays: 3,
  /** 距到期 1 天（＝到期前一天）→ 推送销售 */
  notifyOwnerDays: 1,
  /** 距到期 0 天（＝**到期当天**）→ 标红 + 推送部门经理 */
  alertManagerDays: 0,
} as const;

/**
 * 预警档（**由急到缓**排列；`none` ＝ 还没进任何一档）。**按自然日判定**（见文件头 ★）。
 * ★ `overdue` ＝ **到期日已过**（次日就该掉落 —— 掉落由 M9-F 的 service 执行，见文件头 ⚠）。
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

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * **自然日的唯一落点**：`Asia/Shanghai`（固定 **+08:00**、无夏令时 —— 中国大陆自 1991 年起不用夏令时，
 * 故"加 8 小时再整除一天"就是准确的北京时间日界）。
 *
 * ★ 为什么需要它（而不是直接比毫秒）：口径是「**最小单位是天**」（需求 §6.3 / 废止口径 #41）——
 *   "到期当天"指的是**日历上的那一天**：客户 09-20 14:00 到期，09-20 23:59 仍算"到期当天"，
 *   而 09-21 00:01 就是"到期日已过"（该掉）。用毫秒差算会把这两者揉在一起。
 * ★ 为什么按北京时间而不是 UTC：判定要落在**人上班的那个日历日**上（数据架构 §十二 同注）——
 *   按 UTC 日界的话，北京时间 08:00 前都还属于"UTC 的前一天"，与"今天到期"的直觉不符
 *   （D-54 的"UTC 存、出口换算"是**存储**口径，两者不冲突）。
 */
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

/** 某个时刻所在的自然日序号（Asia/Shanghai）；序号差即"相差几天" */
function shanghaiDayIndex(at: Date): number {
  return Math.floor((at.getTime() + SHANGHAI_OFFSET_MS) / MS_PER_DAY);
}

/**
 * **距掉海还剩几个自然日**（Asia/Shanghai）—— 天数的**唯一落点**。
 *
 * · `0` ＝ 到期当天；`1` ＝ 到期前一天；负数 ＝ **到期日已过**（次日该掉）；>`0` 的其余值＝还有几天
 * · 判据是「**两个时刻各落在哪个自然日**」的差 —— 不看还剩几小时几分（口径＝最小单位是天）
 *
 * ★ 为什么单列出来（而不是让各调用方自己算日差）：**分档**（`classifySeaWarning`）与
 *   **出参字段**（接口 §4.4 / §5.6 的 `drop_in_x_days`，由 M9-F 桥③ 聚合层拼）取的是**同一个数**。
 *   各算各的 ⇒ 列表上写着「2 天后」、扫描却按「3 天」分档（本项目一号坑：同一事实两个落点）。
 *   ⇒ 分档函数**也走本函数**（见下），两处**永远同一个数**。
 */
export function countDaysUntilDrop(input: { dropAt: Date; now: Date }): number {
  return shanghaiDayIndex(input.dropAt) - shanghaiDayIndex(input.now);
}

/**
 * 三档阈值判定（M7-04 的**核心纯函数**）。
 *
 * 判定方式＝先取**距掉海的日差**（`countDaysUntilDrop`，**口径同上面那处，不另算一遍**）：
 * ```
 * 日差 < 0   → overdue        到期日已过（次日掉落）
 * 日差 = 0   → alert_manager  到期当天：标红 + 推部门经理
 * 日差 = 1   → notify_owner   到期前 1 天：推销售
 * 日差 ≤ 3   → agenda         进今日动线
 * 其余       → none
 * ```
 * ★ 边界是**闭区间**（正好 3 天、正好 1 天、正好当天都**算命中**）：少判一天就会漏掉一个客户，
 *   而多提示一次只是多一条提醒，代价不对等。
 * ★ 档位从急到缓逐级降：`overdue` → `alert_manager` → `notify_owner` → `agenda` → `none`。
 */
export function classifySeaWarning(input: { dropAt: Date; now: Date }): SeaWarningTier {
  const daysLeft = countDaysUntilDrop(input);

  if (daysLeft < SEA_WARNING_THRESHOLDS.alertManagerDays) return 'overdue';
  if (daysLeft === SEA_WARNING_THRESHOLDS.alertManagerDays) return 'alert_manager';
  if (daysLeft === SEA_WARNING_THRESHOLDS.notifyOwnerDays) return 'notify_owner';
  if (daysLeft <= SEA_WARNING_THRESHOLDS.agendaDays) return 'agenda';
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
 * ★ **规则生效 ⇒ 倒计时重新起算**（需求 §6.3「规则变更的 7 天缓冲」/ 数据架构 F1 同句）：
 *   锚点再与规则的 `effective_from` 取**较晚者** —— 规则刚生效那一刻，受它约束的在途关系
 *   锚点被抬到生效日 ⇒ 到期时刻＝生效日 + N 天，**每个客户至少再给一整轮**（＝7 天缓冲买到的效果）。
 *   老规则（`effective_from` 远在过去）取不到更晚 ⇒ 行为与从前**逐字一致**（不改历史语义）。
 *   ⚠ 「重新起算」的集合是**受该规则约束的关系**（不是字面"全库在途"）——理由见
 *     `sea-rule.ts` 文件头 ★ 段（那一段同时解释了为什么字面全局重算在本数据模型里无处落）。
 *
 * ★ **返回值是"精确时刻"，但消费方按「自然日」判档**（`classifySeaWarning`）：到期**日**
 *   ＝ 该时刻所在的自然日（Asia/Shanghai）。加整天不会跨日界（无夏令时）⇒
 *   `日(锚点 + N×24h)` ≡ `日(锚点) + N 天`，两者口径一致，不存在"差一小时换一天"的缝。
 *
 * @returns 到期时刻；`followFreqDays` 没配（或不是正数）⇒ `null` ＝ **本片判不了这条**，
 *          由调用方计入"跳过"（**不许**用别的天数 / 默认天数顶替 —— 那等于自造口径）
 */
export function resolveDropDeadline(
  input: SeaWarningAnchor & { followFreqDays: number | null; ruleEffectiveFrom: Date },
): Date | null {
  const days = input.followFreqDays;
  if (days === null || days <= 0) return null;

  const base = input.lastEventAt ?? input.createdAt;
  const anchor = base.getTime() >= input.ruleEffectiveFrom.getTime() ? base : input.ruleEffectiveFrom;
  return new Date(anchor.getTime() + days * MS_PER_DAY);
}

/**
 * 掉海原因码（→ 数据架构 **F2** `sea_record.reason` 值域；**只增不改**）。
 *
 * ★ 为什么写成常量、不散字符串：`reason` 是「客户**为什么**回到公海」的检索键 ——
 *   歪一个字母（或与 F2 漂成两套）那类历史就再也查不出来（→ 同各域 `*_AUDIT_ACTIONS` 的姿势）。
 * ★ **本片只产生 `followTimeout` 一个码**：另两条触发（成单周期超时 / 推进停滞）的锚点
 *   规格没写（→ 本文件头 ★、《欠账登记表》**D-57**），**不猜不替**。
 */
export const SEA_DROP_REASON = {
  /** 跟进频次未达标（触发①「最近 N 天无有效跟进」，锚点 ＝ `last_event_at`） */
  followTimeout: 'follow_timeout',
} as const;
