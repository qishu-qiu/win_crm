import { ErrorCode } from '../errors/app-error';
import { bigintToJson, jsonToBigint, toJsonSafe } from './bigint';

/** 计划判据的样本：2^53 + 1 —— IEEE754 双精度**恰好表示不出来**的最小整数 */
const BEYOND_SAFE_INTEGER = 9007199254740993n;

describe('M0-25 BigInt ↔ string 序列化（防 JSON 精度丢失）', () => {
  it('计划判据：9007199254740993n 往返一致', () => {
    const text = bigintToJson(BEYOND_SAFE_INTEGER);
    expect(text).toBe('9007199254740993');
    expect(jsonToBigint(text)).toBe(BEYOND_SAFE_INTEGER);
  });

  it('为什么必须有这个文件：Number 丢精度、JSON.stringify 遇 BigInt 直接抛', () => {
    // ① 落进 Number 就永久丢精度（两个不同客户会变成同一个 id）
    expect(Number(BEYOND_SAFE_INTEGER)).toBe(9007199254740992);
    expect(BigInt(Number(BEYOND_SAFE_INTEGER))).not.toBe(BEYOND_SAFE_INTEGER);
    // ② 不转字符串，接口直接 500
    expect(() => JSON.stringify({ id: BEYOND_SAFE_INTEGER })).toThrow(TypeError);
    // ③ 转成字符串后，序列化与解析都无损
    expect(JSON.stringify({ id: bigintToJson(BEYOND_SAFE_INTEGER) })).toBe('{"id":"9007199254740993"}');
  });

  it('jsonToBigint：非法入参 → 400 / 20001，且提示里带字段名', () => {
    for (const bad of ['', '   ', 'abc', '1.5', '1e3', '12a', '0x10', '１２３', '- 1']) {
      expect(() => jsonToBigint(bad, 'relation_id')).toThrow(
        expect.objectContaining({
          httpStatus: 400,
          code: ErrorCode.PARAM_INVALID,
          message: expect.stringContaining('relation_id'),
        }),
      );
    }
  });

  it('jsonToBigint：合法整数（含前后空格、0、负数）', () => {
    expect(jsonToBigint(' 42 ')).toBe(42n);
    expect(jsonToBigint('0')).toBe(0n);
    expect(jsonToBigint('-7')).toBe(-7n);
    expect(jsonToBigint('18446744073709551615')).toBe(18446744073709551615n); // unsigned bigint 上限
  });

  it('toJsonSafe：深层 bigint 全转字符串，Date 原样交给 JSON 处理', () => {
    const occurredAt = new Date('2026-09-14T10:00:00.000Z');
    const payload = {
      id: BEYOND_SAFE_INTEGER,
      company: { owner_id: 2n, tags: [3n, 'x'] },
      occurredAt,
      count: 1,
      active: true,
      remark: null,
    };
    const safe = toJsonSafe(payload);
    expect(safe).toEqual({
      id: '9007199254740993',
      company: { owner_id: '2', tags: ['3', 'x'] },
      occurredAt,
      count: 1,
      active: true,
      remark: null,
    });
    // 整棵树真的能序列化，且 id 仍是无损字符串
    expect(JSON.parse(JSON.stringify(safe))).toMatchObject({ id: '9007199254740993' });
  });

  it('toJsonSafe：标量与 null 原样返回，不做多余加工', () => {
    expect(toJsonSafe(5n)).toBe('5');
    expect(toJsonSafe('a')).toBe('a');
    expect(toJsonSafe(null)).toBeNull();
    expect(toJsonSafe(undefined)).toBeUndefined();
    expect(toJsonSafe([])).toEqual([]);
  });
});
