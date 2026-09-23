// =============================================================================
// E 域入参 DTO（M9-E / B2）
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM接口API文档》§5.9：
//       `POST /contracts` req `{relation_id, contact_id?, amount, pay_type?, sign_date,
//         service_start?, service_end?, auto_renew?, remind_days?:[]}`
//       `PUT /contracts/:id` req `{pay_type?, status?, auto_renew?, remind_days?,
//         service_start?, service_end?, attachments?}`
//   · 同 §2.4：字段缺失 / 类型错 / 枚举非法 → 400 / 20001（横切层校验管道统一出口）。
//   · 同 §2.6：入参出参 snake_case；所有 id 都是十进制字符串（后端 bigint，前端 string）。
//
// ★ `contract_no` **不在创建入参里**：它是唯一业务键，由服务端生成（→ 数据架构 E1
//   `uk_contract_no`），避免前端自造撞号；撞号由 `mapPrismaError` 映射到 409。
// =============================================================================
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

import { CONTRACT_STATUSES_DTO } from './contract-constants';

/** 可排序字段白名单（→ §2.7 `order_by`；与 relation 同款理由：防止任意列排序泄漏未授权信息） */
export const CONTRACT_ORDER_FIELDS = ['id', 'sign_date', 'service_end', 'amount', 'created_at'] as const;
export const CONTRACT_DESC_VALUES = ['true', 'false'] as const;

/** `POST /contracts`（创建合同） */
export class CreateContractDto {
  @ApiProperty({ description: '业务关系 id（→ C 域；合同挂在哪条关系上，公司/产品线由此派生）', example: '10' })
  @IsString({ message: 'relation_id 必须是字符串' })
  @Length(1, 32, { message: 'relation_id 长度不合法' })
  relation_id!: string;

  @ApiPropertyOptional({ description: '签约联系人 id（→ B 域联系人；可空）', example: '5' })
  @IsOptional()
  @IsString({ message: 'contact_id 必须是字符串' })
  @Length(1, 32, { message: 'contact_id 长度不合法' })
  contact_id?: string;

  @ApiProperty({ description: '合同金额（Decimal 字符串，>0，最多两位小数）', example: '120000.00' })
  @IsString({ message: 'amount 必须是字符串' })
  @Matches(/^\d+(\.\d{1,2})?$/, { message: 'amount 必须是正数且最多两位小数' })
  amount!: string;

  @ApiPropertyOptional({ description: '收款方式（如 cash/bank/check；落字典，可空）', example: 'bank' })
  @IsOptional()
  @IsString({ message: 'pay_type 必须是字符串' })
  @Length(1, 32, { message: 'pay_type 长度不合法' })
  pay_type?: string;

  @ApiPropertyOptional({ description: '签约日期（YYYY-MM-DD）', example: '2026-09-23' })
  @IsOptional()
  @IsDateString({}, { message: 'sign_date 需为 ISO 日期字符串' })
  sign_date?: string;

  @ApiPropertyOptional({ description: '服务开始日期（YYYY-MM-DD）' })
  @IsOptional()
  @IsDateString({}, { message: 'service_start 需为 ISO 日期字符串' })
  service_start?: string;

  @ApiPropertyOptional({ description: '服务结束日期（YYYY-MM-DD）' })
  @IsOptional()
  @IsDateString({}, { message: 'service_end 需为 ISO 日期字符串' })
  service_end?: string;

  @ApiPropertyOptional({ description: '是否自动续约', example: false })
  @IsOptional()
  @IsBoolean({ message: 'auto_renew 必须是布尔值' })
  auto_renew?: boolean;

  @ApiPropertyOptional({ description: '续约提醒天数（如 [30,60,90]）' })
  @IsOptional()
  @IsArray({ message: 'remind_days 须为数组' })
  @IsInt({ each: true, message: 'remind_days 每项须为整数' })
  @Type(() => Number)
  remind_days?: number[];
}

/** `PUT /contracts/:id`（更新合同） */
export class UpdateContractDto {
  @ApiPropertyOptional({ description: '收款方式', example: 'bank' })
  @IsOptional()
  @IsString({ message: 'pay_type 必须是字符串' })
  @Length(1, 32, { message: 'pay_type 长度不合法' })
  pay_type?: string;

  @ApiPropertyOptional({ description: '合同状态（人工终态 terminated 等）', enum: CONTRACT_STATUSES_DTO })
  @IsOptional()
  @IsIn([...CONTRACT_STATUSES_DTO], { message: 'status 取值不合法' })
  status?: string;

  @ApiPropertyOptional({ description: '是否自动续约' })
  @IsOptional()
  @IsBoolean({ message: 'auto_renew 必须是布尔值' })
  auto_renew?: boolean;

  @ApiPropertyOptional({ description: '续约提醒天数' })
  @IsOptional()
  @IsArray({ message: 'remind_days 须为数组' })
  @IsInt({ each: true, message: 'remind_days 每项须为整数' })
  @Type(() => Number)
  remind_days?: number[];

  @ApiPropertyOptional({ description: '服务开始日期（YYYY-MM-DD）；传 null 清空' })
  @IsOptional()
  @IsDateString({}, { message: 'service_start 需为 ISO 日期字符串' })
  service_start?: string;

  @ApiPropertyOptional({ description: '服务结束日期（YYYY-MM-DD）；传 null 清空' })
  @IsOptional()
  @IsDateString({}, { message: 'service_end 需为 ISO 日期字符串' })
  service_end?: string;

  /** 附件（JSON；不强制结构，跨域文件资产由 B 域 `file_asset` 承载，本域只存引用指针） */
  @ApiPropertyOptional({ description: '附件（JSON；落库 `attachments` 列）' })
  @IsOptional()
  attachments?: unknown;
}

/** `GET /contracts` 查询参数：分页 ＋ 排序 ＋ 筛选 */
export class ListContractQueryDto {
  @ApiPropertyOptional({ description: '页码（默认 1）', example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page 必须是整数' })
  page?: number;

  @ApiPropertyOptional({ description: '每页条数（默认 20，最大 100）', example: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page_size 必须是整数' })
  page_size?: number;

  @ApiPropertyOptional({
    enum: CONTRACT_ORDER_FIELDS,
    default: 'id',
    description: '排序字段（白名单）：id / sign_date / service_end / amount / created_at',
  })
  @IsOptional()
  @IsIn([...CONTRACT_ORDER_FIELDS], { message: 'order_by 取值不合法' })
  order_by?: string;

  @ApiPropertyOptional({ enum: CONTRACT_DESC_VALUES, default: 'true', description: '是否降序（默认 true）' })
  @IsOptional()
  @IsIn([...CONTRACT_DESC_VALUES], { message: 'desc 取值只能是 true / false' })
  desc?: string;

  @ApiPropertyOptional({ description: '状态筛选', enum: CONTRACT_STATUSES_DTO })
  @IsOptional()
  @IsIn([...CONTRACT_STATUSES_DTO], { message: 'status 取值不合法' })
  status?: string;

  @ApiPropertyOptional({ description: '关键字：合同号 / 公司名（模糊）', example: '鑫中网' })
  @IsOptional()
  @IsString({ message: 'keyword 必须是字符串' })
  @Length(1, 50, { message: 'keyword 长度须为 1~50' })
  keyword?: string;
}
