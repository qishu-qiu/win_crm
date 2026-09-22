// =============================================================================
// C 域服务（M3-06 / M3-07 / M3-08 / M3-10 / M3-11）
//
// 分层约束（架构 §5.4）：service **只做编排**（多步、开事务、跨域取引用），
//   **不写业务规则**（唯一键 / 范围 / owner / 开发价值校验全在 `domain/`）、
//   **不写 SQL**（在 `relation.repository.ts`）。
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM接口API文档》§5.6（关系入参出参）、§2.2（数据范围四档）、§2.4（错误码）。
//     ⚠ 计划行 M3-10 写的是 `PATCH /relations/:id`，而 §5.6 写的是 **`PUT`** ——
//       按铁律 A（与规格冲突以规格为准）**实现 PUT**，冲突当时已在批次报告写明，按规格落地（不再欠）。
//   · 《销售CRM数据架构文档》C1 / C2（表与校验）、C7（竞品名册）。
//   · 《销售CRM架构设计说明》§5.2 跨域三条路：
//       ① 同步调对方 **exports 的 service** —— 本文件取公司 / 部门 / 产品线 / 员工引用走这条
//          （**禁止**查对方的表）；③ 改多表必须一起成功 → **本域 `$transaction`**
//          （激活＝「关系 ＋ owner 成员」两步，必须同生共死）。
//   · 同 §7.4：**所有增删改都要留痕**（2026-09-15 七叔口径：「**符合等保标准，所有的增删改
//     都有迹可查**」）—— 本域三个写动作（激活 / 改属性 / 加成员）由**统一审计切面**
//     （`shared/interceptors/audit-log.interceptor.ts`）在端点成功后自动写 `operation_log`，
//     动作名＝本文件导出的 `RELATION_AUDIT_ACTIONS`，由 controller 的 `@Audit(...)` 声明。
//     ⚠ 原文「激活 / 改属性 / 加成员都不在其中 ⇒ 本服务不写审计」**作废**：§7.4 括号里那五个
//       动作是**举例、不是穷尽清单**（把它当穷尽读＝把规格读窄，→ 铁律 §二 坑 23 同类错误）。
//   · 同 §7.5：`P2002` + `uk_active_rel` / `uk_owner` → **409**，人话由 `mapPrismaError` 给。
//
// ★ P2002 的处理姿势（与 B 域同款，两条都要）：
//   ① **预检**（先查一次）→ 覆盖 99% 的「销售手快」，给人话；
//   ② **catch 再映射**（`mapPrismaError`）→ 覆盖并发下预检漏过的竞态。
//   ⚠ 两条路径的**文案必须逐字一致**：否则同一件事（同键撞单）日常一句、并发另一句，
//     前端 / 客服话术就成了两套。单测同时钉住两条（→ `relation.service.spec.ts`）。
// =============================================================================
import { Injectable } from '@nestjs/common';

import {
  AppError,
  AuditService,
  DomainEventName,
  // ⚠ 必须是**值导入**（不能写 `type EventBus`）：Nest 靠 `design:paramtypes` 元数据注入，
  //   类型导入会被编译期擦除 → 元数据退化成 `Function` → 启动即报「依赖解析失败」。
  EventBus,
  ErrorCode,
  buildPageResult,
  createDomainEvent,
  getRequestContext,
  jsonToBigint,
  mapPrismaError,
  resolvePagination,
  type PageResult,
  type Pagination,
  type PaginationQuery,
} from '../../kernel/index';
import { PrismaService } from '../../prisma/prisma.service';
import { CompanyService } from '../company/company.service';
import { OrgService } from '../org/org.service';
import { COMPANY_SEA_STATUS, type RelationTriple } from './domain/relation-active-key';
import { checkValueTierForUrgency } from './domain/relation-attributes';
import { buildRelationListFilter, type RelationListFilter } from './domain/relation-list-filter';
import {
  COLLABORATOR_MEMBER_TYPE,
  OWNER_MEMBER_TYPE,
  checkOwnerSlot,
  findActiveOwner,
  isSameDeptForAskHelp,
  type RelationMemberLike,
} from './domain/relation-owner';
import {
  checkActivateScope,
  checkRelationRead,
  checkRelationWrite,
  checkSeaUnclaimed,
  checkSeaValueTierWrite,
  isRelationWriteRole,
  resolveRelationListScope,
  resolveVisibleCompanyScope,
  type RelationListTab,
  type RelationViewer,
  type RelationWriteDenied,
} from './domain/relation-scope';
import {
  RelationRepository,
  type RelationListOptions,
  type RelationTxClient,
} from './relation.repository';
import type {
  AddRelationMemberDto,
  CreateRelationDto,
  UpdateRelationDto,
} from './dto/relation-request.dto';

/** 关系列表项出参（→ §5.6；未落地字段见 `dto/relation-response.dto.ts` 文件头清单） */
export interface RelationVo {
  id: bigint;
  company: { id: bigint; name: string } | null;
  dept: { id: bigint; name: string } | null;
  /** 产品线引用（多一个固定配色键 `color_key`，→ 需求 §13.3 / 接口 §5.6） */
  product_line: { id: bigint; name: string; color_key: string | null } | null;
  stage: number;
  urgency: string;
  value_tier: string | null;
  customer_level: string | null;
  owner: { id: bigint; name: string } | null;
  sea_status: string;
  last_event_at: string | null;
  next_action_hint: string | null;
  competition: string | null;
  created_at: string;
  updated_at: string;
}

/** 关系成员出参（→ §5.6 `members[]`） */
export interface RelationMemberVo {
  employee: { id: bigint; name: string } | null;
  member_type: string;
  source: string | null;
  valid_until: string | null;
}

/** 关系详情 ＝ 列表项 ＋ 成员 */
export interface RelationDetailVo extends RelationVo {
  members: RelationMemberVo[];
}

/**
 * 掉海预警候选（M7-03 的跨域出口；→ 数据架构 §十二）：只给"算倒计时 ＋ 打日志"要的那几列。
 * ★ 不给公司名 / 部门名：那是给**人看**的展示口径，而本出口的调用方是**定时任务**（写日志用 id 即可）；
 *   要展示请走 `listRelations`（那边才装配名字 ＋ 范围判定）。
 */
export interface SeaWarningCandidate {
  id: bigint;
  deptId: bigint;
  productLineId: bigint;
  /** 在位 owner（`null` ＝ 成员表里没有在位 owner，理论上不该出现在私海里；跳过即可，不补数据） */
  ownerId: bigint | null;
  /** 最近一次**有效沟通**时间（`null` ＝ 从没跟进过） */
  lastEventAt: Date | null;
  createdAt: Date;
}

/**
 * 仓储行 → 掉海预警出口形状。
 *
 * ★ **扫描出口（全量）与列表派生出口（按 id）共用这一个映射**：两个出口喂给 F 域的
 *   `SeaWarningCandidate` 必须**逐字同源**（同一个字段名、同一个"没 owner 给 `null`"取法），
 *   否则会出现"定时任务按 A 取锚点、列表按 B 取锚点"——同一客户两处倒计时不一样。
 * ★ 形参写成**结构类型**（不引 Prisma 生成的类型）：本层只关心这几列，仓储 select 换法不该牵连此处。
 */
function toSeaWarningCandidates(
  rows: readonly {
    id: bigint;
    dept_id: bigint;
    product_line_id: bigint;
    last_event_at: Date | null;
    created_at: Date;
    members: readonly { employee_id: bigint }[];
  }[],
): SeaWarningCandidate[] {
  return rows.map((row) => ({
    id: row.id,
    deptId: row.dept_id,
    productLineId: row.product_line_id,
    ownerId: row.members[0]?.employee_id ?? null,
    lastEventAt: row.last_event_at,
    createdAt: row.created_at,
  }));
}

/**
 * 列表入参（分页 ＋ 筛选）：controller 从 query DTO 翻译过来。
 * ★ 这里收的是**原始视图码 / 紧迫档数组**，各档判定交给 `domain/relation-list-filter.ts`
 *   —— service 只编排、不写规则（架构 §5.4）。
 */
export interface RelationListQuery extends PaginationQuery {
  /** 视图（→ 前端文档 §5：`all` / `following` / `cooperated` / `churned`） */
  view?: string;
  /** 紧迫档多选（→ 需求 §8.2 五档） */
  urgencies?: readonly string[];
  /** 排序字段（**白名单已在 DTO 校验** → 非法 400；缺省 `id`，→ §2.7；**D-07**） */
  orderField?: string;
  /** 降序（缺省 true —— 与既有 `id desc` 一致，**不改变默认观感**；→ §2.7） */
  desc?: boolean;
  /** 关键词＝**公司名**模糊搜（→ §2.7；**D-07**） */
  keyword?: string;
}

/**
 * 列表页签（`private` / `sea`，→ 接口 §4.4）**随本 service 出口一并转出**。
 * ★ 为什么转出：`GET /relations` 已迁聚合层（聚合层要调本域的 `listRelations`），
 *   而调用方**不许自己再抄一份 `'private' | 'sea'`**（抄的那份迟早与 `domain/relation-scope.ts` 分叉）。
 */
