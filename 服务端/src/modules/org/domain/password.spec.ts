// =============================================================================
// 密码哈希用例（M1-07）
// 判据逐字（《开发计划》M1-07）：「单测：正确 → true、错误 → false」。
// 另加两条本项目自立的硬要求：① 哈希串**不含明文**；② 串长必须留在 A2 的 VARCHAR(255) 内。
// =============================================================================
import { hashPassword, verifyPassword } from './password';

const PASSWORD = 'Passw0rd!';
/** A2 `employee.password_hash` 的列宽（→ 数据架构 A2 `VARCHAR(255)`）—— 超出即写库失败 */
const PASSWORD_HASH_MAX_LENGTH = 255;

describe('密码哈希 / 校验（M1-07）', () => {
  /** scrypt 是刻意慢的算法，一次哈希复用给多个断言，避免用例整体变慢 */
  let stored: string;

  beforeAll(async () => {
    stored = await hashPassword(PASSWORD);
  });

  it('哈希串是**自描述**的 `scrypt$N$r$p$salt$hash` 六段，且不含明文', () => {
    const parts = stored.split('$');

    expect(parts).toHaveLength(6);
    expect(parts[0]).toBe('scrypt');
    expect(Number(parts[1])).toBeGreaterThan(0); // N
    expect(Number(parts[2])).toBeGreaterThan(0); // r
    expect(Number(parts[3])).toBeGreaterThan(0); // p
    expect(stored).not.toContain(PASSWORD);
  });

  it('串长留在 A2 的 VARCHAR(255) 内（否则「能算出哈希、写不进库」）', () => {
    expect(stored.length).toBeLessThanOrEqual(PASSWORD_HASH_MAX_LENGTH);
  });

  it('正确密码 → true（判据本体）', async () => {
    await expect(verifyPassword(PASSWORD, stored)).resolves.toBe(true);
  });

  it('错误密码 → false（判据本体）', async () => {
    await expect(verifyPassword('WrongPassword!', stored)).resolves.toBe(false);
  });

  it('同一明文两次哈希结果不同（每次新随机盐，**这是设计使然**不是不稳定）', async () => {
    const second = await hashPassword(PASSWORD);

    expect(second).not.toBe(stored);
    // 但两个串都能验过同一明文 —— 证明「结果不同」没有牺牲正确性
    await expect(verifyPassword(PASSWORD, second)).resolves.toBe(true);
  });

  it.each([
    ['空串', ''],
    ['明文（根本不是哈希串）', PASSWORD],
    ['段数不对', 'scrypt$16384$8$1$onlyFiveParts'],
    ['算法不认识（换了个算法）', 'bcrypt$16384$8$1$c2FsdA==$aGFzaA=='],
    ['N 不是整数', 'scrypt$abc$8$1$c2FsdA==$aGFzaA=='],
    ['N 为 0（成本参数非法）', 'scrypt$0$8$1$c2FsdA==$aGFzaA=='],
  ])('存储串非法（%s）→ false，**不抛错**（绝不让脏数据把登录打成 500）', async (_name, broken) => {
    await expect(verifyPassword(PASSWORD, broken)).resolves.toBe(false);
  });

  it('存储串里的成本参数被篡改 → false（参数确实参与校验，不是装饰）', async () => {
    const parts = stored.split('$');
    parts[1] = String(Number(parts[1]) * 2); // 只改 N

    await expect(verifyPassword(PASSWORD, parts.join('$'))).resolves.toBe(false);
  });

  it('超长密码不会意外通过（长度参与派生）', async () => {
    await expect(verifyPassword(`${PASSWORD}${'x'.repeat(200)}`, stored)).resolves.toBe(false);
  });
});
