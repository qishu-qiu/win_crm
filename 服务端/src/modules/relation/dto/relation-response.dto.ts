// =============================================================================
// C 域出参 DTO（M3-09 ~ M3-11）—— **只服务于 Swagger 文档**，不参与运行时转换
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM接口API文档》§5.6：
//     **列表项** `{id,company:{id,name},dept:{id,name},product_line:{id,name,color_key},stage:1-7,
//       urgency,value_tier,customer_level,owner:{id,name},last_event_at,drop_in_x_days,
//       overdue,competition,amount|amount_masked,old_customer,is_weekly}`
//     **详情** ＝ 列表项 ＋ `{next_action_hint,sea_status,round_no,prev_round?,competitors,labels,
//       members,stage_logs,try_count_30d}`
//     成员 `{employee:{id,name},member_type:"owner"|"collaborator",source,valid_until?}`
//   · 同 §2.6：出参 **snake_case**；id 一律**十进制字符串**（`bigint` 由统一出参拦截器转）。
//
// ⚠ **只给出真能算出来的字段**（设计规范 §3.2 第 11 条「禁假数据撑页面」的同类原则：
//   不填假值、也不假装有字段）。未落地的字段与原因**逐条列出**，全部登记在《欠账登记表》（`过程产出/`）：
//   · `drop_in_x_days` —— **列表项已出**（2026-09-22 桥③：F 域算天数、本域给锚点，装配在聚合层
//     `relation-aggregate`，见 `RelationListItemVoDto`）；⚠ **详情仍未出**（→ 台账 D-10 残余）
//   · `overdue` —— 逾期＝承诺（D 域）判定，M4 才有
//   · `amount` / `amount_masked` —— 合同（E 域）回款，未接
//   · `old_customer` / `is_weekly` —— 需历史合同 / 周报口径，未接
//   · 详情里的 `round_no` / `prev_round` —— `sea_record`（历史轮次）未落库
//   · `competitors` / `labels` / `stage_logs` / `try_count_30d` —— 分属 C4 / C3 / D 域，M3 不交付
//
// ★ 可空字段**必须写全 `type` ＋ `nullable`**（`@ApiProperty({ type: String, nullable: true })`）：
//   只写 `description` 时 Swagger 解不出 `X | null` 这种联合类型，会把该字段生成成**空对象 `{}`**，
//   前端生成物随之变成 `Record<string, never>`（**类型等于不可用**）—— 踩过，→ 铁律坑 20。
// =============================================================================
import { ApiProperty } from '@nestjs/swagger';

/**
 * 「实体引用」统一形状 `{id,name}`。
 * ★ 公司 / 部门 / 产品线 / 员工**四类引用形状相同**，故共用这一个 DTO：
 *   规格 §四 的「实体引用（内嵌）」就是同一个约定（`dept:{id,name}` / `company:{id,name}` …），
 *   分开写四份会把同一形状抄四遍 —— 改一处漏三处。
 */
export class RelationRefDto {
  @ApiProperty({ description: 'id（十进制字符串）', example: '3' })
  id!: string;

  @ApiProperty({ description: '名称快照（生成引用那一刻的库值）', example: '安徽鑫中网信息技术有限公司' })
  name!: string;
}

/**
 * 产品线引用 `{id,name,color_key}`（→ 接口 §5.3 / §5.6「实体引用（内嵌）」）。
 * ★ 与 `RelationRefDto` 不同：产品线**多一个固定配色键**（需求 §13.3「7 条线各一色」），
 *   故此形状单列一个 DTO，别拿 `RelationRefDto` 凑（凑了就把 `color_key` 丢了）。
 */
export class ProductLineRefDto {
  @ApiProperty({ description: '产品线 id（十进制字符串）', example: '1' })
  id!: string;

  @ApiProperty({ description: '产品线名称', example: '网站建设' })
  name!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: '固定配色键（7 条线各一色，前端照渲染，→ 需求 §13.3）；**未配置给 `null`**',
    example: 'blue',
  })
  color_key!: string | null;
}

/** 关系列表项 / 详情共有部分（→ §5.6） */
export class RelationVoDto {
  @ApiProperty({ description: '业务关系 id', example: '1' })
  id!: string;

  @ApiProperty({ type: RelationRefDto, nullable: true, description: '公司档案（档案被逻辑删时取不到引用 → `null`）' })
  company!: RelationRefDto | null;

  @ApiProperty({ type: RelationRefDto, nullable: true, description: '承接部门（`dept_id` 恒定不可变，→ C1）' })
  dept!: RelationRefDto | null;

  @ApiProperty({ type: ProductLineRefDto, nullable: true, description: '产品线（含固定配色键 `color_key`）' })
  product_line!: ProductLineRefDto | null;

  @ApiProperty({ description: '工作流阶段：1~6 ＋ 7＝已流失', example: 1 })
  stage!: number;

