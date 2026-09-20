// =============================================================================
// F 域仓储（M7-01 公海「领取到私海」）—— **只碰本域的表**（`sea_record`）
//
// 分层约束（架构 §5.4）：本文件是本域「唯一允许 import Prisma 干活的层」——
//   只读写库、**不写业务判断**（权限 / 定位 / 原子性全在 C 域出口与 C 域 domain）。
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM数据架构文档》F2（`sea_record`）：`claimed_by` / `claimed_at` ＝「谁 / 何时领回」；
//     索引 `idx_rel_time(relation_id, dropped_at)` 就是「取该关系最近一条入公海记录」的取法。
//   · 《销售CRM架构设计说明》§5.2 跨域三条路：认领要动的三张表
//     （`business_relation` / `relation_member` / `relation_stage_log`）**全是 C 域的表** ——
//     故本域**只写 `sea_record`**，认领本体一律调 C 域 exports 的 service，
//     **不许**直接 UPDATE 别人的表（跨域直连仓储被 ESLint 硬卡）。
// =============================================================================
import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class SeaRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 该关系**最近一条**入公海历史（→ F2 `idx_rel_time`）。
   *
   * ★ 为什么要排序取一条：同一条关系会「掉海 → 领回 → 再掉海」，历史行有多条，
   *   而「本次领回」要回填的是**本轮**那条 ⇒ 按 `dropped_at` 倒序；
   *   时间列是**秒精度**（`DateTime(0)`），同一秒的两行靠 `id` 倒序定序（同 C 域取法）。
   *
   * ★ 返回 `null` ＝ **从来没掉过海**：调用方**跳过、不造行** —— 掉海扫描属 M7 后续片，
   *   现在补一条「假装掉过海」的记录＝**凭实现倒推业务事实**（本项目一号坑的变体）。
   */
  findLatestRecord(relationId: bigint) {
    return this.prisma.seaRecord.findFirst({
      where: { relation_id: relationId },
      orderBy: [{ dropped_at: 'desc' }, { id: 'desc' }],
      select: { id: true },
    });
  }

  /** 回填「谁 / 何时领回」（→ F2 `claimed_by` / `claimed_at`；`idx_claimer` 供领取率 / 公海报表用） */
  markClaimed(recordId: bigint, data: { claimedBy: bigint; claimedAt: Date }) {
    return this.prisma.seaRecord.update({
      where: { id: recordId },
      data: { claimed_by: data.claimedBy, claimed_at: data.claimedAt },
      select: { id: true, claimed_at: true },
    });
  }
}
