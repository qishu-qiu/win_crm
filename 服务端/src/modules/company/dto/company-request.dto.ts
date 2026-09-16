// =============================================================================
// B 域入参 DTO（M2-11 ~ M2-14）—— `POST /companies` / `POST /companies/search-dup` /
//   `POST /contacts` / `GET /companies/:id/contacts`
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM接口API文档》§5.4：
//       建档 / 改 公司 req `{full_name,industry_l1?,industry_l2?,province?,city?,district?,scale?,
//         website?,address?,bank_name?,invoice_title?,tax_no?,credit_code?,registered_capital?,
//         legal_person?,longitude?,latitude?,aliases?:[]}`
//       `POST /companies/search-dup` req `{phone?,credit_code?,name?}`
//   · 同 §5.5：联系人建档 / 改 req `{name,phone,extra_phones?:[],wechat?,email?,gender?,birthday?,
//       decision_role?,tags?:[],company_id?,position?}`
//   · 同 §2.4：坏入参 → **400 / 20001**（由 `AppValidationPipe` 统一映射，本文件只声明规则）。
//   · 同 §2.7：入参出参 snake_case。
//
// ★ 为什么**每个字段都写 `@ApiProperty`**：不写，Swagger 会把该 DTO 生成为空对象，
//   前端 `gen:types` 拿到 `Record<string, never>` → 等于没有类型（→ M1 的实测教训）。
//
// ★ 金额 / 坐标为什么只收**字符串**：接口（§5.4）允许「字符串 / 数值」两种形态，本接口**取字符串**：
//   ① 两位小数的语义不会被 JS 浮点吃掉（`0.1+0.2` 那类误差在金额上是事故）；
//   ② 前端 `String(x)` 一次转换的成本远低于事后对账。
//   `registered_capital` 的单位**一律「元」**（前端按「万元」录入并换算，→ §5.4 注释）。
// =============================================================================
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateNested,
} from 'class-validator';

/** 金额（元）：最多 14 位整数 ＋ 2 位小数 */
const MONEY = /^\d{1,14}(\.\d{1,2})?$/;
/** 坐标：GCJ-02（高德坐标系；库内不动，换底图在出口层转，→ 数据架构 B7） */
const COORDINATE = /^-?\d{1,3}(\.\d{1,6})?$/;
/** 日期：`YYYY-MM-DD` */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** 建档公司（→ §5.4） */
export class CreateCompanyDto {
  @ApiProperty({ description: '公司全称（服务端据此生成 `name_core` 供查重）', example: '安徽鑫中网信息技术有限公司' })
  @IsString({ message: '公司全称必须是字符串' })
  @Length(1, 200, { message: '公司全称长度需为 1~200 位' })
  full_name!: string;

  @ApiPropertyOptional({ description: '统一社会信用代码（可空；**撞码 → 409，请用已有档案**）' })
  @IsOptional()
  @IsString({ message: '统一社会信用代码必须是字符串' })
  @Length(1, 32, { message: '统一社会信用代码长度需为 1~32 位' })
  credit_code?: string;

  @ApiPropertyOptional({ description: '行业一级' })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  industry_l1?: string;

  @ApiPropertyOptional({ description: '行业二级' })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  industry_l2?: string;

  @ApiPropertyOptional({ description: '省' })
  @IsOptional()
  @IsString()
  @Length(1, 32)
  province?: string;

  @ApiPropertyOptional({ description: '市' })
  @IsOptional()
  @IsString()
  @Length(1, 32)
  city?: string;

  @ApiPropertyOptional({ description: '区 / 县' })
  @IsOptional()
  @IsString()
  @Length(1, 32)
  district?: string;

  @ApiPropertyOptional({ description: '规模' })
  @IsOptional()
  @IsString()
  @Length(1, 32)
  scale?: string;

  @ApiPropertyOptional({ description: '官网' })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  website?: string;

  @ApiPropertyOptional({ description: '注册地址（同时是签约校验清单「注册地址」项的落点）' })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  address?: string;

  @ApiPropertyOptional({ description: '开户行' })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  bank_name?: string;

  @ApiPropertyOptional({ description: '发票抬头' })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  invoice_title?: string;

  @ApiPropertyOptional({ description: '税号' })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  tax_no?: string;

