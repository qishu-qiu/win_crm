// =============================================================================
// F 域服务（F-01 公海「领取到私海」＋ M7-03 掉海预警 ＋ **M9-F 真掉海**）—— **只做编排**
//
// 分层约束（架构 §5.4）：service **只做编排**（多步 / 跨域取引用 / 发领域事件），
//   **不写业务规则**（角色 / 范围 / 定位 / 原子性全在 C 域出口与 C 域 `domain/`）、
//   **不写 SQL**（在 `sea.repository.ts`）。
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM数据架构文档》§十二（定时任务）：「掉海预警（私海→公海）｜每小时｜按 sea_rule：
//     ≤3 天进动线；到期前 24h 推销售；6h 标红+推经理；超期落 sea_record 转公司公海」——
//     ★ 末句"超期落 sea_record"＝ **M9-F 真掉海**（`scanSeaWarning` 的 `overdue` 档 → `dropRelation`）；
//       M7-05 当时刻意只告警、不真掉，那一层的判据由 M9-F 接棒（写法沿革见 `scanSeaWarning` 方法头）；
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
  // ⚠ `AuditService` / `EventBus` 必须**值导入**（不能写 `type Xxx`）：Nest 靠 `design:paramtypes`
  //   元数据注入，类型导入会被编译期擦除 → 元数据退化成 `Function` → 启动即报「依赖解析失败」（→ 铁律坑 31）。
  AuditService,
  createDomainEvent,
  DomainEventName,
  EventBus,
  ErrorCode,
  getRequestContext,
  jsonToBigint,
  type RequestContext,
} from '../../kernel/index';
import { OrgService } from '../org/org.service';
import {
  RelationService,
  type SeaWarningCandidate,
  type RelationVo,
} from '../relation/relation.service';
import { SeaRepository } from './sea.repository';
import {
  canManageSeaRule,
  canReadSeaRules,
  countAffectedCustomers,
  isScopeConsistent,
  resolveEffectiveFrom,
  resolveSeaRuleReadDeptIds,
  type SeaRuleScope,
  type SeaRuleViewer,
} from './domain/sea-rule';
import {
  classifySeaWarning,
  resolveDropDeadline,
  resolveSeaRuleFor,
  SEA_DROP_REASON,
  SEA_WARNING_HIT_TIERS,
  type SeaRuleLike,
  type SeaWarningTier,
  type SeaWarningTierCounts,
} from './domain/sea-warning';
import type { ClaimSeaRelationDto, UpdateSeaRuleDto } from './dto/sea-request.dto';

/**
 * F 域写动作的审计动作名（→ A10 口径 `模块.动词`；2026-09-20 定）。
 * ★ 集中一处导出（同 A / B / C / D 域）：动作名是「谁在何时干了什么」的检索键，
 *   写歪一次就再也查不到那条记录。**只增不改**：改名＝历史审计断链。
 */
export const SEA_AUDIT_ACTIONS = {
  /** 领取公海客户到私海 → `POST /sea/company/:id/claim` */
  claim: 'sea.claim',
  /**
   * ★ 到期**自动掉落**回公海（M9-F；→ 数据架构 A10「已实现清单」）。
   * ⚠ **系统动作、没有 HTTP 端点**：`operator_id` 恒为 `0n`（≠ 任何员工）；
   *   一次任务写**一条**（批次明细在 `detail`，逐条状态在 `sea_record`）—— 理由见 `recordDropAudit`。
   */
  drop: 'sea.drop',
  /**
   * ★ 公海规则配置：**提交某层级规则的新版本**（`PUT /sea/rules`，M9-F 规则配置片）。
   * ⚠ 预告（`confirmed` 未传 / `false`，**零写库**）也会经同一个端点 ⇒ 配了"只看影响面"
   *   的那次调用在 `operation_log` 里**也留一条**（切面按 HTTP 方法判定，不看落没落库）——
   *   这是**有意为之**：配置页的动作本身就属敏感动作（→ 架构 §7.4），宁可多一条也不漏；
   *   落没落库看那次请求的出参 `applied`。
   */
  ruleUpdate: 'sea.rule_update',
} as const;

