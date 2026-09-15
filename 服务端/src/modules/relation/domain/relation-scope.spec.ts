// =============================================================================
// C 域纯规则用例（M3-07 / M3-08 的范围口径）
// 判据（《开发计划-V1》M3-07 / M3-08）：私海列表＝owner 是我；公海列表＝无 owner。
// ★ 本批**提前收敛数据范围**（架构把「范围注入」排在 M5，理由见实现文件头 ★）：
//   销售只能看「我参与的关系 ＋ 我所属部门的公海」；经理看管辖部门；
//   交付 / 客服**不进公海**；管理员只读。
// =============================================================================
import type { DataScope } from '../../../kernel/context/request-context';

import {
  checkActivateScope,
  checkRelationWrite,
  isRelationWriteRole,
  resolveRelationListScope,
  seaStatusOfTab,
  type RelationViewer,
} from './relation-scope';

function viewer(
  type: DataScope['type'],
  options: {
    roleCodes?: string[];
    deptIds?: bigint[];
    managedDeptIds?: bigint[];
    employeeId?: bigint;
  } = {},
): RelationViewer {
  return {
    employeeId: options.employeeId ?? 7n,
    roleCodes: options.roleCodes ?? ['sale'],
    dataScope: { type, deptIds: options.managedDeptIds ?? [] },
    myDeptIds: options.deptIds ?? [1n, 2n],
  };
}