  @ApiPropertyOptional({
    description: '**注册资本（单位＝元**；前端按「万元」录入并各做一次换算）。可选扩展字段，不参与签约强制与完善度',
    example: '5000000',
  })
  @IsOptional()
  @Matches(MONEY, { message: '注册资本需为元的金额（最多两位小数）' })
  registered_capital?: string;

  @ApiPropertyOptional({ description: '法定代表人（可选扩展字段）' })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  legal_person?: string;

  @ApiPropertyOptional({ description: '经度 GCJ-02', example: '117.227239' })
  @IsOptional()
  @Matches(COORDINATE, { message: '经度格式不正确' })
  longitude?: string;

  @ApiPropertyOptional({ description: '纬度 GCJ-02', example: '31.820587' })
  @IsOptional()
  @Matches(COORDINATE, { message: '纬度格式不正确' })
  latitude?: string;

  @ApiPropertyOptional({ description: '曾用名 / 别名（合并时自动收进）', type: [String] })
  @IsOptional()
  @IsArray({ message: 'aliases 必须是数组' })
  @IsString({ each: true, message: 'aliases 每项必须是字符串' })
  aliases?: string[];
}

/** 撞库查重（→ §5.4 `POST /companies/search-dup`） */
export class SearchDupDto {
  @ApiPropertyOptional({ description: '按**联系人手机号**查（撞库第 ① 个触发点，→ 需求 §12.1）' })
  @IsOptional()
  @IsString()
  @Length(1, 32)
  phone?: string;

  @ApiPropertyOptional({ description: '按**统一社会信用代码**查（撞码 → 强制使用已有档案）' })
  @IsOptional()
  @IsString()
  @Length(1, 32)
  credit_code?: string;

  @ApiPropertyOptional({ description: '按**公司名**查（两段式：`name_core` 收缩候选 → 编辑距离判级）' })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;
}

/** 联系人附加号（→ 数据架构 B3 `extra_phones`：**不参与撞单**、无唯一约束） */
export class ExtraPhoneDto {
  @ApiProperty({ description: '类型', enum: ['mobile', 'tel', 'wechat'], example: 'mobile' })
  @IsIn(['mobile', 'tel', 'wechat'], { message: '附加号类型只能是 mobile / tel / wechat' })
  type!: string;

  @ApiProperty({ description: '号码', example: '13900000000' })
  @IsString({ message: '附加号必须是字符串' })
  @Length(1, 32, { message: '附加号长度需为 1~32 位' })
  number!: string;

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  note?: string;
}

/** 建档联系人（→ §5.5） */
export class CreateContactDto {
  @ApiProperty({ description: '姓名', example: '张伟' })
  @IsString({ message: '姓名必须是字符串' })
  @Length(1, 50, { message: '姓名长度需为 1~50 位' })
  name!: string;

  @ApiProperty({ description: '主号（撞单校验核心；服务端会先做归一：去空格 / `+86` / `-`）', example: '13800000000' })
  @IsString({ message: '手机号必须是字符串' })
  @Length(1, 32, { message: '手机号长度需为 1~32 位' })
  phone!: string;

  @ApiPropertyOptional({ description: '附加号（可多个；不参与撞单）', type: [ExtraPhoneDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExtraPhoneDto)
  extra_phones?: ExtraPhoneDto[];

  @ApiPropertyOptional({ description: '微信' })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  wechat?: string;

  @ApiPropertyOptional({ description: '邮箱' })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  email?: string;

  @ApiPropertyOptional({ description: '性别' })
  @IsOptional()
  @IsString()
  @Length(1, 8)
  gender?: string;

  @ApiPropertyOptional({ description: '生日 `YYYY-MM-DD`', example: '1985-06-01' })
  @IsOptional()
  @Matches(DATE_ONLY, { message: '生日格式需为 YYYY-MM-DD' })
  birthday?: string;

  @ApiPropertyOptional({ description: '决策角色', enum: ['decision', 'influence', 'execute'] })
  @IsOptional()
  @IsIn(['decision', 'influence', 'execute'], { message: '决策角色只能是 decision / influence / execute' })
  decision_role?: string;

  @ApiPropertyOptional({ description: '个人自由标签', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ description: '就职公司 id（十进制字符串）；给了就同时写一条 `company_contact`' })
  @IsOptional()
  @IsString()
  @Length(1, 20)
  company_id?: string;

  @ApiPropertyOptional({ description: '职位（配合 `company_id` 一起给）' })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  position?: string;
}
