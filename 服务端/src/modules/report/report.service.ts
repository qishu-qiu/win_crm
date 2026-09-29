import { Injectable } from '@nestjs/common';

import { AppError, ErrorCode, getRequestContext } from '../../kernel/index';
import { type SeaManagerTodoResult, SeaService } from '../sea/sea.service';
import {
  type DayRange,
  type DeptCompareItem,
  type MonthRange,
  type PendingTodoItem,
  type TopSalesItem,
  ReportRepository,
  type ZombieWeeklyItem,
} from './report.repository';

export interface DashboardKpi {
  today_new: number;
  today_todo: number;
  month_signed: { amount: number; chain_ratio: number | null };
}

/** 活跃预警（3 卡：签约到期 / 新商机 / 掉公海）—— 接口 §5.13 `warnings` */
export interface WarningItem {
  type: 'contract_expire' | 'new_biz' | 'sea_drop';
  relation_id: string;
  relation_name: string | null;
  owner_id?: string | null;
  owner_name?: string | null;
  /** contract_expire：到期日（ISO） */
  service_end?: string | null;
  /** contract_expire：剩余天数（负＝已过期未续） */
  days_left?: number | null;
  /** new_biz：建档时间（ISO） */
  created_at?: string | null;
  /** sea_drop：已停留公海自然日 */
  dropped_days?: number;
}

export interface DashboardResult {
  kpi: DashboardKpi;
  /** 今日/逾期待跟进明细（承诺到期未办） */
  pending_todo: PendingTodoItem[];
  /** 活跃预警 3 卡（签约到期 / 新商机 / 掉公海） */
  warnings: WarningItem[];
  /** 部门对比（当月签约额 ＋ 当前私海关系数） */
  dept_compare: DeptCompareItem[];
  /** 销冠榜（按签单人聚当月签约额，Top 10） */
  top_sales: TopSalesItem[];
  /** 周重点僵尸榜（urgency=weekly 且 ≥14 天无有效跟进） */
  zombie_weekly: ZombieWeeklyItem[];
  /** 复用 `GET /sea/manager-todo`（公海停留超期待决策） */
  sea_todo: SeaManagerTodoResult;
}

/**
 * 经营看板（M8-06 Phase 4 切片②/③；→ 接口 §5.13 `GET /reports/dashboard`）。
 *
 * ★ **谁能看**：部门经理 / 总经理 / 管理员（销售 / 交付·客服 403）—— 与 `GET /targets/progress` 同一档。
 * ★ KPI 三指标：今日新增（business_relation.created_at）、今日待跟进（commitment.due_at 且 open）、
 *   本月签约额（contract.sign_date 当月 `status∈{running,done}` 汇总 ＋ 环比上月）。
 * ★ `sea_todo` **复用 `SeaService.listManagerTodo()`** —— 同一套规则解析（L4→L1 ＋ 7 天缓冲），不重复实现。
 * ★ 5 个列表分区（pending_todo / warnings / dept_compare / top_sales / zombie_weekly）**本版落真实数据**
 *   （→ 接口 §5.13；欠账 D-02 ⑤ 关闭）：形状以接口 §5.13 为唯一真相源，本层只做派生、不造业务字段。
 *   - 范围收敛统一走 `repository` 的 `scopeFilter`（`dept_id` 恒定，按关系转交不漂移）。
 *   - owner 取「在位的那一个」（`relation_member.owner_flag` 非空），不冗余 owner 字段。
 *   - 「无推进」判定复用 `business_relation.last_event_at`（有效沟通才更新），不重新派生。
 * ★ 报表/看板**不脱敏**（§2.4）返回真实金额。
 */
@Injectable()
export class ReportService {
  constructor(
    private readonly repository: ReportRepository,
    private readonly sea: SeaService,
  ) {}

  async getDashboard(): Promise<DashboardResult> {
    const context = requireViewer();
    if (context.dataScope.type !== 'all' && context.dataScope.type !== 'dept') {
      throw new AppError(ErrorCode.FORBIDDEN, 403, '只有部门经理 / 总经理 / 管理员能查看看板', {
        constraint: 'report.dashboard.forbidden',
      });
    }
    const scopeDeptIds: readonly bigint[] | null =
      context.dataScope.type === 'all' ? null : [...context.dataScope.deptIds];
    const now = new Date();
    const day: DayRange = beijingDayRange(now);
    const months: MonthRange = beijingMonths(now);
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 86_400_000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);
    const expireFrom = day.start;
    const expireTo = new Date(day.start.getTime() + 90 * 86_400_000);