/**
 * 领取成功出参 ＝ **C 域列表项**（形状唯一落点）＋ `sea_record` 回填结果。
 * ★ 不在本域重抄 20 个字段：抄了就是双真相源（→ D 域 `ActivateRelationVo` 同一姿势）。
 */
export interface SeaClaimVo extends RelationVo {
  /** 本次领回时间（ISO）；**`null` ＝ 这条关系没有入公海历史**（不造行、不假装掉过海） */
  claimed_at: string | null;
}

/**
 * 一条公海规则的出参（→ 接口 §4.14.10 / §5.16）。
 * ★ 两个 key 用**实体引用**（`{id,name}`）下发：规则页要显示"哪个部门 / 哪条线"，
 *   只给 id 前端还得再查一次（引用取不到时给 `null`，**不编名字**——同 C 域的 `refOf` 取法）。
 */
export interface SeaRuleVo {
  id: bigint;
  level: number;
  dept: { id: bigint; name: string } | null;
  product_line: { id: bigint; name: string } | null;
  follow_freq_days: number | null;
  deal_cycle_days: number | null;
  stay_days: number | null;
  no_progress_max: number | null;
  effective_from: string;
  status: string;
  /** 派生：`effective_from` 还在将来 ⇒ 7 天缓冲期内、**尚未生效** */
  pending: boolean;
}

/** `PUT /sea/rules` 出参：预告 ＋（落库时）新版本行 */
export interface SeaRuleUpdateResultVo {
  applied: boolean;
  /** 本次变更将影响的**在途私海客户数**（口径 → `domain/sea-rule.ts` `countAffectedCustomers`） */
  affected_customers: number;
  effective_from: string;
  rule: SeaRuleVo | null;
}

/** 规则行的读形状（＝ `listActiveRulesForConfig` / `replaceRuleVersion` 的 select，列名出不了本层） */
interface SeaRuleRow {
  id: bigint;
  level: number;
  dept_id: bigint | null;
  product_line_id: bigint | null;
  follow_freq_days: number | null;
  deal_cycle_days: number | null;
  stay_days: number | null;
  no_progress_max: number | null;
  effective_from: Date;
  status: string;
}

