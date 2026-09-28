// =============================================================================
// D 域纯规则单测（M8-06 Phase 2-A）：动线处理动作校验
//   不连库、不引框架 —— 只钉「动作合不合法 / ignored 要不要原因 / snoozed 超没超限」。
// =============================================================================
import { AppError, ErrorCode } from '../../../kernel/index';
import { AGENDA_SNOOZE_MAX, validateAgendaAction } from './agenda-action';

async function captureAppError(fn: () => unknown): Promise<AppError> {
  try {
    fn();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('期望抛出 AppError，但调用成功返回了');
}

describe('validateAgendaAction（M8-06 Phase 2-A）', () => {
  it('`done` / `snoozed` / `ignored` 都合法，且 reason 空白归一成 null', () => {
    expect(validateAgendaAction({ action: 'done' }, 0)).toEqual({ action: 'done', reason: null });
    expect(validateAgendaAction({ action: 'snoozed' }, 0).action).toBe('snoozed');
    expect(validateAgendaAction({ action: 'ignored', reason: '  客户已离职  ' }, 0)).toEqual({
      action: 'ignored',
      reason: '客户已离职',
    });
  });

  it('`action` 不在白名单 → 400（枚举非法）', async () => {
    const error = await captureAppError(() => validateAgendaAction({ action: 'postpone' }, 0));
    expect(error.httpStatus).toBe(400);
    expect(error.code).toBe(ErrorCode.PARAM_INVALID);
    expect(error.constraint).toBe('agenda.action_invalid');
  });

  it('`ignored` 没给原因 → 422 / `20403`，不归一成空', async () => {
    const error = await captureAppError(() => validateAgendaAction({ action: 'ignored' }, 0));
    expect(error.httpStatus).toBe(422);
    expect(error.code).toBe(ErrorCode.REQUIRED_MISSING);
    expect(error.constraint).toBe('agenda.ignored_reason_required');
  });

  it('`ignored` 原因超长 → 422（与承诺豁免同档上限）', async () => {
    const error = await captureAppError(() =>
      validateAgendaAction({ action: 'ignored', reason: 'x'.repeat(256) }, 0),
    );
    expect(error.httpStatus).toBe(422);
    expect(error.constraint).toBe('agenda.ignored_reason_too_long');
  });

  it('`snoozed` 已达上限（snooze_count == 3）→ 422，第 4 次被拦', async () => {
    const error = await captureAppError(() => validateAgendaAction({ action: 'snoozed' }, AGENDA_SNOOZE_MAX));
    expect(error.httpStatus).toBe(422);
    expect(error.constraint).toBe('agenda.snooze_capped');
  });

  it('`snoozed` 未达上限（snooze_count == 2）→ 放行', () => {
    expect(validateAgendaAction({ action: 'snoozed' }, 2).action).toBe('snoozed');
  });
});
