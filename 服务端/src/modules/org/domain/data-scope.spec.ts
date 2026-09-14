// =============================================================================
// A 域纯规则用例（M1-06）
// 判据逐字（《开发计划》M1-06）：「单测：销售 / 经理 / 总经理 → 三种结果」。
// =============================================================================
import {
  BUILTIN_ROLE_CODES,
  isDeptScopedScope,
  resolveDataScope,
  resolvePrimaryRole,
  rolePriority,
} from './data-scope';

describe('数据范围纯规则（M1-06 · 架构 §7.2）', () => {
  it('内置角色码是 A4 的 6 条，且是 `sale` **不是** `sales`（jwt-claims.ts 注释里的 `sales` 是笔误）', () => {
    expect([...BUILTIN_ROLE_CODES]).toEqual([
      'sale',
      'service',
      'delivery',
      'admin',
      'dept_manager',
      'gm',
    ]);
    expect(BUILTIN_ROLE_CODES).not.toContain('sales');
  });

  describe('resolveDataScope：三档（判据本体）', () => {
    it.each([
      ['销售 → self', ['sale'], 'self'],
      ['客服 → self', ['service'], 'self'],
      ['交付 → self', ['delivery'], 'self'],
      ['部门经理 → dept', ['dept_manager'], 'dept'],
      ['总经理 → all', ['gm'], 'all'],
      ['管理员 → all（2026-09-11 定：管理员可查看业务数据）', ['admin'], 'all'],
    ])('%s', (_name, roleCodes, expected) => {
      expect(resolveDataScope(roleCodes)).toBe(expected);
    });

    it('无角色 → self（最小权限兜底，**绝不默认放行**）', () => {
      expect(resolveDataScope([])).toBe('self');
    });

    it('未知 / 自定义角色码 → self（不认识的码不当特权处理）', () => {
      expect(resolveDataScope(['some_custom_role'])).toBe('self');
    });

    it('多角色取**范围更大**者：经理 ＋ 销售 → dept（不被销售角色拉低）', () => {
      expect(resolveDataScope(['sale', 'dept_manager'])).toBe('dept');
    });

    it('多角色取**范围更大**者：经理 ＋ 总经理 → all', () => {
      expect(resolveDataScope(['dept_manager', 'gm'])).toBe('all');
    });
  });

  describe('resolvePrimaryRole：一人多角色时的 `UserVO.role`（规格未定义，本项目技术口径）', () => {
    it.each([
      [['sale'], 'sale'],
      [['sale', 'gm'], 'gm'],
      [['sale', 'admin'], 'admin'],
      [['dept_manager', 'admin'], 'admin'],
      [['delivery', 'service'], 'service'],
    ])('%s → %s（取权限最大者，避免「总经理渲染成销售菜单」）', (roleCodes, expected) => {
      expect(resolvePrimaryRole(roleCodes)).toBe(expected);
    });

    it('无角色 → 空串（不抛错：显示不出主角色不该让登录失败）', () => {
      expect(resolvePrimaryRole([])).toBe('');
    });

    it('只有未知角色 → 取字典序最小者，且**同输入同输出**（不随查询顺序漂移）', () => {
      expect(resolvePrimaryRole(['zzz', 'aaa'])).toBe('aaa');
      expect(resolvePrimaryRole(['aaa', 'zzz'])).toBe('aaa');
    });
  });

  describe('rolePriority：主角色与权限共用同一张优先级表', () => {
    it('序号**越小越优先**，顺序＝「权限从大到小」：gm < admin < dept_manager < sale < service < delivery', () => {
      const ordered = ['gm', 'admin', 'dept_manager', 'sale', 'service', 'delivery'];

      for (let i = 1; i < ordered.length; i += 1) {
        expect(rolePriority(ordered[i]!)).toBeGreaterThan(rolePriority(ordered[i - 1]!));
      }
      expect(rolePriority('gm')).toBe(0);
    });

    it('优先级表与 A4 的内置角色码**恰好同一个集合**（漏一个 → 那个角色永远排最后，会被静默降权）', () => {
      const ranked = ['gm', 'admin', 'dept_manager', 'sale', 'service', 'delivery'];

      expect([...ranked].sort()).toEqual([...BUILTIN_ROLE_CODES].sort());
    });

    it('未知角色码排在**所有内置角色之后**（自定义角色不许盖过内置角色）', () => {
      const worstBuiltin = Math.max(...BUILTIN_ROLE_CODES.map((code) => rolePriority(code)));

      expect(rolePriority('some_custom_role')).toBe(Number.MAX_SAFE_INTEGER);
      expect(rolePriority('some_custom_role')).toBeGreaterThan(worstBuiltin);
    });
  });

  it('isDeptScopedScope 只对 `dept` 为真（`all` 不等于「按部门过滤」）', () => {
    expect(isDeptScopedScope('dept')).toBe(true);
    expect(isDeptScopedScope('self')).toBe(false);
    expect(isDeptScopedScope('all')).toBe(false);
  });
});
