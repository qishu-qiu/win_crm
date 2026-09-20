// =============================================================================
// F 域服务（F-01 公海「领取到私海」＋ M7-03 掉海预警）—— **只做编排**
//
// 分层约束（架构 §5.4）：service **只做编排**（多步 / 跨域取引用 / 发领域事件），
//   **不写业务规则**（角色 / 范围 / 定位 / 原子性全在 C 域出口与 C 域 `domain/`）、
//   **不写 SQL**（在 `sea.repository.ts`）。
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM数据架构文档》§十二（定时任务）：「掉海预警（私海→公海）｜每小时｜按 sea_rule：
//     ≤3 天进动线；到期前 24h 推销售；6h 标红+推经理；超期落 sea_record 转公司公海」——
//     ⚠ 末句"超期落 sea_record"**不在本片**（M7-05：只告警、不真掉）→ `scanSeaWarning`；
//   · 《销售CRM接口API文档》§4.5：`POST /sea/company/:id/claim`（`:id` ＝ **公司 id**）；
//     §5.6 尾：**领取瞬间该关系所有 open 承诺 `owner_id` 转新 owner**（承诺随关系走，→ 需求 §8.1）。
//   · 《销售CRM架构设计说明》§3 层级：F 域与 D 域**同在 L4** ⇒ **同层禁止互相依赖**；
//     同 §5.2 跨域三条路：① 要**同步结果** → 调对方 exports 的 service（认领本体走这条）；
//     ② **不等结果** → 发领域事件（**承诺级联走这条** —— 见下方 ★）。
//   · 同 §5.3 事件清单：`RelationClaimed` ＝ **F 发 → D 落事件 ＋ A 通知前 owner**
//     （⚠ A 那半＝「通知前 owner」，**通知设施尚未落地**，故本片只发事件、无人做通知，
//       →《欠账登记表》D-42）。
//   · 数据架构 §10.2-3：抢公海＝**条件 UPDATE**（影响 1 行才算抢到，否则 409）—— 该原子性
//     在 C 域仓储的**同一条语句**里，本层不重复实现（也不该在 F 域再写一遍）。
//
// ★ 三步的先后与「为什么不跨域开事务」（§5.2 路之③ 只允许**本域**事务）：
//   ① **认领本体**（C 域出口，它自带一个 C 域本域事务：条件 UPDATE ＋ owner 成员 ＋ 阶段留痕）；
//   ② **回填 `sea_record`**（**本域的表**）—— 必须排在①**之后**：没抢到就不该留下「被领走」的痕迹；
//   ③ **发 `RelationClaimed`**（D 域订阅后转 open 承诺 owner）—— 必须发在**最末**：
//      它表达的语义是「这条关系已经被领成功了」，前面任何一步抛错都不该发出这个事实
//      （发早了，承诺就转给了一个没抢到的人）。
//
// ★ 为什么承诺级联**不能**由 F 域同步调 D 域出口：同层禁依赖（架构 §3）；
//   也不能反过来让 D 域编排领取（那要 D 域去碰 C 域的表）。**唯一合规路径＝领域事件**，
//   且承诺级联**不需要同步返回**（§5.2 路之② 的教科书用例）。
// =============================================================================
import { Injectable, Logger } from '@nestjs/common';

import {
  AppError,
  createDomainEvent,
  DomainEventName,
  // ⚠ `EventBus` 必须**值导入**（不能写 `type EventBus`）：Nest 靠 `design:paramtypes` 元数据注入，
  //   类型导入会被编译期擦除 → 元数据退化成 `Function` → 启动即报「依赖解析失败」（→ 铁律坑 31）。
  EventBus,
  ErrorCode,
  getRequestContext,
  jsonToBigint,
} from '../../kernel/index';
import {
  RelationService,
  type SeaWarningCandidate,
  type RelationVo,
} from '../relation/relation.service';
import { SeaRepository } from './sea.repository';
import {
  classifySeaWarning,
  resolveDropDeadline,
  resolveSeaRuleFor,
  SEA_WARNING_HIT_TIERS,
  type SeaWarningTier,
  type SeaWarningTierCounts,
} from './domain/sea-warning';
import type { ClaimSeaRelationDto } from './dto/sea-request.dto';

/**
 * F 域写动作的审计动作名（→ A10 口径 `模块.动词`；2026-09-20 定）。
 * ★ 集中一处导出（同 A / B / C / D 域）：动作名是「谁在何时干了什么」的检索键，
 *   写歪一次就再也查不到那条记录。**只增不改**：改名＝历史审计断链。
 */
export const SEA_AUDIT_ACTIONS = {
  /** 领取公海客户到私海 → `POST /sea/company/:id/claim` */
  claim: 'sea.claim',
} as const;

/**
 * 领取成功出参 ＝ **C 域列表项**（形状唯一落点）＋ `sea_record` 回填结果。
 * ★ 不在本域重抄 20 个字段：抄了就是双真相源（→ D 域 `ActivateRelationVo` 同一姿势）。
 */
