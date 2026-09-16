// =============================================================================
// A 域纯规则（M1-07）—— 密码哈希 / 校验（`hash` ＋ `verify`）
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM数据架构文档》A2 `employee.password_hash VARCHAR(255)`：
//     只存**哈希**、绝不存明文（故哈希串长度必须留在 255 内 —— 本实现的串长约 130 字符，安全）。
//   · 《销售CRM架构设计说明》§5.4：`domain/**` 须与框架 / ORM 解耦。
//
// ★ 为什么用 Node 内置 `node:crypto` 的 `scrypt`，而不是新装 `bcrypt`：
//   ① `scrypt` 是**内存硬（memory-hard）**算法，抗 GPU 暴力枚举，强度不低于 bcrypt；
//   ② **零新依赖** —— 装 `bcrypt` 要带 native 编译（Windows 上极易翻车），
//      `bcryptjs` 则是纯 JS、强度更弱；两者都要过一遍依赖审批，而内置算法不用；
//   ③ 版本锚点已在 M0-01 定稿，M1 阶段不动依赖清单。
//
// ★ 哈希串格式（**自描述**，参数写进串里）：
//   `scrypt$N$r$p$<saltBase64>$<hashBase64>`
//   好处＝将来升级参数（如 N 翻倍）时，**旧串仍能按它自己的参数验证通过**，
//   不会出现「改一次强度，全公司登录不了」的事故。
//
// 分层约束（架构 §5.4）：本文件**不 import `@nestjs/*` / `@prisma/client`**、不查库。
//   ⚠ 严格说它不是数学意义的「纯函数」（随机盐 + 异步），但**无副作用、无 IO、可脱离框架单测**，
//     与 M1-06 / M1-15 的 domain 层纪律一致。
// =============================================================================
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/** scrypt 成本参数（`N` 越大越慢越安全；`r` 块大小；`p` 并行度） */
interface ScryptParams {
  readonly N: number;
  readonly r: number;
  readonly p: number;
}

const ALGORITHM = 'scrypt';
const SALT_BYTES = 16;
const KEY_BYTES = 64;
/**
 * 默认成本参数：`N=16384, r=8, p=1`（≈ 16MB 内存、单次 ~50ms 量级）。
 * 取值口径：登录是**低频**动作，用户可感知阈值内尽量拉高；再高会让测试与并发登录变慢。
 */
const DEFAULT_PARAMS: ScryptParams = { N: 16384, r: 8, p: 1 };

/** scrypt 内存上限：`128 * N * r` 是算法实际占用，留一倍余量（Node 默认 32MB 在高 N 时会直接抛错） */
function maxmemFor(params: ScryptParams): number {
  return 128 * params.N * params.r * 2;
}

/** 派生密钥（Promise 化，避免 `scryptSync` 阻塞事件循环） */
function deriveKey(password: string, salt: Buffer, params: ScryptParams): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      KEY_BYTES,
      { N: params.N, r: params.r, p: params.p, maxmem: maxmemFor(params) },
      (error, derivedKey) => {
        if (error) {
          reject(error);
        } else {
          resolve(derivedKey);
        }
      },
    );
  });
}

/** 解析已存哈希串；**格式非法一律返回 `null`**（由调用方当「验不过」处理，不抛错、不泄露内部形状） */
function parseStored(stored: string): { params: ScryptParams; salt: Buffer; hash: Buffer } | null {
  const parts = stored.split('$');
  if (parts.length !== 6) return null;
  const [algorithm, rawN, rawR, rawP, rawSalt, rawHash] = parts;
  if (algorithm !== ALGORITHM) return null;

  const N = Number(rawN);
  const r = Number(rawR);
  const p = Number(rawP);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return null;
  if (N <= 0 || r <= 0 || p <= 0) return null;

  return {
    params: { N, r, p },
    salt: Buffer.from(rawSalt, 'base64'),
    hash: Buffer.from(rawHash, 'base64'),
  };
}

/**
 * 生成密码哈希（登录 M1-08 用；`password_hash` 入库唯一来源）。
 * 每次调用都用**新的随机盐**，故同一明文两次结果不同 —— 这是**设计使然**，不是不稳定。
 */
export async function hashPassword(plain: string): Promise<string> {
  const params = DEFAULT_PARAMS;
  const salt = randomBytes(SALT_BYTES);
  const hash = await deriveKey(plain, salt, params);
  return [
    ALGORITHM,
    params.N,
    params.r,
    params.p,
    salt.toString('base64'),
    hash.toString('base64'),
  ].join('$');
}

/**
 * 校验密码。
 * ★ 用 `timingSafeEqual` 做**定长比较**，不用 `===` —— 后者会在首个不同字节处提前返回，
 *   把「密码前几位对上了」这件事通过耗时间接泄露出去。
 *
 * @returns 存储串格式非法 / 算法不识别 / 密码不符 → `false`（**不抛错**，调用方统一返「手机号或密码不正确」）
 */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parsed = parseStored(stored);
  if (parsed === null) return false;

  let actual: Buffer;
  try {
    actual = await deriveKey(plain, parsed.salt, parsed.params);
  } catch {
    // 存储串里的参数离谱（如 N 大到内存爆）→ 视为验不过，绝不把 500 抛给登录接口
    return false;
  }

  if (actual.length !== parsed.hash.length) return false;
  return timingSafeEqual(actual, parsed.hash);
}
