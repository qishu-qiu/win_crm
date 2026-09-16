// =============================================================================
// D 域入参 DTO（M4-07 写跟单）
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM接口API文档》§5.7：
//       `POST /relations/:id/events` req `{contact_id?,action_type,summary?,outcome?,
//        stage_forward?,pain_point_id?,competition?,competitor_id?,competition_note?,
//        duration_min?,mentioned_user_ids?:[],promise?:{...},appointment_id?,visit_log_id?}`
//   · 《销售CRM数据架构文档》D2：`action_type` / `outcome` / `summary` ≤ 200 字；
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
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

import { COMPETITION_VALUES } from '../../relation/domain/relation-attributes';
import {
  CLOSABLE_STATUSES,
  COMMITMENT_CONTENT_MAX_LENGTH,
  COMMITMENT_CTYPES,
  COMMITMENT_PARTIES,
  COMMITMENT_WAIVE_REASON_MAX_LENGTH,
} from '../domain/commitment-rules';
import { ACTION_TYPES, OUTCOME_VALUES, QUICK_MARK_OUTCOMES, SUMMARY_MAX_LENGTH } from '../domain/event-effective';

/** `competition_note` 上限（→ D2：≤100 字） */
const COMPETITION_NOTE_MAX_LENGTH = 100;
/** 单次投入分钟上限（一天 1440 分钟；超过必是误填） */
const DURATION_MAX = 1440;
/** 一次批量快速标记的条数上限（一屏勾选足够；也防一次请求打爆 `action_event`） */
const QUICK_MARK_MAX_ITEMS = 100;

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

/** `GET /relations/:id/events`（时间线，→ §5.7：默认近 1 个月） */
export class ListEventQueryDto {
  @ApiPropertyOptional({
    enum: ['1m', 'all'],
    description: '时间窗：`1m` ＝近 1 个月（默认，→ §5.7）；`all` ＝全部',
  })
  @IsOptional()
  @IsIn(['1m', 'all'], { message: 'range 取值不合法' })
  range?: string;
}

/** `POST /relations/:id/commitments`（建承诺，→ §5.7 / 需求 §10.1） */
export class CreateCommitmentDto {
  @ApiPropertyOptional({
    description: '对着哪个联系人（**选填**，同事件口径：不选也可提交）',
    example: '5',
  })
  @IsOptional()
  @IsString({ message: 'contact_id 必须是字符串' })
  @Length(1, 32, { message: 'contact_id 长度不合法' })
  contact_id?: string;

  @ApiProperty({
    enum: COMMITMENT_PARTIES,
    description:
      '承诺三型：`me` 我答应客户（**催自己**）/ `them` 客户答应我（**催客户**）/ ' +
      '`verdict` 我定的判定点（**给个结论**）—— → 需求 §10.1',
    example: 'me',
  })
  @IsIn([...COMMITMENT_PARTIES], { message: 'party 取值不合法' })
  party!: string;

  @ApiProperty({
    enum: COMMITMENT_CTYPES,
    description: '承诺类型（→ 数据架构 D1：9 种，`social_*` 为客情类）',
    example: 'deliver',
  })
  @IsIn([...COMMITMENT_CTYPES], { message: 'ctype 取值不合法' })
  ctype!: string;

  @ApiProperty({ description: '一句话承诺内容（≤255 字）', example: '周三前把报价单发过去' })
  @IsString({ message: 'content 必须是字符串' })
  @Length(1, COMMITMENT_CONTENT_MAX_LENGTH, {
    message: `content 最长 ${COMMITMENT_CONTENT_MAX_LENGTH} 字`,
  })
  content!: string;

  @ApiPropertyOptional({
    description:
      '到期时间（ISO 字符串）。**前端「三快选」默认明天**，服务端**不替销售定时间**（不给＝未定，→ 需求 §10.1）',
    example: '2026-09-16T00:00:00.000Z',
  })
  @IsOptional()
  @IsDateString({}, { message: 'due_at 需为 ISO 日期字符串' })
  due_at?: string;

  @ApiPropertyOptional({
    description: '提醒时间（ISO 字符串）；不给＝到期当天清晨（组装时算，属 M7）',
    example: '2026-09-16T01:00:00.000Z',
  })
  @IsOptional()
  @IsDateString({}, { message: 'remind_at 需为 ISO 日期字符串' })
  remind_at?: string;

  @ApiPropertyOptional({
    description: '由哪条跟单产生（选填；写事件的「有承诺吗」三快选带过来，→ 需求 §10.1）',
    example: '101',
  })
  @IsOptional()
  @IsString({ message: 'source_event_id 必须是字符串' })
  @Length(1, 32, { message: 'source_event_id 长度不合法' })
  source_event_id?: string;
}

/**
 * `PUT /relations/:id/commitments`（改承诺）。
 * ⚠ 规格只给了「`G/P/U /relations/:id/commitments`」这一行（→ 接口 §三 总览 / §5.7），
 *   **没给 U 的入参形状** —— 本批按「`id` 指认目标承诺 ＋ 要改的字段」实现，
 *   冲突 / 缺口已登记（→《欠账登记表》D-16）。
 */
