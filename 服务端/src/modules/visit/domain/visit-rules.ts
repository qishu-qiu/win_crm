// =============================================================================
// 外出登记（visit）纯规则（→ 需求 §7.5 / 架构 C6）
//
// 分层约束（架构 §5.4）：`domain/**` 不 import 框架 / Prisma / 不查库。
// 只做「reason 合不合法、relation_ids 是不是正整数数组」的纯判定，假数据即可单测。
//
// ★ 业务边界（勿自造，→ 需求 §7.5 / §14.2）：外出登记＝**纯行政考勤**，
//   不校验客户归属、不自动产生业务事件、不关联报销；`relation_ids` 只是「去了哪些客户」的备注。
// =============================================================================
import { AppError, ErrorCode } from '../../../kernel/index';

export interface CreateVisitInput {
  reason: string;
  relationIds?: number[];
}

/** reason 上限（→ 架构 C6 `visit_log.reason` VARCHAR(255)） */
export const VISIT_REASON_MAX_LENGTH = 255;

/**
 * 校验「新建外出登记」入参（纯规则，不碰库）。
 * 返回归一化后的 `reason` 与 `relationIds`（空数组归一成 `null`，与 `visit_log.relation_ids` 可空一致）。
 * 非法直接抛 `AppError`（横切层统一出口）。
 */
export function validateCreateVisit(input: CreateVisitInput): {
  reason: string;
  relationIds: number[] | null;
} {
  const reason = (input.reason ?? '').trim();
  if (reason.length === 0) {
    throw new AppError(ErrorCode.REQUIRED_MISSING, 422, '去干什么（reason）必填', {
      constraint: 'visit.reason_required',
    });
  }
  if (reason.length > VISIT_REASON_MAX_LENGTH) {
    throw new AppError(
      ErrorCode.REQUIRED_MISSING,
      422,
      `reason 最长 ${VISIT_REASON_MAX_LENGTH} 字`,
      { constraint: 'visit.reason_too_long' },
    );
  }

  const relationIds = input.relationIds ?? [];
  for (const rid of relationIds) {
    if (!Number.isInteger(rid) || rid <= 0) {
      throw new AppError(ErrorCode.PARAM_INVALID, 400, 'relation_ids 每项须为正整数', {
        constraint: 'visit.relation_id_invalid',
      });
    }
  }

  return { reason, relationIds: relationIds.length === 0 ? null : relationIds };
}
