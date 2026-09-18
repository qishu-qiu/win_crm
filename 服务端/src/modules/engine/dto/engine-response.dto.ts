// =============================================================================
// D 域出参 DTO（M4-07 / M4-08）—— **只服务于 Swagger 文档**，不参与运行时转换
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM接口API文档》§5.7 事件项：
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

// ★ 跨域引**形状**：接口 §5.6 的「关系列表项」只有**一份**定义（C 域 `RelationVoDto`）——
//   本域再抄一遍约 20 个字段＝双真相源（改一处漏一处）。同 `engine-request.dto.ts` 引 C 域
//   `relation-attributes` 枚举白名单的理由：唯一落点在哪就引哪。
import { RelationVoDto } from '../../relation/dto/relation-response.dto';
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
    // ⚠ `items` 必须写全 → `additionalProperties: true`：写成 `{ type: 'object' }`（或空 `{}`）
    //   都会让 `openapi-typescript` 产出 **`Record<string, never>[]`** —— 那种类型一写 `.xxx`
    //   就报错（等于不可用，→ 铁律坑 20）。本字段本批恒为 `[]`，但**类型也得是能用的**。
    items: { type: 'object', additionalProperties: true },
    description: '附件（本批不接收，恒为 `[]`）',
  })
  attachments!: unknown[];
}

/** 承诺项（→ §5.7 承诺形状，M4-09） */
export class CommitmentVoDto {
  @ApiProperty({ description: '承诺 id', example: '9' })
  id!: string;

  @ApiProperty({ description: '所属业务关系 id', example: '11' })
  relation_id!: string;

  @ApiProperty({
    enum: ['me', 'them', 'verdict'],
    description: '承诺三型：`me` 我答应客户 / `them` 客户答应我 / `verdict` 我定的判定点',
    example: 'me',
  })
  party!: string;

  @ApiProperty({ description: '承诺类型（→ 数据架构 D1）', example: 'deliver' })
  ctype!: string;

  @ApiProperty({ description: '一句话承诺内容', example: '周三前把报价单发过去' })
  content!: string;

  @ApiProperty({ type: String, nullable: true, description: '到期时间（未定＝`null`）' })
  due_at!: string | null;

  @ApiProperty({ type: String, nullable: true, description: '提醒时间（未定＝`null`）' })
  remind_at!: string | null;

  @ApiProperty({
    enum: ['open', 'done', 'expired', 'waived', 'cancelled'],
    description:
      '状态。`open` 进行中 / `done` 已兑现 / `expired` 已逾期（派生态，按 `due_at` 算）/ ' +
      '`waived` 已豁免（**必填原因**，理由见 `waive_reason`）/ `cancelled` 已取消',
    example: 'open',
  })
  status!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      '豁免原因（**仅 `status=waived` 有值**，其余状态为 `null`）。' +
      '`cancelled` 与 `waived` 的分界：取消＝**录错了 / 不成立**（不填原因）；' +
      '豁免＝**确有其事但做不成**（客户变卦 / 特殊原因…，**必填**）（→ 需求 §10.1）',
  })
  waive_reason!: string | null;

  @ApiProperty({ type: String, nullable: true, description: '兑现时间（未兑现＝`null`）' })
  done_at!: string | null;
}

/** 今日动线条目（→ §5.7，M4-10） */
export class AgendaItemVoDto {
  @ApiProperty({ description: '动线条目 id', example: '31' })
  id!: string;

  @ApiProperty({
    enum: ['commitment', 'appointment', 'cadence', 'relation'],
    description: '这条因何而来：承诺 / 预约 / 节奏规则命中 / 关系（掉海硬提醒）',
    example: 'commitment',
  })
  ref_type!: string;

  @ApiProperty({ type: String, nullable: true, description: '来源对象 id（如承诺 id）' })
  ref_id!: string | null;

  @ApiProperty({
    type: EngineRefDto,
    nullable: true,
    description:
      '哪条业务关系（`name` 取公司全称，→ C 域出口）。' +
      '**可为 `null`**：动线条目存在「只有联系人、还没挂关系」的形态（→ 数据架构 D4 `relation_id` 可空）',
  })
  relation!: EngineRefDto | null;

  @ApiProperty({ type: EngineRefDto, nullable: true, description: '对着哪个联系人（可为 `null`）' })
  contact!: EngineRefDto | null;

  @ApiProperty({ type: String, nullable: true, description: '为什么今天该找 TA' })
  reason!: string | null;

  @ApiProperty({ description: '优先级（越大越靠前）', example: 10 })
  priority!: number;

  @ApiProperty({ type: String, nullable: true, description: '建议动作（人话）' })
  action_hint!: string | null;

  @ApiProperty({
    enum: ['open', 'done', 'snoozed', 'ignored'],
    description: '处理状态（列表只返回 `open` / `snoozed`，见仓储注释）',
    example: 'open',
  })
  status!: string;

  @ApiProperty({ description: '已被「明天再说」几次（上限 3，→ 需求 §10.4）', example: 0 })
  snooze_count!: number;
}

/**
 * 批量快速标记出参（→ §5.7 `POST /events/quick-mark`，M6-09）。
 * ⚠ 规格**只给了 req、没给出参形状** —— 本批按「标了几条」实现，
 *   缺口登记（→《欠账登记表》D-24），待回填接口文档。
 */
export class QuickMarkResultDto {
  @ApiProperty({ description: '实际落库的事件条数（＝去重后能写的关系数）', example: 3 })
  marked!: number;
}

/**
 * `POST /contacts/:id/activate-relation` 出参（→ 接口 §5.6，D-29）：
 * **新关系的列表项**（＝ §5.6 列表项形状，前端可直接跳详情）＋ `linked_events`。
 * ★ 列表项部分**继承 C 域 `RelationVoDto`**（理由见本文件头 ★ 跨域引形状）。
 */
export class ActivateRelationResultDto extends RelationVoDto {
  @ApiProperty({
    description:
      '本次**搬运的孤儿跟单条数**（关联前只挂在联系人、没挂关系的那批 `action_event`）。' +
      '⚠ 可重入：重复调用**不会二次搬运**（只动 `relation_id` 为空的行），故第二次通常是 `0`',
    example: 2,
  })
  linked_events!: number;
}