export type { RelationListTab } from './domain/relation-scope';

/**
 * 与 `kernel/errors/prisma-error.mapper.ts` 的 `uk_active_rel` / `uk_owner` 两条**逐字一致**。
 * ★ 抽成常量是为了让「预检」和「兜底」两处**不可能**写出两句话（改一处即两处生效）。
 */
const RELATION_DUPLICATED_MESSAGE = '该公司在该部门·产品线下已有归属，请走转交或协同';
const OWNER_OCCUPIED_MESSAGE = '该业务关系已有归属销售';

/**
 * 同三元组**已有公海行**时的人话（→ 接口 §4.4 / §5.6；D-53）。
 * ★ 与「已有归属」（`RELATION_DUPLICATED_MESSAGE`）**刻意分两句**：两句指向的**下一步动作不同** ——
 *   已有**私海**该走转交 / 协同；已有**公海**该**直接领取**（走 `POST /sea/company/:id/claim`
 *   承接**同一条**关系）。挤成一句的话，销售会去点"转交"，而正确动作是把它从公海领回来。
 */
const RELATION_IN_SEA_MESSAGE = '该客户在本部门·产品线下已在公海，请直接领取（不要另建关系）';

/**
 * 公海（无主）关系被写时的人话 —— 与《接口API文档》§5.6 的 `20408` 说明**逐字一致**。
 * （写动作拒的是「**未领取**」这个状态，不是「你没权限」：故 422 而非 403。）
 */
const SEA_UNCLAIMED_MESSAGE = '该公司还在公海（未领取）：要写跟单请先领取到私海';

/** 重新领取 ⇒ **新一轮从阶段 1 开始**（→ 需求 §8.1；`relation_stage_log` 保留上一轮历史） */
const NEW_ROUND_STAGE = 1;

/** 「领取到私海」定位不到可领的关系（本就没有 / 刚刚被人领走） */
const SEA_CLAIM_NOT_FOUND_MESSAGE = '该公司在本部门 · 产品线下没有待领取的公海关系，请刷新列表';

/**
 * 「该部门未承接这条产品线」的人话 —— 与《接口API文档》§2.4 `20409` 的说明**逐字一致**。
 * ★ 报的是**组合**错，不是"你没权限"：两个 id 都真、也都在你的可建范围内，错的是
 *   「这条线不归这个部门卖」（承接关系配置在 A7 `dept_ids`，由管理员维护）。
 */
const PRODUCT_LINE_NOT_SERVED_MESSAGE = '该产品线不是这个部门承接的，请换一条产品线';

/**
 * 并发抢同一条：被同事先领走了（→ 数据架构 §10.2-3：条件 UPDATE 影响 0 行）。
 * ⚠ 与「定位不到」（400）**分两句人话**：这条是**竞态**（接口 §2.4 把"抢公海"归 409 族），
 *   那句是"本来就没有"——两件事对销售的动作不同（这里该刷新重试，那里该换个客户）。
 */
const SEA_CLAIM_RACE_MESSAGE = '这条公海客户刚刚被同事领走了，请刷新列表';

/**
 * C 域写动作的审计动作名（→ A10 口径 `模块.动词`；2026-09-15 定）。
 * ★ 与 `ORG_AUDIT_ACTIONS` 同一理由**集中一处导出**：动作名是「谁在何时干了什么」的检索键，
 *   写歪一次就再也查不到那条记录（双真相源＝本项目一号坑）。
 * ★ **只增不改**：改名＝历史审计断链；将来新增写动作时在此追加，并同步数据架构 A10 的清单。
 */
export const RELATION_AUDIT_ACTIONS = {
  /** 激活关系（＋ owner 成员）→ `POST /relations` */
  activate: 'relation.activate',
  /** 改关系属性（紧迫 / 价值档 / 下一步 / 竞品）→ `PUT /relations/:id` */
  update: 'relation.update',
  /** 加关系成员（owner / 协同 / @求助）→ `POST /relations/:id/members` */
  addMember: 'relation.add_member',
  /** 管理员查看关系详情 → `GET /relations/:id`（→ D-35：仅 `admin` 角色写 `operation_log`） */
  view: 'relation.view',
} as const;

/** @求助默认 7 天（→ C2：`dept_rule.ask_help_days` 可配；**配置化尚未排期**，本批取规格默认值） */
const ASK_HELP_DEFAULT_DAYS = 7;

@Injectable()
export class RelationService {
  constructor(
    private readonly repository: RelationRepository,
    private readonly org: OrgService,
    private readonly company: CompanyService,
    private readonly prisma: PrismaService,
    /** 领域事件总线（M4-11；`@Global()` 模块提供，故本域 `imports` 不必列出） */
    private readonly events: EventBus,
    /** 审计留痕（`@Global()` 单例；管理员读路径的 `relation.view` 走 `recordStandalone`，→ D-35） */
    private readonly audit: AuditService,
  ) {}

  // ===== M3-06 激活（关系 ＋ owner 成员，本域事务）=====

  /**
   * 激活业务关系（→ §5.6 `POST /relations`）。
   *
   * 顺序＝**先范围、再存在性、再组合、再唯一键、最后落库**：
   *   ① 范围（越权 / 只读角色）—— 最早拦，别让人用错误信息探出「这个 dept 存在不存在」；
   *   ② 三元组存在性 —— 跨域走 service 取引用（§5.2 路之①），不存在给 **400 参数错误**；
   *   ③ 「部门 × 产品线」是承接组合 —— 不是 → **422 / `20409`**（→ 架构 §7.2「可建产品线范围」/ D-74）；
   *   ④ 活跃唯一预检 —— 命中给 **409 / 20401**，**人话分两档**（私海 → 转交 / 协同；公海 → 直接领取，→ D-53）；
   *   ⑤ 事务：关系 ＋ owner 成员一起写（架构 §5.2 路之③）。
   * ★ owner ＝ **发起人自己**（激活即归属；换人走 `transfer` 审批，→ C2「主责变更」）。
   * ★ 本方法**被两处调用**：`POST /relations` 与 `POST /contacts/:id/activate-relation`
   *   （后者由 D 域编排、跨域路之①回头调本域，→ D-29）——故 ③ 两道口子**天然共用**，不会一边收一边漏。
   */
  async createRelation(dto: CreateRelationDto): Promise<RelationVo> {
    const viewer = requireViewer();
    const triple = {
      companyId: jsonToBigint(dto.company_id, 'company_id'),
      deptId: jsonToBigint(dto.dept_id, 'dept_id'),
      productLineId: jsonToBigint(dto.product_line_id, 'product_line_id'),
    };

    const activateVerdict = checkActivateScope(triple.deptId, viewer);
    if (!activateVerdict.ok) throw verdictError(activateVerdict);

    await this.requireTripleExists(triple);

    // ★ 「部门 × 产品线」必须是**配置里存在的承接组合**（→ 架构 §7.2「可建产品线范围」）：
    //   判据与录入页下拉**同源**（前端按 `dept_ids` 收敛什么，这里就放行什么）——
    //   两边不同集正是 D-74 的原始症状（界面不给选、构造请求却收下）。
    await this.requireLineServedByDept(triple.deptId, triple.productLineId);

    const conflict = await this.activeSlotConflict(triple);
    if (conflict !== null) throw conflict;

    const created = await this.prisma
      .$transaction(async (tx) => {
        const client: RelationTxClient = tx;
        const relation = await this.repository.createRelation(
          {
            company_id: triple.companyId,
            dept_id: triple.deptId,
            product_line_id: triple.productLineId,
            created_by: viewer.employeeId,
          },
          client,
        );
        await this.repository.createMember(
          {
            relation_id: relation.id,
            employee_id: viewer.employeeId,
            member_type: OWNER_MEMBER_TYPE,
            added_by: viewer.employeeId,
          },
          client,
        );
        return relation;
      })
      .catch(async (error: unknown) => {
        // 并发下预检漏过 → DB 的 `uk_active_rel` / `uk_owner` 兜底，映射成**同一句**人话
        const mapped = mapPrismaError(error);
        // ⚠ `uk_active_rel` 那档必须**与预检同源**：重查一次占位行、按 `sea_status` 分档。
        //   否则并发窗口下，销售会拿到「已有归属……走转交」—— 而正确动作其实是「去领取」（→ D-53）。
        if (mapped !== null && mapped.constraint === 'uk_active_rel') {
          throw (await this.activeSlotConflict(triple)) ?? mapped;
        }
        throw mapped ?? error;
      });

    // ⚠ 必须**读回一次**：事务里 `createRelation` 的那次 RETURNING 发生在**写 owner 成员之前**，
    //   它的 `members` 是空的 —— 拿它去装配引用会得到一个「owner 为 null」的出参
    //   （真库实测踩到过；单测的假对象也要按这个阶段造，否则抓不出来）。
    const row = await this.requireRelationRow(created.id);

    // ★ 建档事件（→ 架构 §5.3：`RelationCreated` ＝ **C 发 → D 域落首条 `action_event`**）
    //   ① **发在事务提交之后**：事务回滚了就不该有「已建档」这条事件；
    //   ② 只带**最小信息**（谁 / 对哪条关系 / 归属人），D 域要更多数据回查本域 service（§5.3 尾注）；
    //   ③ 投递方式由**订阅方**决定（D 域按默认 `async` 订阅）—— 故此处不等它落库、
    //      也不因它失败而把已经建好的关系判成失败（跨域路②＝「我不等结果」）。
    await this.events.publish(
      createDomainEvent({
        name: DomainEventName.RelationCreated,
        actorId: viewer.employeeId,
        aggregateId: created.id,
        payload: {
          companyId: triple.companyId,
          deptId: triple.deptId,
          productLineId: triple.productLineId,
          ownerId: viewer.employeeId,
        },
      }),
    );

    return this.buildVo(row, await this.loadRefs([row]));
  }

