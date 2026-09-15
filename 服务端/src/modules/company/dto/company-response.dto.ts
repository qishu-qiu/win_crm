// =============================================================================
// B 域出参 DTO（M2-11 ~ M2-14）—— **只服务于 Swagger 文档**，不参与运行时转换
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM接口API文档》V1.18 §5.4 公司列表项：
//       `{id,full_name,city,industry_l1,scale,credit_code?,registered_capital?,legal_person?,
//         relation_count,old_customer,address_maintained,updated_at}`
//   · 同 §5.4 `POST /companies/search-dup` resp：
//       `{candidates:[{id,full_name,credit_code_masked,similarity,match_type:"same"|"high_sim"}],
//         suggest:"use_exists"|"create_new"}`
//   · 同 §5.5 `ContactBrief` `{id,name,position?,phone|phone_masked,phone_locked?,decision_role,is_current}`
//     —— **列表 / 卡片出参一律 `phone_masked`**。
//
// ⚠ **本批（M2）暂不出的三个字段**（接口 §5.4 列表项里有，但 B 域算不出来）：
//   `relation_count`（关系数，属 C 域）、`old_customer`（有历史合同，属 E 域）——
//   跨域**禁止查对方的表**（架构 §5.2），要等 M3/M4 的域建好后由其 service / 事件提供；
//   **现在不填假值**（→ 设计规范 §3.2 第 11 条「禁假数据撑页面」）。
//   `address_maintained` 属本域可算（`address` 或 `longitude` 为空 → false），故照出。
//
// ★ id 为什么声明成 `String` 而运行时是 `bigint`：主键是 `BigInt @db.UnsignedBigInt`，
//   出口统一在 `response.interceptor` 过 `toJsonSafe`（→ `kernel/common/bigint.ts`）。
// =============================================================================
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** 公司列表项 / 建档出参（→ §5.4） */
export class CompanyVoDto {
  @ApiProperty({ type: String, example: '1' })
  id!: string;

  @ApiProperty({ example: '安徽鑫中网信息技术有限公司' })
  full_name!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: '标准化核心词（服务端生成，供两段式查重第一段）',
    example: '鑫中网',
  })
  name_core!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: '城市' })
  city!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: '行业一级' })
  industry_l1!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: '规模' })
  scale!: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: '统一社会信用代码（**列表给全量**；查重候选才用 `credit_code_masked`）',
  })
  credit_code!: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: '注册资本（单位＝元；前端按「万元」展示）',
    example: '5000000',
  })
  registered_capital!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: '法定代表人' })
  legal_person!: string | null;

  @ApiProperty({ description: '地址是否维护（`address` 或坐标为空 → false）；派生展示，不落表' })
  address_maintained!: boolean;

  @ApiProperty({ example: '2026-09-15T10:00:00+08:00' })
  updated_at!: string;
}

/** 查重候选（→ §5.4） */
export class DupCandidateVoDto {
  @ApiProperty({ type: String, example: '1' })
  id!: string;

  @ApiProperty({ description: '公司全称（**给全**：销售要认出是不是这家）' })
  full_name!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: '信用代码**打码**形态（→ §2.8；规格未给形态，暂为前 4 ＋ `****` ＋ 后 4）',
  })
  credit_code_masked!: string | null;

  @ApiProperty({ description: '相似度 0~1（`same` 恒为 1）', example: 0.5 })
  similarity!: number;

  @ApiProperty({ description: '判级：`same`＝核心词完全相同；`high_sim`＝高度疑似', enum: ['same', 'high_sim'] })
  match_type!: string;
}

/** 查重结果（→ §5.4） */
export class SearchDupResultVoDto {
  @ApiProperty({ type: [DupCandidateVoDto], description: '候选清单（可空数组）' })
  candidates!: DupCandidateVoDto[];

  @ApiProperty({
    description: '建议：**有候选一律 `use_exists`**（需求 §12.1 分支 4：疑似默认选现有），无候选才 `create_new`',
    enum: ['use_exists', 'create_new'],
  })
  suggest!: string;
}

/** 联系人简卡（→ §5.5 `ContactBrief`；列表 / 卡片一律 `phone_masked`） */
export class ContactBriefVoDto {
  @ApiProperty({ type: String, example: '1' })
  id!: string;

  @ApiProperty({ example: '张伟' })
  name!: string;

  @ApiPropertyOptional({ type: String, nullable: true, description: '职位（来自 `company_contact.position`）' })
  position!: string | null;

  @ApiProperty({ description: '打码手机号（列表 / 卡片出参形态，**不是权限**，→ §2.8）', example: '138****0000' })
  phone_masked!: string;

  @ApiProperty({
    description:
      '手机号是否**对当前查看者**处于上锁态（＝锁开着、且查看者不是落锁人，→ 需求 §4.3 二）。' +
      '⚠ 列表**本就一律 `phone_masked`**：本字段是「已上锁 ＋ 申请解锁」的提示，不是权限开关',
  })
  phone_locked!: boolean;

  @ApiPropertyOptional({ description: '决策角色', enum: ['decision', 'influence', 'execute'] })
  decision_role!: string | null;

  @ApiProperty({ description: '是否当前在职（`company_contact.is_current`；历史就职给 false）' })
  is_current!: boolean;
}

/** 建档联系人出参（详情形态：主号**给全号**，→ §5.5 详情口径） */
export class ContactCreatedVoDto {
  @ApiProperty({ type: String, example: '1' })
  id!: string;

  @ApiProperty({ example: '张伟' })
  name!: string;

  @ApiProperty({ description: '归一后的主号（**详情给全号**，与角色无关，→ §2.8）', example: '13800000000' })
  phone!: string;

  @ApiPropertyOptional({ description: '命中历史号时的提示（**提示不拦截**，→ §5.5）' })
  phone_history_hint?: string;
}
