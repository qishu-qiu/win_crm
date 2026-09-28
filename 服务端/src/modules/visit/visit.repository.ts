// =============================================================================
// 外出登记（visit）仓储层 —— **唯一允许 import Prisma 的地方**（架构 §2 / §5.4）
//
// ★ 纯行政考勤（→ 需求 §7.5 / 架构 C6）：只管 `visit_log` 的增 / 查 / 回，
//   不连任何业务域、不产生 `action_event`、不写任何跨域字段。
// =============================================================================
import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const VISIT_SELECT = {
  id: true,
  employee_id: true,
  depart_at: true,
  reason: true,
  actual_return_at: true,
  relation_ids: true,
  created_at: true,
} as const;

export type VisitRow = Prisma.VisitLogGetPayload<{ select: typeof VISIT_SELECT }>;

@Injectable()
export class VisitRepository {
  constructor(private readonly prisma: PrismaService) {}

  createVisit(data: {
    employee_id: bigint;
    depart_at: Date;
    reason: string;
    relation_ids: number[] | null;
  }): Promise<VisitRow> {
    // `relation_ids` 可空（JSON）：空数组归一成「不传」→ DB 落 `null`（与 `visit_log.relation_ids` 可空一致）
    return this.prisma.visitLog.create({
      data: { ...data, relation_ids: data.relation_ids ?? undefined },
      select: VISIT_SELECT,
    });
  }

  /** 按主键取一条外出登记（**带 `employee_id` 条件**：别人的外出记录不许动 / 不许看） */
  findById(employeeId: bigint, id: bigint): Promise<VisitRow | null> {
    return this.prisma.visitLog.findFirst({ where: { id, employee_id: employeeId }, select: VISIT_SELECT });
  }

  /** 回来点一下：只写 `actual_return_at`（纯行政，→ 需求 §7.5；`visit_log` 无 `updated_by` 列，靠 `@updatedAt` 落 `updated_at`） */
  returnVisit(id: bigint, actualReturnAt: Date): Promise<VisitRow> {
    return this.prisma.visitLog.update({
      where: { id },
      data: { actual_return_at: actualReturnAt },
      select: VISIT_SELECT,
    });
  }

  /** 我的外出记录（→ 接口 §5.8 `GET /visits`）：按 `depart_at` 倒序，可选某天过滤 */
  listMyVisits(employeeId: bigint, dateStart?: Date, dateEnd?: Date): Promise<VisitRow[]> {
    return this.prisma.visitLog.findMany({
      where: {
        employee_id: employeeId,
        ...(dateStart && dateEnd ? { depart_at: { gte: dateStart, lte: dateEnd } } : {}),
      },
      select: VISIT_SELECT,
      orderBy: { depart_at: 'desc' },
      take: 50,
    });
  }
}
