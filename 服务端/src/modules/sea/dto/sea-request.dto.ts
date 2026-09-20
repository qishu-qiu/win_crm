// =============================================================================
// F 域入参 DTO（F-01）
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM接口API文档》§4.5 端点总览：`POST /sea/company/:id/claim`（`:id` ＝ **公司 id**）。
//     ⚠ §5 尚无该端点的形状章节 —— req 由**本片施工单定稿**（2026-09-20 已拍板）：
//       `{dept_id, product_line_id}`，与 `POST /relations` **逐字同形** —— 部门 × 产品线是
//       **业务关系**的属性（公海的一"条"＝一条业务关系，→ 需求 §6.3），故必须能定位到具体那一条。
//   · 同 §2.4：字段缺失 / 类型错 → **400 / 20001**（横切层校验管道统一出口）。
//   · 同 §2.6：入参出参 **snake_case**；所有 id 都是**十进制字符串**（后端 `bigint`，前端 string）。
// =============================================================================
import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

/** `POST /sea/company/:id/claim`（领取到私海）——`:id` ＝ **公司 id** */
export class ClaimSeaRelationDto {
  @ApiProperty({
    description:
      '承接部门 id（＝这条公海关系**所属部门**；销售＝本部门、经理＝管辖部门、总经理＝任意）。' +
      '⚠ 跨部门领公海这件事**不存在**（→ 需求 §6.3）：别部门想要这个客户＝自己激活一条本部门的关系',
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