  /**
   * 同三元组的**占位行** → 该给哪句 409（★ 分两档，→ 需求 §6.3 /《欠账登记表》D-53）。
   *
   * ★ 为什么要抽成一处：**预检**（日常路径）与 **P2002 兜底**（并发路径）都要给"同一句话"
   *   （→ 本文件头「两条路径文案必须逐字一致」）。各写一遍的话，公海那档就会在并发窗口下
   *   退回成"已有归属"，把销售往"转交"上引 —— 而它该做的是**领取**。
   *
   * ★ 判据只有一条：`deleted_at IS NULL AND merged_into IS NULL`（＝ 占位，★ 2026-09-21 起
   *   **公海也占位**）—— 与 DB 生成列 `active_key` 的表达式**同源**（→ `findActiveRelation` 的 ★）。
   *
   * @returns `null` ＝ 该三元组没有占位行（可以建）；否则回一条 409 的 `AppError`
   */
  private async activeSlotConflict(triple: RelationTriple): Promise<AppError | null> {
    const occupying = await this.repository.findActiveRelation(triple);
    if (occupying === null) return null;

    // 占位行在**公海** ⇒ 引导去领取（承接同一条）；否则（私海）⇒ 引导转交 / 协同
    const message =
      occupying.sea_status === COMPANY_SEA_STATUS ? RELATION_IN_SEA_MESSAGE : RELATION_DUPLICATED_MESSAGE;
    return new AppError(ErrorCode.RELATION_DUPLICATED, 409, message, { constraint: 'uk_active_rel' });
  }

  // ===== F-01 公海「领取到私海」的跨域出口（→ 接口 §4.5 `POST /sea/company/:id/claim`；D-33）=====

  /**
   * 「领取到私海」：把「公司 × 部门 × 产品线」下的**那一条公海关系**认领给当前登录人。
   *
   * ★ 为什么这个出口在 **C 域**（而不是 F 域自己改）：认领要动的三张表
   *   （`business_relation` / `relation_member` / `relation_stage_log`）**全是 C 域的表**，
   *   跨域不许查表更不许写表（架构 §5.2）⇒ F 域只做编排 ＋ 写自己的 `sea_record`。
   *
   * ★ 三件事**一个本域事务**（架构 §5.2 路之③「多表一致性 → 本域 `$transaction`」）：
   *   ① **原子认领**：条件 UPDATE（`sea_status='company_sea'`），`count === 1` 才算抢到 ——
   *      否则 **409**（不靠"先查再改"的预检：两人同时点，预检都会过）；
   *   ② **owner 成员切换**：先撤在位 owner（掉海任务未建，公海里可能残留），再**复活或插入**新 owner
   *      （`uk_member` 不含 `revoked_at` ⇒ 曾当过该关系 owner 的人领回时只能复活，不能 INSERT）；
   *   ③ **阶段回到 1** ＋ 留痕：`stage_id` 由 ① 的那条 UPDATE 同批置 1（不拆两条语句，见仓储注释），
   *      再补一行 `relation_stage_log`（`action='normal'`、无 `reason` —— 不新造 reason 码）记录
   *      「从上一轮的阶段 X 回到新一轮阶段 1」（→ 需求 §8.1：重新领取后阶段从 1 重新开始）。
   *
   * ★ 权限＝**可写角色 ＋ 读范围**（与 D-32 的读门**同一档**，不另开一格）：
   *   销售＝本部门公海、经理＝管辖部门、总经理＝全部；**管理员（`all` 档但只读）与交付 / 客服一律拒**。
   * ★ 范围判定用**入参 `dept_id`**（不看定位结果）：否则"定位不到 = 400"与"越界 = 403"两个回包
   *   可以被拿来**反推别部门有没有这条公海**（同 `checkSeaUnclaimed` 那条「不许用 422 反推存在性」的顾虑）。
   *
   * ★ 承诺级联**不在这里**：`commitment` 是 D 域的表，而 **F / D 同层禁依赖**（架构 §3）⇒
   *   由调用方发 `RelationClaimed` 领域事件、D 域订阅后转 open 承诺 owner（架构 §5.2 路之②）。
   *
   * @returns `{relation, prevStage, prevOwnerId}`：`relation` ＝ **写完之后读回**的列表项
   *          （＝接口 §5.6 `RelationVo` 的**唯一形状**，F 域直接拿去当出参，不重抄一遍字段）；
   *          `prevStage` / `prevOwnerId` ＝ 认领前的阶段与在位 owner（公海理应 `null`），
   *          供上层组事件载荷。
   */
  async claimCompanySeaRelation(input: {
    companyId: bigint;
    deptId: bigint;
    productLineId: bigint;
  }): Promise<{ relation: RelationVo; prevStage: number; prevOwnerId: bigint | null }> {
    const viewer = requireViewer();

    // ① 角色：只读角色（管理员 / 交付 · 客服）当场拒 —— 与 `addMember` 等写动作同一条人话
    if (!isRelationWriteRole(viewer.roleCodes)) {
      throw new AppError(ErrorCode.FORBIDDEN, 403, '当前角色对业务关系只读', {
        constraint: 'relation.read_only',
      });
    }

    // ② 范围：按**入参部门**判（理由见方法头 ★）
    const scope = resolveRelationListScope('sea', viewer);
    if (scope.kind === 'denied') {
      throw new AppError(ErrorCode.FORBIDDEN, 403, '无权限：交付 / 客服不进公海', {
        constraint: 'relation.sea.denied',
      });
    }
    if (scope.kind !== 'all' && !scope.deptIds.includes(input.deptId)) {
      throw new AppError(ErrorCode.FORBIDDEN, 403, '无权领取其他部门的公海客户', {
        constraint: 'relation.out_of_scope',
      });
    }

    // ③ 三元组存在性（公司 / 部门 / 产品线）—— 与 `createRelation` 同一道校验、同一句人话：
    //    id 指错了是**参数错**（400，改参数重试），与「本来就没有这条公海」（也该刷新列表）
    //    是两件事、两个下一步动作，不许挤进同一句人话里。
    await this.requireTripleExists({
      companyId: input.companyId,
      deptId: input.deptId,
      productLineId: input.productLineId,
    });

    // ④ 定位目标（公海 ＋ 三元组）；定位不到 ＝ 本来就没有 / 刚刚被人领走
    const row = await this.repository.findCompanySeaRelation({
      companyId: input.companyId,
      deptId: input.deptId,
      productLineId: input.productLineId,
    });
    if (row === null) {
      throw new AppError(ErrorCode.PARAM_INVALID, 400, SEA_CLAIM_NOT_FOUND_MESSAGE, {
        constraint: 'sea.relation_not_claimed',
      });
    }

    const prevOwnerMember = row.members.find(
      (member) => member.member_type === OWNER_MEMBER_TYPE && member.revoked_at === null,
    );
    const now = new Date();

    await this.prisma
      .$transaction(async (tx) => {
        const client: RelationTxClient = tx;

        // ① 原子认领（条件 UPDATE ＋ 阶段置 1，同一条语句）
        const { count } = await this.repository.claimSeaRelation(
          row.id,
          { employeeId: viewer.employeeId, stageId: NEW_ROUND_STAGE },
          client,
        );
        if (count !== 1) {
          // 事务内抛出 ⇒ 整笔回滚（此处此前也没有别的写，回滚是干净的）
          throw new AppError(ErrorCode.UNIQUE_CONFLICT, 409, SEA_CLAIM_RACE_MESSAGE, {
            constraint: 'sea.claim_conflict',
          });
        }

        // ② owner 成员切换：先撤在位（残留兜底）→ 再复活或插入
        await this.repository.revokeActiveOwner(row.id, viewer.employeeId, client);
        const existed = await this.repository.findMember({
          relation_id: row.id,
          employee_id: viewer.employeeId,
          member_type: OWNER_MEMBER_TYPE,
        });
        if (existed === null) {
          await this.repository.createMember(
            {
              relation_id: row.id,
              employee_id: viewer.employeeId,
              member_type: OWNER_MEMBER_TYPE,
              added_by: viewer.employeeId,
            },
            client,
          );
        } else {
          await this.repository.reviveMember(
            existed.id,
            { added_by: viewer.employeeId, added_at: now },
            client,
          );
        }

        // ③ 阶段留痕（仅当上一轮不在阶段 1 时才有"回落"可言 —— 避免写无信息的噪声行）
        if (row.stage_id !== NEW_ROUND_STAGE) {
          await this.repository.createStageLog(
            {
              relation_id: row.id,
              from_stage: row.stage_id,
              to_stage: NEW_ROUND_STAGE,
              action: 'normal',
              reason: null,
              operator_id: viewer.employeeId,
            },
            client,
          );
        }
      })
      .catch((error: unknown) => {
        // 并发下预检漏过 → `uk_owner` / `uk_member` 等 DB 兜底，映射成人话（→ §7.5）
        throw mapPrismaError(error) ?? error;
      });

    // ★ 必须**读回一次**再出参（同 `createRelation` 那条注释）：事务里那批写的返回值都发生在
    //   **owner 成员落库之前**，`members` 是空的 —— 拿它装配引用，出参的 `owner` 就会是 `null`
    //   （真库实测踩过；单测的假对象也要按这个阶段造）。
    const fresh = await this.requireRelationRow(row.id);
    return {
      relation: this.buildVo(fresh, await this.loadRefs([fresh])),
      prevStage: row.stage_id,
      prevOwnerId: prevOwnerMember?.employee_id ?? null,
    };
  }

