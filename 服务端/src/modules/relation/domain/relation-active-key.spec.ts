// =============================================================================
// C 域纯规则用例（M3-04）
// 判据逐字（《开发计划-V1》M3-04）：「公司 × 部门 × 产品线 活跃唯一键纯函数」，
//   验收＝「单测：同键归一、异键区分」。
// ★ 另钉一条**与 DB 的契约**：`buildActiveKey` 的字符串必须与生成列
//   `CONCAT_WS('-', company_id, dept_id, product_line_id)` **逐字同格式**
//   —— 不一致时预检会「查不到」，整条链路静默退化成「靠 409 兜底」。
// =============================================================================
import {
  COMPANY_SEA_STATUS,
  PRIVATE_SEA_STATUS,
  buildActiveKey,
  isSameTriple,
  occupiesActiveSlot,
} from './relation-active-key';

describe('relation-active-key（M3-04）', () => {
  describe('buildActiveKey：同键归一、异键区分', () => {
    it('同一三元组 → 同一个键（同一公司 · 同部门 · 同产品线）', () => {
      expect(buildActiveKey({ companyId: 7n, deptId: 2n, productLineId: 5n })).toBe(
        buildActiveKey({ companyId: 7n, deptId: 2n, productLineId: 5n }),
      );
    });

    it('字符串归一：`7` 与 `07`（同一数字的不同写法）在库里是同一个 id，键必须一致', () => {
      expect(buildActiveKey({ companyId: 7n, deptId: 2n, productLineId: 5n })).toBe('7-2-5');
      expect(buildActiveKey({ companyId: 7n, deptId: 2n, productLineId: 5n })).toBe(
        buildActiveKey({ companyId: BigInt('7'), deptId: BigInt('2'), productLineId: BigInt('5') }),
      );
    });

    it.each([
      ['换公司', { companyId: 8n, deptId: 2n, productLineId: 5n }],
      ['换部门（→ 「别部门自己激活一条本部门的关系」，→ 废止口径 #9）', { companyId: 7n, deptId: 3n, productLineId: 5n }],
      ['换产品线（同公司同部门的两条业务线互不冲突）', { companyId: 7n, deptId: 2n, productLineId: 6n }],
    ])('异键区分：%s → 键不同', (_name, other) => {
      expect(buildActiveKey(other)).not.toBe(buildActiveKey({ companyId: 7n, deptId: 2n, productLineId: 5n }));
    });

    it('格式与 DB 生成列逐字一致（`CONCAT_WS(\'-\', 公司, 部门, 产品线)`，→ C1 / migration ③）', () => {
      // ⚠ 这条断言是**与数据库的契约**：改格式＝改 DB 生成列，两边必须同批
      expect(buildActiveKey({ companyId: 12n, deptId: 34n, productLineId: 56n })).toBe('12-34-56');
    });
  });

  describe('occupiesActiveSlot：只有「私海且未并」占活跃位（→ C1）', () => {
    it('私海 ＋ 未合并 → 占位（能建）', () => {
      expect(occupiesActiveSlot(PRIVATE_SEA_STATUS, null)).toBe(true);
    });

    it('已掉公海 → 不占位（可被重新领取 / 别部门激活）', () => {
      expect(occupiesActiveSlot(COMPANY_SEA_STATUS, null)).toBe(false);
    });

    it('被并分支（`merged_into IS NOT NULL`）→ 不占位（让位给 survivor）', () => {
      expect(occupiesActiveSlot(PRIVATE_SEA_STATUS, 99n)).toBe(false);
    });

    it('公海 ＋ 已并 → 同样不占位（两个条件任一不满足即释放）', () => {
      expect(occupiesActiveSlot(COMPANY_SEA_STATUS, 99n)).toBe(false);
    });

    it('未知 sea_status → 不占位（**最小权限**：不认识的状态不当成「私海占位」）', () => {
      expect(occupiesActiveSlot('weird', null)).toBe(false);
    });
  });

  describe('isSameTriple', () => {
    it('三元组全等 → true', () => {
      expect(
        isSameTriple(
          { companyId: 1n, deptId: 2n, productLineId: 3n },
          { companyId: 1n, deptId: 2n, productLineId: 3n },
        ),
      ).toBe(true);
    });

    it('任一不同 → false', () => {
      expect(
        isSameTriple(
          { companyId: 1n, deptId: 2n, productLineId: 3n },
          { companyId: 1n, deptId: 2n, productLineId: 4n },
        ),
      ).toBe(false);
    });
  });
});
