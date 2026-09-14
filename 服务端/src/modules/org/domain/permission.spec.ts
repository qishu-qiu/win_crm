// =============================================================================
// 权限矩阵合并用例（M1-10 的配套）
// 口径：`UserVO.permissions = {"perm_key":"level"}`（→ 接口API文档 §5.2），
//       一人多角色撞同一个 `perm_key` 时**按角色优先级取先出现者**（规格未定义，本项目技术口径）。
// =============================================================================
import { hasAnyRole, mergePermissionLevels, type PermissionRow } from './permission';

const ROWS: PermissionRow[] = [
  { perm_key: 'customer.view', role_code: 'sale', level: 'masked' },
  { perm_key: 'customer.view', role_code: 'gm', level: 'visible' },
  { perm_key: 'customer.export', role_code: 'gm', level: 'visible' },
];

describe('权限矩阵合并（M1-10 配套）', () => {
  it('撞同一 `perm_key` → 取**优先级更高**的角色档位（总经理不被销售角色拉低）', () => {
    expect(mergePermissionLevels(ROWS, ['sale', 'gm'])).toEqual({
      'customer.export': 'visible',
      'customer.view': 'visible',
    });
  });

  it('只有销售角色时，取销售自己的档位（别把没持有的角色权限算进来）', () => {
    // 注意：`gm` 的行仍在入参里（真实实现是**按员工角色码**查库，此处刻意喂「多出来的行」来证明
    // 结果只由 roleCodes 命中；若将来有人在 service 里漏了过滤条件，这条会立刻红）
    expect(mergePermissionLevels(ROWS, ['sale'])).toEqual({ 'customer.view': 'masked' });
  });

  it('键按字典序（同输入同输出，前端 diff 与快照测试不抖）', () => {
    const rows: PermissionRow[] = [
      { perm_key: 'zzz', role_code: 'sale', level: 'visible' },
      { perm_key: 'aaa', role_code: 'sale', level: 'visible' },
      { perm_key: 'mmm', role_code: 'sale', level: 'visible' },
    ];

    expect(Object.keys(mergePermissionLevels(rows, ['sale']))).toEqual(['aaa', 'mmm', 'zzz']);
  });

  it('未知角色码**不覆盖**已知角色（库里被塞的自定义角色不该降级内置权限）', () => {
    const rows: PermissionRow[] = [
      { perm_key: 'customer.view', role_code: 'some_custom_role', level: 'denied' },
      { perm_key: 'customer.view', role_code: 'sale', level: 'visible' },
    ];

    expect(mergePermissionLevels(rows, ['sale', 'some_custom_role'])).toEqual({
      'customer.view': 'visible',
    });
  });

  it('空矩阵 / 空角色 → 空对象（不是 undefined，出参形状要稳定）', () => {
    expect(mergePermissionLevels([], ['sale'])).toEqual({});
    expect(mergePermissionLevels(ROWS, [])).toEqual({});
  });

  it('hasAnyRole：命中任一即真', () => {
    expect(hasAnyRole(['sale', 'gm'], ['gm'])).toBe(true);
    expect(hasAnyRole(['sale'], ['gm', 'admin'])).toBe(false);
    expect(hasAnyRole([], ['sale'])).toBe(false);
  });
});
