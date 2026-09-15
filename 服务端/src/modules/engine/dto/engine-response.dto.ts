// =============================================================================
// D 域出参 DTO（M4-07 / M4-08）—— **只服务于 Swagger 文档**，不参与运行时转换
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM接口API文档》V1.17 §5.7 事件项：
//       `{id,action_type,summary,outcome,pain_point:{id,label}?,competition?,actor:{id,name},
//         owner_snapshot?,contact:{id,name}?,duration_min?,event_at,branch:"main"|"sub",
//         round_no,attachments:[]}`
//   · 同 §2.6：出参 **snake_case**；id 一律**十进制字符串**（`bigint` 由统一出参拦截器转）。
//
// ⚠ **M4 只给出本模块真能算出来的字段**（不填假值、也不假装有字段）。未落地的字段与原因：
//   · `pain_point` —— 卡点字典（C5）未接，本批不收也不返；
//   · `round_no` —— 轮次由 `sea_record`（F 域）派生，`sea_record` 未落库（→ 交接说明 §三 #12）；
//   · `attachments` —— 本批不接收附件，恒为空数组（字段**保留**以免前端判空逻辑分叉）。
//
// ★ 可空字段**必须写全 `type` ＋ `nullable`**（`@ApiProperty({ type: String, nullable: true })`）：
//   只写 `description` 时 Swagger 解不出 `X | null` 联合类型，会把该字段生成成**空对象 `{}`**，
//   前端生成物随之变成 `Record<string, never>`（**类型等于不可用**）—— 踩过，→ 铁律坑 20。
// =============================================================================
import { ApiProperty } from '@nestjs/swagger';

/** 「实体引用」统一形状 `{id,name}`（同 C 域 `RelationRefDto` 的约定，→ 接口 §四） */
export class EngineRefDto {
  @ApiProperty({ description: 'id（十进制字符串）', example: '7' })
  id!: string;

  @ApiProperty({ description: '名称快照（取引用那一刻的库值）', example: '王海涛' })
  name!: string;
}

/** 跟单事件项（→ §5.7） */
export class ActionEventVoDto {
  @ApiProperty({ description: '事件 id', example: '1' })
  id!: string;

  @ApiProperty({ description: '动作类型（→ D2）', example: 'phone' })
  action_type!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: '一句话结果（**快速标记时为 `null`**）',
  })
  summary!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: '结果码（空＝中性，→ D2）',
    example: 'advanced',
  })
  outcome!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: '本次了解的竞品态势（→ C1 快照）',
    example: 'none',
  })
  competition!: string | null;

  @ApiProperty({ type: EngineRefDto, description: '谁填的（操作人）' })
  actor!: EngineRefDto;

  @ApiProperty({
    type: EngineRefDto,
    nullable: true,
    description:
      '**本条创建时该关系的归属人**（→ D2 `owner_snapshot`：按轮次归组 ＋ 前主人标姓名用）。' +
      '关系暂无 owner（如已掉公海）时为 `null`',
  })
  owner_snapshot!: EngineRefDto | null;

  @ApiProperty({
    type: EngineRefDto,
    nullable: true,
    description: '本次跟进的联系人（**选填**，→ 需求 §6.3 多联系人口径）',
  })
  contact!: EngineRefDto | null;

  @ApiProperty({ type: Number, nullable: true, description: '本次投入分钟' })
  duration_min!: number | null;

  @ApiProperty({ description: '事件发生时间（时间线排序基准，→ D2 `event_at`）' })
  event_at!: string;

  @ApiProperty({
    enum: ['main', 'sub'],
    description:
      '`main`＝本条是**该关系 owner** 写的（主线）；`sub`＝协同 / 他人写的（树杈）—— ' +
      '**分界基准是 owner，不是当前登录人**（→ 决策 #30：经理打开时看到的也是主跟单人视角）',
  })
  branch!: 'main' | 'sub';

  @ApiProperty({
    type: 'array',
    items: { type: 'object' },
    description: '附件（本批不接收，恒为 `[]`）',
  })
  attachments!: unknown[];
}