  @ApiProperty({ description: '紧迫档', enum: ['weekly', 'monthly', 'quarterly', 'long_term', 'gray'] })
  urgency!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: '开发价值档（非灰度关系**必标**，→ C1）',
    enum: ['high', 'medium', 'low', 'pending'],
  })
  value_tier!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: '客户等级（**系统按滚动 12 个月回款自动算、不手填** → E 域未接，本批恒 `null`）',
  })
  customer_level!: string | null;

  @ApiProperty({ type: RelationRefDto, nullable: true, description: '主责销售（**公海关系为 `null`**）' })
  owner!: RelationRefDto | null;

  @ApiProperty({ description: '`private`＝私海（有 owner）/ `company_sea`＝公海（无 owner）', enum: ['private', 'company_sea'] })
  sea_status!: string;

  @ApiProperty({ type: String, nullable: true, description: '最近一次**有效沟通**时间（快速标记不计入，→ C1）' })
  last_event_at!: string | null;

  @ApiProperty({ type: String, nullable: true, description: '一句话「上次说好下次干嘛」' })
  next_action_hint!: string | null;

  @ApiProperty({ type: String, nullable: true, description: '竞品态势快照（`null`＝未知）', enum: ['none', 'in_use', 'comparing'] })
  competition!: string | null;

  @ApiProperty({ description: '建档时间（ISO）' })
  created_at!: string;

  @ApiProperty({ description: '最近更新时间（ISO）' })
  updated_at!: string;
}

/**
 * 关系**列表项**（→ §5.6 列表项）＝ `RelationVoDto` ＋ `drop_in_x_days`。
 *
 * ★ 为什么**单开一个类**、不往 `RelationVoDto` 里加：该字段**只有列表有**（详情本期不出）
 *   —— 加在基类上＝让详情的 Swagger 也宣称有这个字段，前端按生成物写就会取到 `undefined`
 *   （"假装有字段"比"没有"更糟，→ 文件头 ⚠ 段的原则）。
 * ★ 谁填它：**不是本域 service**。`drop_in_x_days` 由 **D-61 桥③ 聚合层**（`relation-aggregate`）
 *   拼装 —— F 域算「距掉海还剩几个自然日」、本域给「锚点（部门 / 产品线 / 最近有效沟通 / 建档时刻）」。
 *   与 `CompanyDetailVoDto` 的 `relations_summary` / `event_count_30d` **同一姿势**：
 *   出参 DTO 描述的是 **HTTP 出参形状**，不等于本域 service 的返回类型。
 */
export class RelationListItemVoDto extends RelationVoDto {
  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      '距掉海还剩几个**自然日**（Asia/Shanghai 日界；**派生、不落库**，→ §5.1 派生字段）。' +
      '`0` ＝ **今天到期**（列表按「到期当天掉公海 ⚠」标红）；**负数** ＝ 到期日已过 ⇒ 次日掉落；' +
      '正数 ＝ 还有几天。**拿不到就给 `null`**（公海 / 无主 / 没有规则命中 / 规则没配跟进天数）' +
      '—— 一律**不编 0**（编了会把"判不了"显示成"今天到期"）。',
    example: 3,
  })
  drop_in_x_days!: number | null;
}

/**
 * 关系列表**分页出参**（→ 接口 §2.3 统一响应包 · 分页形态 / §五 PageResult）。
 * ★ 键名逐字固定为 `list / total / page / page_size`（§2.3 G2）—— 别改成 `pageSize`：
 *   出参 snake_case 是 §2.6 的硬口径，改了整个前端拆包层都要跟着动。
 * ★ 列表类**一律分页**（→ 设计规范 §4.3「不用无限滚动」）⇒ 从 M6-07 起 `GET /relations`
 *   的 `data` 就是这个对象，**不再是裸数组**。
 */
export class RelationPageVoDto {
  @ApiProperty({ type: [RelationListItemVoDto], description: '当前页数据' })
  list!: RelationListItemVoDto[];

  @ApiProperty({ description: '符合筛选条件的全量条数（前端「共 N 条」）', example: 120 })
  total!: number;

  @ApiProperty({ description: '当前页码（从 1 开始）', example: 1 })
  page!: number;

  @ApiProperty({ description: '每页条数（默认 20，最大 100，→ §2.7）', example: 20 })
  page_size!: number;
}

/** 关系成员（→ §5.6 `members[]`） */
export class RelationMemberVoDto {
  @ApiProperty({ type: RelationRefDto, nullable: true, description: '成员员工（员工被停用时取不到引用 → `null`）' })
  employee!: RelationRefDto | null;

  @ApiProperty({ description: '`owner`＝主责销售（一关系仅一人）/ `collaborator`＝协同人', enum: ['owner', 'collaborator'] })
  member_type!: string;

  @ApiProperty({ type: String, nullable: true, description: '`collaborate` 正式协同 / `ask_help` @求助；owner 为 `null`' })
  source!: string | null;

  @ApiProperty({ type: String, nullable: true, description: '协同有效期（`null`＝长期，仅正式协同，→ C2）' })
  valid_until!: string | null;
}

/** 关系详情 ＝ 列表项 ＋ 成员（M3 范围；其余详情字段见文件头「未落地清单」） */
export class RelationDetailVoDto extends RelationVoDto {
  @ApiProperty({ type: [RelationMemberVoDto], description: '成员（含已撤销的留痕行，按加入先后）' })
  members!: RelationMemberVoDto[];
}
