// =============================================================================
// F 域服务（M7-01 公海「领取到私海」）—— **只做编排**
//
// 分层约束（架构 §5.4）：service **只做编排**（多步 / 跨域取引用 / 发领域事件），
//   **不写业务规则**（角色 / 范围 / 定位 / 原子性全在 C 域出口与 C 域 `domain/`）、
//   **不写 SQL**（在 `sea.repository.ts`）。
//
// 口径来源（★ 真相源，勿自造）：
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
import { Injectable } from '@nestjs/common';

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
import { RelationService, type RelationVo } from '../relation/relation.service';
import { SeaRepository } from './sea.repository';
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

@Injectable()
export class SeaService {
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
