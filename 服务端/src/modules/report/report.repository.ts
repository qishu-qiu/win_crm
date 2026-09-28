import { Injectable } from '@nestjs/common';

import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface DayRange {
  start: Date;
  end: Date;
}

export interface MonthRange {
  thisStart: Date;
  thisEnd: Date;
  lastStart: Date;
  lastEnd: Date;
}

/**
 * 报表/看板仓储（M8-06 Phase 4 切片②）。
 *
 * ★ 只 `SELECT` 聚合，不写库、不发事件；跨表聚合一律 `$queryRaw`（表达不了就用裸 SQL，→ CODEBUDDY §5）。
 * ★ 范围收敛在**本层**：`deptIds === null` ＝ 不收敛（老板/管理员）；给集合 ＝ 经理管辖部门。
 *   `contract` / `commitment` 自身无 `dept_id`，必须 **JOIN `business_relation`** 才能按 `dept_id` 收敛
 *   （与子代理探查结论一致）。
 */
@Injectable()
export class ReportRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** 今日新增关系数（`business_relation.created_at` 落北京今日） */
  async countTodayNew(deptIds: readonly bigint[] | null, range: DayRange): Promise<number> {
    const scope = this.scopeFilter(deptIds, 'br');
    const rows = await this.prisma.$queryRaw<{ c: bigint }[]>`
      SELECT COUNT(*) AS c FROM business_relation br
      WHERE br.created_at >= ${range.start} AND br.created_at <= ${range.end}
        AND br.deleted_at IS NULL AND ${scope}
    `;
    return Number(rows[0]?.c ?? 0);
  }

  /** 今日待跟进数（`commitment.due_at` 落北京今日且 `status='open'`） */
  async countTodayTodo(deptIds: readonly bigint[] | null, range: DayRange): Promise<number> {
    const scope = this.scopeFilter(deptIds, 'br');
    const rows = await this.prisma.$queryRaw<{ c: bigint }[]>`
      SELECT COUNT(*) AS c FROM commitment c
      INNER JOIN business_relation br ON br.id = c.relation_id
      WHERE c.due_at >= ${range.start} AND c.due_at <= ${range.end}
        AND c.status = 'open' AND br.deleted_at IS NULL AND ${scope}
    `;
    return Number(rows[0]?.c ?? 0);
  }

  /** 本月签约额（含环比上月）；`contract` 无 `dept_id` → JOIN `business_relation` 收敛 */
  async sumMonthSigned(
    deptIds: readonly bigint[] | null,
    months: MonthRange,
  ): Promise<{ amount: number; chainRatio: number | null }> {
    const scope = this.scopeFilter(deptIds, 'br');
    const rows = await this.prisma.$queryRaw<{ this_month: Prisma.Decimal; last_month: Prisma.Decimal }[]>`
      SELECT
        COALESCE(SUM(CASE WHEN ct.sign_date >= ${months.thisStart} AND ct.sign_date <= ${months.thisEnd} THEN ct.amount ELSE 0 END), 0) AS this_month,
        COALESCE(SUM(CASE WHEN ct.sign_date >= ${months.lastStart} AND ct.sign_date <= ${months.lastEnd} THEN ct.amount ELSE 0 END), 0) AS last_month
      FROM contract ct
      INNER JOIN business_relation br ON br.id = ct.relation_id
      WHERE ct.deleted_at IS NULL AND ct.status IN ('running', 'done') AND ${scope}
    `;
    const thisMonth = rows[0] ? rows[0].this_month.toNumber() : 0;
    const lastMonth = rows[0] ? rows[0].last_month.toNumber() : 0;
    const chainRatio = lastMonth > 0 ? (thisMonth - lastMonth) / lastMonth : null;
    return { amount: thisMonth, chainRatio };
  }

  /** 范围收敛：`null` 不收敛；空集合 → 无行（避免 `IN ()` 语法错） */
  private scopeFilter(deptIds: readonly bigint[] | null, alias: string): Prisma.Sql {
    if (deptIds === null) return Prisma.sql`1=1`;
    if (deptIds.length === 0) return Prisma.sql`1=0`;
    return Prisma.sql`${Prisma.raw(alias)}.dept_id IN (${Prisma.join(
      deptIds.map((id) => Prisma.sql`${id}`),
      ', ',
    )})`;
  }
}
