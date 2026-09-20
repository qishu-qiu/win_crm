// =============================================================================
// F 域出参 DTO（M7-01）—— **只服务于 Swagger 文档**，不参与运行时转换
//
// 口径来源（★ 真相源，勿自造）：
//   · 接口 §4.5 那行只写了「幂等；领取即继承原 owner 全文跟单」，**§5 没有形状章节** ——
//     本片出参由施工单定稿（2026-09-20 已拍板）：**不新造形状** ＝
//     **C 域 `RelationVo`（列表项形状的唯一落点）＋ 本次回填结果 `claimed_at`**，
//     前端据此可直接跳 `/relations/:id`。
//     ⚠ 待**片 2 真库验过后**一次性回填接口 §5（不先写契约再改实现，免得两头漂）。
//   · 同 §2.6：出参 snake_case；id 一律十进制字符串（bigint 由统一出参拦截器转）。
//
// ★ 为什么 `extends RelationVoDto` 而不在 F 域重抄 20 个字段：抄一遍就是**双真相源**——
//   将来 C 域加一个字段，这里忘了加，前端类型就分叉（本项目一号坑）。
//   D 域的 `ActivateRelationVo extends RelationVo` 是同一姿势。
//
// ★ 可空字段必须写全 `type` ＋ `nullable`：只写 `description` 时 Swagger 解不出联合类型，
//   会把字段生成成空对象 `{}`，前端出参类型退化成 `Record<string, never>`（→ 铁律坑 20）。
// =============================================================================
import { ApiProperty } from '@nestjs/swagger';

import { RelationVoDto } from '../../relation/dto/relation-response.dto';

/** 领取成功出参 ＝ 关系列表项 ＋ 本次回填结果（→ 施工单 §片 1） */
export class SeaClaimVoDto extends RelationVoDto {
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      '本次领回 `sea_record.claimed_at`（ISO），即**这次从公海领回的时间**；' +
      '**`null` ＝ 这条关系没有入公海历史**（掉海扫描属 M7 后续片：没有历史就**不造行**，' +
      '不假装掉过海）—— 与「领取成功」不矛盾',
  })
  claimed_at!: string | null;
}
