// =============================================================================
// 数据范围判定用例（M5-02）
//
// 判据（→《开发计划-V1》M5-02）：**四档** scope → **四种**条件；
//   ＋ 本文件的「红线」用例：`dept` 档**空部门集合 ≠ 不过滤**（把空集合当「不限」＝ 越权读全公司）。
// =============================================================================
import type { DataScope } from '../context/request-context';
import { resolveDataScopeTarget } from './data-scope-target';

const scopeOf = (type: DataScope['type'], deptIds: bigint[] = []): DataScope => ({ type, deptIds });

describe('数据范围判定（M5-02 · 四档 → 四种目标）', () => {
  it('`all`（总经理 / 管理员）→ 不过滤', () => {
    expect(resolveDataScopeTarget(scopeOf('all'))).toEqual({ mode: 'all' });
  });

  it('`dept`（部门经理）→ 限定部门集合，**原样透传 `scope.deptIds`**', () => {
    expect(resolveDataScopeTarget(scopeOf('dept', [1n, 2n]))).toEqual({ mode: 'depts', deptIds: [1n, 2n] });
  });

  it('`self`（销售）→ 本人相关（owner ∪ 有效协同，由各域按 viewer 自算）', () => {
    expect(resolveDataScopeTarget(scopeOf('self'))).toEqual({ mode: 'self' });
  });

  it('`serving`（交付 · 客服）→ 服务中客户（E 域未接入前的形状）', () => {
    expect(resolveDataScopeTarget(scopeOf('serving'))).toEqual({ mode: 'serving' });
  });

  describe('★ 红线：空集合与「不过滤」不是一回事', () => {
    it('`dept` 档但**管辖部门为空** → 空部门集合，**绝不退化成 `all`**', () => {
      const target = resolveDataScopeTarget(scopeOf('dept', []));
      // 这是本文件最重要的一条：`{ in: [] }` 在 SQL 里恒假（看不到数据）是对的，
      // 若实现成「空集合＝不过滤」，经理一挂空部门就会看到**全公司** —— 越权且无声。
      expect(target).toEqual({ mode: 'depts', deptIds: [] });
      expect(target.mode).not.toBe('all');
    });

    it('返回的 `deptIds` 是**新数组**（不是入参引用）：下游改动不会污染上下文里的原数组', () => {
      const source = [1n, 2n];
      const target = resolveDataScopeTarget(scopeOf('dept', source));

      if (target.mode !== 'depts') throw new Error(`期望 depts，实际 ${target.mode}`);
      expect(target.deptIds).not.toBe(source);
      expect(target.deptIds).toEqual([1n, 2n]);
    });
  });

  it('未知档位（防御式兜底）→ `self`：宁可少看到，**不可默认全量**', () => {
    const dirty = { type: 'company', deptIds: [] } as unknown as DataScope;
    expect(resolveDataScopeTarget(dirty)).toEqual({ mode: 'self' });
  });
});