describe('relation-scope（M3-07 / M3-08 的范围收敛）', () => {
  describe('resolveRelationListScope：私海页签', () => {
    it('销售（self）→ `mine`：只看我 owner ∪ 我有效协同（不是「全公司私海」）', () => {
      expect(resolveRelationListScope('private', viewer('self'))).toEqual({
        kind: 'mine',
        deptIds: [],
      });
    });

    it('经理（dept）→ `dept`：**管辖部门**（不是「我所属部门」）', () => {
      expect(
        resolveRelationListScope('private', viewer('dept', { managedDeptIds: [3n, 4n], roleCodes: ['dept_manager'] })),
      ).toEqual({ kind: 'dept', deptIds: [3n, 4n] });
    });

    it('总经理 / 管理员（all）→ `all`：不过滤', () => {
      expect(resolveRelationListScope('private', viewer('all', { roleCodes: ['gm'] }))).toEqual({
        kind: 'all',
        deptIds: [],
      });
    });

    it('交付 / 客服（serving）→ 仍是 `mine`（**比规格更窄**：规格是「在合同服务期内」，本批未接合同表）', () => {
      expect(resolveRelationListScope('private', viewer('serving', { roleCodes: ['service'] }))).toEqual({
        kind: 'mine',
        deptIds: [],
      });
    });
  });

  describe('resolveRelationListScope：公海页签', () => {
    it('销售（self）→ 按**我所属部门**（部门公海＝本部门的关系集合，→ C1）', () => {
      expect(resolveRelationListScope('sea', viewer('self', { deptIds: [2n] }))).toEqual({
        kind: 'dept',
        deptIds: [2n],
      });
    });

    it('销售：兼职部门一并带上（兼部门公海也看得到）', () => {
      expect(resolveRelationListScope('sea', viewer('self', { deptIds: [2n, 9n] }))).toEqual({
        kind: 'dept',
        deptIds: [2n, 9n],
      });
    });

    it('经理（dept）→ **管辖部门**公海', () => {
      expect(
        resolveRelationListScope('sea', viewer('dept', { managedDeptIds: [3n], deptIds: [1n], roleCodes: ['dept_manager'] })),
      ).toEqual({ kind: 'dept', deptIds: [3n] });
    });

    it('**交付 / 客服（serving）→ `denied`**：§2.2 原文「不进公海」（给 403 而不是空列表）', () => {
      expect(resolveRelationListScope('sea', viewer('serving', { roleCodes: ['delivery'] }))).toEqual({
        kind: 'denied',
        deptIds: [],
      });
    });

    it('总经理 / 管理员（all）→ `all`：不过滤', () => {
      expect(resolveRelationListScope('sea', viewer('all', { roleCodes: ['admin'] }))).toEqual({
        kind: 'all',
        deptIds: [],
      });
    });

    it('销售没有任何所属部门 → `dept` 且集合为空（**空集合 ≠ 不过滤**，不许退化成看全部）', () => {
      expect(resolveRelationListScope('sea', viewer('self', { deptIds: [] }))).toEqual({
        kind: 'dept',
        deptIds: [],
      });
    });
  });

  describe('seaStatusOfTab：页签 → `sea_status`（两处口径只此一处）', () => {
    it('私海 / 公海两个映射固定', () => {
      expect(seaStatusOfTab('private')).toBe('private');
      expect(seaStatusOfTab('sea')).toBe('company_sea');
    });
  });

  describe('isRelationWriteRole（→ §2.2：管理员只读；交付 · 客服只读）', () => {
    it.each([
      ['销售可写', ['sale'], true],
      ['部门经理可写', ['dept_manager'], true],
      ['总经理可写', ['gm'], true],
      ['客服**只读**', ['service'], false],
      ['交付**只读**', ['delivery'], false],
      ['管理员**只读**（2026-09-14 定）', ['admin'], false],
      ['管理员 ＋ 销售 → 仍可写（走销售那份权利，**不是「有一个只读角色就全禁」**）', ['admin', 'sale'], true],
      ['无角色 → 不可写（最小权限兜底）', [], false],
    ])('%s', (_name, roleCodes, expected) => {
      expect(isRelationWriteRole(roleCodes)).toBe(expected);
    });
  });

  describe('checkActivateScope：激活时给的 `dept_id` 必须落在可建范围内', () => {
    it('销售：本部门（含兼职）→ 放行', () => {
      expect(checkActivateScope(2n, viewer('self', { deptIds: [1n, 2n] }))).toEqual({ ok: true });
    });

    it('销售：**别的部门** → 拒（`dept_id` 恒定不可变，替别部门建档＝越权，→ 废止口径 #9）', () => {
      expect(checkActivateScope(3n, viewer('self', { deptIds: [1n, 2n] }))).toEqual({
        ok: false,
        kind: 'out_of_scope',
      });
    });

    it('经理：**管辖部门**放行；自己所属但不归我管辖的部门 → 拒', () => {
      const manager = viewer('dept', { roleCodes: ['dept_manager'], managedDeptIds: [3n], deptIds: [1n] });
      expect(checkActivateScope(3n, manager)).toEqual({ ok: true });
      expect(checkActivateScope(1n, manager)).toEqual({ ok: false, kind: 'out_of_scope' });
    });

    it('总经理（all）：任意部门放行', () => {
      expect(checkActivateScope(99n, viewer('all', { roleCodes: ['gm'] }))).toEqual({ ok: true });
    });

    it('管理员 / 交付 / 客服 → `read_only`（只读角色连激活都不给）', () => {
      expect(checkActivateScope(1n, viewer('all', { roleCodes: ['admin'] }))).toEqual({
        ok: false,
        kind: 'read_only',
      });
      expect(checkActivateScope(1n, viewer('serving', { roleCodes: ['delivery'] }))).toEqual({
        ok: false,
        kind: 'read_only',
      });
    });
  });

  describe('checkRelationWrite：改已有关系', () => {
    it('销售：**我 owner** 的关系 → 放行', () => {
      expect(checkRelationWrite({ deptId: 2n, ownerId: 7n }, viewer('self'))).toEqual({ ok: true });
    });

    it('销售：别人的关系（即便同部门）→ 拒（同部门可见 ≠ 可改）', () => {
      expect(checkRelationWrite({ deptId: 2n, ownerId: 8n }, viewer('self'))).toEqual({
        ok: false,
        kind: 'out_of_scope',
      });
    });

    it('★ 协同人（不是 owner）→ 拒：改关系属性 / 加成员**归 owner**（2026-09-15 七叔拍板「维持」）', () => {
      // 口径锚点：协同人**只写跟单**（D 域走读口径），改属性 / 加成员不给。
      // ★ 注意本函数的入参**故意不含 `members`** ——「我参与（owner ∪ 有效协同）」是**读**口径，
      //   不许直接拿来当写判定（那会把协同误放行）。真放开过：先改签名，再改这条。
      expect(checkRelationWrite({ deptId: 2n, ownerId: 8n }, viewer('self'))).toEqual({
        ok: false,
        kind: 'out_of_scope',
      });
    });

    it('销售：无 owner（公海）的关系 → 拒（领取要走公海动作，不是直接改）', () => {
      expect(checkRelationWrite({ deptId: 2n, ownerId: null }, viewer('self'))).toEqual({
        ok: false,
        kind: 'out_of_scope',
      });
    });

    it('经理：管辖部门内的关系 → 放行（含他人 owner）', () => {
      expect(
        checkRelationWrite(
          { deptId: 3n, ownerId: 8n },
          viewer('dept', { roleCodes: ['dept_manager'], managedDeptIds: [3n] }),
        ),
      ).toEqual({ ok: true });
    });

    it('经理：管辖外的关系 → 拒', () => {
      expect(
        checkRelationWrite(
          { deptId: 4n, ownerId: 8n },
          viewer('dept', { roleCodes: ['dept_manager'], managedDeptIds: [3n] }),
        ),
      ).toEqual({ ok: false, kind: 'out_of_scope' });
    });

    it('总经理（all）：任意关系放行', () => {
      expect(checkRelationWrite({ deptId: 99n, ownerId: 8n }, viewer('all', { roleCodes: ['gm'] }))).toEqual({
        ok: true,
      });
    });

    it('管理员（all 档但只读）→ `read_only`：档位管「能看到谁」，写权限另判（→ §2.2）', () => {
      expect(checkRelationWrite({ deptId: 1n, ownerId: 7n }, viewer('all', { roleCodes: ['admin'] }))).toEqual({
        ok: false,
        kind: 'read_only',
      });
    });
  });
});