export interface SeaClaimVo extends RelationVo {
  /** 本次领回时间（ISO）；**`null` ＝ 这条关系没有入公海历史**（不造行、不假装掉过海） */
  claimed_at: string | null;
}

/** 掉海预警**一次扫描**的结果（M7-03；判据＝日志可见扫描结果与命中数，故这里只回计数） */
export interface SeaWarningScanResult {
  /** 候选私海条数（＝本次真正检查过的关系数） */
  scanned: number;
  /** 生效中的规则条数（0 ⇒ 本次一条都没判，见方法内 warn） */
  rules: number;
  /** 跳过：该关系**解析不到任何规则**（部门 / 产品线没配、且没有全局兜底） */
  skippedNoRule: number;
  /** 跳过：规则里**没配跟进天数**（本片只有触发①，见 `domain/sea-warning.ts` 文件头 ★） */
  skippedNoFreq: number;
  /** 命中条数（四档之和；不含 `none`） */
  hits: number;
  /** 各档条数（**含 `none`**，便于"扫了几条、几条没事"一眼看全） */
  tiers: SeaWarningTierCounts;
}

/** 各档计数从 0 起（档位清单以 `SEA_WARNING_HIT_TIERS` ＋ `none` 为准，防漏档） */
function emptyTierCounts(): SeaWarningTierCounts {
  const counts = { overdue: 0, alert_manager: 0, notify_owner: 0, agenda: 0, none: 0 };
  for (const tier of SEA_WARNING_HIT_TIERS) counts[tier] = 0;
  return counts;
}

@Injectable()
export class SeaService {
  private readonly logger = new Logger(SeaService.name);

  constructor(
    private readonly repository: SeaRepository,
    private readonly relation: RelationService,
    private readonly events: EventBus,
  ) {}

  /**
   * 领取公海客户到我的私海（→ 接口 §4.5；`:id` ＝ 公司 id）。
   *
   * 权限 / 定位 / 原子性**一律不在本层判**（也不许判）：
   *   · 角色（管理员 / 交付 · 客服只读）、范围（销售本部门 / 经理管辖 / 总经理全部）、
   *     定位规则（三元组 ＋ `sea_status='company_sea'`）、并发抢（影响 0 行 → 409）
   *     —— 全在 **C 域出口 `claimCompanySeaRelation`** 里（那三张表是 C 域的表，改动只能它自己做）。
   *   · 本层只负责：**回填本域历史** ＋ **把「领成功」这件事发出去**（承诺级联）。
   */
  async claimCompanySeaRelation(companyId: string, dto: ClaimSeaRelationDto): Promise<SeaClaimVo> {
    // 先要上下文（缺上下文＝守卫没跑＝编程错误，给 401 而不是静默降级，→ 同 C 域 `requireViewer`）
    const viewer = requireViewer();
    const companyIdValue = jsonToBigint(companyId, 'id');
    const deptId = jsonToBigint(dto.dept_id, 'dept_id');
    const productLineId = jsonToBigint(dto.product_line_id, 'product_line_id');

    // ① 认领本体（C 域出口）：一个 C 域事务里做完「条件 UPDATE ＋ owner 成员 ＋ 阶段留痕」
    const { relation, prevOwnerId } = await this.relation.claimCompanySeaRelation({
      companyId: companyIdValue,
      deptId,
      productLineId,
    });

    // ② 回填 `sea_record`（**本域的表**）；没有历史行 ⇒ **跳过、不造行**（→ 仓储注释 ★）
    const claimedAt = new Date();
    const latest = await this.repository.findLatestRecord(relation.id);
    if (latest !== null) {
      await this.repository.markClaimed(latest.id, {
        claimedBy: viewer.employeeId,
        claimedAt,
      });
    }

    // ③ 承诺级联（接口 §5.6 尾）走领域事件（架构 §5.2 路之②／§5.3）
    //   · 只带**最小信息**：谁（`actorId`）＋ 对哪条关系（`aggregateId`）＋ 何时（`occurredAt`）
    //     ＋ 「前主人是谁」（D 域落事件要用；A 域将来通知前 owner 也要用，§5.3）；
    //   · **不等结果**（投递方式由订阅方定，D 域选 `async`）—— 承诺晚转几十毫秒不影响领取成功。
    await this.events.publish(
      createDomainEvent({
        name: DomainEventName.RelationClaimed,
        // 领取人 ＝ 新 owner（承诺跟着他走，→ 需求 §8.1）
        actorId: viewer.employeeId,
        aggregateId: relation.id,
        occurredAt: claimedAt,
        payload: { companyId: companyIdValue, deptId, productLineId, prevOwnerId },
      }),
    );

    return { ...relation, claimed_at: latest === null ? null : claimedAt.toISOString() };
  }

  // ===== M7-03 掉海预警（**只告警、不真掉**；→ 开发计划 M7-03 / M7-05）=====

