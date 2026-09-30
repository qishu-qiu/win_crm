// =============================================================================
// E 域入参 DTO（M9-E / B3：签约校验清单配置）
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM接口API文档》§5.15：`POST /sign-checklists` req
//     `{product_line_id, scope, field_key, label, required?}`；
//     `PUT /sign-checklists/:id` req `{required?, sort?, status?}`（仅这三项可改）。
//   · 同 §2.4：字段缺失 / 类型错 / 枚举非法 → 400 / 20001（横切层校验管道统一出口）。
//   · 同 §2.6：所有 id 都是十进制字符串（后端 bigint，前端 string）。
// =============================================================================
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Length } from 'class-validator';

import { SIGN_CHECKLIST_SCOPES, type SignChecklistScope } from '../domain/sign-checklist';

/** `POST /sign-checklists`（新增签约校验项，管理员） */
export class CreateSignChecklistDto {
  @ApiProperty({ description: '产品线 id（十进制字符串）', example: '1' })
  @IsString({ message: 'product_line_id 必须是字符串' })
  @Length(1, 32, { message: 'product_line_id 长度不合法' })
  product_line_id!: string;

  @ApiProperty({
    description: '校验层级（company＝公司级 / relation＝关系级 / ledger＝台账级）',
    enum: [...SIGN_CHECKLIST_SCOPES],
  })
  @IsIn([...SIGN_CHECKLIST_SCOPES], { message: 'scope 取值不合法' })
  scope!: SignChecklistScope;

  @ApiProperty({
    description: '字段键：company/relation 用真实列名；ledger 用 `field_template.field_key`',
    example: 'credit_code',
  })
  @IsString({ message: 'field_key 必须是字符串' })
  @Length(1, 64, { message: 'field_key 长度不合法' })
  field_key!: string;

  @ApiProperty({ description: '中文显示名（弹窗用，前端不硬编码）', example: '统一社会信用代码' })
  @IsString({ message: 'label 必须是字符串' })
  @Length(1, 128, { message: 'label 长度不合法' })
  label!: string;

  @ApiPropertyOptional({ description: '是否必填（默认 true）', example: true })
  @IsOptional()
  @IsBoolean({ message: 'required 必须是布尔值' })
  required?: boolean;
}

/** `PUT /sign-checklists/:id`（改签约校验项，管理员；仅以下三项可改） */
export class UpdateSignChecklistDto {
  @ApiPropertyOptional({ description: '是否必填', example: true })
  @IsOptional()
  @IsBoolean({ message: 'required 必须是布尔值' })
  required?: boolean;

  @ApiPropertyOptional({ description: '排序', example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'sort 必须是整数' })
  sort?: number;

  @ApiPropertyOptional({ description: '状态（active / disabled；停用不删）', enum: ['active', 'disabled'] })
  @IsOptional()
  @IsIn(['active', 'disabled'], { message: 'status 取值不合法' })
  status?: string;
}
