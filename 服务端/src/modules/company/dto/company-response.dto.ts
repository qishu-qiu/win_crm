// =============================================================================
// B 域出参 DTO（M2-11 ~ M2-14）—— **只服务于 Swagger 文档**，不参与运行时转换
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM接口API文档》§5.4 公司列表项：
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

/** 「实体引用」`{id,name}`（→ §四；此处用于 `phone_locked_by`） */
export class ContactRefVoDto {
  @ApiProperty({ type: String, example: '7' })
  id!: string;

  @ApiProperty({ example: '王海涛' })
  name!: string;
}

/**
 * 公司列表**分页出参**（→ 接口 §2.3 分页形态 / §五 PageResult；**D-08** · 2026-09-20 铺开）。
 * ★ 键名逐字固定 `list / total / page / page_size`（§2.3 G2）—— **别改成 `pageSize`**（§2.6 出参 snake_case）。
 * ★ 「列表类一律分页」⇒ `GET /companies` 的 `data` 从**裸数组**改为本对象（原「最近 100 条 ＋ 裸数组」作废）。
 */
export class CompanyPageVoDto {
  @ApiProperty({ type: [CompanyVoDto], description: '当前页数据' })
  list!: CompanyVoDto[];

  @ApiProperty({ description: '符合筛选条件的全量条数（前端「共 N 条」）', example: 120 })
  total!: number;

  @ApiProperty({ description: '当前页码（从 1 开始）', example: 1 })
  page!: number;

  @ApiProperty({ description: '每页条数（默认 20，最大 100，→ §2.7）', example: 20 })
  page_size!: number;
}

/**
 * 联系人列表**分页出参**（同 §2.3；**D-08**）。
 * ★ `GET /contacts` 与 `GET /companies/:id/contacts` **共用本形状**（两者都是联系人列表）。
 */
export class ContactPageVoDto {
  @ApiProperty({ type: [ContactBriefVoDto], description: '当前页数据（**一律 `phone_masked`**，→ §2.8）' })
  list!: ContactBriefVoDto[];

  @ApiProperty({ description: '符合筛选条件的全量条数（前端「共 N 条」）', example: 120 })
  total!: number;

  @ApiProperty({ description: '当前页码（从 1 开始）', example: 1 })
  page!: number;

  @ApiProperty({ description: '每页条数（默认 20，最大 100，→ §2.7）', example: 20 })
  page_size!: number;
}

/** 备用号（→ §5.5 详情 `extra_phones[]`；`note` 可空） */
export class ContactExtraPhoneVoDto {
  @ApiProperty({
    description:
      '号型（**值域唯一落点 ＝《销售CRM数据架构文档》B2**）：`mobile` / `tel` / `wechat`。' +
      '⚠ 2026-09-20 拍板收敛（→《欠账登记表》D-49）：本 DTO 原先写的 `landline` / `other` **作废**' +
      '（旧码只作历史数据兜底，新写入口只用上列三码）',
    example: 'mobile',
  })
  type!: string;

  @ApiProperty({ description: '号码（与主号同待遇：**被上锁时整个 `extra_phones` 都不返回**）' })
  number!: string;

  @ApiPropertyOptional({ type: String, nullable: true, description: '备注（如「他助理」）' })
  note?: string;
}

/** 就职 / 跳槽历史项（→ §5.5 详情 `employments[]`，B5 含历史） */
export class ContactEmploymentVoDto {
  @ApiProperty({ type: String, example: '3' })
  company_id!: string;

  @ApiProperty({ description: '公司全称（就职记录指向的公司）', example: '合肥测试建材有限公司' })
  company_name!: string;

  @ApiProperty({ type: String, nullable: true, description: '职位' })
  position!: string | null;

  @ApiProperty({ type: String, nullable: true, description: '入职时间（可空）' })
  joined_at!: string | null;

  @ApiProperty({ type: String, nullable: true, description: '离职时间（在职为 `null`）' })
  left_at!: string | null;

  @ApiProperty({ description: '是否当前在职（`true` 的排在最前）' })
  is_current!: boolean;
}

/** 谈判特质项（→ §5.5 详情 `traits[]`，B4） */
export class ContactTraitVoDto {
  @ApiProperty({ type: String, description: '字典项 id（→ A11）', example: '12' })
  trait_id!: string;

  @ApiProperty({ description: '特质码（英文码，落库时冗余存了一份）', example: 'price_sensitive' })
  trait_code!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: '中文文案（取自字典 `dict_item`；字典项被停用 / 删除时为 `null`，**不编文案**）',
    example: '价格敏感',
  })
  label!: string | null;
}

/**
 * 联系人**详情**（→ 接口 §5.5「详情」）。
 *
 * ★ 出参形态（→ §2.8，**是形态、不是权限**）：**详情一律给全号 `phone`** ；
 *   唯一例外＝该联系人**被上锁**且查看者**不是落锁人** —— 此时 `phone` 与 `extra_phones`
 *   **两个键都不出现**（锁跟人：主号与备用号一并隐藏），改给 `phone_locked` ＋ `phone_locked_by`。
 *   故这两个字段声明成 `@ApiPropertyOptional`（**没有值 ≠ 空值**，前端要按"键不存在"判）。
 * ⚠ 规格详情里的 `unlocked_until`（申请解锁通过后 24h 内可见）依赖 G 域审批，本批**不返回**
 *   （也不给 `null` 占位）→《欠账登记表》D-04。
 */