  // ===== M3-07 / M3-08 列表（私海 / 公海）=====

  /**
   * 关系列表（→ §5.6 `GET /relations`；**M6-07 起带分页**）。
   *
   * ★ 档位判定走 kernel 唯一入口（→ `kernel/data-scope/data-scope-target.ts`，M5-02），
   *   C 域语义在 `domain/relation-scope.ts`；本层只做「按范围选一个仓储方法」—— **不拼 `where`**。
   * ★ 交付 / 客服看**公海** → **403**（§2.2「不进公海」）：返回空列表是**静默错误**。
   * ★ 分页默认值与上限（1 / 20 / 100）的归一化**只在 kernel 一处**（→ §2.7）：本层不自己夹紧，
   *   否则同一套夹紧规则会有两份（改了这里漏了那里就分叉）。
   */
  async listRelations(
    tab: RelationListTab,
    query: RelationListQuery = {},
  ): Promise<PageResult<RelationVo>> {
    const viewer = requireViewer();
    const scope = resolveRelationListScope(tab, viewer);
    if (scope.kind === 'denied') {
      throw new AppError(ErrorCode.FORBIDDEN, 403, '无权限：交付 / 客服不进公海', {
        constraint: 'relation.sea.denied',
      });
    }

    const pagination = resolvePagination(query);
    // ★ 筛选（视图 / 紧迫档）与**数据范围是两层**：范围＝我能看到谁（domain 判定），
    //   筛选项＝我看到的那批里我想挑哪些（也是 domain 判定）—— 两者在 repository 里
    //   以**同一个复合 where** 落到 SQL，故 `total` 数的是**筛完之后**的总数。
    const filter = buildRelationListFilter(query.view, query.urgencies);
    // ★ 排序 / 关键词（**D-07**）：白名单校验在 DTO（`@IsIn` → 非法 400），本层只**透传**
    //   （翻译成 Prisma 排序在 repository —— `Prisma.*` 只许出现在仓储层，架构 §5.4）
    const options: RelationListOptions = {
      orderField: query.orderField,
      desc: query.desc,
      keyword: query.keyword,
    };
    const now = new Date();
    const { rows, total } =
      scope.kind === 'all'
        ? await this.listAll(tab, filter, pagination, options)
        : scope.kind === 'dept'
          ? await this.listByDepts(tab, scope.deptIds, filter, pagination, options)
          : await this.repository.listPrivateRelationsOfEmployee(
              viewer.employeeId,
              now,
              filter,
              pagination,
              options,
            );

    const refs = await this.loadRefs(rows);
    return buildPageResult(
      rows.map((row) => this.buildVo(row, refs)),
      total,
      pagination,
    );
  }

  // ===== M3-10 详情 / 改属性 =====

  /** 关系详情（→ §5.6；本批 ＝ 列表项 ＋ 成员） */
  async getRelation(id: string): Promise<RelationDetailVo> {
    const viewer = requireViewer();
    const row = await this.requireRelation(id);

    const readVerdict = checkRelationRead(memberInputOf(row), viewer, new Date());
    if (!readVerdict.ok) throw verdictError(readVerdict);

    // 管理员读留痕（拍板 Q4：仅 `admin` 角色写 `operation_log`，best-effort 不冒泡）
    if (viewer.roleCodes.includes('admin')) {
      await this.audit.recordStandalone({
        action: RELATION_AUDIT_ACTIONS.view,
        target_type: 'business_relation',
        target_id: row.id,
      });
    }

    const refs = await this.loadRefs([row]);
    return { ...this.buildVo(row, refs), members: buildMemberVos(row, refs) };
  }

  // ===== M4-07 D 域（跟单 / 承诺）的跨域出口 =====

  /**
   * **D 域写跟单 / 建承诺前的准入校验**（→ §5.2 路之①：跨域只能调对方 exports 的 service，
   * D 域**不许**查 `business_relation` 这张表，也不许自己判范围 —— 范围规则只有本域有）。
   *
   * 判据＝三条叠加：
   *   ① **看得见**（`checkRelationRead`）：owner ∪ **有效协同人** ∪ 部门档管辖 ∪ `all` 档
   *      ∪（**公海**）本部门 —— 公海读门口径 2026-09-18 补（→ D-32①）；
   *   ② **可写角色**（`isRelationWriteRole`）：`sale` / `dept_manager` / `gm`
   *      —— 管理员（`all` 档但只读）与交付 · 客服（`serving` 档）一律拒（→ §2.2 /《欠账登记表》D-01）；
   *   ③ **不是公海（已领取）**（`checkSeaUnclaimed`）→ 无主一律 **422 / `20408`**
   *      —— ⚠ 这条是**2026-09-18 新加**的：①②**都挡不住它**（→ D-31 真库实测）。
   *
   * ★ 为什么用**读**口径而不用 `checkRelationWrite`（那条只认 **owner**）：
   *   §10.2 原文「可见性继承业务关系权限（本人全文 / **协同可读写** / 他人私海不可见）」——
   *   **协同人对跟单是可读写的**；而「改关系属性 / 加成员」是**另一件事**，**归 owner**
   *   （2026-09-15 七叔拍板「维持」→ `relation-scope.ts` 的 `checkRelationWrite` ★★ 段）。
   *   ⇒ 跟单走读口径 ＋ 写角色；关系属性走 owner 判定。**两者刻意不同，别合并**。
   *
   * @returns 关系 id ＋ **当前 owner**（D 域要拿它填 `action_event.owner_snapshot`、
   *          并判时间线里哪条是「主线」，→ D2 / 接口 §5.7 `branch`）
   * @throws 400 关系不存在 ｜ 403 越界（`out_of_scope`）或只读角色（`read_only`）
   *         ｜ **422 / `20408`** 公海（无主）未领取（→ D-32②）
   */
  async requireWritableRelation(id: string): Promise<{ id: bigint; ownerId: bigint | null }> {
    const viewer = requireViewer();
    const row = await this.requireRelation(id);

    const readVerdict = checkRelationRead(memberInputOf(row), viewer, new Date());
    if (!readVerdict.ok) throw verdictError(readVerdict);

    if (!isRelationWriteRole(viewer.roleCodes)) {
      throw new AppError(ErrorCode.FORBIDDEN, 403, '当前角色对业务关系只读（管理员 / 交付 · 客服）', {
        constraint: 'relation.read_only',
      });
    }

    const owner = findActiveOwner(row.members.map(toMemberLike));
    const ownerId = owner?.employeeId ?? null;

    // ★ **公海（无主）未领取 ⇒ 一票否决**（→ D-32②，2026-09-18 拍板）：写跟单只能在私海。
    //   上面两条门**都挡不住它**：经理 / 总经理对管辖内公海原本整条放行（真库实测落过无主跟单，
    //   →《欠账登记表》D-31）；销售那边则是"撞"上的（旧读门顺带拒了）—— 读门口径一放宽就会漏。
    //   ⇒ 必须**显式判**，不许靠别的门顺带兜住。
    //   ⚠ `sea_locked`（422）与 `out_of_scope`（403）的分工见 `checkSeaUnclaimed`：别部门的公海
    //     照旧 403，不许用 422 反推出「这条存在且无主」。
    const seaVerdict = checkSeaUnclaimed({ deptId: row.dept_id, ownerId }, viewer);
    if (seaVerdict !== null) throw verdictError(seaVerdict);

    return { id: row.id, ownerId };
  }

  /**
   * 回写「最近一次**有效沟通**时间」（→ C1 `last_event_at`；由 **D 域**在写完事件后调用，M4-07）。
   *
   * ★ 调用方**已经**判过「是不是有效沟通」（`domain/last-event.ts` 的 `decideLastEventUpdate`）
   *   —— 本方法**不再重复判**，避免同一个规则落两处（改一处漏一处＝双真相源）。
   * ⚠ **不进 D 域的事务**：`business_relation` 是**本域（C 域）**的表，
   *   跨两个域开事务是明令禁止的（§5.2 ③），故由 D 域**提交后**再调这里。
   */
  async touchLastEventAt(relationId: bigint, eventAt: Date): Promise<void> {
    await this.repository.updateLastEventAt(relationId, eventAt);
  }

