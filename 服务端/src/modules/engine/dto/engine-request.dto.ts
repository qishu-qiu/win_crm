// =============================================================================
// D 域入参 DTO（M4-07 写跟单）
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM接口API文档》V1.17 §5.7：
//       `POST /relations/:id/events` req `{contact_id?,action_type,summary?,outcome?,
//        stage_forward?,pain_point_id?,competition?,competitor_id?,competition_note?,
//        duration_min?,mentioned_user_ids?:[],promise?:{...},appointment_id?,visit_log_id?}`
//   · 《销售CRM数据架构文档》V1.31 D2：`action_type` / `outcome` / `summary` ≤ 200 字；
//       `competition` ∈ none / in_use / comparing；`competition_note` ≤ 100 字。
//   · 同 §2.4：字段缺失 / 类型错 / **枚举非法** → **400 / 20001**（横切校验管道统一出口）。
//   · 同 §2.6：入参出参 **snake_case**；id 一律**十进制字符串**（后端 `bigint`）。
//
// ★ 本批**故意不收**的字段（都在上面那条 req 里，但**属后续里程碑**，收了也无法校验＝假契约）：
//   · `stage_forward` —— 阶段推进（接口 §2.6 / §5.6），M4 只裁了「数字 1~7」，推进本身未做；
//   · `pain_point_id` —— 卡点字典项（C5 / 字典域）未接；
//   · `competitor_id` —— 竞品名册（C7）属 **C 域**，跨域出口未开，收了无法验存在性
//     （不校验就落库＝外键报错 500，比不收更糟）；
//   · `promise` —— 承诺随事件一起建（M4-09），本批事件与承诺分开交付；
//   · `appointment_id` / `visit_log_id` —— 预约（D5）/ 外出（§5.8）未接。
//
// ★ 枚举用 `@IsIn([...常量])` 而不是再抄一份字面量：白名单只有一处落点，
//   将来加值只改 domain（漏改 DTO 会立刻编译不过）。
//   `competition` 的常量**引 C 域 `relation-attributes`**（C 域是更低层，架构 §5.1 允许依赖；
//   且它是该白名单的**唯一落点**，在 D 域重抄一份就是双真相源）。
// =============================================================================
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

import { COMPETITION_VALUES } from '../../relation/domain/relation-attributes';
import { ACTION_TYPES, OUTCOME_VALUES, SUMMARY_MAX_LENGTH } from '../domain/event-effective';

/** `competition_note` 上限（→ D2：≤100 字） */
const COMPETITION_NOTE_MAX_LENGTH = 100;
/** 单次投入分钟上限（一天 1440 分钟；超过必是误填） */
const DURATION_MAX = 1440;

/** `POST /relations/:id/events`（写跟单） */
export class CreateEventDto {
  @ApiPropertyOptional({
    description:
      '本次对着哪个联系人（**选填**，→ 需求 §6.3 多联系人：见谁都算有效跟进，不按角色加权）',
    example: '5',
  })
  @IsOptional()
  @IsString({ message: 'contact_id 必须是字符串' })
  @Length(1, 32, { message: 'contact_id 长度不合法' })
  contact_id?: string;

  @ApiProperty({
    enum: ACTION_TYPES,
    description:
      '动作类型（→ D2）。`meal` / `gift` / `greeting`＝客情；`ask_help`＝@求助；' +
      '`note`＝纯备注；`system`＝系统事件',
    example: 'phone',
  })
  @IsIn([...ACTION_TYPES], { message: 'action_type 取值不合法' })
  action_type!: string;

  @ApiPropertyOptional({
    description:
      '一句话结果（≤200 字）。**有效沟通必填，快速标记可空** —— ' +
      '`outcome` ∈ 未联系 / 未接电话 / 说两句挂了 时不强制写一个字（→ 需求 §10.2）',
    example: '客户说下周一再谈，等他们内部过会',
  })
  @IsOptional()
  @IsString({ message: 'summary 必须是字符串' })
  @Length(1, SUMMARY_MAX_LENGTH, { message: `summary 最长 ${SUMMARY_MAX_LENGTH} 字` })
  summary?: string;

  @ApiPropertyOptional({
    enum: OUTCOME_VALUES,
    description:
      '结果。**有效沟通**：advanced（有进展）/ stalled（卡住）/ await_reply（等回复）；' +
      '**快速标记（无效沟通，不重置掉海倒计时）**：not_contacted / no_answer / brief_hangup。' +
      '空＝中性（非必填，且**算有效沟通**）',
  })
  @IsOptional()
  @IsIn([...OUTCOME_VALUES], { message: 'outcome 取值不合法' })
  outcome?: string;

  @ApiPropertyOptional({
    enum: COMPETITION_VALUES,
    description: '本次跟单了解的竞品态势（→ D2：事务回写 C1 快照）',
  })
  @IsOptional()
  @IsIn([...COMPETITION_VALUES], { message: 'competition 取值不合法' })
  competition?: string;

  @ApiPropertyOptional({ description: '竞品情况一句话（≤100 字）' })
  @IsOptional()
  @IsString({ message: 'competition_note 必须是字符串' })
  @Length(1, COMPETITION_NOTE_MAX_LENGTH, {
    message: `competition_note 最长 ${COMPETITION_NOTE_MAX_LENGTH} 字`,
  })
  competition_note?: string;

  @ApiPropertyOptional({ description: '本次投入分钟（算单位时间价值）', example: '30' })
  @IsOptional()
  @IsInt({ message: 'duration_min 必须是整数' })
  @Min(1, { message: 'duration_min 至少 1 分钟' })
  @Max(DURATION_MAX, { message: `duration_min 最多 ${DURATION_MAX} 分钟` })
  duration_min?: number;

  @ApiPropertyOptional({
    description:
      '@求助的同事 id 列表（十进制字符串）。**仅正向展示**（卡片上"本条 @了谁"）；' +
      '授权另走 `relation_member.ask_help`（→ D2 / C2），本列**不做反向查询**',
    example: ['8'],
  })
  @IsOptional()
  @ArrayMaxSize(20, { message: 'mentioned_user_ids 最多 20 个' })
  @IsString({ each: true, message: 'mentioned_user_ids 里每项都必须是字符串' })
  mentioned_user_ids?: string[];
}
