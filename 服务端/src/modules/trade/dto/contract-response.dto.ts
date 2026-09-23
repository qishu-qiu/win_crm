// =============================================================================
// E 域出参 DTO（M9-E / B2）—— **只服务于 Swagger 文档**，不参与运行时转换
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM接口API文档》§5.9：`列表项 {id,contract_no,company,product_line,signer,amount,
//     paid_amount,pay_progress,status,sign_date,service_end,expire_level}`；
//     `详情` ＝ 列表项 ＋ `{payments,splits,attachments}`（payments/splits 属 B4/B5，本期留空数组）。
//   · 同 §2.6：出参 snake_case；id 一律十进制字符串（bigint 由统一出参拦截器转）。
//
// ★ 可空字段必须写全 `type` ＋ `nullable`（→ 铁律坑 20：否则 Swagger 生成 `{}`，前端类型不可用）。
// =============================================================================
import { ApiProperty } from '@nestjs/swagger';

/** 实体引用统一形状 `{id,name}`（公司 / 员工共用） */
export class ContractRefDto {
  @ApiProperty({ description: 'id（十进制字符串）', example: '3' })
  id!: string;

  @ApiProperty({ description: '名称快照', example: '安徽鑫中网信息技术有限公司' })
  name!: string;
}

/** 产品线引用 `{id,name,color_key}` */
export class ProductLineRefDto {
  @ApiProperty({ description: '产品线 id', example: '1' })
  id!: string;

  @ApiProperty({ description: '产品线名称', example: '网站建设' })
  name!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: '固定配色键（前端照渲染）；未配置给 null',
    example: 'blue',
  })
  color_key!: string | null;
}

/** 合同列表项 / 详情共有部分（→ §5.9） */
export class ContractVoDto {
  @ApiProperty({ description: '合同 id', example: '1' })
  id!: string;

  @ApiProperty({ description: '合同编号（唯一，服务端生成）', example: 'CN20260923000001' })
  contract_no!: string;

  @ApiProperty({ type: ContractRefDto, nullable: true, description: '公司档案' })
  company!: ContractRefDto | null;

  @ApiProperty({ type: ProductLineRefDto, nullable: true, description: '产品线' })
  product_line!: ProductLineRefDto | null;

  @ApiProperty({ type: ContractRefDto, nullable: true, description: '签单人（业绩归属，终身不变）' })
  signer!: ContractRefDto | null;

  @ApiProperty({ description: '合同金额（Decimal 字符串）', example: '120000.00' })
  amount!: string;

  @ApiProperty({ description: '已回款金额（Decimal 字符串）', example: '0.00' })
  paid_amount!: string;

  @ApiProperty({ description: '回款进度（0~100）', example: 0 })
  pay_progress!: number;

  @ApiProperty({ description: '合同状态', enum: ['unpaid', 'partial', 'running', 'done', 'terminated'] })
  status!: string;

  @ApiProperty({ type: String, nullable: true, description: '签约日期（ISO）' })
  sign_date!: string | null;

  @ApiProperty({ type: String, nullable: true, description: '服务结束日期（ISO）' })
  service_end!: string | null;

  @ApiProperty({ description: '到期预警档（0/30/60/90）', example: 0 })
  expire_level!: number;

  @ApiProperty({ description: '创建时间（ISO）' })
  created_at!: string;

  @ApiProperty({ description: '更新时间（ISO）' })
  updated_at!: string;
}

/** 合同列表分页出参（→ §2.3 统一响应包 PageResult；键名固定 list/total/page/page_size） */
export class ContractPageResultDto {
  @ApiProperty({ type: [ContractVoDto], description: '当前页数据' })
  list!: ContractVoDto[];

  @ApiProperty({ description: '全量条数', example: 120 })
  total!: number;

  @ApiProperty({ description: '当前页码（从 1 开始）', example: 1 })
  page!: number;

  @ApiProperty({ description: '每页条数（默认 20，最大 100）', example: 20 })
  page_size!: number;
}