  /**
   * 关系**引用**（`{id, name}`）批量出口 —— D 域的「今日动线」条目要 `relation:{id,name}`（→ §5.7）。
   *
   * ★ `name` 取**公司全称**：业务关系本身**没有名字字段**（→ 数据架构 C1），
   *   「今天该找谁」问的就是**哪家公司** —— 依据是接口 §5.7 该字段的形状与业务语义，
   *   不是本域自造的展示口径。
   * ★ 公司引用取不到（档案被逻辑删 / 已并走）时**不编名字**，该条 `name` 给空串。
   * ⚠ 本方法**不做可见性过滤**：调用方（D 域）拿到的 id 来自**它自己**的动线条目
   *   （`daily_agenda.user_id` 已保证「这条是给我的」），再加一层关系范围判断会把
   *   经理 / 交付看到的那部分也剪掉。要判关系可见性请用 `getRelation` / `requireWritableRelation`。
   */
  async getRelationRefs(ids: readonly bigint[]): Promise<{ id: bigint; name: string }[]> {
    const unique = uniqueBigints(ids);
    if (unique.length === 0) return [];

    const rows = await this.repository.findRelationRefsByIds(unique);
    const companies = await this.company.getCompanyRefs(
      uniqueBigints(rows.map((row) => row.company_id)),
    );
    const names = toNameMap(companies);

    return rows.map((row) => ({ id: row.id, name: names.get(row.company_id.toString()) ?? '' }));
  }

