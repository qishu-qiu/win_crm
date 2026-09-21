// =============================================================================
// C 域纯规则用例（M3-04）
// 判据逐字（《开发计划-V1》M3-04）：「公司 × 部门 × 产品线 活跃唯一键纯函数」，
//   验收＝「单测：同键归一、异键区分」。
// ★ 另钉一条**与 DB 的契约**：`buildActiveKey` 的字符串必须与生成列
//   `CONCAT_WS('-', company_id, dept_id, product_line_id)` **逐字同格式**
//   —— 不一致时预检会「查不到」，整条链路静默退化成「靠 409 兜底」。
// =============================================================================
import { buildActiveKey, isSameTriple, occupiesActiveSlot } from './relation-active-key';

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

  describe('occupiesActiveSlot：**未删未并**即占位（→ C1；★ 2026-09-21 起**公海也占位** · D-53）', () => {
    it('★ 未删未并 → 占位 —— **不论公私海**（同三元组至多一条关系，本口径的核心）', () => {
      // ⚠ 旧口径下「公海」是**不占位**的；改了它才堵得住 D-53：否则同一三元组会并存
      //    「公海行 ＋ 私海行」，公海那条一被领就撞私海行占住的位 ⇒ 必 409（→ 需求 §6.3）
      // ⚠ 函数签名里**没有 `seaStatus`** 正是这层意思：占位与否与公私海无关
      expect(occupiesActiveSlot({ mergedInto: null, deletedAt: null })).toBe(true);
    });

    it('被并分支（`merged_into IS NOT NULL`）→ 不占位（让位给 survivor）', () => {
      expect(occupiesActiveSlot({ mergedInto: 99n, deletedAt: null })).toBe(false);
    });

    it('逻辑删除（`deleted_at` 非空）→ 不占位（＝不再作为跟进目标 ⇒ 该三元组可再激活）', () => {
      expect(occupiesActiveSlot({ mergedInto: null, deletedAt: new Date('2026-09-21T00:00:00Z') })).toBe(
        false,
      );
    });

    it('两个条件都不满足 → 不占位（任一满足即释放）', () => {
      expect(occupiesActiveSlot({ mergedInto: 99n, deletedAt: new Date('2026-09-21T00:00:00Z') })).toBe(
        false,
      );
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
