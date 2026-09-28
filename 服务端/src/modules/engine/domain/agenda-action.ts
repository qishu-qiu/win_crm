// =============================================================================
// D 域纯规则：今日动线处理动作的校验（→ 接口 §4.14.4 / 需求 §10.4）
//
// 分层约束（架构 §5.4）：`domain/**` 不 import 框架 / Prisma / 不查库；
//   只做「动作合不合法、ignored 要不要原因、snoozed 超没超限」的纯判定，
//   假数据即可单测（→ `agenda-action.spec.ts`）。
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM接口API文档》§4.14.4：`done` / `snoozed` / `ignored`；
//     `snoozed` 同一条最多 3 次；`ignored` 必填 reason（→ §2.4 `20403`）。
//   · 数据架构 D4 `daily_agenda.snooze_count`：「同一条最多 snooze 3 次，杜绝无限推迟」。
// =============================================================================
import { AppError, ErrorCode } from '../../../kernel/index';

/** 动线处理动作（→ §4.14.4） */
export const AGENDA_ACTIONS = ['done', 'snoozed', 'ignored'] as const;
export type AgendaAction = (typeof AGENDA_ACTIONS)[number];

/** `ignored` 原因上限（→ §4.14.4；与承诺豁免原因同档） */
export const AGENDA_IGNORED_REASON_MAX_LENGTH = 255;

/** `snoozed` 上限（→ 数据架构 D4 `snooze_count`：同一条最多 3 次） */
export const AGENDA_SNOOZE_MAX = 3;

export interface AgendaActionInput {
  action: string;
  reason?: string;
}

/**
 * 校验「动线处理动作」入参（纯规则，不碰库）。
 *
 * ★ 返回归一化后的 `action` 与 `reason`（空白原因归一成 `null`）；
 *   任何非法直接抛 `AppError`（横切层统一出口，controller 不拼错误响应）。
 *
 * 两道闸：
 *   ① `action` 不在白名单 → 400（枚举非法，→ §2.4）；
 *   ② `ignored` 没给原因 → 422 / `20403`（→ §4.14.4「ignored 必填原因」）；
 *   ③ `snoozed` 已达上限（当前 `snooze_count >= AGENDA_SNOOZE_MAX`）→ 422
 *     （「第 4 次起不再返回该选项，强制 done/ignored」，→ §4.14.4）。
 *
 * ⚠ `currentSnoozeCount` 由调用方从库里取（动作要落在哪条动线、已经推过几次是数据态），
 *   本函数不查库、只判「给的这个数超没超上限」。
 */
export function validateAgendaAction(
  input: AgendaActionInput,
  currentSnoozeCount: number,
): { action: AgendaAction; reason: string | null } {
  if (!AGENDA_ACTIONS.includes(input.action as AgendaAction)) {
    throw new AppError(
      ErrorCode.PARAM_INVALID,
      400,
      '参数错误：action 只能是 done / snoozed / ignored',
      { constraint: 'agenda.action_invalid' },
    );
  }
  const action = input.action as AgendaAction;

  if (action === 'ignored') {
    const reason = (input.reason ?? '').trim();
    if (reason.length === 0) {
      throw new AppError(ErrorCode.REQUIRED_MISSING, 422, '忽略动线必须填写原因', {
        constraint: 'agenda.ignored_reason_required',
      });
    }
    if (reason.length > AGENDA_IGNORED_REASON_MAX_LENGTH) {
      throw new AppError(
        ErrorCode.REQUIRED_MISSING,
        422,
        `忽略原因最长 ${AGENDA_IGNORED_REASON_MAX_LENGTH} 字`,
        { constraint: 'agenda.ignored_reason_too_long' },
      );
    }
    return { action, reason };
  }

  if (action === 'snoozed') {
    if (currentSnoozeCount >= AGENDA_SNOOZE_MAX) {
      throw new AppError(
        ErrorCode.REQUIRED_MISSING,
        422,
        `「明天再说」最多 ${AGENDA_SNOOZE_MAX} 次，请今天处理或选择忽略`,
        { constraint: 'agenda.snooze_capped' },
      );
    }
  }

  return { action, reason: (input.reason ?? '').trim() || null };
}
