// =============================================================================
// 外出登记（visit）服务层 —— 编排 / 调仓储 / 抛统一错误（架构 §2 / §5.4）
//
// ★ 纯行政考勤（→ 需求 §7.5 / 架构 C6）：不连业务域、不产业务事件、不写跨域字段；
//   `employee_id` 一律取**当前登录人**（外出登记是「我」的行踪，→ 需求 §7.5）。
// =============================================================================
import { Injectable } from '@nestjs/common';
import { AppError, ErrorCode, getRequestContext, jsonToBigint } from '../../kernel/index';
import { CreateVisitDto } from './dto/visit-request.dto';
import { VisitLogDto } from './dto/visit-response.dto';
import { validateCreateVisit } from './domain/visit-rules';
import { VisitRepository, type VisitRow } from './visit.repository';

/** 审计动作名（→ 数据架构 §A10；★ 只增不改） */
export const VISIT_AUDIT_ACTIONS = {
  /** 登记外出 → `POST /visits` */
  create: 'visit.create',
  /** 回来点一下 → `POST /visits/:id/return` */
  return: 'visit.return',
} as const;

export interface ListVisitQuery {
  /** 可选：只看某天（本地 `YYYY-MM-DD`）；不传＝最近 50 条 */
  date?: string;
}

@Injectable()
export class VisitService {
  constructor(private readonly repository: VisitRepository) {}

  /** `POST /visits`：登记一条外出（→ 接口 §4.7 / §5.8） */
  async createVisit(dto: CreateVisitDto): Promise<VisitLogDto> {
    const viewer = requireViewer();
    const { reason, relationIds } = validateCreateVisit({
      reason: dto.reason,
      relationIds: dto.relation_ids,
    });

    const row = await this.repository.createVisit({
      employee_id: viewer.employeeId,
      depart_at: new Date(dto.depart_at),
      reason,
      relation_ids: relationIds,
    });
    return this.toDto(row);
  }

  /** `POST /visits/:id/return`：回来点一下（→ 接口 §4.7）。★ 只写 `actual_return_at`，纯行政 */
  async returnVisit(id: string): Promise<VisitLogDto> {
    const viewer = requireViewer();
    const visitId = jsonToBigint(id, 'id');

    const row = await this.repository.findById(viewer.employeeId, visitId);
    if (row === null) {
      throw new AppError(ErrorCode.PARAM_INVALID, 404, '外出登记不存在或不属于你', {
        constraint: 'visit.not_found',
      });
    }
    if (row.actual_return_at !== null) {
      throw new AppError(ErrorCode.REQUIRED_MISSING, 422, '这条外出已经回来了，不能重复点', {
        constraint: 'visit.already_returned',
      });
    }

    const updated = await this.repository.returnVisit(visitId, new Date());
    return this.toDto(updated);
  }

  /** `GET /visits`：我的外出记录（→ 接口 §5.8） */
  async listMyVisits(query: ListVisitQuery): Promise<VisitLogDto[]> {
    const viewer = requireViewer();

    let dateStart: Date | undefined;
    let dateEnd: Date | undefined;
    if (query.date !== undefined && query.date !== '') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(query.date)) {
        throw new AppError(ErrorCode.PARAM_INVALID, 400, 'date 须为 YYYY-MM-DD', {
          constraint: 'visit.date_format',
        });
      }
      dateStart = new Date(`${query.date}T00:00:00`);
      dateEnd = new Date(`${query.date}T23:59:59.999`);
    }

    const rows = await this.repository.listMyVisits(viewer.employeeId, dateStart, dateEnd);
    return rows.map((row) => this.toDto(row));
  }

  /** 行 → 出参（纯装配；权限 / 合法性都不在这一层做） */
  private toDto(row: VisitRow): VisitLogDto {
    return {
      id: row.id.toString(),
      employee_id: row.employee_id.toString(),
      depart_at: row.depart_at.toISOString(),
      reason: row.reason,
      actual_return_at: row.actual_return_at === null ? null : row.actual_return_at.toISOString(),
      relation_ids:
        row.relation_ids === null
          ? []
          : (row.relation_ids as unknown[]).map((v) => String(v)),
      created_at: row.created_at.toISOString(),
    };
  }
}

/** 取当前登录人（→ 同 engine/sea/trade 各域本地实现：缺上下文＝守卫没跑＝401，不静默降级） */
function requireViewer(): { employeeId: bigint; roleCodes: readonly string[] } {
  const context = getRequestContext();
  if (context === undefined) {
    throw new AppError(ErrorCode.UNAUTHENTICATED, 401, '未登录或登录已过期', {
      constraint: 'visit.no_context',
    });
  }
  return { employeeId: context.employeeId, roleCodes: context.roleCodes };
}
