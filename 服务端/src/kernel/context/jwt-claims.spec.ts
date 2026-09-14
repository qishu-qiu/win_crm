// =============================================================================
// 令牌声明契约用例（M0-32 前置）
// 断言的是「签发方与校验方口径一致」这件事 —— 那是本文件存在的全部理由。
// =============================================================================
import { AppError, ErrorCode } from '../errors/app-error';
import { type RequestContext } from './request-context';
import { fromClaims, toClaims, type AccessTokenClaims } from './jwt-claims';

/** 超出 IEEE754 安全整数范围的 id（2^53 + 1）：任何一次 Number 转换都会在这里露馅 */
const BIG_ID = 9007199254740993n;

const CONTEXT: RequestContext = {
  employeeId: BIG_ID,
  deptIds: [1n, 2n],
  roleCodes: ['sales', 'dept_manager'],
  dataScope: { type: 'dept', deptIds: [1n, 2n] },
};

describe('令牌声明契约（kernel/context/jwt-claims）', () => {
  describe('toClaims —— 签发侧', () => {
    it('id 一律转成十进制字符串：BigInt 进了 JSON number 就永久丢精度', () => {
      const claims = toClaims(CONTEXT);

      expect(claims.sub).toBe('9007199254740993');
      expect(claims.dept_ids).toEqual(['1', '2']);
      expect(claims.scope.dept_ids).toEqual(['1', '2']);
      // 反证：若这里漏转，JSON 序列化会直接抛 TypeError（BigInt 不可序列化）
      expect(() => JSON.stringify(claims)).not.toThrow();
    });

    it('角色码原样带出，且不共享引用（避免调用方改到上下文）', () => {
      const claims = toClaims(CONTEXT);

      expect(claims.roles).toEqual(['sales', 'dept_manager']);
      claims.roles.push('gm');
      expect(CONTEXT.roleCodes).toEqual(['sales', 'dept_manager']);
    });
  });

  describe('fromClaims —— 校验侧', () => {
    it('与 toClaims 往返一致，且大整数 id 一位不差（M0-25 同源口径）', () => {
      const restored = fromClaims(toClaims(CONTEXT));

      expect(restored).toEqual(CONTEXT);
      expect(restored.employeeId).toBe(BIG_ID);
      expect(typeof restored.employeeId).toBe('bigint');
    });

    it('容忍未来新增的声明（前向兼容：签发方加字段不该让老校验方拒绝）', () => {
      const claims: AccessTokenClaims & { new_field: string } = { ...toClaims(CONTEXT), new_field: 'x' };

      expect(fromClaims(claims)).toEqual(CONTEXT);
    });

    it('四档全都往返得回来（含 2026-09-14 新增的 `serving`）—— 漏一档就是「签得出来、解不回来」的令牌', () => {
      const cases: ReadonlyArray<{ type: RequestContext['dataScope']['type']; deptIds: bigint[] }> = [
        { type: 'self', deptIds: [] },
        { type: 'serving', deptIds: [] },
        { type: 'dept', deptIds: [1n] },
        { type: 'all', deptIds: [] },
      ];

      for (const { type, deptIds } of cases) {
        const context: RequestContext = { ...CONTEXT, dataScope: { type, deptIds } };

        expect(fromClaims(toClaims(context))).toEqual(context);
      }
    });

    // 形状非法一律 401 / 20002：令牌的问题＝调用方的问题，抛 500 会把「伪造 token」记成系统故障
    const invalidCases: ReadonlyArray<{ readonly name: string; readonly payload: unknown }> = [
      { name: '载荷不是对象', payload: 'not-an-object' },
      { name: '载荷是 null', payload: null },
      { name: '缺 sub', payload: { dept_ids: [], roles: [], scope: { type: 'all', dept_ids: [] } } },
      { name: 'sub 是数字（精度已在签发侧丢失）', payload: { ...toClaims(CONTEXT), sub: 9007199254740993 } },
      { name: 'sub 是负数', payload: { ...toClaims(CONTEXT), sub: '-1' } },
      { name: 'sub 是小数', payload: { ...toClaims(CONTEXT), sub: '1.5' } },
      { name: 'dept_ids 不是数组', payload: { ...toClaims(CONTEXT), dept_ids: '1,2' } },
      { name: 'roleCodes 含空串', payload: { ...toClaims(CONTEXT), roles: [''] } },
      { name: '缺 scope', payload: { sub: '1', dept_ids: [], roles: [] } },
      { name: 'scope.type 不在 self/serving/dept/all 四档内', payload: { ...toClaims(CONTEXT), scope: { type: 'company', dept_ids: [] } } },
      { name: 'scope.dept_ids 缺失（缺字段≠空数组）', payload: { ...toClaims(CONTEXT), scope: { type: 'all' } } },
    ];

    it.each(invalidCases)('$name → 401 / 20002', ({ payload }) => {
      expect.assertions(3);
      try {
        fromClaims(payload);
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).httpStatus).toBe(401);
        expect((error as AppError).code).toBe(ErrorCode.UNAUTHENTICATED);
      }
    });

    it('对外人话不泄露内部细节（约束名只进 constraint，供日志定位）', () => {
      try {
        fromClaims({ ...toClaims(CONTEXT), sub: '-1' });
        throw new Error('本该抛错');
      } catch (error) {
        expect((error as AppError).message).toBe('未登录或登录已过期');
        expect((error as AppError).constraint).toContain('sub');
      }
    });
  });
});
