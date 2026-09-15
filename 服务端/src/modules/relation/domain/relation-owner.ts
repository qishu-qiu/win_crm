// =============================================================================
// C 域纯规则（M3-05）—— 「一关系一 owner」
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM数据架构文档》V1.31 C2：`member_type` ∈ `owner`（主责销售，**1**）/
//     `collaborator`（协同人：正式协同或被 @求助者，**多**）；DB 侧由生成列
//     `owner_flag = IF(member_type='owner', relation_id, NULL)` ＋ `uk_owner` 兜底
//     （→ `migrations/0001_init/migration.sql` 文末 ③）。
//   · 同 C2：`valid_until` **仅 collaborator** 有（到期自动失效，解除读写权与全号可见；
//     `NULL`＝长期，仅正式协同）；`source` ∈ `collaborate`（协同审批通过）/ `ask_help`（@求助，默认 7 天）。
//   · 同 C2「主责变更」：换人＝`transfer` 审批；短期＝带期限 collaborator ——
//     ⇒ **本文件不做「直接改 owner」**，只判「能不能加 owner」（换人另有入口，M3 不做）。
//   · 《销售CRM架构设计说明》V1.3 §7.5：`P2002` + `uk_owner` → **409**；
//     `kernel/errors/prisma-error.mapper.ts` 的人话是「该业务关系已有归属销售」。
//   · 《销售CRM业务需求文档》§4.3：@求助**限同部门**；跨部门走**正式协同审批**（→ 废止口径 #10）。
//     ⚠ 该约束落在**协同人**上（本文件 `canAddCollaborator`），**不影响** owner 判定。
//
// 分层约束（架构 §5.4）：`domain/**` 与框架 / ORM 解耦 —— 不 import `@nestjs/*` / `@prisma/client`，不查库。
// =============================================================================

/** 主责销售（→ C2，一关系仅一条） */
export const OWNER_MEMBER_TYPE = 'owner';

/** 协同人（→ C2，可多条） */
export const COLLABORATOR_MEMBER_TYPE = 'collaborator';

/** 关系成员（**本文件只认这几列**，结构由调用方给，便于用假数据单测） */
export interface RelationMemberLike {
  employeeId: bigint;
  memberType: string;
  source?: string | null;
  /** 仅 collaborator 有意义；`null`＝长期（正式协同） */
  validUntil?: Date | null;
  /** 非空＝已撤销（撤销留痕，不物理删，→ C2） */
  revokedAt?: Date | null;
}

/** 加 owner 的判定结果（service 据此给 409 人话或放行） */
export type OwnerSlotVerdict =
  | { ok: true }
  /** 这个人**已经是** owner 了（重复授予；DB 侧 `uk_member` 也会拦） */
  | { ok: false; kind: 'already_owner'; currentOwnerId: bigint }
  /** 位子被**别人**占着（→ §7.5：409「该业务关系已有归属销售」） */
  | { ok: false; kind: 'occupied'; currentOwnerId: bigint };

/** 当前**有效** owner（未撤销的那条）；没有则 `undefined` */
export function findActiveOwner(
  members: readonly RelationMemberLike[],
): RelationMemberLike | undefined {
  return members.find(
    (member) => member.memberType === OWNER_MEMBER_TYPE && (member.revokedAt ?? null) === null,
  );
}

/**
 * 能不能给这条关系再加一个 owner（→ M3-05 判据本体：「加入第二 owner 被拒」）。
 *
 * ★ 三种结果都**必须**能表达：「位子空着」放行、「同一个人」与「别人占着」都要拒，
 *   但**人话不同** —— 前者是「你已经负责这个客户了」，后者才是「已有归属销售」。
 *   合成一种会让销售照着错的话去操作（比如以为要找别人要客户）。
 */
export function checkOwnerSlot(
  members: readonly RelationMemberLike[],
  employeeId: bigint,
): OwnerSlotVerdict {
  const owner = findActiveOwner(members);
  if (owner === undefined) return { ok: true };
  if (owner.employeeId === employeeId) {
    return { ok: false, kind: 'already_owner', currentOwnerId: owner.employeeId };
  }
  return { ok: false, kind: 'occupied', currentOwnerId: owner.employeeId };
}

/**
 * 协同人**当前是否有效**（→ C2：`valid_until` 到期自动失效；已撤销即失效）。
 *
 * ★ 这条判定有两个消费方，必须同口径：① M3 的私海列表（DB `where` 的形式）；
 *   ② 展示层判断要不要给「读写权 / 全号」—— 故放在 domain 而不是散在 service 里。
 * ★ `validUntil === null` ＝**长期**（仅正式协同，`source=collaborate`）；@求助的 7 天来自
 *   `dept_rule.ask_help_days`，落库时写进 `valid_until`（→ C2），**不在本函数里算天数**。
 */
export function isEffectiveCollaborator(member: RelationMemberLike, now: Date): boolean {
  if (member.memberType !== COLLABORATOR_MEMBER_TYPE) return false;
  if ((member.revokedAt ?? null) !== null) return false;
  const until = member.validUntil ?? null;
  return until === null || until.getTime() > now.getTime();
}

/**
 * @求助（`ask_help`）**限同部门**（→ 需求 §4.3；跨部门走正式协同审批）。
 *
 * ★ 判据是「两人是否同部门」，而**部门集合的比较归调用方**（本层不查库、也不知道部门树）：
 *   调用方把「求助人所属部门集合」与「被@人所属部门集合」的交集是否非空传进来即可。
 *   ⚠ 兼职部门也算同一部门（主 / 兼任一命中即可）—— 兼职同事在系统里就是「同部门的人」。
 */
export function isSameDeptForAskHelp(
  requesterDeptIds: readonly bigint[],
  mentionedDeptIds: readonly bigint[],
): boolean {
  return requesterDeptIds.some((deptId) => mentionedDeptIds.includes(deptId));
}
