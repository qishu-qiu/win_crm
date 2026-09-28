import { Injectable } from '@nestjs/common';

import { AppError, ErrorCode, getRequestContext } from '../../kernel/index';
import { type SeaManagerTodoResult, SeaService } from '../sea/sea.service';
import { ReportRepository, type DayRange, type MonthRange } from './report.repository';

export interface DashboardKpi {
  today_new: number;
  today_todo: number;
  month_signed: { amount: number; chain_ratio: number | null };
}

export interface DashboardResult {
  kpi: DashboardKpi;
  /** 接口 §5.13 占位、形状待定 → `[]`（→ 欠账 D-33 ⑤） */
  pending_todo: unknown[];
  /** 接口 §5.13 占位、形状待定 → `[]` */
  warnings: unknown[];
  /** 接口 §5.13 占位、形状待定 → `[]` */
  dept_compare: unknown[];
  /** 接口 §5.13 占位、形状待定 → `[]` */
  top_sales: unknown[];
  /** 接口 §5.13 占位、形状待定 → `[]` */
  zombie_weekly: unknown[];
  /** 复用 `GET /sea/manager-todo` */
  sea_todo: SeaManagerTodoResult;
}

/**
 * 经营看板（M8-06 Phase 4 切片②；→ 接口 §5.13 `GET /reports/dashboard`）。
 *
 * ★ **谁能看**：部门经理 / 总经理 / 管理员（销售 / 交付·客服 403）—— 与 `GET /targets/progress` 同一档。
 * ★ KPI 三指标：今日新增（business_relation.created_at）、今日待跟进（commitment.due_at 且 open）、
 *   本月签约额（contract.sign_date 当月 `status∈{running,done}` 汇总 ＋ 环比上月）。
 * ★ `sea_todo` **复用 `SeaService.listManagerTodo()`** —— 同一套规则解析（L4→L1 ＋ 7 天缓冲），不重复实现。
 * ★ `pending_todo` / `warnings` / `dept_compare` / `top_sales` / `zombie_weekly` 在接口 §5.13 仍是 `[]` 占位、
 *   **item 形状未定义**（无独立存储模型、需派生）→ 本版回 `[]`，不编业务字段（文档驱动，→ 欠账 D-33 ⑤）。
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

    const [todayNew, todayTodo, monthSigned, seaTodo] = await Promise.all([
      this.repository.countTodayNew(scopeDeptIds, beijingDayRange(now)),
      this.repository.countTodayTodo(scopeDeptIds, beijingDayRange(now)),
      this.repository.sumMonthSigned(scopeDeptIds, beijingMonths(now)),
      this.sea.listManagerTodo(),
    ]);

    return {
      kpi: {
        today_new: todayNew,
        today_todo: todayTodo,
        month_signed: { amount: monthSigned.amount, chain_ratio: monthSigned.chainRatio },
      },
      pending_todo: [],
      warnings: [],
      dept_compare: [],
      top_sales: [],
      zombie_weekly: [],
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
