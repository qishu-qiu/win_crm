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

/** 待办明细项（承诺到期/逾期未办）→ 接口 §5.13 `pending_todo` */
export interface PendingTodoItem {
  relation_id: string;
  relation_name: string | null;
  contact_id: string | null;
  contact_name: string | null;
  due_at: Date;
  overdue: boolean;
  content: string | null;
}

/** 签约到期预警项 → 接口 §5.13 `warnings.type=contract_expire` */
export interface ContractExpireItem {
  contract_id: string;
  contract_no: string;
  relation_id: string;
  relation_name: string | null;
  service_end: Date | null;
  days_left: number | null;
}

/** 新商机项（近 N 日新建档且尚无有效跟进）→ 接口 §5.13 `warnings.type=new_biz` */
export interface NewBizItem {
  relation_id: string;
  relation_name: string | null;
  owner_id: string | null;
  owner_name: string | null;
  created_at: Date;
}

/** 部门对比项（按 `dept_id` 聚当月签约额＋当前私海关系数）→ 接口 §5.13 `dept_compare` */
export interface DeptCompareItem {
  dept_id: string;
  dept_name: string;
  signed_amount: number;
  relation_count: number;
}

/** 销冠项（按 `signer_id` 聚当月签约额）→ 接口 §5.13 `top_sales` */
export interface TopSalesItem {
  owner_id: string;
  owner_name: string;
  signed_amount: number;
  contract_count: number;
}

/** 周重点僵尸项（`urgency='weekly'` 且 ≥14 天无有效跟进）→ 接口 §5.13 `zombie_weekly` */
export interface ZombieWeeklyItem {
  relation_id: string;
  relation_name: string | null;
  owner_id: string | null;
  owner_name: string | null;
  last_event_at: Date | null;
  no_progress_days: number;
}