  /**
   * 扫一遍**所有有主关系**，按三档阈值算出"该提醒谁"，并把扫描结果与命中数写进日志。
   *
   * ⚠⚠ **本方法对业务数据零写**（M7-05 判据逐字：「只告警、不真掉（不写 `sea_record`、不清 owner）」）：
   *   · 不写 `sea_record`（真掉海才写，属 **M9-F**）；
   *   · 不动 `business_relation` 任何列（`sea_status` 含在内）；
   *   · 不撤 owner 成员；
   *   · **也不写 `daily_agenda`** —— 「≤3 天进动线」里的"进动线"是
   *     **组装今日动线**那条任务（§十二，每日 05:00）的事，不属本片。
   *   本方法唯一产生的记录是调用方（`JobRunner`）写的 `job_run_log` —— 那是"任务自身跑得怎么样"，
   *   不是业务数据（→ A13：两者分工固定，不可互相替代）。
   *
   * ★ 三档的**出口动作**本片一律不做：推销售 / 推经理要 `notification`（未建，→ D-42）、
   *   进动线要 `daily_agenda` 组装任务（未建，→ M9 jobs）。本片只把**扫描结果与命中数**打出来。
   *
   * ★ 规则**一条都没有**时：只 warn、不猜、不拿默认天数顶上（那等于由实现定义业务口径）——
   *   规则配置端点（接口 §4.14.10 `GET/PUT /sea/rules`）属 M9-F。
   *
   * @param now 判定基准时刻由调用方传入（本层不读系统时钟：任务时刻要与 `job_run_log.run_at` 同源）
   */
  async scanSeaWarning(now: Date): Promise<SeaWarningScanResult> {
    const tiers = emptyTierCounts();
    const rules = await this.repository.listActiveSeaRules(now);
    const candidates: SeaWarningCandidate[] = await this.relation.listSeaWarningCandidates();

    if (rules.length === 0) {
      this.logger.warn(
        `掉海预警：sea_rule 没有生效中的规则（规则配置属 M9-F）⇒ 本次一条都不判，候选 ${candidates.length} 条全部跳过`,
      );
      return {
        scanned: candidates.length,
        rules: 0,
        skippedNoRule: candidates.length,
        skippedNoFreq: 0,
        hits: 0,
        tiers,
      };
    }

    let skippedNoRule = 0;
    let skippedNoFreq = 0;
    let hits = 0;

    for (const candidate of candidates) {
      // ① 规则解析（L4→L1 取第一条，7 天缓冲已由仓储的 `effective_from <= now` 挡过一道）
      const rule = resolveSeaRuleFor(
        rules,
        { deptId: candidate.deptId, productLineId: candidate.productLineId },
        now,
      );
      if (rule === null) {
        skippedNoRule += 1;
        continue;
      }

      // ② 到期时刻（触发①「最近 N 天无有效跟进」；本片只覆盖这一条，见 domain 文件头 ★）
      const dropAt = resolveDropDeadline({
        lastEventAt: candidate.lastEventAt,
        createdAt: candidate.createdAt,
        followFreqDays: rule.followFreqDays,
      });
      if (dropAt === null) {
        skippedNoFreq += 1;
        continue;
      }

      // ③ 分档（阈值判定是纯函数，口径只有一处 → `domain/sea-warning.ts`）
      const tier: SeaWarningTier = classifySeaWarning({ dropAt, now });
      tiers[tier] += 1;
      if (tier === 'none') continue;

      hits += 1;
      // 逐条明细走 `debug`：正常班次命中数不大，排查时开日志即可看到"哪条、为谁、何时到期"
      this.logger.debug(
        `掉海预警命中：关系 ${candidate.id}（部门 ${candidate.deptId} / 产品线 ${candidate.productLineId} / owner ${candidate.ownerId ?? '-'}）到期 ${dropAt.toISOString()} → ${tier}`,
      );
    }

    this.logger.log(
      `掉海预警扫描完成：候选私海 ${candidates.length} 条 / 生效规则 ${rules.length} 条 → 命中 ${hits} 条` +
        `（已到期 ${tiers.overdue} / ≤6h ${tiers.alert_manager} / ≤24h ${tiers.notify_owner} / ≤3天 ${tiers.agenda}）` +
        `；跳过：无规则 ${skippedNoRule} / 规则未配跟进天数 ${skippedNoFreq}`,
    );

    return {
      scanned: candidates.length,
      rules: rules.length,
      skippedNoRule,
      skippedNoFreq,
      hits,
      tiers,
    };
  }
}

/** 取当前请求上下文（→ 同 C 域：缺上下文给 **401**，绝不兜底成「匿名」） */
function requireViewer() {
  const context = getRequestContext();
  if (context === undefined) {
    throw new AppError(ErrorCode.UNAUTHENTICATED, 401, '未登录或登录已过期', {
      constraint: 'sea.no_context',
    });
  }
  return context;
}
