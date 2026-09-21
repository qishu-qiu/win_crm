// =============================================================================
// F 域入参 DTO（F-01）
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM接口API文档》**§5.16 公海 sea**（形状唯一落点）：req ＝ `{dept_id, product_line_id}`，
//     与 `POST /relations` **逐字同形** —— 部门 × 产品线是**业务关系**的属性
//     （公海的一"条"＝一条业务关系，→ 需求 §6.3），故必须能定位到具体那一条。
//     `:id` ＝ **公司 id**（§4.5 那行留指针）。
//   · 同 §2.4：字段缺失 / 类型错 → **400 / 20001**（横切层校验管道统一出口）。
//   · 同 §2.6：入参出参 **snake_case**；所有 id 都是**十进制字符串**（后端 `bigint`，前端 string）。
// =============================================================================
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

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

/**
 * 天数上限（**防御性上界，非业务口径**）：F1 没给上限，而 `天数 × 86400000` 一旦越过
 * `Number.MAX_SAFE_INTEGER` 就会静默丢精度（算出来的到期时刻是错的，且没人会来查）。
 * 取 10 年 —— 够宽（不会误拦真实配置），又保证乘法在安全整数内。
 */
const RULE_DAYS_MAX = 3650;

/**
 * `PUT /sea/rules` —— **提交某层级公海规则的新版本**（→ 接口 §4.14.10 / §5.16；需求 §6.3）。
 *
 * ★ 语义 ＝ **整行覆盖**（不是部分更新）：`PUT` 提交的就是"这条规则新版本的内容"；
 *   没给的字段 ⇒ **该维度不配**（落 `null`）。想保留原值就把它一起带上 ——
 *   与「插新版本行」（F1）同一姿势，不做"缺省＝沿用"的隐式推断。
 * ★ `confirmed` 是**两段式确认**（形态不新增端点，见 §5.16）：
 *   不传 / `false` ⇒ **只回预告**（`affected_customers`，**零写库**）；
 *   `true` ⇒ 落库（插新版本行 ＋ 旧行 `status=disabled`）。
 */
export class UpdateSeaRuleDto {
  @ApiProperty({
    enum: [1, 2, 3, 4],
    description:
      '规则层级（→ 数据架构 F1）：`1` 全局 / `2` 产品线 / `3` 部门 / `4` 部门×产品线。' +
      '**层级与两个 key 必须搭配一致**（1＝两个都不给 / 2＝只给产品线 / 3＝只给部门 / 4＝都给），' +
      '搭配错 → **400 / 20001**（搭配错了不会被库拦下，只会静默失配，故在入口就拒）',
    example: 4,
  })
  @IsInt({ message: 'level 必须是整数' })
  @Min(1, { message: 'level 只能是 1~4' })
  @Max(4, { message: 'level 只能是 1~4' })
  level!: number;

  @ApiPropertyOptional({
    description:
      '部门 id（十进制字符串）。**层级 3 / 4 必给**；层级 1 / 2 给了就是搭配错（400）。' +
      '⚠ 部门级 / 部门×产品级**只有该部门的部门经理**（或老板 / 管理员）能配 → 否则 **403**',
    example: '2',
  })
  @IsOptional()
  @IsString({ message: 'dept_id 必须是字符串' })
  @Length(1, 32, { message: 'dept_id 长度不合法' })
  dept_id?: string;

  @ApiPropertyOptional({
    description:
      '产品线 id（十进制字符串）。**层级 2 / 4 必给**；层级 1 / 3 给了就是搭配错（400）',
    example: '1',
  })
  @IsOptional()
  @IsString({ message: 'product_line_id 必须是字符串' })
  @Length(1, 32, { message: 'product_line_id 长度不合法' })
  product_line_id?: string;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description:
      '**跟进频次**天数（触发①「最近 N 天无有效跟进」→ 需求 §6.3）。' +
      '`null` / 不给 ＝ **这一项不配**（扫描对该关系"判不了"，**不许拿默认天数顶替**）；' +
      '给 0 或负数 → **400 / 20001**（"不配"请用 `null`，别用 0 表示）',
    example: 30,
  })
  @IsOptional()
  @IsInt({ message: 'follow_freq_days 必须是整数' })
  @Min(1, { message: 'follow_freq_days 至少 1 天（不配请传 null）' })
  @Max(RULE_DAYS_MAX, { message: `follow_freq_days 最多 ${RULE_DAYS_MAX} 天` })
  follow_freq_days?: number | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description:
      '**成单周期**天数（触发②「激活 N 天未签约」→ 需求 §6.3）。' +
      '⚠ 触发②的**锚点口径规格未写**（"激活"＝首轮建档还是本轮领回）⇒ 本项**只配不改行为**，' +
      '扫描暂不读它（→《欠账登记表》D-57）',
    example: 90,
  })
  @IsOptional()
  @IsInt({ message: 'deal_cycle_days 必须是整数' })
  @Min(1, { message: 'deal_cycle_days 至少 1 天（不配请传 null）' })
  @Max(RULE_DAYS_MAX, { message: `deal_cycle_days 最多 ${RULE_DAYS_MAX} 天` })
  deal_cycle_days?: number | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description:
      '**公海停留超期**天数（→ F1 ★ P-10 修正：**只用于「公海停留超期 → 经理决策待办」**，' +
      '**不参与私海掉落倒计时**）。⚠ 该任务与决策端点属后续片，本项**只配不生效**',
    example: 60,
  })
  @IsOptional()
  @IsInt({ message: 'stay_days 必须是整数' })
  @Min(1, { message: 'stay_days 至少 1 天（不配请传 null）' })
  @Max(RULE_DAYS_MAX, { message: `stay_days 最多 ${RULE_DAYS_MAX} 天` })
  stay_days?: number | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description:
      '**推进停滞**天数（触发③「N 天内阶段未向前推进一格」→ 需求 §6.3）。' +
      '⚠ 触发③的**锚点口径规格未写**（"向前"含不含回退）⇒ 本项**只配不改行为**' +
      '（→《欠账登记表》D-57）',
    example: 21,
  })
  @IsOptional()
  @IsInt({ message: 'no_progress_max 必须是整数' })
  @Min(1, { message: 'no_progress_max 至少 1 天（不配请传 null）' })
  @Max(RULE_DAYS_MAX, { message: `no_progress_max 最多 ${RULE_DAYS_MAX} 天` })
  no_progress_max?: number | null;

  @ApiPropertyOptional({
    type: Boolean,
    description:
      '**是否落库**：不传 / `false` ＝ 只回预告（`affected_customers`，**零写库**，供"先看看影响多大"）；' +
      '`true` ＝ 提交变更（插新版本行 ＋ 旧行 `status=disabled`，新版本 **7 天后生效**）',
    example: false,
  })
  @IsOptional()
  @IsBoolean({ message: 'confirmed 必须是布尔值' })
  confirmed?: boolean;
}
