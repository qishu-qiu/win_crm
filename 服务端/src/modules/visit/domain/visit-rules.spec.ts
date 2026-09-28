// =============================================================================
// 外出登记纯规则单测（M8-06 Phase 2-B）：建登校验
//   不连库、不引框架 —— 只钉「reason 必填/超长」「relation_ids 是不是正整数数组」。
// =============================================================================
import { AppError } from '../../../kernel/index';
import { validateCreateVisit } from './visit-rules';

async function capture(fn: () => unknown): Promise<AppError> {
  try {
    fn();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('期望抛 AppError，但调用成功');
}

describe('validateCreateVisit（M8-06 Phase 2-B）', () => {
  it('正常：reason 合法、无 relation_ids → 归一成 null', () => {
    expect(validateCreateVisit({ reason: '拜访 A 客户' })).toEqual({
      reason: '拜访 A 客户',
      relationIds: null,
    });
  });

  it('正常：带 relation_ids → 原样返回', () => {
    expect(validateCreateVisit({ reason: ' 续约面谈 ', relationIds: [1001, 1002] })).toEqual({
      reason: '续约面谈',
      relationIds: [1001, 1002],
    });
  });

  it('reason 为空 → 422', async () => {
    const error = await capture(() => validateCreateVisit({ reason: '   ' }));
    expect(error.httpStatus).toBe(422);
    expect(error.constraint).toBe('visit.reason_required');
  });

  it('reason 超长 → 422', async () => {
    const error = await capture(() => validateCreateVisit({ reason: 'x'.repeat(256) }));
    expect(error.httpStatus).toBe(422);
    expect(error.constraint).toBe('visit.reason_too_long');
  });

  it('relation_ids 含非正整数 → 400', async () => {
    const error = await capture(() => validateCreateVisit({ reason: 'ok', relationIds: [0, -3] }));
    expect(error.httpStatus).toBe(400);
    expect(error.constraint).toBe('visit.relation_id_invalid');
  });
});