export class ContactDetailVoDto {
  @ApiProperty({ type: String, example: '1' })
  id!: string;

  @ApiProperty({ example: '张伟' })
  name!: string;

  @ApiPropertyOptional({
    description:
      '主号**全号**（→ §2.8：详情给全号，与角色无关）。' +
      '**被上锁且查看者不是落锁人时该键不存在**',
    example: '13800000000',
  })
  phone?: string;

  @ApiProperty({
    description:
      '手机号是否**对当前查看者**处于上锁态（＝锁开着且查看者不是落锁人，→ 需求 §4.3 二）。' +
      '⚠ 这是**状态**：为 `true` 时本出参不含 `phone` / `extra_phones`',
  })
  phone_locked!: boolean;

  @ApiProperty({
    type: ContactRefVoDto,
    nullable: true,
    description: '落锁人（未上锁时为 `null`，→ 需求 §4.3 二「被上锁时显示 by XX」）',
  })
  phone_locked_by!: ContactRefVoDto | null;

  @ApiPropertyOptional({
    type: [ContactExtraPhoneVoDto],
    description: '备用号（**被上锁且查看者不是落锁人时该键不存在** —— 锁跟人，主号备用号一并隐藏）',
  })
  extra_phones?: ContactExtraPhoneVoDto[];

  @ApiProperty({ type: String, nullable: true, description: '微信' })
  wechat!: string | null;

  @ApiProperty({ type: String, nullable: true, description: '邮箱' })
  email!: string | null;

  @ApiProperty({ type: String, nullable: true, description: '性别' })
  gender!: string | null;

  @ApiProperty({ type: String, nullable: true, description: '生日（`YYYY-MM-DD`）', example: '1985-03-12' })
  birthday!: string | null;

  @ApiProperty({ type: String, nullable: true, description: '决策角色', enum: ['decision', 'influence', 'execute'] })
  decision_role!: string | null;

  @ApiProperty({ type: [String], description: '个人自由标签（与谈判特质分栏并存，→ B3）' })
  tags!: string[];

  @ApiProperty({ type: [ContactTraitVoDto], description: '谈判特质（上限＝`dept_rule.contact_trait_max`，→ B4）' })
  traits!: ContactTraitVoDto[];

  @ApiProperty({ description: '状态', enum: ['active', 'left', 'freelance'], example: 'active' })
  status!: string;

  @ApiProperty({
    type: [ContactEmploymentVoDto],
    description: '就职 / 跳槽历史（**在职的在前**；含历史 → B5）',
  })
  employments!: ContactEmploymentVoDto[];
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

/** 档案标签项（→ B2 `company_profile_tag`；identity / policy 用） */
export class CompanyProfileTagItemVoDto {
  @ApiProperty({ type: String, example: '12' })
  tag_id!: string;

  @ApiProperty({ description: '标签码（英文码，建标时冗余落库）', example: 'state_owned' })
  tag_code!: string;

  @ApiProperty({ type: String, nullable: true, description: '中文文案（取自字典；停用 / 删除为 `null`，不编文案）' })
  label!: string | null;
}

/** 公司档案标签分组（→ §5.4 `profile_tags`；B2 三类口径） */
export class CompanyProfileTagGroupVoDto {
  @ApiProperty({ type: [CompanyProfileTagItemVoDto], description: '身份标签（多选）' })
  identity!: CompanyProfileTagItemVoDto[];

  @ApiProperty({ type: [CompanyProfileTagItemVoDto], description: '制度标签（多选）' })
  policy!: CompanyProfileTagItemVoDto[];

  @ApiPropertyOptional({
    type: CompanyProfileTagItemVoDto,
    nullable: true,
    description: '决策链（单选）；⚠ 出参只含 `tag_id` / `label`（→ §5.4），`tag_code` 不返回',
  })
  decision_chain?: CompanyProfileTagItemVoDto | null;
}

/**
 * 公司详情（→ §5.4 详情；D-05）。
 * ★ 继承 `CompanyVoDto` 的全部基本档案字段，再补 `completeness` / `profile_tags` / `contacts`。
 * ★ `contacts[]` 按**卡片**出参（一律 `phone_masked`，拍板 Q2）；`relations_summary` / `event_count_30d`
 *   依赖 C 域 `business_relation`、B(L2) 禁止依赖 C(L3)，本轮暂不出（登记缺口）。
 */
export class CompanyDetailVoDto extends CompanyVoDto {
  @ApiProperty({ description: '完善度三档（0-100，→ B1 `completeness_1/2/3`）' })
  completeness!: { c1: number; c2: number; c3: number };

  @ApiProperty({ type: CompanyProfileTagGroupVoDto, description: '档案标签（身份 / 制度 / 决策链，→ B2）' })
  profile_tags!: CompanyProfileTagGroupVoDto;

  @ApiProperty({ type: [ContactBriefVoDto], description: '联系人简卡（列表 / 卡片一律 `phone_masked`，拍板 Q2）' })
  contacts!: ContactBriefVoDto[];
}
