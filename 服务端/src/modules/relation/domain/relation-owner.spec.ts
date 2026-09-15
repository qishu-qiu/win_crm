// =============================================================================
// C 域纯规则用例（M3-05）
// 判据逐字（《开发计划-V1》M3-05）：「一关系一 owner 判定纯函数」，
//   验收＝「单测：**加入第二 owner 被拒**」。
// =============================================================================
import {
  COLLABORATOR_MEMBER_TYPE,
  OWNER_MEMBER_TYPE,
  checkOwnerSlot,
  findActiveOwner,
  isEffectiveCollaborator,
  isSameDeptForAskHelp,
  type RelationMemberLike,
} from './relation-owner';

const ME = 7n;
const OTHER = 8n;

function owner(employeeId: bigint, overrides: Partial<RelationMemberLike> = {}): RelationMemberLike {
  return { employeeId, memberType: OWNER_MEMBER_TYPE, source: null, validUntil: null, revokedAt: null, ...overrides };
}

function collaborator(employeeId: bigint, overrides: Partial<RelationMemberLike> = {}): RelationMemberLike {
  return {
    employeeId,
    memberType: COLLABORATOR_MEMBER_TYPE,
    source: 'collaborate',
    validUntil: null,
    revokedAt: null,
    ...overrides,
  };
}

describe('relation-owner（M3-05）', () => {
  describe('checkOwnerSlot：一关系一 owner', () => {
    it('位子空着 → 放行（新关系激活时就是这条路径）', () => {
      expect(checkOwnerSlot([], ME)).toEqual({ ok: true });
    });

    it('**加入第二 owner 被拒**（判据本体）：别人占着 → `occupied`', () => {
      expect(checkOwnerSlot([owner(OTHER)], ME)).toEqual({
        ok: false,
        kind: 'occupied',
        currentOwnerId: OTHER,
      });
    });

    it('同一个人重复授予 → `already_owner`（与「别人占着」分开：人话不同，→ C2 / §7.5）', () => {
      expect(checkOwnerSlot([owner(ME)], ME)).toEqual({
        ok: false,
        kind: 'already_owner',
        currentOwnerId: ME,
      });
    });

    it('已被撤销的 owner 不占位 → 放行（换人留痕后新 owner 可以进来）', () => {
      expect(checkOwnerSlot([owner(OTHER, { revokedAt: new Date('2026-09-01') })], ME)).toEqual({
        ok: true,
      });
    });

    it('协同人不占 owner 位 → 放行（一关系多协同，但只有一个主责）', () => {
      expect(checkOwnerSlot([collaborator(ME), collaborator(OTHER)], ME)).toEqual({ ok: true });
    });
  });

  describe('findActiveOwner', () => {
    it('取未撤销的那条 owner', () => {
      const active = owner(ME);
      expect(findActiveOwner([owner(OTHER, { revokedAt: new Date() }), active])).toBe(active);
    });

    it('没有 owner（只有协同人 / 全被撤销）→ undefined', () => {
      expect(findActiveOwner([])).toBeUndefined();
      expect(findActiveOwner([collaborator(ME)])).toBeUndefined();
      expect(findActiveOwner([owner(ME, { revokedAt: new Date() })])).toBeUndefined();
    });
  });

  describe('isEffectiveCollaborator（→ C2：到期自动失效；撤销即失效）', () => {
    const now = new Date('2026-09-15T10:00:00Z');

    it('`valid_until = NULL`（长期，仅正式协同）→ 有效', () => {
      expect(isEffectiveCollaborator(collaborator(ME, { validUntil: null }), now)).toBe(true);
    });

    it('未到期 → 有效', () => {
      expect(
        isEffectiveCollaborator(collaborator(ME, { validUntil: new Date('2026-09-22T10:00:00Z') }), now),
      ).toBe(true);
    });

    it('已到期 → 失效（@求助默认 7 天到期后自动收回）', () => {
      expect(
        isEffectiveCollaborator(collaborator(ME, { validUntil: new Date('2026-09-15T09:59:59Z') }), now),
      ).toBe(false);
    });

    it('已撤销 → 失效（即便 `valid_until` 还是 NULL）', () => {
      expect(isEffectiveCollaborator(collaborator(ME, { revokedAt: now }), now)).toBe(false);
    });

    it('owner 不是「有效协同人」（两条口径不能混用：owner 走 owner 判定）', () => {
      expect(isEffectiveCollaborator(owner(ME), now)).toBe(false);
    });
  });

  describe('isSameDeptForAskHelp（→ 需求 §4.3：@求助限同部门；跨部门走正式协同审批）', () => {
    it('有交集 → 同部门（可 @求助）', () => {
      expect(isSameDeptForAskHelp([2n], [2n, 3n])).toBe(true);
    });

    it('兼职部门命中也算同部门（兼部门同事在系统里就是同部门的人）', () => {
      expect(isSameDeptForAskHelp([2n, 9n], [9n])).toBe(true);
    });

    it('无交集 → 跨部门（不许 @求助，→ 废止口径 #10）', () => {
      expect(isSameDeptForAskHelp([2n], [3n])).toBe(false);
    });

    it('任一侧为空 → 不是同部门（**不默认放行**）', () => {
      expect(isSameDeptForAskHelp([], [2n])).toBe(false);
      expect(isSameDeptForAskHelp([2n], [])).toBe(false);
    });
  });
});