    const [
      todayNew,
      todayTodo,
      monthSigned,
      seaTodo,
      pendingTodo,
      contractExpires,
      newBiz,
      deptCompare,
      topSales,
      zombieWeekly,
    ] = await Promise.all([
      this.repository.countTodayNew(scopeDeptIds, day),
      this.repository.countTodayTodo(scopeDeptIds, day),
      this.repository.sumMonthSigned(scopeDeptIds, months),
      this.sea.listManagerTodo(),
      this.repository.listPendingTodo(scopeDeptIds, day),
      this.repository.listContractExpire(scopeDeptIds, expireFrom, expireTo),
      this.repository.listNewBiz(scopeDeptIds, sevenDaysAgo),
      this.repository.listDeptCompare(scopeDeptIds, months),
      this.repository.listTopSales(scopeDeptIds, months, 10),
      this.repository.listZombieWeekly(scopeDeptIds, fourteenDaysAgo, now),
    ]);

    const warnings: WarningItem[] = [
      ...contractExpires.map<WarningItem>((e) => ({
        type: 'contract_expire',
        relation_id: e.relation_id,
        relation_name: e.relation_name,
        service_end: e.service_end ? e.service_end.toISOString() : null,
        days_left: e.days_left,
      })),
      ...newBiz.map<WarningItem>((b) => ({
        type: 'new_biz',
        relation_id: b.relation_id,
        relation_name: b.relation_name,
        owner_id: b.owner_id,
        owner_name: b.owner_name,
        created_at: b.created_at.toISOString(),
      })),
      ...seaTodo.items.map<WarningItem>((it) => ({
        type: 'sea_drop',
        relation_id: it.relation_id,
        relation_name: it.company?.name ?? null,
        dropped_days: it.days_in_sea,
      })),
    ];

    return {
      kpi: {
        today_new: todayNew,
        today_todo: todayTodo,
        month_signed: { amount: monthSigned.amount, chain_ratio: monthSigned.chainRatio },
      },
      pending_todo: pendingTodo,
      warnings,
      dept_compare: deptCompare,
      top_sales: topSales,
      zombie_weekly: zombieWeekly,
      sea_todo: seaTodo,
    };
  }
}

/** 北京时间自然日界（`+08:00`，→ 与 sea / follow-up 同口径）；落库 UTC，故转回 UTC 瞬间比较 */
function beijingDayRange(now: Date): DayRange {
  const b = new Date(now.getTime() + 8 * 3_600_000);
  const y = b.getUTCFullYear();
  const m = b.getUTCMonth();
  const d = b.getUTCDate();
  const start = new Date(Date.UTC(y, m, d, 0, 0, 0) - 8 * 3_600_000);
  const end = new Date(Date.UTC(y, m, d, 23, 59, 59) - 8 * 3_600_000);
  return { start, end };
}

/** 北京当月 / 上月区间（`sign_date` 为 DATE，按北京月落） */
function beijingMonths(now: Date): MonthRange {
  const b = new Date(now.getTime() + 8 * 3_600_000);
  const y = b.getUTCFullYear();
  const m = b.getUTCMonth(); // 0-based
  const thisStart = new Date(Date.UTC(y, m, 1, 0, 0, 0) - 8 * 3_600_000);
  const thisEnd = new Date(Date.UTC(y, m + 1, 0, 23, 59, 59) - 8 * 3_600_000);
  const lm = m === 0 ? 11 : m - 1;
  const ly = m === 0 ? y - 1 : y;
  const lastStart = new Date(Date.UTC(ly, lm, 1, 0, 0, 0) - 8 * 3_600_000);
  const lastEnd = new Date(Date.UTC(ly, lm + 1, 0, 23, 59, 59) - 8 * 3_600_000);
  return { thisStart, thisEnd, lastStart, lastEnd };
}

/** 取当前请求上下文（→ 同 C/F 域：缺上下文给 **401**，绝不兜底成「匿名」） */
function requireViewer() {
  const context = getRequestContext();
  if (context === undefined) {
    throw new AppError(ErrorCode.UNAUTHENTICATED, 401, '未登录或登录已过期', {
      constraint: 'report.no_context',
    });
  }
  return context;
}