  /**
   * 按公司取「业务线列表」（→ D-61 桥③ 聚合层 `relations_summary` 的业务线部分）。
   *
   * ★ 跨域拼装：dept / product_line 名字走 org 出口（A 域），C 域不许查 `department` / `product_line` 表。
   * ★ 返回**去重**后的业务线（同一 部门×产品线 只列一次）；引用取不到（已删）的条目跳过、不编名字。
   * ★ 不收敛数据范围：公司详情是全公司共享资料层，业务线列表同样全公司可见（→ §13.2）。
   * ⚠ **不含** `sign_date` / `amount`：那在 E 域 `contract`（本期未建 module）⇒ 聚合层待补、不编假值。
   */
  async getRelationsByCompany(
    companyId: bigint,
  ): Promise<{ dept: { id: bigint; name: string }; product_line: { id: bigint; name: string; color_key: string | null } }[]> {
    const rows = await this.repository.findRelationsByCompany(companyId);
    if (rows.length === 0) return [];

    const deptIds = uniqueBigints(rows.map((row) => row.dept_id));
    const productLineIds = uniqueBigints(rows.map((row) => row.product_line_id));
    const [depts, productLines] = await Promise.all([
      this.org.getDeptRefs(deptIds),
      this.org.getProductLineRefs(productLineIds),
    ]);
    const deptName = toNameMap(depts);
    const productLineMap = new Map(
      productLines.map((line) => [line.id.toString(), { name: line.name, colorKey: line.color_key }]),
    );

    const seen = new Set<string>();
    const result: { dept: { id: bigint; name: string }; product_line: { id: bigint; name: string; color_key: string | null } }[] = [];
    for (const row of rows) {
      const key = `${row.dept_id.toString()}:${row.product_line_id.toString()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const deptNameValue = deptName.get(row.dept_id.toString());
      const line = productLineMap.get(row.product_line_id.toString());
      if (deptNameValue === undefined || line === undefined) continue;
      result.push({
        dept: { id: row.dept_id, name: deptNameValue },
        product_line: { id: row.product_line_id, name: line.name, color_key: line.colorKey },
      });
    }
    return result;
  }

  /**
   * 某公司下**当前查看者可见**的关系 id（→ D-61 桥③ `event_count_30d` 的可见性收敛出口）。
   *
   * ★ 调用方＝**D 域** `EngineService.countCompanyEvents30d`（再往上由聚合层拼进公司详情）：
   *   「公司 × 跟单计数」里「哪些关系算数」是**本域**的可见性规则，D 域不许自己拼（→ 架构 §5.2 路之①）。
   * ★ 档位判定复用**私海列表那一套**（`resolveRelationListScope('private', viewer)`，→ 本文件
   *   `listRelations` 同源）：公司详情页里「我能看见的跟单」必须与**列表里能点开的关系**一致 ——
   *   另写一套判断，迟早出现「列表里有它、计数里没它」。
   *   · `all`  → 该公司下全部私海（总经理 / 管理员）
   *   · `dept` → 管辖部门（经理）
   *   · `mine` → 我参与（销售 / 交付 · 客服；⚠ 交付 · 客服的正解是「服务期内」，E 域未建前按
   *              「我参与」收敛，**比规格窄、不越权** →《欠账登记表》D-01）
   * ★ **不并公海**：跟单只能写在私海（→ D-32②），公海关系名下不会有跟单（理由同仓储那头 ★）。
   * ★ 出参只给 **id**：调用方要的就是「拿这批 id 去数跟单」，不给整行（同 `getRelationRefs` 的取法）。
   */
  async listVisibleRelationIdsOfCompany(companyId: bigint): Promise<bigint[]> {
    const viewer = requireViewer();
    const scope = resolveRelationListScope('private', viewer);
    // ⚠ 私海页签不会给 `denied`（那个分支只属公海，→ `resolveRelationListScope`）；
    //   这里显式兜底成空集而**不是**落进 `mine` 分支 —— 万一将来语义变了，
    //   「看不见」宁可少数、不可多算（计数多算＝把别人的跟单算到我看的数字里）。
    if (scope.kind === 'denied') return [];

    const now = new Date();
    const rows =
      scope.kind === 'all'
        ? await this.repository.listVisibleRelationIdsOfCompany(companyId)
        : scope.kind === 'dept'
          ? await this.repository.listVisibleRelationIdsOfCompanyOfDepts(companyId, scope.deptIds)
          : await this.repository.listVisibleRelationIdsOfCompanyOfEmployee(
              companyId,
              viewer.employeeId,
              now,
            );

    return rows.map((row) => row.id);
  }

  /**
   * 「**我可见的公司**」的 company_id 集合（→ 需求 §6.1 ⑪ 联系人列表收敛；D-28）。
   *
   * @returns **`null` ＝ 不收敛**（`all` 档：总经理 / 管理员，→ 需求 §4.2）；否则是 id 集合
   *          （可能为空数组 ＝ 该公司都没得看）
   *
   * ★ 调用方＝**聚合层**（`CompanyAggregateService.listContacts` / `getContact`）：它算出集合后
   *   把它当**入参**喂给 B 域列表 —— B 域（L2）**不许**反向依赖本域（L3），装配只能发生在更高层
   *   （架构 §3，→ D-28）。
   * ★ 为什么 `all` 档返回 `null` 而不是「把所有 id 查出来」：那不是省事，是**故意不把全库公司 id
   *   塞进一个巨型 `IN (...)`**（公司数一涨就慢）；`null` 的语义＝「调用方不套过滤」。
   * ★ 范围判定复用 `resolveVisibleCompanyScope`（domain，两个页签并集），本层只做选路与取数。
   */
  async listVisibleCompanyIds(): Promise<readonly bigint[] | null> {
    const viewer = requireViewer();
    const scope = resolveVisibleCompanyScope(viewer);
    if (scope.kind === 'all') return null;

    const rows = await this.repository.listVisibleCompanyIds(scope, new Date());
    return rows.map((row) => row.company_id);
  }

  // ===== M7-03 掉海预警（F 域定时任务）的跨域出口 =====

  /**
   * 掉海预警扫描的候选私海（→ 数据架构 §十二「掉海预警（私海→公海）｜每小时」）。
   *
   * ★ **本方法不做数据范围收敛，也没有当前登录人** —— 它服务的是 **Worker 定时任务**
   *   （系统身份）：预警要盯住**所有**有主关系（→ 仓储注释 ★）。因此：
   *   · **只许系统任务调用**，HTTP 出口一律走 `listRelations`（那条有范围判定）；
   *   ⓘ 2026-09-22 起本域多一个**同族**出口 `getSeaWarningAnchors`（**按 id 集合**取，服务列表页
   *     的 `drop_in_x_days`）：形状同源（同一个映射函数）、只有"候选从哪来"不同（全库扫 vs 一页 id）；
   *   · F 域拿到的是**已装配好的最小字段**（不是 C 域的行形状）—— 形状换一次不该让调用方跟着改。
   * ★ **口径不在本层**：天数解析（L4→L1）＋ 到期时刻 ＋ 三档阈值全在
   *   `F 域 domain/sea-warning.ts`（掉海规则是 F 域的规则，C 域不掺和）。
   */
  async listSeaWarningCandidates(): Promise<SeaWarningCandidate[]> {
    return toSeaWarningCandidates(await this.repository.listPrivateSeaCandidatesForWarning());
  }

  /**
   * 按 **id 集合**取掉海倒计时的**锚点**（→ 接口 §4.4 / §5.6 `drop_in_x_days` 的跨域出口）。
   *
   * ★ 调用方＝**F 域出口**（`SeaService.listDropCountdown`，再往上由聚合层 `relation-aggregate`
   *   拼进关系列表）。**天数怎么算不在本域**：规则解析 / 到期时刻 / 三档阈值全在
   *   F 域 `domain/sea-warning.ts` —— 掉海规则是 F 域的规则，C 域只负责"这几列它长什么样"。
   * ★ 形状＝ `SeaWarningCandidate`（与定时任务那个出口**同一份**，见 `toSeaWarningCandidates`）。
   * ★ **本方法不判数据范围、也判不了**（同 `listSeaWarningCandidates`：出口服务的是装配层，不是登录人）
   *   ⇒ **入参必须是已经过范围收敛的 id 集**（本域 `listRelations` 的出参）。调用方拿别人的 id 来问，
   *   就是绕过范围判定 —— 故本域的约定是：**该出口只给聚合层用，且紧跟列表取数之后**（一页 ≤100 条）。
   * ★ 入参为空 ⇒ **不查库直接回空**（`IN ()` 没有意义，也不该白跑一趟）。
   */
  async getSeaWarningAnchors(ids: readonly bigint[]): Promise<SeaWarningCandidate[]> {
    const unique = uniqueBigints(ids);
    if (unique.length === 0) return [];

    return toSeaWarningCandidates(await this.repository.findSeaWarningCandidatesByIds(unique));
  }

  /**
   * 「部门 × 产品线」维度的**在途私海条数** —— 供 **F 域公海规则变更预告**（M9-F；需求 §6.3
   * 「提交变更时系统先提示『本次将影响 X 个客户』」）。
   *
   * ★ 与 `listSeaWarningCandidates` 的**分工**（别把两个出口读混）：
   *   · 那个给**逐条明细**（`lastEventAt` / owner…），服务的是**系统定时任务** ⇒ 只许系统调；
   *   · 这个给**聚合数**（两个 key ＋ 计数），服务的是**人在提交规则变更前看一眼影响面**
   *     ⇒ 可供 HTTP 出口调，也**只给到聚合层**（客户是谁不必出门）。
   * ★ 口径**不在本层**：哪些关系算"在途"、哪些规则命中它们，全在 F 域
   *   （`domain/sea-rule.ts` 的 `countAffectedCustomers`）；本层只做取数与形状转换。
   *
   * @param deptIds `null` ＝ 不收敛（全公司）；给集合 ＝ 只统计这些部门
   *   —— 经理只该看到**自己管辖部门**的影响面（→ `domain/sea-rule.ts` 的读范围）。
   */
  async countPrivateSeaByDeptLine(
    deptIds: readonly bigint[] | null,
  ): Promise<{ deptId: bigint; productLineId: bigint; count: number }[]> {
    const rows = await this.repository.countPrivateSeaByDeptLine(deptIds);

    return rows.map((row) => ({
      deptId: row.dept_id,
      productLineId: row.product_line_id,
      count: row._count._all,
    }));
  }

  /**
   * 「到期掉海」的系统出口（→ 需求 §6.3 掉海节奏表末行「到期 → 执行掉落回公司公海，写历史记录」；
   *   数据架构 §十二 掉海预警末句；F1 尾「只 UPDATE `sea_status`，严禁 UPDATE `dept_id`」）。
   *
   * ★ **为什么这个出口在 C 域**：掉落要动的两张表（`business_relation` / `relation_member`）
   *   都是 C 域的表 —— 它就是 `claimCompanySeaRelation`（领取）**反向的同一件事**：
   *   那边"公海 → 私海 ＋ 切 owner"，这边"私海 → 公海 ＋ 撤 owner"。跨域不许碰别人的表
   *   （架构 §5.2）⇒ **F 域只编排 ＋ 写自己的 `sea_record`**。
   *
   * ★ **为什么不调 `requireViewer`**（与 `listSeaWarningCandidates` 同一约定）：
   *   调用方是 **Worker 定时任务**（系统身份）—— 没有登录人、没有请求上下文；
   *   "谁有权限掉海"这个问题不成立（掉海是**系统按规则执行**，不是某个人的操作）。
   *   ⚠ 故本方法**只许系统任务调用**，HTTP 出口一律不许接（那边走 `listRelations` 之类）。
   *
   * ★ **一个本域事务**（架构 §5.2 路之③：多表一致性只在本域开事务）：
   *   ① 取**在位 owner**（`sea_record.owner_id` 要的是"掉海那一刻的归属人"快照 ⇒ 必须在撤之前取）；
   *   ② **条件 UPDATE** `sea_status: private → company_sea`，`count === 1` 才算掉成
   *      （→ 数据架构 §10.2-3 与"抢公海"同一姿势：不靠"先查再改"）；
   *   ③ **撤销在位 owner 成员**（撤销＝置 `revoked_at`、**不物理删**，→ §10.2-1）。
   *   ★ 三件事必须**同生共死**：只改 `sea_status` 不撤 owner，库里就留下
   *     "公海却还有主人"的过渡态（`listPrivateSeaCandidatesForWarning` 头注专门防过这个）。
   *
   * @returns 掉成功 ⇒ `{ownerId}`（供 F 域写 `sea_record`）；
   *          `null` ＝ **本次没掉**（没有在位 owner / 条件 UPDATE 未命中 —— 并发下刚被领走）
   *          ⇒ 调用方**跳过**：没有"掉"这件事，就不该留掉海痕迹、更不该写历史行。
   */
  async dropPrivateSeaRelation(relationId: bigint): Promise<{ ownerId: bigint } | null> {
    return this.prisma.$transaction(async (tx) => {
      const client: RelationTxClient = tx;

      // ① 在位 owner（掉海快照要写它；撤完就没得写了）
      const owner = await this.repository.findActiveOwnerMember(relationId, client);
      if (owner === null) return null;

      // ② 条件 UPDATE：影响 1 行才算掉成
      const { count } = await this.repository.dropSeaRelation(relationId, client);
      if (count !== 1) return null;

      // ③ 撤销在位 owner；`by = null` ＝ 系统动作（没有"谁"，→ 仓储注释 ★）
      await this.repository.revokeActiveOwner(relationId, null, client);

      return { ownerId: owner.employee_id };
    });
  }

  /**
   * 改关系属性（→ §5.6 `PUT /relations/:id`）。
   *
   * ★ 「非灰度必标开发价值」判的是**合并后的最终态**（`urgency` / `value_tier` 各自取改完的样子）：
   *   只改 `urgency` 的关系，若库里**已经**标过价值，就该放行 —— 否则销售每次都得把两个字段
   *   一起提交一遍（→ `domain/relation-attributes.ts` 文件头 ★）。
   *
   * ★★ **本端点是公海唯一放行的写口**（→ D-32②）：无主关系**只传 `value_tier`** 时放行
   *    （开发价值＝**部门共同维护**，**销售也能标**），其余情况一律 **422 / `20408`**。
   *    判定口径见 `domain/relation-scope.ts` 的 `checkSeaValueTierWrite`（**规则不在本层**）。
   */
  async updateRelation(id: string, dto: UpdateRelationDto): Promise<RelationVo> {
    const viewer = requireViewer();
    const row = await this.requireRelation(id);

    const writeInput = writeInputOf(row);
    if (writeInput.ownerId === null) {
      // 公海（无主）：走**唯一例外**那条判定 —— 不是"放宽了写权限"，是"开发价值本来就不归 owner"。
      const seaVerdict = checkSeaValueTierWrite(
        {
          deptId: row.dept_id,
          members: row.members.map(toMemberLike),
          valueTierOnly: hasOnlyValueTier(dto),
        },
        viewer,
        new Date(),
      );
      if (!seaVerdict.ok) throw verdictError(seaVerdict);
    } else {
      const writeVerdict = checkRelationWrite(writeInput, viewer);
      if (!writeVerdict.ok) throw verdictError(writeVerdict);
    }

    const urgency = dto.urgency ?? row.urgency;
    const valueTier = dto.value_tier ?? row.value_tier;
    const tierVerdict = checkValueTierForUrgency(urgency, valueTier);
    if (!tierVerdict.ok) {
      throw new AppError(
        ErrorCode.REQUIRED_MISSING,
        422,
        '非灰度关系必须标注开发价值，请先选一个开发价值档',
        { constraint: 'relation.value_tier_required' },
      );
    }

    let competitorId: bigint | undefined;
    if (dto.competitor_id !== undefined) {
      competitorId = jsonToBigint(dto.competitor_id, 'competitor_id');
      const competitor = await this.repository.findCompetitorById(competitorId);
      if (competitor === null) {
        throw new AppError(ErrorCode.PARAM_INVALID, 400, '参数错误：competitor_id 指向的竞品不存在', {
          constraint: 'relation.competitor_missing',
        });
      }
    }

    const updated = await this.repository
      .updateRelation(row.id, {
        updated_by: viewer.employeeId,
        ...(dto.urgency === undefined ? {} : { urgency: dto.urgency }),
        ...(dto.value_tier === undefined ? {} : { value_tier: dto.value_tier }),
        ...(dto.next_action_hint === undefined ? {} : { next_action_hint: dto.next_action_hint }),
        ...(dto.competition === undefined ? {} : { competition: dto.competition }),
        ...(competitorId === undefined ? {} : { competitor_id: competitorId }),
      })
      .catch((error: unknown) => {
        throw mapPrismaError(error) ?? error;
      });

    return this.buildVo(updated, await this.loadRefs([updated]));
  }

  // ===== M3-11 成员 =====

  /** 关系成员列表（→ §5.6；含**已撤销**的留痕行） */
  async listMembers(id: string): Promise<RelationMemberVo[]> {
    const viewer = requireViewer();
    const row = await this.requireRelation(id);

    const readVerdict = checkRelationRead(memberInputOf(row), viewer, new Date());
    if (!readVerdict.ok) throw verdictError(readVerdict);

    return buildMemberVos(row, await this.loadRefs([row]));
  }

  /**
   * 加关系成员（→ §5.6 `POST /relations/:id/members`）。
   *
   * ★ owner：走 `checkOwnerSlot`（一关系一 owner）→ 别人占位 **409 + `uk_owner` 那句人话**。
   * ★ collaborator：`source` 必填；`ask_help`（@求助）**限同部门**（需求 §4.3 / 废止口径 #10），
   *   跨部门 → **422 / 20407**（码值 2026-09-15 补进接口 §2.4，见 `ErrorCode.ASK_HELP_CROSS_DEPT`）；
   *   `ask_help` 未给 `valid_until` 时按 C2 默认 **7 天**。
   * ⚠ 正式协同的**审批流**不在本批：本批只落「审批通过之后的那一行」——
   *   审批中心（M5/approval）接上时，本方法就是它的执行出口，届时需补「审批单号」字段落库。
   */
  async addMember(id: string, dto: AddRelationMemberDto): Promise<RelationMemberVo[]> {
    const viewer = requireViewer();
    const row = await this.requireRelation(id);

    const writeVerdict = checkRelationWrite(writeInputOf(row), viewer);
    if (!writeVerdict.ok) throw verdictError(writeVerdict);

    const employeeId = jsonToBigint(dto.employee_id, 'employee_id');
    const employeeRefs = await this.org.getEmployeeRefs([employeeId]);
    if (employeeRefs.length === 0) {
      throw new AppError(ErrorCode.PARAM_INVALID, 400, '参数错误：employee_id 指向的员工不存在', {
        constraint: 'relation.employee_missing',
      });
    }

    const existed = await this.repository.findMember({
      relation_id: row.id,
      employee_id: employeeId,
      member_type: dto.member_type,
    });
    if (existed !== null) {
      // ⚠ 不复用 `uk_member` 的兜底文案（那句只说明「撞了唯一键」）：这里能说清是哪种情况
      throw new AppError(
        ErrorCode.UNIQUE_CONFLICT,
        409,
        existed.revoked_at === null ? '该成员已在关系中' : '该成员曾被移除，暂不支持再次加入',
        { constraint: 'uk_member' },
      );
    }

    let source: string | undefined;
    let validUntil: Date | undefined;

    if (dto.member_type === OWNER_MEMBER_TYPE) {
      const ownerVerdict = checkOwnerSlot(row.members.map(toMemberLike), employeeId);
      if (!ownerVerdict.ok) {
        throw ownerVerdict.kind === 'already_owner'
          ? new AppError(ErrorCode.UNIQUE_CONFLICT, 409, '该成员已是该关系的主责销售', {
              constraint: 'uk_member',
            })
          : new AppError(ErrorCode.UNIQUE_CONFLICT, 409, OWNER_OCCUPIED_MESSAGE, {
              constraint: 'uk_owner',
            });
      }
    } else if (dto.member_type === COLLABORATOR_MEMBER_TYPE) {
      source = dto.source;
      if (source === undefined) {
        throw new AppError(ErrorCode.PARAM_INVALID, 400, '参数错误：新增协同人必须给出 source', {
          constraint: 'relation.member.source_required',
        });
      }
      if (source === 'ask_help') {
        const mentionedDeptIds = await this.org.getEmployeeDeptIds(employeeId);
        if (!isSameDeptForAskHelp(viewer.myDeptIds, mentionedDeptIds)) {
          // ⚠ 码值 2026-09-15 定：原实现借的是 403 / 20003（「数据权限越界」），七叔拍板补一条
          //   业务码 —— 这条拦的是**动作不合规**（不是"你没权限看这条数据"），故按 §2.4 归到
          //   **422 ＋ 204xx**：`20407` 跨部门 @求助（接口 §2.4 已同步写入）
          throw new AppError(
            ErrorCode.ASK_HELP_CROSS_DEPT,
            422,
            '@求助仅限同部门，跨部门请走正式协同审批',
            { constraint: 'relation.ask_help.cross_dept' },
          );
        }
      }
      if (dto.valid_until !== undefined) {
        validUntil = new Date(dto.valid_until);
      } else if (source === 'ask_help') {
        validUntil = addDays(new Date(), ASK_HELP_DEFAULT_DAYS);
      }
    } else {
      // DTO 的白名单已经挡过（`member_type ∈ owner / collaborator`）；走到这里说明 **DTO 与
      // domain 常量脱钩**（有人加了第三种成员类型却只改了一处）—— 宁可 400，也不许静默落库
      throw new AppError(ErrorCode.PARAM_INVALID, 400, '参数错误：member_type 取值不合法', {
        constraint: 'relation.member.type_invalid',
      });
    }

    await this.repository
      .createMember({
        relation_id: row.id,
        employee_id: employeeId,
        member_type: dto.member_type,
        added_by: viewer.employeeId,
        ...(source === undefined ? {} : { source }),
        ...(validUntil === undefined ? {} : { valid_until: validUntil }),
      })
      .catch((error: unknown) => {
        throw mapPrismaError(error) ?? error;
      });

    // 读回整条关系再出参：**成员列表要含刚加的那一行**，且引用（员工姓名）也必须按**读回后**
    // 的成员集合去取 —— 用加成员之前那份 `row` 取引用，新成员就会显示成 `employee: null`。
    const refreshed = await this.requireRelationRow(row.id);
    return buildMemberVos(refreshed, await this.loadRefs([refreshed]));
  }

  // ===== 私有：取数 / 装配 =====

  /** 私海 / 公海 × `all` 档（分页 ＋ 筛选 ＋ 排序/关键词，**D-07**） */
  private listAll(
    tab: RelationListTab,
    filter: RelationListFilter,
    pagination: Pagination,
    options: RelationListOptions,
  ) {
    return tab === 'private'
      ? this.repository.listPrivateRelations(filter, pagination, options)
      : this.repository.listSeaRelations(filter, pagination, options);
  }

  /** 私海 / 公海 × `dept` 档（部门公海＝本部门的关系集合，→ C1；分页 ＋ 筛选 ＋ 排序/关键词） */
  private listByDepts(
    tab: RelationListTab,
    deptIds: readonly bigint[],
    filter: RelationListFilter,
    pagination: Pagination,
    options: RelationListOptions,
  ) {
    return tab === 'private'
      ? this.repository.listPrivateRelationsOfDepts(deptIds, filter, pagination, options)
      : this.repository.listSeaRelationsOfDepts(deptIds, filter, pagination, options);
  }

  /** 解析 url 上的关系 id → 取行；不存在给 **400 参数错误**（与 B 域同款，→ §2.4） */
  private async requireRelation(id: string): Promise<RelationRow> {
    const relationId = jsonToBigint(id, 'id');
    return this.requireRelationRow(relationId);
  }

  private async requireRelationRow(id: bigint): Promise<RelationRow> {
    const row = await this.repository.findRelationById(id);
    if (row === null) {
      throw new AppError(ErrorCode.PARAM_INVALID, 400, '参数错误：业务关系不存在', {
        constraint: 'relation.not_found',
      });
    }
    return row;
  }

  /**
   * 三元组的存在性校验（公司 / 部门 / 产品线）。
   * ★ 三样都走**跨域出口**（§5.2 路之①）：`company` 属 B 域、`department` / `product_line` 属 A 域，
   *   C 域**不许查它们的表**；拿不到引用＝不存在（被逻辑删的档案同样视为不存在）。
   */
  private async requireTripleExists(triple: {
    companyId: bigint;
    deptId: bigint;
    productLineId: bigint;
  }): Promise<void> {
    const [companies, departments, productLines] = await Promise.all([
      this.company.getCompanyRefs([triple.companyId]),
      this.org.getDeptRefs([triple.deptId]),
      this.org.getProductLineRefs([triple.productLineId]),
    ]);

    if (companies.length === 0) {
      throw new AppError(ErrorCode.PARAM_INVALID, 400, '参数错误：company_id 指向的公司不存在', {
        constraint: 'relation.company_missing',
      });
    }
    if (departments.length === 0) {
      throw new AppError(ErrorCode.PARAM_INVALID, 400, '参数错误：dept_id 指向的部门不存在', {
        constraint: 'relation.dept_missing',
      });
    }
    if (productLines.length === 0) {
      throw new AppError(ErrorCode.PARAM_INVALID, 400, '参数错误：product_line_id 指向的产品线不存在', {
        constraint: 'relation.product_line_missing',
      });
    }
  }

  /**
   * 「部门 × 产品线」必须是**配置里存在的承接组合**（→ 架构 §7.2「可建产品线范围」；接口 §2.4 `20409`）。
   *
   * ★ 为什么排在**存在性之后**：id 指错了是 **400**（改 id 重试），组合不成立是 **422**（换一条产品线）——
   *   两句人话指向的**下一步动作不同**，不许挤进同一句（同 D-53 撞键分档的取法）。
   * ★ 判据走 **A 域出口**（`product_line.dept_ids` 反查，→ `org.getDeptProductLineIds`）：
   *   C 域**不许查产品线表**（架构 §5.2 路之①）。
   * ★ 与**录入页下拉同源**（→ D-74）：前端收敛什么，这里就放行什么；**别在这里再加窄**
   *   （再窄＝第二套口径，就是 D-73 那次的翻车姿势）。
   */
  private async requireLineServedByDept(deptId: bigint, productLineId: bigint): Promise<void> {
    const servedLineIds = await this.org.getDeptProductLineIds(deptId);
    if (!servedLineIds.includes(productLineId)) {
      throw new AppError(
        ErrorCode.PRODUCT_LINE_NOT_SERVED,
        422,
        PRODUCT_LINE_NOT_SERVED_MESSAGE,
        {
          constraint: 'relation.product_line_not_served',
        },
      );
    }
  }

  /**
   * 批量取跨域引用（**一次列表一次往返**，别按行查）。
   * ★ 四个来源都是别人的域：公司（B）＋ 部门 / 产品线 / 员工（A），故**只能**走对方的 service。
   */
  private async loadRefs(rows: readonly RelationRow[]): Promise<RefMaps> {
    const [companies, departments, productLines, employees] = await Promise.all([
      this.company.getCompanyRefs(uniqueBigints(rows.map((row) => row.company_id))),
      this.org.getDeptRefs(uniqueBigints(rows.map((row) => row.dept_id))),
      this.org.getProductLineRefs(uniqueBigints(rows.map((row) => row.product_line_id))),
      this.org.getEmployeeRefs(
        uniqueBigints(rows.flatMap((row) => row.members.map((member) => member.employee_id))),
      ),
    ]);

    return {
      companies: toNameMap(companies),
      departments: toNameMap(departments),
      productLines: new Map(
        productLines.map((line) => [line.id.toString(), { name: line.name, colorKey: line.color_key }]),
      ),
      employees: toNameMap(employees),
    };
  }

  /** 行 → 列表项出参（纯装配；范围 / 唯一键等判断都不在这一层做） */
  private buildVo(row: RelationRow, refs: RefMaps): RelationVo {
    const owner = findActiveOwner(row.members.map(toMemberLike));
    return {
      id: row.id,
      company: refOf(refs.companies, row.company_id),
      dept: refOf(refs.departments, row.dept_id),
      product_line: productLineRefOf(refs.productLines, row.product_line_id),
      stage: row.stage_id,
      urgency: row.urgency,
      value_tier: row.value_tier,
      // ⚠ 客户等级＝按回款自动算（→ C1）：E 域未接，本批恒 null（**不手填、也不假装有**）
      customer_level: row.customer_level,
      owner: owner === undefined ? null : refOf(refs.employees, owner.employeeId),
      sea_status: row.sea_status,
      last_event_at: row.last_event_at === null ? null : row.last_event_at.toISOString(),
      next_action_hint: row.next_action_hint,
      competition: row.competition,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    };
  }
}

/** 仓储读出的关系行（结构取自 `RELATION_SELECT`，**不手抄字段**） */
type RelationRow = NonNullable<Awaited<ReturnType<RelationRepository['findRelationById']>>>;

/** 跨域引用表（id 十进制串 → 名字）；取不到就是「没有」（呼叫方给 `null`，**不编名字**） */
interface RefMaps {
  companies: Map<string, string>;
  departments: Map<string, string>;
  /** 产品线**多带一个配色键**，故不是纯 `name` 表 */
  productLines: Map<string, { name: string; colorKey: string | null }>;
  employees: Map<string, string>;
}

/** 关系成员（→ §5.6 `members[]`；员工被停用时引用取不到 → `employee: null`） */
function buildMemberVos(row: RelationRow, refs: RefMaps): RelationMemberVo[] {
  return row.members.map((member) => ({
    employee: refOf(refs.employees, member.employee_id),
    member_type: member.member_type,
    source: member.source,
    valid_until: member.valid_until === null ? null : member.valid_until.toISOString(),
  }));
}

/** 当前登录人 → `RelationViewer`（**只从令牌/上下文来**，不查库，→ 架构 §7.1） */
function requireViewer(): RelationViewer {
  const context = getRequestContext();
  if (context === undefined) {
    throw new AppError(ErrorCode.UNAUTHENTICATED, 401, '未登录或登录已过期', {
      constraint: 'relation.no_context',
    });
  }
  return {
    employeeId: context.employeeId,
    roleCodes: context.roleCodes,
    dataScope: context.dataScope,
    myDeptIds: context.deptIds,
  };
}

/**
 * 判定结果 → `AppError`。
 *
 * ★ 三档**分开说**，别给一句糊的：
 *   · `read_only` / `out_of_scope` → **403**（「你压根没这个权利」）；
 *   · `sea_locked` → **422 / `20408`**（「权利有，但这条**还没领取**」）——→ D-32②。
 *     `20408` 与 `20404`（预约未完成）同为「状态不允许」一族（→ 接口 §2.4）。
 */
function verdictError(verdict: RelationWriteDenied): AppError {
  if (verdict.kind === 'sea_locked') {
    return new AppError(ErrorCode.SEA_WRITE_FORBIDDEN, 422, SEA_UNCLAIMED_MESSAGE, {
      constraint: 'relation.sea.unclaimed',
    });
  }

  return verdict.kind === 'read_only'
    ? new AppError(ErrorCode.FORBIDDEN, 403, '当前角色对业务关系只读（管理员 / 交付 · 客服）', {
        constraint: 'relation.read_only',
      })
    : new AppError(ErrorCode.FORBIDDEN, 403, '无权限：该业务关系不在你的数据范围内', {
        constraint: 'relation.out_of_scope',
    });
}

/**
 * 「**只传了 `value_tier`**」＝ 其余字段**一个都没给**（→ D-32②：其余字段一起传**也算写**）。
 *
 * ⚠ 空 body（什么都没传）**不算**：它不是"只想改开发价值"，而是一次**没有内容的写请求** ——
 *   公海关系上照拒（真要什么都不改，就不该发这个请求）。
 */
function hasOnlyValueTier(dto: UpdateRelationDto): boolean {
  return (
    dto.value_tier !== undefined &&
    dto.urgency === undefined &&
    dto.next_action_hint === undefined &&
    dto.competition === undefined &&
    dto.competitor_id === undefined
  );
}

/** 域内成员形状（camelCase）← 仓储行（snake_case）：**翻译只在这一处** */
function toMemberLike(member: RelationRow['members'][number]): RelationMemberLike {
  return {
    employeeId: member.employee_id,
    memberType: member.member_type,
    source: member.source,
    validUntil: member.valid_until,
    revokedAt: member.revoked_at,
  };
}

/** 读 / 写判定入参（部门 ＋ 当前 owner，两者都取自**这一行**） */
function memberInputOf(row: RelationRow): { deptId: bigint; members: RelationMemberLike[] } {
  return { deptId: row.dept_id, members: row.members.map(toMemberLike) };
}

function writeInputOf(row: RelationRow): { deptId: bigint; ownerId: bigint | null } {
  const owner = findActiveOwner(row.members.map(toMemberLike));
  return { deptId: row.dept_id, ownerId: owner === undefined ? null : owner.employeeId };
}

function uniqueBigints(ids: readonly bigint[]): bigint[] {
  return [...new Set(ids)];
}

function toNameMap(refs: readonly { id: bigint; name: string }[]): Map<string, string> {
  return new Map(refs.map((ref) => [ref.id.toString(), ref.name]));
}

/** id → `{id,name}`；引用取不到 → `null`（跨域出口只回未删除的行：已删档案 / 已停用员工取不到） */
function refOf(map: Map<string, string>, id: bigint): { id: bigint; name: string } | null {
  const name = map.get(id.toString());
  return name === undefined ? null : { id, name };
}

/** id → `{id,name,color_key}`（产品线专用；未配置配色 → 该字段 `null`，**不编默认色**） */
function productLineRefOf(
  map: Map<string, { name: string; colorKey: string | null }>,
  id: bigint,
): { id: bigint; name: string; color_key: string | null } | null {
  const hit = map.get(id.toString());
  return hit === undefined ? null : { id, name: hit.name, color_key: hit.colorKey };
}

/** 日期加天数（@求助默认 7 天；不用第三方库，够了） */
function addDays(base: Date, days: number): Date {
  const next = new Date(base);
  next.setDate(next.getDate() + days);
  return next;
}
