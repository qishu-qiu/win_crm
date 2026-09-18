// =============================================================================
// A 域 · 字典服务（M6-15）—— 「英文码 → 中文文案」的**唯一跨域出口**
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM架构设计说明》§5.1：第 1 层 `org(A)` 的能力 ＝
//     **人 / 部门 / 角色 / 规则 / 字典 / 通知 / 目标** —— 「字典」是 A 域的**并列能力之一**，
//     故它有**自己的 service**（而不是塞进 `OrgService`：那个类的语义是"组织与权限"）。
//   · 同 §5.2 路之①：别的域要字典文案时**同步调本 service** ——
//     `dict_item` 是 A 域的表，跨域**不许直查**（更不许直连 `OrgRepository`）。
//   · 《销售CRM数据架构文档》A11 / A12（`dict_type` / `dict_item`）；
//     全站口径「**枚举一律英文码落库、文案走字典**」（→ `CODEBUDDY.md` §5）。
//
// ★ 为什么不放 kernel：kernel 是**零业务依赖**且**不查库**（架构 §5.2 / §5.4）——
//   「从库里取字典」必须由拥有该表的域提供。kernel 只放**纯形状函数**（如 `parseStringList`）。
// ⚠ 将来 §4.14.1 的字典读写端点（字典项新增 / 停用）落在**本类**，
//   **不要**回塞 `OrgService`（否则那个类又会变成杂物间，与本次调整的初衷相反）。
// =============================================================================
import { Injectable } from '@nestjs/common';

import { OrgRepository } from './org.repository';

@Injectable()
export class DictService {
  constructor(private readonly repository: OrgRepository) {}

  /**
   * 字典项 `{id,label}` 引用（→ 数据架构 A11）—— 把**已落库的英文码**翻成中文文案。
   *
   * ★ 只做一件事：**按 id 批量取 `label`**；查不到的 id 由调用方回落
   *   （**不编文案** —— 编出来的中文没人能审计出它从哪来）。
   * ⚠ 是**批量**接口：逐个 id 查会变成 N+1（一条联系人 3 个特质就是 3 次往返）。
   * 首个调用方＝B 域联系人详情的 `traits:[{trait_id,trait_code,label}]`（→ D-03）。
   */
  getDictItemLabels(ids: readonly bigint[]): Promise<{ id: bigint; label: string }[]> {
    return this.repository.findDictItemLabels(ids);
  }
}
