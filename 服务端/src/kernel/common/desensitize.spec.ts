// =============================================================================
// 脱敏判定用例（M5-05 判据 / M5-09 红线）
//
// 判据逐字（《开发计划-V1》）：
//   M5-05「单测：**同部门明码、跨部门打码**」
//   M5-09「测试铁律 #11：**脱敏按部门判**、报表不脱敏 —— 单测红线通过」
//     （「报表不脱敏」的落点是出口豁免开关，见 `desensitize.interceptor.spec.ts`）
//
// ★ 2026-09-15 七叔口径（原话）：「**本部门都可查看，其他部门不可查看；总经理可查看全部**」
//   —— 故口径 ＝「按部门」＋「总经理例外」两者；管理员**不是**例外（不解除金额脱敏，→ §2.2）。
//
// ★ 只有真函数、没有假件：纯判定，不需要库、不需要上下文（kernel 零依赖）。
// ★ 边界刻意逐条占位：空集合 / 多部门命中 / 单部门 / 总经理 —— 免得「恰好都对」掩盖了比较写反。
// =============================================================================
import { AMOUNT_MASK, resolveDeptDesensitize } from './desensitize';

/** 默认入参（普通销售：只看得到自己那一个部门，且不是总经理） */
const viewer = (viewerDeptIds: readonly bigint[], targetDeptId: bigint, isGeneralManager = false) => ({
  viewerDeptIds,
  targetDeptId,
  isGeneralManager,
});

describe('脱敏判定（M5-05 / M5-09：跨业务线**按部门**判 ＋ 总经理例外）', () => {
  it('同部门 → `visible`（明码，→ M5-05 判据前半句）', () => {
    expect(resolveDeptDesensitize(viewer([2n], 2n))).toBe('visible');
  });

  it('跨部门 → `masked`（打码，→ M5-05 判据后半句；「其他部门的看不了」）', () => {
    expect(resolveDeptDesensitize(viewer([2n], 3n))).toBe('masked');
  });

  it('兼职多部门：命中其中任一个就是本部门（→ §4.3 四「按部门」；不按产品线判）', () => {
    expect(resolveDeptDesensitize(viewer([2n, 9n], 9n))).toBe('visible');
    expect(resolveDeptDesensitize(viewer([2n, 9n], 4n))).toBe('masked');
  });

  it('我的部门集合为空 → `masked`（**不默认放行**：没有部门可比＝哪里都不属于）', () => {
    expect(resolveDeptDesensitize(viewer([], 2n))).toBe('masked');
  });

  it('★ 总经理 → **跨部门也 `visible`**（「总经理可查看全部」，→ §4.3 四 末行）', () => {
    expect(resolveDeptDesensitize(viewer([2n], 7n, true))).toBe('visible');
    // 连部门集合为空也照样全可见（他的可见性不来自部门）
    expect(resolveDeptDesensitize(viewer([], 7n, true))).toBe('visible');
  });

  it('管理员**不是**例外：非总经理时跨部门仍 `masked`（不解除金额脱敏，→ §2.2）', () => {
    expect(resolveDeptDesensitize(viewer([2n], 3n, false))).toBe('masked');
  });

  it('打码形态常量＝`***`，且**不含数字**（→ 数据架构 §十一 ③「完全脱敏」）', () => {
    expect(AMOUNT_MASK).toBe('***');
    expect(/\d/.test(AMOUNT_MASK)).toBe(false);
  });
});
