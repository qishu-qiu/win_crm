// =============================================================================
// E 域（合同）疑似重复分组纯函数（M9-E / B6）
//
// 分层约束（架构 §5.4）：本文件**零框架依赖**——不 import `@nestjs/*`、不 import Prisma、
// 不查库。假数据即可单测（→ CODEBUDDY.md §5）。
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM数据架构文档》E1（"逻辑重复"检测口径）：同 `company_id`（经 `relation_id`
//     归到同一家公司）＋ 同 `signer_id` ＋ 同 `amount` ＋ `sign_date` 相近（默认 ≤7 天）分组。
//   · 《销售CRM接口API文档》§4.8：`GET /contracts/suspected-duplicates` 返回可疑对，
//     **系统只列清单给经理，不自动合并 / 不自动拦截 / 不自动删**（→ 需求 §十六 N7）。
// =============================================================================

/** 参与重复检测的合同行（仓储只取这 6 列） */
export interface DuplicateCheckContract {
  id: bigint;
  contract_no: string;
  company_id: bigint;
  signer_id: bigint;
  /** Decimal 字符串（按字符串相等分组：同值同表示） */
  amount: string;
  sign_date: Date | null;
}

/** 可疑对中的单条合同（→ §4.8 出参 `contracts:[{id,contract_no,amount,sign_date,signer_id}]`） */
export interface DuplicatePairContract {
  id: bigint;
  contract_no: string;
  amount: string;
  sign_date: string | null;
  signer_id: bigint;
}

/** 一组可疑对（按 `company_id` 归并；→ §4.8 出参 `[{company_id, contracts:[...]}]`） */
export interface SuspectedDuplicate {
  company_id: bigint;
  contracts: [DuplicatePairContract, DuplicatePairContract];
}

/** 归一化 `window_days`：非正整数 → 默认 7；下限 1（天数必须 ≥1 才有"相近"语义） */
export function normalizeWindowDays(raw: unknown): number {
  const n = typeof raw === 'string' ? Number(raw) : (raw as number);
  if (!Number.isFinite(n) || n < 1) return 7;
  return Math.floor(n);
}

function toPair(row: DuplicateCheckContract): DuplicatePairContract {
  return {
    id: row.id,
    contract_no: row.contract_no,
    amount: row.amount,
    sign_date: row.sign_date === null ? null : row.sign_date.toISOString(),
    signer_id: row.signer_id,
  };
}

/**
 * 疑似重复合同检测（纯函数，无副作用）。
 *
 * 步骤：
 *   ① 按 `company_id ＋ signer_id ＋ amount` 分组（三组都相同才可能是"同一笔真合同两个编号"）；
 *   ② 组内两两比对：双方 `sign_date` 均非空且相差 ≤ `windowDays` 自然日 → 记一对可疑对；
 *   ③ `sign_date` 任一为空 → 无法比对，跳过该配（同一笔真合同必然都有签约日）。
 *
 * ★ 同公司同金额可能是两笔真合同（续费 / 增购），**判定重复是人的活**——本函数只给出"嫌疑对"，
 *   不删除 / 不拦截（→ 需求 §十六 N7）。
 */
export function findSuspectedDuplicates(
  rows: readonly DuplicateCheckContract[],
  windowDays: number,
): SuspectedDuplicate[] {
  const window = normalizeWindowDays(windowDays);
  const groups = new Map<string, DuplicateCheckContract[]>();
  for (const row of rows) {
    const key = `${row.company_id.toString()}#${row.signer_id.toString()}#${row.amount}`;
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [row]);
    else bucket.push(row);
  }

  const result: SuspectedDuplicate[] = [];
  for (const bucket of groups.values()) {
    for (let i = 0; i < bucket.length; i += 1) {
      const a = bucket[i];
      if (a.sign_date === null) continue;
      for (let j = i + 1; j < bucket.length; j += 1) {
        const b = bucket[j];
        if (b.sign_date === null) continue;
        const diffDays = Math.abs((a.sign_date.getTime() - b.sign_date.getTime()) / 86_400_000);
        if (diffDays <= window) {
          result.push({
            company_id: a.company_id,
            contracts: [toPair(a), toPair(b)],
          });
        }
      }
    }
  }
  return result;
}
