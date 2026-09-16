// =============================================================================
// C 域入参 DTO（M3-09 / M3-10 / M3-11）
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM接口API文档》§5.6：
//       `POST /relations` req `{company_id, dept_id, product_line_id}`
//       `PUT /relations/:id` req `{urgency?, value_tier?, next_action_hint?, competition?, competitor_id?}`
//       `POST /relations/:id/members` req `{employee_id, member_type, source:"collaborate"|"ask_help", valid_until?}`
//   · 《销售CRM数据架构文档》C1 / C2：`urgency` / `value_tier` / `competition` /
//     `member_type` / `source` 的**枚举值**（白名单在 domain 里，DTO 只做「照抄一遍」的入参校验）。
//   · 同 §2.4：字段缺失 / 类型错 / **枚举非法** → **400 / 20001**（横切层的校验管道统一出口）。
//   · 同 §2.6：入参出参 **snake_case**；所有 id 都是**十进制字符串**（后端 `bigint`，前端 string）。
//
// ★ 枚举用 `@IsIn([...domain 常量])` 而不是再抄一份字面量：白名单只有一处落点，
//   将来加值只改 domain（漏改 DTO 会立刻编译不过）。
// =============================================================================
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';

import {
  COMPETITION_VALUES,
  URGENCY_VALUES,
  VALUE_TIER_VALUES,
} from '../domain/relation-attributes';
import { RELATION_VIEWS } from '../domain/relation-list-filter';
import { COLLABORATOR_MEMBER_TYPE, OWNER_MEMBER_TYPE } from '../domain/relation-owner';

/** 页签取值（→ 接口 §4.4：私海 / 公海） */
export const RELATION_TABS = ['private', 'sea'] as const;

/** 成员来源（→ C2） */
export const MEMBER_SOURCES = ['collaborate', 'ask_help'] as const;

/** `POST /relations`（激活业务关系） */
export class CreateRelationDto {
  @ApiProperty({ description: '公司档案 id（→ B1）', example: '3' })
  @IsString({ message: 'company_id 必须是字符串' })
  @Length(1, 32, { message: 'company_id 长度不合法' })
  company_id!: string;

  @ApiProperty({
    description:
      '承接部门 id —— **必须落在我可建范围内**（销售＝我所属部门含兼职；经理＝管辖部门；' +
      '总经理＝任意）；⚠ `dept_id` 恒定不可变（→ 数据架构 C1），别部门想接＝自己激活一条',
    example: '2',
  })
  @IsString({ message: 'dept_id 必须是字符串' })
  @Length(1, 32, { message: 'dept_id 长度不合法' })
  dept_id!: string;

  @ApiProperty({ description: '产品线 id（→ A7）', example: '1' })
  @IsString({ message: 'product_line_id 必须是字符串' })
  @Length(1, 32, { message: 'product_line_id 长度不合法' })
  product_line_id!: string;
}

/**
 * `GET /relations` 查询参数：**页签 ＋ 分页 ＋ 筛选（视图 / 紧迫档）**。
 *
 * ★ 筛选两项是 **P-01 拍板（2026-09-16，七叔）**新增：前端文档 §5 要求该页有「seg 视图」
 *   与「紧迫档 chip」，而接口侧原本没有任何对应 query —— 拍板结论＝**由后端开参数**
 *   （**不是**前端本地过滤：一分页就只能筛当前页，且「共 N 条」会退化成"本页条数"）。
 * ★ 各档**判定**不写在本文件（DTO 只管"形状"，§2.4）—— 唯一落点＝
 *   `domain/relation-list-filter.ts`（纯函数、可单测）。
 * ★ 分页两项**只校验「是不是整数」**（类型层，§2.4「类型错 → 400」）；
 *   默认值 1 / 20 与上限 100 的**归一化归 kernel 一处**（→ §2.7）—— 这里不写 `@Min` / `@Max`，
 *   否则同一套夹紧规则会变成两份（`page=0` 该报错还是该回第 1 页，两处说法就分叉了）。
 */
export class ListRelationQueryDto {
  @ApiPropertyOptional({
    enum: RELATION_TABS,
    default: 'private',
    description: '`private`＝私海（我参与 / 管辖部门 / 全部）；`sea`＝公海（＝无 owner 的关系）',
  })
  @IsOptional()
  @IsIn([...RELATION_TABS], { message: 'tab 只能是 private 或 sea' })
  tab?: string;

