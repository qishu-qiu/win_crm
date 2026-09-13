import { AppError, ErrorCode } from './app-error';

describe('M0-22 AppError 基类（code / httpStatus / message）', () => {
  it('计划判据：构造后能读到 status', () => {
    const err = new AppError(ErrorCode.RELATION_DUPLICATED, 409, '该公司在该部门·产品线下已有归属');
    expect(err.httpStatus).toBe(409);
    expect(err.code).toBe(20401);
    expect(err.message).toBe('该公司在该部门·产品线下已有归属');
  });

  it('是真 Error：可 throw / catch，instanceof 成立', () => {
    const err = new AppError(ErrorCode.PARAM_INVALID, 400, '参数错误');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AppError);
    expect(err.name).toBe('AppError');
    expect(() => {
      throw err;
    }).toThrow(AppError);
  });

  it('constraint / cause 是内部定位字段（只进日志），且不透 DB 原话进 message', () => {
    const cause = new Error("Duplicate entry '13800000000' for key 'uk_phone_active'");
    const err = new AppError(ErrorCode.UNIQUE_CONFLICT, 409, '该手机号已存在', {
      constraint: 'uk_phone_active',
      cause,
    });
    expect(err.constraint).toBe('uk_phone_active');
    expect(err.cause).toBe(cause);
    expect(err.message).not.toContain('Duplicate entry');
  });

  it('code 与 httpStatus 是两套编号，互不干扰', () => {
    const err = new AppError(ErrorCode.UNIQUE_CONFLICT, 409, 'x');
    expect(err.httpStatus).not.toBe(err.code);
  });

  it('错误码表与《接口API文档》§2.4 逐行一致', () => {
    expect(ErrorCode.OK).toBe(0);
    expect(ErrorCode.PARAM_INVALID).toBe(20001);
    expect(ErrorCode.UNAUTHENTICATED).toBe(20002);
    expect(ErrorCode.FORBIDDEN).toBe(20003);
    expect(ErrorCode.UNIQUE_CONFLICT).toBe(20004);
    expect(ErrorCode.RATE_LIMITED).toBe(20005);
    expect(ErrorCode.INTERNAL).toBe(20099);
    expect(ErrorCode.RELATION_DUPLICATED).toBe(20401);
    expect(ErrorCode.OVER_LIMIT).toBe(20402);
    expect(ErrorCode.REQUIRED_MISSING).toBe(20403);
    expect(ErrorCode.APPOINTMENT_UNFINISHED).toBe(20404);
    expect(ErrorCode.UNLOCK_REQUEST_EXISTS).toBe(20405);
    expect(ErrorCode.RELATION_ACTIVATED).toBe(20406);
  });

  it('错误码无重复（防手抄串号）', () => {
    const values = Object.values(ErrorCode);
    expect(new Set(values).size).toBe(values.length);
  });
});
