// =============================================================================
// 目标仓储（M8-06 Phase 4 切片 1）—— 唯一允许 import Prisma 的地方
//
// 分层约束（架构 §5.4）：本文件只碰 Prisma；不写业务判断（判断在 `target.service.ts`）。
// 口径来源（★ 真相源）：
//   · 《销售CRM数据架构文档》`target`（回款额口径）/ `contract`（amount＝签约额、paid_amount＝回款额、
//     sign_date 落月；无 dept_id，部门 scope 经 `relation_id → business_relation.dept_id`）。
// =============================================================================
import { Injectable } from '@nestjs/common';
import { Prisma, type Target } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface ScopeAmounts {
  signed: number;
  paid: number;
}

@Injectable()
export class TargetRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** 取调用方可见的「当月」目标行（where 由 service 按数据范围拼好） */
  listTargetsByWhere(where: Prisma.TargetWhereInput): Promise<Target[]> {
    return this.prisma.target.findMany({ where });
  }

  /**
   * 某 scope 当月签约额 / 回款额（按 `Contract.sign_date` 落在 period 内合计）。
   * scope 过滤：company(scope_id=0→全公司；≠0→company_id) / dept(→relation.dept_id) / employee(→signer_id)。
   */
  async sumContractAmountsByScope(
    scopeType: string,
    scopeId: bigint,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<ScopeAmounts> {
    const filters: Prisma.Sql[] = [
      Prisma.sql`c.deleted_at IS NULL`,
      Prisma.sql`c.sign_date >= ${periodStart}`,
      Prisma.sql`c.sign_date <= ${periodEnd}`,
    ];
    if (scopeType === 'company') {
      if (scopeId !== 0n) filters.push(Prisma.sql`c.company_id = ${scopeId}`);
    } else if (scopeType === 'dept') {
      filters.push(Prisma.sql`r.dept_id = ${scopeId}`);
    } else {
      filters.push(Prisma.sql`c.signer_id = ${scopeId}`);
    }
    const whereSql = Prisma.join(filters, ' AND ');

    const rows = await this.prisma.$queryRaw<{ signed: Prisma.Decimal; paid: Prisma.Decimal }[]>`
      SELECT COALESCE(SUM(c.amount), 0) AS signed, COALESCE(SUM(c.paid_amount), 0) AS paid
      FROM contract c
      LEFT JOIN business_relation r ON c.relation_id = r.id
      WHERE ${whereSql}
    `;
    const row = rows[0] ?? { signed: new Prisma.Decimal(0), paid: new Prisma.Decimal(0) };
    return { signed: row.signed.toNumber(), paid: row.paid.toNumber() };
  }

  /** scope 展示名（看板用；查不到则回退 id 文本） */
  async resolveScopeName(scopeType: string, scopeId: bigint): Promise<string> {
    if (scopeType === 'company') return '全公司';
    if (scopeType === 'dept') {
      const dept = await this.prisma.department.findUnique({
        where: { id: scopeId },
        select: { name: true },
      });
      return dept?.name ?? `部门${scopeId}`;
    }
    const emp = await this.prisma.employee.findUnique({
      where: { id: scopeId },
      select: { name: true },
    });
    return emp?.name ?? `员工${scopeId}`;
  }
}
