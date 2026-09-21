// =============================================================================
// F 域出参 DTO（F-01）—— **只服务于 Swagger 文档**，不参与运行时转换
//
// 口径来源（★ 真相源，勿自造）：
//   · 接口 **§5.16 公海 sea**（形状唯一落点）：出参 ＝ **C 域 `RelationVo`（列表项形状的唯一落点）
//     ＋ 本次回填结果 `claimed_at`**，前端据此可直接跳 `/relations/:id`（§4.5 那行留指针）。
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

import { RelationRefDto, RelationVoDto } from '../../relation/dto/relation-response.dto';

/** 领取成功出参 ＝ 关系列表项 ＋ 本次回填结果（→ 接口 §5.16） */
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

/**
 * 一条公海规则（→ 接口 §4.14.10 / §5.16）。
 *
 * ★ 四个天数可以各自为 `null` ＝ **该维度没配**（口径见 F1 / 需求 §6.3）；
 *   前端展示成"未配置"，**不要回落成默认天数**（回落＝凭空造业务口径）。
 * ★ `pending` 是**派生字段**（`effective_from > 请求时刻`）＝ "7 天缓冲期内、还没生效" ——
 *   前端据此显示「将于 X 生效」而不是"当前生效值"，免得经理以为自己刚改的立刻生效了。
 */
export class SeaRuleVoDto {
  @ApiProperty({ description: '规则行 id（`sea_rule.id`；版本行，**停用不删**）', example: '7' })
  id!: string;

  @ApiProperty({ enum: [1, 2, 3, 4], description: '层级：1 全局 / 2 产品线 / 3 部门 / 4 部门×产品线' })
  level!: number;

  @ApiProperty({
    type: RelationRefDto,
    nullable: true,
    description: '部门引用（层级 3 / 4 才有；层级 1 / 2 为 `null`）',
  })
  dept!: RelationRefDto | null;

  @ApiProperty({
    type: RelationRefDto,
    nullable: true,
    description: '产品线引用（层级 2 / 4 才有；层级 1 / 3 为 `null`）',
  })
  product_line!: RelationRefDto | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: '跟进频次天数（触发①；`null` ＝ 未配）',
    example: 30,
  })
  follow_freq_days!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: '成单周期天数（触发②；⚠ 锚点口径未定 ⇒ 只配不生效，→ D-57）',
    example: 90,
  })
  deal_cycle_days!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: '公海停留超期天数（**只用于"公海停留超期→经理决策待办"**，不参与私海倒计时，→ F1 P-10）',
    example: 60,
  })
  stay_days!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: '推进停滞天数（触发③；⚠ 锚点口径未定 ⇒ 只配不生效，→ D-57）',
    example: 21,
  })
  no_progress_max!: number | null;

  @ApiProperty({
    type: String,
    description: '生效时刻（ISO；＝**提交日 + 7 天**，→ 需求 §6.3 的 7 天缓冲）',
    example: '2026-09-28T12:00:00.000Z',
  })
  effective_from!: string;

  @ApiProperty({ description: '行状态（`active` / `disabled`；**停用不删**，历史版本仍在表里）', example: 'active' })
  status!: string;

  @ApiProperty({ description: '是否**还没生效**（`effective_from > 现在` ⇒ 7 天缓冲期内）', example: false })
  pending!: boolean;
}

/** `PUT /sea/rules` 出参：预告结果 ＋（落库时）新版本行（→ 接口 §5.16） */
export class SeaRuleUpdateResultDto {
  @ApiProperty({
    description:
      '**是否已落库**：`false` ＝ 只回了预告（`confirmed` 未传 / `false`，**零写库**）；' +
      '`true` ＝ 已插新版本行（旧行已置 `disabled`）',
    example: true,
  })
  applied!: boolean;

  @ApiProperty({
    description:
      '**本次变更将影响 X 个客户** ＝ 新版本生效后由这条规则约束的**在途私海**客户数' +
      '（含"新版本配了天数才真会掉海"的那批口径说明 → §5.16）',
    example: 12,
  })
  affected_customers!: number;

  @ApiProperty({
    type: String,
    description: '拟生效 / 已定生效时刻（ISO）＝ **提交日 + 7 天**',
    example: '2026-09-28T12:00:00.000Z',
  })
  effective_from!: string;

  @ApiProperty({
    type: SeaRuleVoDto,
    nullable: true,
    description: '落库后的新版本行；**只回预告时为 `null`**',
  })
  rule!: SeaRuleVoDto | null;
}
