// =============================================================================
// 外出登记（visit）入参 DTO —— 纯行政考勤（→ 需求 §7.5 / 架构 C6 / 接口 §4.7·§5.8）
//
// ★ 口径（勿自造）：就三样 —— `depart_at`（出去时间）/ `reason`（去干什么一句话）/
//   `relation_ids?`（可选：去了哪些客户）。**不收预计返回时间 / 交通 / 目的地 / 备注**，
//   **不产生业务事件、不关联报销**（→ 需求 §7.5 / §14.2）。
// =============================================================================
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsDateString, IsInt, IsOptional, IsPositive, IsString, Length } from 'class-validator';
import { Type } from 'class-transformer';

/** `POST /visits`：外出登记（→ 接口 §4.7 / §5.8） */
export class CreateVisitDto {
  @ApiProperty({
    description: '出去时间（ISO 8601，本地时区；纯考勤记录，不做未来校验）',
    example: '2026-09-28T09:30:00',
  })
  @IsDateString({}, { message: 'depart_at 必须是合法时间（ISO 8601）' })
  @Type(() => String)
  depart_at!: string;

  @ApiProperty({ description: '去干什么（一句话，≤255 字；行政知道他不在公司、去干啥了）', example: '拜访 A 客户谈续约' })
  @IsString({ message: 'reason 必须是字符串' })
  @Length(1, 255, { message: 'reason 长度须为 1~255' })
  reason!: string;

  @ApiPropertyOptional({
    description: '去了哪些客户（业务关系 id 数组，**可空**＝只登记行踪不挂客户）；纯行政、不校验归属',
    example: [1001, 1002],
    type: [Number],
  })
  @IsOptional()
  @IsArray({ message: 'relation_ids 必须是数组' })
  @IsInt({ each: true, message: 'relation_ids 每项必须是整型' })
  @IsPositive({ each: true, message: 'relation_ids 每项须为正整数' })
  relation_ids?: number[];
}

/** `POST /visits/:id/return`：回来点一下（→ 接口 §4.7）。req 体为空 `{}`，本 DTO 仅占位。 */
export class ReturnVisitDto {}