/**
 * 报表/看板仓储（M8-06 Phase 4 切片②/③）。
 *
 * ★ 只 `SELECT` 聚合，不写库、不发事件；跨表聚合一律 `$queryRaw`（表达不了就用裸 SQL，→ CODEBUDDY §5）。
 * ★ 范围收敛在**本层**：`deptIds === null` ＝ 不收敛（老板/管理员）；给集合 ＝ 经理管辖部门。
 *   `contract` / `commitment` 自身无 `dept_id`，必须 **JOIN `business_relation`（别名 `br`）** 才能按 `br.dept_id` 收敛
 *   （`br.dept_id` 恒定不可变，按关系转交不漂移 → 部门/销冠聚合口径稳定）。
 * ★ owner 取「在位的」那一个：走 `relation_member.owner_flag IS NOT NULL`（owner_flag 是生成列，
 *   在位的 owner 才非空），不在 `business_relation` 上冗余 owner 字段（避免双真相源）。
 * ★ 「无推进」判定**直接复用 `business_relation.last_event_at`**（该列只在有效沟通时更新、快速标记不计），
 *   不重新派生，避免与跟单写入逻辑漂移（→ 需求 §8.2）。
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

  /**
   * 待办明细：承诺 `status='open'` 且 `due_at` ≤ 北京今日结束（含今日 ＋ 历史逾期）。
   * 按 `due_at` 升序（最紧急在前）；`overdue` ＝ 早于北京今日 0 点（前端据此置红）。
   */
  async listPendingTodo(
    deptIds: readonly bigint[] | null,
    range: DayRange,
    limit = 200,
  ): Promise<PendingTodoItem[]> {
    const scope = this.scopeFilter(deptIds, 'br');
    const rows = await this.prisma.$queryRaw<{
      relation_id: bigint;
      relation_name: string | null;
      contact_id: bigint | null;
      contact_name: string | null;
      due_at: Date;
      content: string | null;
      overdue_flag: bigint;
    }[]>`
      SELECT c.relation_id, co.full_name AS relation_name, c.contact_id, ct.name AS contact_name,
             c.due_at, c.content,
             CASE WHEN c.due_at < ${range.start} THEN 1 ELSE 0 END AS overdue_flag
      FROM commitment c
      INNER JOIN business_relation br ON br.id = c.relation_id
      LEFT JOIN company co ON co.id = br.company_id
      LEFT JOIN contact ct ON ct.id = c.contact_id
      WHERE c.status = 'open' AND c.due_at <= ${range.end}
        AND br.deleted_at IS NULL AND ${scope}
      ORDER BY c.due_at ASC
      LIMIT ${limit}
    `;
    return rows.map((r) => ({
      relation_id: String(r.relation_id),
      relation_name: r.relation_name,
      contact_id: r.contact_id != null ? String(r.contact_id) : null,
      contact_name: r.contact_name,
      due_at: r.due_at,
      overdue: Number(r.overdue_flag) === 1,
      content: r.content,
    }));
  }

  /**
   * 签约到期预警（`warnings.type=contract_expire`）：`status='running'` 且 `service_end` 落在
   * [北京今日, 北京今日+90天]（续约预警 30/60/90 的覆盖区间）。`days_left` 负＝已过期仍未续。
   */
  async listContractExpire(
    deptIds: readonly bigint[] | null,
    from: Date,
    to: Date,
    limit = 100,
  ): Promise<ContractExpireItem[]> {
    const scope = this.scopeFilter(deptIds, 'br');
    const rows = await this.prisma.$queryRaw<{
      contract_id: bigint;
      contract_no: string;
      relation_id: bigint;
      relation_name: string | null;
      service_end: Date | null;
      days_left: bigint | null;
    }[]>`
      SELECT ct.id AS contract_id, ct.contract_no, br.id AS relation_id, co.full_name AS relation_name,
             ct.service_end, DATEDIFF(ct.service_end, ${from}) AS days_left
      FROM contract ct
      INNER JOIN business_relation br ON br.id = ct.relation_id
      LEFT JOIN company co ON co.id = br.company_id
      WHERE ct.deleted_at IS NULL AND ct.status = 'running'
        AND ct.service_end >= ${from} AND ct.service_end <= ${to}
        AND ${scope}
      ORDER BY ct.service_end ASC
      LIMIT ${limit}
    `;
    return rows.map((r) => ({
      contract_id: String(r.contract_id),
      contract_no: r.contract_no,
      relation_id: String(r.relation_id),
      relation_name: r.relation_name,
      service_end: r.service_end,
      days_left: r.days_left != null ? Number(r.days_left) : null,
    }));
  }

  /**
   * 新商机（`warnings.type=new_biz`）：近 `since` 内新建档、且尚无有效跟进
   * （`last_event_at` 为空，或早于建档时间）。owner 取在位 owner。
   */
  async listNewBiz(
    deptIds: readonly bigint[] | null,
    since: Date,
    limit = 100,
  ): Promise<NewBizItem[]> {
    const scope = this.scopeFilter(deptIds, 'br');
    const rows = await this.prisma.$queryRaw<{
      relation_id: bigint;
      relation_name: string | null;
      owner_id: bigint | null;
      owner_name: string | null;
      created_at: Date;
    }[]>`
      SELECT br.id AS relation_id, co.full_name AS relation_name,
             rm.employee_id AS owner_id, e.name AS owner_name, br.created_at
      FROM business_relation br
      LEFT JOIN company co ON co.id = br.company_id
      LEFT JOIN relation_member rm ON rm.relation_id = br.id AND rm.owner_flag IS NOT NULL
      LEFT JOIN employee e ON e.id = rm.employee_id
      WHERE br.created_at >= ${since} AND br.deleted_at IS NULL
        AND (br.last_event_at IS NULL OR br.last_event_at < br.created_at)
        AND ${scope}
      ORDER BY br.created_at DESC
      LIMIT ${limit}
    `;
    return rows.map((r) => ({
      relation_id: String(r.relation_id),
      relation_name: r.relation_name,
      owner_id: r.owner_id != null ? String(r.owner_id) : null,
      owner_name: r.owner_name,
      created_at: r.created_at,
    }));
  }

  /**
   * 部门对比（`dept_compare`）：按 `dept_id` 聚**当月签约额** ＋ **当前私海关系数**（盘子）。
   * `dept_id` 恒定 → 聚合口径不因关系转交漂移；范围收敛只保留管辖部门。
   */
  async listDeptCompare(
    deptIds: readonly bigint[] | null,
    months: MonthRange,
  ): Promise<DeptCompareItem[]> {
    const scope = this.scopeFilter(deptIds, 'br');
    const rows = await this.prisma.$queryRaw<{
      dept_id: bigint;
      dept_name: string;
      signed_amount: Prisma.Decimal;
      relation_count: bigint;
    }[]>`
      SELECT br.dept_id, d.name AS dept_name,
             COALESCE(SUM(CASE WHEN ct.sign_date >= ${months.thisStart} AND ct.sign_date <= ${months.thisEnd}
                              AND ct.status IN ('running','done') AND ct.deleted_at IS NULL
                         THEN ct.amount ELSE 0 END), 0) AS signed_amount,
             COUNT(DISTINCT CASE WHEN br.sea_status = 'private' THEN br.id END) AS relation_count
      FROM business_relation br
      INNER JOIN department d ON d.id = br.dept_id
      LEFT JOIN contract ct ON ct.relation_id = br.id
      WHERE br.deleted_at IS NULL AND ${scope}
      GROUP BY br.dept_id, d.name
      ORDER BY signed_amount DESC
    `;
    return rows.map((r) => ({
      dept_id: String(r.dept_id),
      dept_name: r.dept_name,
      signed_amount: r.signed_amount.toNumber(),
      relation_count: Number(r.relation_count),
    }));
  }

  /**
   * 销冠榜（`top_sales`）：按 `contract.signer_id`（签单人＝业绩归属，终身锁定）聚当月签约额，
   * 降序取 Top N。范围收敛作用在 `business_relation.dept_id`（签单人可能跨部门，故按关系归属部门收敛）。
   */
  async listTopSales(
    deptIds: readonly bigint[] | null,
    months: MonthRange,
    limit = 10,
  ): Promise<TopSalesItem[]> {
    const scope = this.scopeFilter(deptIds, 'br');
    const rows = await this.prisma.$queryRaw<{
      owner_id: bigint;
      owner_name: string;
      signed_amount: Prisma.Decimal;
      contract_count: bigint;
    }[]>`
      SELECT ct.signer_id AS owner_id, e.name AS owner_name,
             COALESCE(SUM(ct.amount), 0) AS signed_amount, COUNT(*) AS contract_count
      FROM contract ct
      INNER JOIN business_relation br ON br.id = ct.relation_id
      INNER JOIN employee e ON e.id = ct.signer_id
      WHERE ct.deleted_at IS NULL AND ct.status IN ('running','done')
        AND ct.sign_date >= ${months.thisStart} AND ct.sign_date <= ${months.thisEnd}
        AND ${scope}
      GROUP BY ct.signer_id, e.name
      ORDER BY signed_amount DESC
      LIMIT ${limit}
    `;
    return rows.map((r) => ({
      owner_id: String(r.owner_id),
      owner_name: r.owner_name,
      signed_amount: r.signed_amount.toNumber(),
      contract_count: Number(r.contract_count),
    }));
  }

  /**
   * 周重点僵尸榜（`zombie_weekly`）：`urgency='weekly'` 且（`last_event_at` 为空 或 ≤ `since`＝14 天前）
   * 无任何有效推进。owner 取在位 owner；`no_progress_days` 取 `now − last_event_at`（无跟进给 9999）。
   */
  async listZombieWeekly(
    deptIds: readonly bigint[] | null,
    since: Date,
    now: Date,
    limit = 100,
  ): Promise<ZombieWeeklyItem[]> {
    const scope = this.scopeFilter(deptIds, 'br');
    const rows = await this.prisma.$queryRaw<{
      relation_id: bigint;
      relation_name: string | null;
      owner_id: bigint | null;
      owner_name: string | null;
      last_event_at: Date | null;
      no_progress_days: bigint;
    }[]>`
      SELECT br.id AS relation_id, co.full_name AS relation_name,
             rm.employee_id AS owner_id, e.name AS owner_name, br.last_event_at,
             CASE WHEN br.last_event_at IS NULL THEN 9999
                  ELSE DATEDIFF(${now}, br.last_event_at) END AS no_progress_days
      FROM business_relation br
      LEFT JOIN company co ON co.id = br.company_id
      LEFT JOIN relation_member rm ON rm.relation_id = br.id AND rm.owner_flag IS NOT NULL
      LEFT JOIN employee e ON e.id = rm.employee_id
      WHERE br.urgency = 'weekly' AND br.deleted_at IS NULL
        AND (br.last_event_at IS NULL OR br.last_event_at <= ${since})
        AND ${scope}
      ORDER BY no_progress_days DESC
      LIMIT ${limit}
    `;
    return rows.map((r) => ({
      relation_id: String(r.relation_id),
      relation_name: r.relation_name,
      owner_id: r.owner_id != null ? String(r.owner_id) : null,
      owner_name: r.owner_name,
      last_event_at: r.last_event_at,
      no_progress_days: Number(r.no_progress_days),
    }));
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