export class UpdateCommitmentDto {
  @ApiProperty({ description: '要改哪条承诺（十进制字符串）', example: '9' })
  @IsString({ message: 'id 必须是字符串' })
  @Length(1, 32, { message: 'id 长度不合法' })
  id!: string;

  @ApiPropertyOptional({
    enum: CLOSABLE_STATUSES,
    description:
      '流转到（→ 需求 §10.1 收尾三态）：`done` 兑现（写 `done_at` / `done_by`）/ ' +
      '`cancelled` 取消（**录错了 / 不成立**，不需原因）/ `waived` 豁免（**必填原因**，见 `waive_reason`）。' +
      '已结束的承诺（兑现 / 取消 / 豁免）再改 → **422 / 20403**',
    example: 'done',
  })
  @IsOptional()
  @IsIn([...CLOSABLE_STATUSES], { message: 'status 取值不合法' })
  status?: string;

  @ApiPropertyOptional({
    description:
      '豁免原因（**仅 `status=waived` 时传，且必填** ≤255 字；兑现 / 取消 / 改期一律不传）。' +
      '★ 为什么豁免必填而取消不必填：取消＝记录本身错了（纠错），豁免＝记录没错、但结果没成 ——' +
      '不写原因，经理事后分不清"这条线还有没有戏"（→ 需求 §10.1）',
    example: '客户内部预算冻结，本季度不启动',
    maxLength: COMMITMENT_WAIVE_REASON_MAX_LENGTH,
  })
  @IsOptional()
  @IsString({ message: 'waive_reason 必须是字符串' })
  @Length(1, COMMITMENT_WAIVE_REASON_MAX_LENGTH, {
    message: `waive_reason 长度须为 1~${COMMITMENT_WAIVE_REASON_MAX_LENGTH}`,
  })
  waive_reason?: string;

  @ApiPropertyOptional({ description: '改期（ISO 字符串）', example: '2026-09-20T00:00:00.000Z' })
  @IsOptional()
  @IsDateString({}, { message: 'due_at 需为 ISO 日期字符串' })
  due_at?: string;

  @ApiPropertyOptional({ description: '改提醒时间（ISO 字符串）', example: '2026-09-20T01:00:00.000Z' })
  @IsOptional()
  @IsDateString({}, { message: 'remind_at 需为 ISO 日期字符串' })
  remind_at?: string;
}

/**
 * `POST /events/quick-mark`（批量快速标记，→ 接口 §5.7 / §4.6）。
 *
 * 规格原文 req：`{relation_ids?:[],contact_ids?:[],outcome:"not_contacted"|"no_answer"|"brief_hangup"}`
 * （`relation_ids` 与 `contact_ids` **至少一组非空**；**不更新 `last_event_at`**）。
 *
 * ⚠ 本批**只接 `relation_ids`**：`contact_ids`（"待关联公司"阶段只绑联系人的标记，→ 需求 §6.1 模型 B）
 *   要先判「这条联系人归不归我写」，而 B 域目前**没有联系人写权限出口**、规格也没给判定口径 ——
 *   收了只能不校验（＝假契约）。故给了 `contact_ids` 一律 **400**，缺口登记（→《欠账登记表》D-23）。
 */
export class QuickMarkDto {
  @ApiPropertyOptional({
    description: '要标记的业务关系 id 列表（十进制字符串）。与 `contact_ids` 至少一组非空',
    example: ['5', '4'],
  })
  @IsOptional()
  @IsArray({ message: 'relation_ids 必须是数组' })
  @ArrayMaxSize(QUICK_MARK_MAX_ITEMS, { message: `relation_ids 最多 ${QUICK_MARK_MAX_ITEMS} 条` })
  @IsString({ each: true, message: 'relation_ids 里每项都必须是字符串' })
  relation_ids?: string[];

  @ApiPropertyOptional({
    description:
      '待关联联系人的 id 列表（十进制字符串）。⚠ **本批未开放**：联系人写权限口径未定，' +
      '给了会返回 **400**（→《欠账登记表》D-23）',
    example: ['7'],
  })
  @IsOptional()
  @IsArray({ message: 'contact_ids 必须是数组' })
  @ArrayMaxSize(QUICK_MARK_MAX_ITEMS, { message: `contact_ids 最多 ${QUICK_MARK_MAX_ITEMS} 条` })
  @IsString({ each: true, message: 'contact_ids 里每项都必须是字符串' })
  contact_ids?: string[];

  @ApiProperty({
    enum: QUICK_MARK_OUTCOMES,
    description:
      '快速标记三型：`not_contacted` 未联系 / `no_answer` 未接电话 / `brief_hangup` 说两句挂了' +
      '（→ 需求 §10.2）。**不算有效跟进、不重置掉海倒计时**（→ 需求 §6.3）',
    example: 'no_answer',
  })
  @IsIn([...QUICK_MARK_OUTCOMES], { message: 'outcome 取值不合法（只接受三型快速标记）' })
  outcome!: string;
}