  @ApiPropertyOptional({ description: '页码（默认 1；`< 1` 回第 1 页）', example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page 必须是整数' })
  page?: number;

  @ApiPropertyOptional({ description: '每页条数（默认 20；超 100 按 100 计）', example: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page_size 必须是整数' })
  page_size?: number;

  @ApiPropertyOptional({
    enum: RELATION_VIEWS,
    default: 'all',
    description:
      '视图（→ 前端文档 §5）：`all`＝我的全部（不过滤）/ `following`＝跟进中（阶段 1~5）/' +
      '`cooperated`＝已合作（阶段 6）/ `churned`＝已流失（阶段 7）。' +
      '⚠ 前端 §5 另有一档「逾期未跟进」，**本批不提供** —— 它要判「逾期」，而逾期唯一来源是承诺 / ' +
      '预约（D 域），字段尚未落地（→《欠账登记表》D-10）；**不编一个假的逾期定义**',
  })
  @IsOptional()
  @IsIn([...RELATION_VIEWS], { message: 'view 取值不合法' })
  view?: string;

  @ApiPropertyOptional({
    description:
      '紧迫档**多选**，逗号分隔（→ 需求 §8.2 五档）：`weekly` 周重点 / `monthly` 月重点 / ' +
      '`quarterly` 季度跟 / `long_term` 长期跟 / `gray` 灰度；不传＝不筛。空串按「没筛」处理',
    example: 'weekly,gray',
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.split(',').map((part) => part.trim()) : value,
  )
  @IsArray({ message: 'urgency 需为逗号分隔的字符串' })
  @IsIn([...URGENCY_VALUES], { each: true, message: 'urgency 含非法取值' })
  urgency?: string[];
}

/** `PUT /relations/:id`（改属性） */
export class UpdateRelationDto {
  @ApiPropertyOptional({ enum: URGENCY_VALUES, description: '紧迫档（纯手动，无自动降级）' })
  @IsOptional()
  @IsIn([...URGENCY_VALUES], { message: 'urgency 取值不合法' })
  urgency?: string;

  @ApiPropertyOptional({
    enum: VALUE_TIER_VALUES,
    description:
      '开发价值档。⚠ 非灰度关系**必标** ——「已标」＝**有值且合法即可，`pending` 也算标过**（2026-09-15 拍板），' +
      '**完全没标**才 **422 / 20403**',
  })
  @IsOptional()
  @IsIn([...VALUE_TIER_VALUES], { message: 'value_tier 取值不合法' })
  value_tier?: string;

  @ApiPropertyOptional({ description: '一句话「上次说好下次干嘛」', example: '周四带样机再谈' })
  @IsOptional()
  @IsString({ message: 'next_action_hint 必须是字符串' })
  @Length(0, 255, { message: 'next_action_hint 最长 255 字' })
  next_action_hint?: string;

  @ApiPropertyOptional({ enum: COMPETITION_VALUES, description: '竞品态势快照（录入在事件侧，此处为修正）' })
  @IsOptional()
  @IsIn([...COMPETITION_VALUES], { message: 'competition 取值不合法' })
  competition?: string;

  @ApiPropertyOptional({ description: '竞品名册 id（→ C7）', example: '1' })
  @IsOptional()
  @IsString({ message: 'competitor_id 必须是字符串' })
  @Length(1, 32, { message: 'competitor_id 长度不合法' })
  competitor_id?: string;
}

/** `POST /relations/:id/members`（加成员） */
export class AddRelationMemberDto {
  @ApiProperty({ description: '员工 id', example: '3' })
  @IsString({ message: 'employee_id 必须是字符串' })
  @Length(1, 32, { message: 'employee_id 长度不合法' })
  employee_id!: string;

  @ApiProperty({
    enum: [OWNER_MEMBER_TYPE, COLLABORATOR_MEMBER_TYPE],
    description: '`owner` 一关系仅一人（已有归属 → 409）；`collaborator` 可多人',
  })
  @IsIn([OWNER_MEMBER_TYPE, COLLABORATOR_MEMBER_TYPE], { message: 'member_type 取值不合法' })
  member_type!: string;

  @ApiPropertyOptional({
    enum: MEMBER_SOURCES,
    description:
      '仅协同人需要：`collaborate`＝正式协同（审批通过）／`ask_help`＝@求助（**限同部门**，' +
      '未给 `valid_until` 时默认 7 天）',
  })
  @IsOptional()
  @IsIn([...MEMBER_SOURCES], { message: 'source 取值不合法' })
  source?: string;

  @ApiPropertyOptional({ description: '协同有效期（ISO 日期；`null` / 缺省＝长期，仅正式协同）' })
  @IsOptional()
  @IsDateString({}, { message: 'valid_until 需为 ISO 日期字符串' })
  valid_until?: string;
}
