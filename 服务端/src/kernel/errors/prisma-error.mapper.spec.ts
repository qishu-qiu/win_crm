import { AppError, ErrorCode } from './app-error';
import { PRISMA_UNIQUE_CONFLICT, mapPrismaError, type PrismaKnownErrorLike } from './prisma-error.mapper';

/** 假 P2002 —— M0-23 判据就是「假 P2002」，全程不碰真库 */
function fakeP2002(target: unknown): PrismaKnownErrorLike {
  return { code: PRISMA_UNIQUE_CONFLICT, meta: { target } };
}

function mapOrFail(error: unknown): AppError {
  const mapped = mapPrismaError(error);
  if (mapped === null) throw new Error('期望映射为 AppError，实际返回 null');
  return mapped;
}

describe('M0-23 P2002 → 409 / 人话（架构 §7.5 / API §2.4）', () => {
  it('计划判据：假 P2002（uk_active_rel）→ 409，且提示可定位到约束名', () => {
    const err = mapOrFail(fakeP2002(['uk_active_rel']));
    expect(err).toBeInstanceOf(AppError);
    expect(err.httpStatus).toBe(409);
    expect(err.code).toBe(ErrorCode.RELATION_DUPLICATED);
    expect(err.constraint).toBe('uk_active_rel');
    expect(err.message).toContain('归属');
  });

  it('uk_phone_active → 409「该手机号已存在」（架构 §7.5）', () => {
    const err = mapOrFail(fakeP2002(['uk_phone_active']));
    expect(err.httpStatus).toBe(409);
    expect(err.code).toBe(ErrorCode.UNIQUE_CONFLICT);
    expect(err.message).toBe('该手机号已存在');
  });

  it('uk_owner → 409（一关系多 owner，架构 §7.5）', () => {
    const err = mapOrFail(fakeP2002(['uk_owner']));
    expect(err.httpStatus).toBe(409);
    expect(err.constraint).toBe('uk_owner');
  });

  it('uk_contract_no / uk_line_scope_field 同样 409（→ §4.8 / §5.15）', () => {
    expect(mapOrFail(fakeP2002(['uk_contract_no'])).httpStatus).toBe(409);
    expect(mapOrFail(fakeP2002(['uk_line_scope_field'])).httpStatus).toBe(409);
  });

  it('MySQL 形状兜底：meta.target 回列名（phone_active）也能命中同一规则', () => {
    const err = mapOrFail(fakeP2002(['phone_active']));
    expect(err.httpStatus).toBe(409);
    expect(err.constraint).toBe('uk_phone_active');
    expect(err.message).toBe('该手机号已存在');
  });

  it('meta.target 是字符串（非数组）也认', () => {
    expect(mapOrFail(fakeP2002('uk_active_rel')).code).toBe(ErrorCode.RELATION_DUPLICATED);
  });

  it('大小写 / 前后空格不敏感', () => {
    expect(mapOrFail(fakeP2002([' UK_Active_Rel '])).constraint).toBe('uk_active_rel');
  });

  it('未登记的约束 → 兜底 409 / 20004，且提示里**回带约束名**（判据「提示含约束名」的字面落点）', () => {
    const err = mapOrFail(fakeP2002(['uk_some_new_thing']));
    expect(err.httpStatus).toBe(409);
    expect(err.code).toBe(ErrorCode.UNIQUE_CONFLICT);
    expect(err.message).toContain('uk_some_new_thing');
  });

  it('target 缺失 → 仍给 409 兜底，不抛异常', () => {
    const err = mapOrFail({ code: PRISMA_UNIQUE_CONFLICT, meta: {} });
    expect(err.httpStatus).toBe(409);
    expect(err.constraint).toBe('未知约束');
  });

  it('非 P2002 / 非错误对象 → 返回 null（交全局过滤器兜底，不吞异常）', () => {
    expect(mapPrismaError({ code: 'P2025', meta: {} })).toBeNull();
    expect(mapPrismaError(new Error('boom'))).toBeNull();
    expect(mapPrismaError(undefined)).toBeNull();
    expect(mapPrismaError(null)).toBeNull();
  });

  it('原始 Prisma 错误挂 cause，且不透进 message（§2.4 不把 DB 原话丢给销售）', () => {
    const raw = fakeP2002(['uk_phone_active']);
    const err = mapOrFail(raw);
    expect(err.cause).toBe(raw);
    expect(err.message).not.toContain('Duplicate entry');
  });
});