/** 掉海扫描**一次**的结果（M7-03 分档 ＋ **M9-F 真掉**；判据＝日志可见扫描结果与命中数，故这里回计数） */
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
  /** ★ M9-F：本次**真的掉**了几条（关系回公海 ＋ 撤 owner ＋ 写 `sea_record`） */
  dropped: number;
  /** ★ M9-F：到期了但**没掉成**（C 域出口说"轮不到我掉"：并发下刚被领走 / 已不在私海）—— 下次扫描再看 */
  dropSkipped: number;
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
    /** 审计留痕（`@Global()` 单例）：掉海是**系统动作**，走 `recordStandalone`（→ D-68②） */
    private readonly audit: AuditService,
    /**
     * A 域（L1，**可以**依赖）：规则出参要部门 / 产品线的**名字**，而那是 A 域的表
     * （跨域不许查对方的表 → 架构 §5.2 路之①）。本域只用它的两个只读引用出口。
     */
    private readonly org: OrgService,
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

  // ===== 公海规则配置（M9-F；→ 接口 §4.14.10 / §5.16）=====

  /**
   * 看公海规则（→ 接口 §4.14.10 `GET /sea/rules`）。
   *
   * ★ **谁能看**（→ 需求 §6.3 层级 ＋《前端》§四.2 系统设置行）：老板 / 管理员看全部；
   *   部门经理看「**L1 / L2 全部**（上级兜底：看不到就解释不了"我这个部门到底按几天算"）
   *   ＋ 自己**管辖部门**的 L3 / L4」；销售与交付 · 客服 **403**（那块配置跟他们无关）。
   * ★ **含待生效行**：7 天缓冲期内的新版本行也是 `active`（F1：停用的是**旧**行）——
   *   漏了它，经理看不到自己刚提交的变更，会以为没提交上。出参用 `pending` 区分。
   * ★ 排序由仓储给（`level desc, id desc`）：高层在前，同层新版本在前。
   */
  async listSeaRules(): Promise<SeaRuleVo[]> {
    const viewer = requireViewer();
    const ruleViewer = ruleViewerOf(viewer);
    if (!canReadSeaRules(ruleViewer)) {
      throw new AppError(ErrorCode.FORBIDDEN, 403, '只有部门经理 / 总经理 / 管理员能查看公海规则', {
        constraint: 'sea.rule_read_forbidden',
      });
    }

    const rows = await this.repository.listActiveRulesForConfig(
      resolveSeaRuleReadDeptIds(ruleViewer),
    );
    const names = await this.loadRuleRefNames(rows);
    const now = new Date();

    return rows.map((row) => toRuleVo(row, names, now));
  }

  /**
   * 提交某层级公海规则的**新版本**（→ 接口 §4.14.10 `PUT /sea/rules`）。
   *
   * 六步（顺序即语义，别调换）：
   *   ① **层级与 key 搭配**校验（`isScopeConsistent`）—— 搭配错了库不会拦，只会静默失配 ⇒ 400；
   *   ② **谁能配这一层**（`canManageSeaRule`：老板 / 管理员任意层；部门经理限管辖部门的 L3 / L4）⇒ 403；
   *   ③ **引用存在性**（部门 / 产品线打错 → 400，而不是撞外键冒 500）；
   *   ④ **预告**（`countAffectedCustomers`；口径与扫描**共用** `resolveSeaRuleFor`）；
   *   ⑤ `confirmed !== true` ⇒ **到此为止**（只回预告、**零写库**）；
   *   ⑥ 落库＝**插新版本行 ＋ 旧行 `status=disabled`**（一个本域事务，→ `replaceRuleVersion`）。
   *
   * ★ 预告与落库**必须同一个 `effective_from`**（＝本次提交时刻 + 7 天）：两次算出来的
   *   判定基准不同，就会出现"预告说 3 个、落库后其实是 5 个"—— 那比不给预告更糟
   *   （经理是**照着这个数**决定要不要改的）。
   * ★ 留痕：本端点在 controller 上标 `@Audit(SEA_AUDIT_ACTIONS.ruleUpdate, 'sea_rule')`
   *   —— 写在**本域**（配置动作的发起人就是登录人），走切面；预告那次也留痕（见常量注释）。
   */
  async updateSeaRule(dto: UpdateSeaRuleDto): Promise<SeaRuleUpdateResultVo> {
    const viewer = requireViewer();
    const ruleViewer = ruleViewerOf(viewer);
    const submittedAt = new Date();

    // ① 层级与两个 key 的搭配（→ 数据架构 F1 的层级语义）
    const scope: SeaRuleScope = {
      level: dto.level,
      deptId: dto.dept_id === undefined ? null : jsonToBigint(dto.dept_id, 'dept_id'),
      productLineId:
        dto.product_line_id === undefined ? null : jsonToBigint(dto.product_line_id, 'product_line_id'),
    };
    if (!isScopeConsistent(scope)) {
      throw new AppError(
        ErrorCode.PARAM_INVALID,
        400,
        '参数错误：层级与 dept_id / product_line_id 的搭配不合法（1＝两个都不给 / 2＝只给产品线 / 3＝只给部门 / 4＝都给）',
        { constraint: 'sea.rule_scope_inconsistent' },
      );
    }

    // ② 权限（需求 §6.3 的层级归属）
    if (!canManageSeaRule(ruleViewer, scope)) {
      throw new AppError(ErrorCode.FORBIDDEN, 403, '你没有配置这一层公海规则的权限', {
        constraint: 'sea.rule_write_forbidden',
      });
    }

    // ③ 引用存在性（拿不到引用＝不存在；被逻辑删的部门 / 产品线同样视为不存在）
    const names = await this.requireRuleRefs(scope.deptId, scope.productLineId);

    // ④ 预告（口径与落库同源：同一个 effective_from ＋ 同一个规则解析）
    const effectiveFrom = resolveEffectiveFrom(submittedAt);
    const nextRule: SeaRuleLike = {
      level: scope.level,
      deptId: scope.deptId,
      productLineId: scope.productLineId,
      followFreqDays: dto.follow_freq_days ?? null,
      effectiveFrom,
    };
    const [existingRules, groups] = await Promise.all([
      // 判定基准取 `effectiveFrom`（不是"现在"）：要算的是**生效那一刻**的管辖面，
      // 而那 7 天里可能还有别的待生效版本（→ `countAffectedCustomers` 文件头 ★）
      this.repository.listActiveSeaRules(effectiveFrom),
      // 计数只在自己的可见部门内（经理看不到别部门的影响面；规则本身也只在那些部门内）
      this.relation.countPrivateSeaByDeptLine(resolveSeaRuleReadDeptIds(ruleViewer)),
    ]);
    const affected = countAffectedCustomers({ existingRules, nextRule, groups, at: effectiveFrom });
    const effectiveFromIso = effectiveFrom.toISOString();

    // ⑤ 只预告（零写库）
    if (dto.confirmed !== true) {
      return {
        applied: false,
        affected_customers: affected,
        effective_from: effectiveFromIso,
        rule: null,
      };
    }

    // ⑥ 落库（本域事务：插新版本行 ＋ 旧行 disabled）
    const created = await this.repository.replaceRuleVersion({
      level: scope.level,
      deptId: scope.deptId,
      productLineId: scope.productLineId,
      followFreqDays: dto.follow_freq_days ?? null,
      dealCycleDays: dto.deal_cycle_days ?? null,
      stayDays: dto.stay_days ?? null,
      noProgressMax: dto.no_progress_max ?? null,
      effectiveFrom,
      operatorId: viewer.employeeId,
    });

    this.logger.log(
      `公海规则变更：L${scope.level}（部门 ${scope.deptId ?? '-'} / 产品线 ${scope.productLineId ?? '-'}）` +
        `新版本 ${created.id} 将于 ${effectiveFromIso} 生效；预告影响 ${affected} 个客户`,
    );

    return {
      applied: true,
      affected_customers: affected,
      effective_from: effectiveFromIso,
      rule: toRuleVo(created, names, submittedAt),
    };
  }

  /** 批量取部门 / 产品线名字（**一次列表一次往返**，不按行查） */
  private async loadRuleRefNames(rows: readonly SeaRuleRow[]): Promise<RuleRefNames> {
    return this.requireRuleRefs(
      null,
      null,
      uniqueBigints(
        rows.flatMap((row) => (row.dept_id === null ? [] : [row.dept_id])),
      ),
      uniqueBigints(
        rows.flatMap((row) => (row.product_line_id === null ? [] : [row.product_line_id])),
      ),
    );
  }

  /**
   * 取规则要用的部门 / 产品线引用（**一个出口两种用法**）：
   *   · `deptId` / `productLineId` 给了 ⇒ **存在性校验**（拿不到引用 → **400**）；
   *   · 只给 `deptIds` / `productLineIds` 批 ⇒ 名称映射（出参装配用）。
   * ★ 合成一个方法是因为两者取的是**同一份**引用（同一趟跨域出口），分开写会出现
   *   "校验用一次、装配再查一次"的重复往返。
   */
  private async requireRuleRefs(
    deptId: bigint | null,
    productLineId: bigint | null,
    extraDeptIds: readonly bigint[] = [],
    extraProductLineIds: readonly bigint[] = [],
  ): Promise<RuleRefNames> {
    const [depts, lines] = await Promise.all([
      this.org.getDeptRefs(deptId === null ? extraDeptIds : uniqueBigints([deptId, ...extraDeptIds])),
      this.org.getProductLineRefs(
        productLineId === null ? extraProductLineIds : uniqueBigints([productLineId, ...extraProductLineIds]),
      ),
    ]);

    if (deptId !== null && depts.length === 0) {
      throw new AppError(ErrorCode.PARAM_INVALID, 400, '参数错误：dept_id 指向的部门不存在', {
        constraint: 'sea.rule_dept_missing',
      });
    }
    if (productLineId !== null && lines.length === 0) {
      throw new AppError(ErrorCode.PARAM_INVALID, 400, '参数错误：product_line_id 指向的产品线不存在', {
        constraint: 'sea.rule_product_line_missing',
      });
    }

    return { depts: toNameMap(depts), lines: toNameMap(lines) };
  }

  // ===== 掉海扫描（M7-03 分档告警 ＋ **M9-F 起 `overdue` 真掉**）=====

  /**
   * 扫一遍**所有有主关系**：按三档阈值算出"该提醒谁"，**并把已到期（`overdue`）的真的掉回公海**。
   *
   * ⚠⚠ **写法沿革（别把两片读混）**：
   *   · **M7-03 / M7-05 当时刻意"只告警、不真掉"** —— 那一层的判据逐字是「不写 `sea_record`、
   *     不清 owner」（先把"谁快到期了"扫出来，真掉海那半留到规则与出口齐备再做）；
   *   · **★ M9-F（2026-09-21）接棒**：`overdue` 档**真的掉**（→ `dropRelation`），依据 ＝
   *     需求 §6.3 掉海节奏表末行「**到期 → 执行掉落回公司公海，写历史记录（sea_record）**」。
   *   三档**告警出口动作**（推销售 / 标红推经理）**仍未接**：要 `notification`（未建，→ D-42）；
   *   「≤3 天进动线」要 **组装今日动线**那条任务（§十二，每日 05:00，未建，→ M9 jobs）
   *   —— 故本方法**不写 `daily_agenda`**（进动线不是它的事，硬写＝替那条任务下结论）。
   *
   * ★ 本方法**唯一会写业务数据的路径**是 `overdue` 档那一条 `dropRelation`（关系回公海 ＋ 撤 owner
   *   ＋ 写 `sea_record`）；`none` / `agenda` / `notify_owner` / `alert_manager` **四档一律零写**
   *   —— 它们只是"还来得及"，不该产生任何业务事实。
   *
   * ★ 规则**一条都没有**时：只 warn、不猜、不拿默认天数顶上（那等于由实现定义业务口径）——
   *   规则配置端点（接口 §4.14.10 `GET/PUT /sea/rules`）属 **M9-F 的另一片**，尚未建。
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
        dropped: 0,
        dropSkipped: 0,
        tiers,
      };
    }

    let skippedNoRule = 0;
    let skippedNoFreq = 0;
    let hits = 0;
    let dropped = 0;
    let dropSkipped = 0;
    /** 本批**真的掉**的关系 id（供审计 `detail` 追溯；→ D-68②） */
    const droppedIds: bigint[] = [];

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
      //   ★ `ruleEffectiveFrom` 进来是 M9-F 的活：规则刚生效 ⇒ 锚点抬到生效日，
      //     在途倒计时**重新起算**（每个客户至少再给一整轮，→ 需求 §6.3 / F1）
      const dropAt = resolveDropDeadline({
        lastEventAt: candidate.lastEventAt,
        createdAt: candidate.createdAt,
        followFreqDays: rule.followFreqDays,
        ruleEffectiveFrom: rule.effectiveFrom,
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

      // ④ ★ M9-F：**已到期的真的掉**（四档里只有这一档会写业务数据，→ 方法头 ★）
      if (tier === 'overdue') {
        const didDrop = await this.dropRelation(candidate.id, now);
        if (didDrop) {
          dropped += 1;
          droppedIds.push(candidate.id);
        } else {
          dropSkipped += 1; // 并发下刚被领走（或已不在私海）——不是错误，下次扫描再看
        }
      }
    }

    // ⑤ ★ D-68②：本批真的掉了才写**一条**任务级审计（没有业务变更就什么都不写，→ `recordDropAudit`）
    if (dropped > 0) {
      await this.recordDropAudit(now, {
        scanned: candidates.length,
        dropped,
        dropSkipped,
        relationIds: droppedIds,
      });
    }

    this.logger.log(
      `掉海扫描完成：候选私海 ${candidates.length} 条 / 生效规则 ${rules.length} 条 → 命中 ${hits} 条` +
        `（已到期 ${tiers.overdue} / ≤6h ${tiers.alert_manager} / ≤24h ${tiers.notify_owner} / ≤3天 ${tiers.agenda}）` +
        `；★ 真掉 ${dropped} 条（未掉成 ${dropSkipped} 条）` +
        `；跳过：无规则 ${skippedNoRule} / 规则未配跟进天数 ${skippedNoFreq}`,
    );

    return {
      scanned: candidates.length,
      rules: rules.length,
      skippedNoRule,
      skippedNoFreq,
      hits,
      dropped,
      dropSkipped,
      tiers,
    };
  }

  /**
   * 真掉一条（M9-F）：**C 域出口改关系 ＋ 撤 owner** → **本域写 `sea_record`**。
   *
   * ★ 顺序与「跨域不开大事务」（架构 §5.2）：C 域那半**自己一个事务**（关系 ＋ 成员必须同生共死），
   *   本域这半排在它**之后** —— 与「领取」三步同一姿势（那边也是 C 域事务在前、F 域回填在后）。
   * ★ **顺序不可颠倒**：先写 `sea_record` 再掉关系 ⇒ 掉失败时库里就多一条"没掉过海却掉过海"的
   *   历史（凭空编业务事实，本项目一号坑）；反过来（掉了但历史没写成）最差只是**少一条记录**，
   *   关系状态本身是对的 —— 两害相权取其轻。
   * ★ 掉海**天然幂等可重跑**：掉成之后关系已 `company_sea`，下次扫描的候选（只取 `private`）
   *   不再含它 ⇒ 不会重复掉、不会重复写历史。
   *
   * @returns `true` ＝ 掉了（历史行也已写）；`false` ＝ **没掉**（C 域出口说"这条轮不到我掉"）
   */
  private async dropRelation(relationId: bigint, now: Date): Promise<boolean> {
    const result = await this.relation.dropPrivateSeaRelation(relationId);
    if (result === null) return false;

    await this.repository.createSeaRecord({
      relationId,
      ownerId: result.ownerId,
      reason: SEA_DROP_REASON.followTimeout,
      droppedAt: now,
    });
    return true;
  }

  /**
   * 记**一条**「本批掉海」的审计（D-68②；→ 架构 §7.4 ④ / 数据架构 A10）。
   *
   * ★ **为什么是"任务级一条"，不是逐条**：
   *   · 掉海一次可能改几十上百行，逐条写会把按月分区的 `operation_log` 刷成日志墙；
   *   · 「哪条关系何时掉海」在 **`sea_record`** 里已逐条可查 —— 审计表与领域史表是
   *     「**两者都写、语义与权限不同、不合并**」（数据架构 §164）：审计回答"**谁在何时干了什么**"、
   *     史表回答"**这条业务对象经历了什么**"⇒ 本条审计只承载**批次**语义，具体对象 id 进 `detail`。
   * ★ 为什么走 `recordStandalone` 而不是 `record`（事务内）：
   *   掉海的写发生在 **C 域事务**里（关系 ＋ 成员），而审计是 **F 域**的事 ⇒ 放进去就是**跨域大事务**
   *   （架构 §5.2 路之③ 只允许**本域**事务）；一次任务还可能掉多条、跨多个 C 域事务，合成不了一个。
   *   ⇒ 按架构 §7.4 ③ 的取舍走 best-effort：**审计写失败只记系统日志、绝不回滚掉海**。
   * ★ `operator_id = 0n` ＝ **系统动作**（数据架构 A10：系统动作=0）——**必须显式传**：
   *   `AuditService` 在"没传又无请求上下文"时**抛错**，正是为了不让"忘传"被静默记成系统动作。
   * ★ `occurred_at` 用任务传入的 `now`：与 `job_run_log.run_at` **同源**，两处对得上账。
   *
   * @param now 本次任务的判定基准时刻（同 `scanSeaWarning` 的入参）
   */
  private async recordDropAudit(
    now: Date,
    batch: { scanned: number; dropped: number; dropSkipped: number; relationIds: readonly bigint[] },
  ): Promise<void> {
    await this.audit.recordStandalone({
      action: SEA_AUDIT_ACTIONS.drop,
      operator_id: 0n, // ← 系统动作（无登录人）；不传且无上下文时 AuditService 会抛错
      occurred_at: now,
      detail: {
        reason: SEA_DROP_REASON.followTimeout,
        scanned: batch.scanned,
        dropped: batch.dropped,
        drop_skipped: batch.dropSkipped,
        // ⚠ 全量 id（V1 单次掉落量级＝"若干天内到期的关系数"，通常几十条内）；
        //    若将来出现单次上千条的场景，再改为"只记计数 ＋ 前 N 条"（届时 `sea_record` 仍逐条可查）
        relation_ids: batch.relationIds.map((id) => id.toString()),
      },
    });
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

/** 规则端点的"看规则的人" ＝ 角色 ＋ **管辖部门**（取 `dataScope.deptIds`，见 `SeaRuleViewer` ★） */
function ruleViewerOf(context: RequestContext): SeaRuleViewer {
  return { roleCodes: context.roleCodes, managedDeptIds: context.dataScope.deptIds };
}

/** 跨域引用映射（id 串 → 名字）；两个 key 各一份 */
interface RuleRefNames {
  readonly depts: ReadonlyMap<string, string>;
  readonly lines: ReadonlyMap<string, string>;
}

function toNameMap(refs: readonly { id: bigint; name: string }[]): Map<string, string> {
  return new Map(refs.map((ref) => [ref.id.toString(), ref.name]));
}

function uniqueBigints(ids: readonly bigint[]): bigint[] {
  return [...new Set(ids)];
}

/** id → `{id,name}`；**引用取不到给 `null`、不编名字**（同 C 域 `refOf`：已删档案 / 停用产品线取不到） */
function refOf(
  map: ReadonlyMap<string, string>,
  id: bigint | null,
): { id: bigint; name: string } | null {
  if (id === null) return null;
  const name = map.get(id.toString());
  return name === undefined ? null : { id, name };
}

/** 规则行 → 出参（`pending` 是**派生**：还没生效的版本行，前端显示"将于 X 生效"） */
function toRuleVo(row: SeaRuleRow, names: RuleRefNames, now: Date): SeaRuleVo {
  return {
    id: row.id,
    level: row.level,
    dept: refOf(names.depts, row.dept_id),
    product_line: refOf(names.lines, row.product_line_id),
    follow_freq_days: row.follow_freq_days,
    deal_cycle_days: row.deal_cycle_days,
    stay_days: row.stay_days,
    no_progress_max: row.no_progress_max,
    effective_from: row.effective_from.toISOString(),
    status: row.status,
    pending: row.effective_from.getTime() > now.getTime(),
  };
}
