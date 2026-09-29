import { ApiProperty } from '@nestjs/swagger';

import { SeaManagerTodoResultDto } from '../../sea/dto/sea-response.dto';

/** 本月签约额（→ 接口 §5.13 / §4.12） */
export class MonthSignedDto {
  @ApiProperty({ description: '本月签约额（元）' })
  amount!: number;

  @ApiProperty({ description: '环比上月 ＝ (本月 − 上月) / 上月；上月为 0 → `null`', nullable: true })
  chain_ratio!: number | null;
}

/** 看板 KPI（→ 接口 §5.13 / §4.12） */
export class DashboardKpiDto {
  @ApiProperty({ description: '今日新增关系数（`business_relation.created_at` 落北京今日）' })
  today_new!: number;

  @ApiProperty({ description: '今日待跟进数（`commitment.due_at` 落北京今日且 `status=open`）' })
  today_todo!: number;

  @ApiProperty({ type: MonthSignedDto, description: '本月签约额（`contract.sign_date` 落北京当月且 `status∈{running,done}` 汇总）' })
  month_signed!: MonthSignedDto;
}

/** 待办明细项（→ 接口 §5.13 `pending_todo`）：承诺到期/逾期未办 */
export class PendingTodoItemDto {
  @ApiProperty({ description: '业务关系 id（十进制字符串）' })
  relation_id!: string;

  @ApiProperty({ nullable: true, description: '关系展示名（公司名）' })
  relation_name!: string | null;

  @ApiProperty({ nullable: true, description: '关联联系人 id（承诺直接绑定的联系人）' })
  contact_id!: string | null;

  @ApiProperty({ nullable: true, description: '关联联系人姓名' })
  contact_name!: string | null;

  @ApiProperty({ description: '承诺到期时间（ISO8601）' })
  due_at!: string;

  @ApiProperty({ description: '是否已逾期（due_at 早于北京今日 0 点 → 前端置红）' })
  overdue!: boolean;

  @ApiProperty({ nullable: true, description: '承诺内容（作为待办描述）' })
  content!: string | null;
}

/** 活跃预警项（→ 接口 §5.13 `warnings`）：3 卡共用结构，`type` 区分，其余字段按 `type` 出现 */
export class WarningItemDto {
  @ApiProperty({ enum: ['contract_expire', 'new_biz', 'sea_drop'], description: '预警类型' })
  type!: 'contract_expire' | 'new_biz' | 'sea_drop';

  @ApiProperty({ description: '业务关系 id（十进制字符串）' })
  relation_id!: string;

  @ApiProperty({ nullable: true, description: '关系展示名（公司名）' })
  relation_name!: string | null;

  @ApiProperty({ nullable: true, description: '`new_biz`：在位 owner 员工 id' })
  owner_id!: string | null;

  @ApiProperty({ nullable: true, description: '`new_biz`：在位 owner 姓名' })
  owner_name!: string | null;

  @ApiProperty({ nullable: true, description: '`contract_expire`：合同到期日（ISO8601）' })
  service_end!: string | null;

  @ApiProperty({ nullable: true, description: '`contract_expire`：剩余天数（负＝已过期未续）' })
  days_left!: number | null;

  @ApiProperty({ nullable: true, description: '`new_biz`：建档时间（ISO8601）' })
  created_at!: string | null;

  @ApiProperty({ nullable: true, description: '`sea_drop`：已停留公海自然日数' })
  dropped_days!: number | null;
}

/** 部门对比项（→ 接口 §5.13 `dept_compare`） */
export class DeptCompareItemDto {
  @ApiProperty({ description: '部门 id（十进制字符串）' })
  dept_id!: string;

  @ApiProperty({ description: '部门名称' })
  dept_name!: string;

  @ApiProperty({ description: '当月签约额（元，按 `business_relation.dept_id` 聚合，恒定不漂移）' })
  signed_amount!: number;

  @ApiProperty({ description: '当前本部门私海关系数（盘子大小）' })
  relation_count!: number;
}

/** 销冠项（→ 接口 §5.13 `top_sales`）：按签单人聚当月签约额，Top 10 */
export class TopSalesItemDto {
  @ApiProperty({ description: '签单人（业绩归属）员工 id（十进制字符串）' })
  owner_id!: string;

  @ApiProperty({ description: '签单人姓名' })
  owner_name!: string;

  @ApiProperty({ description: '当月签约额（元）' })
  signed_amount!: number;

  @ApiProperty({ description: '当月签约单数' })
  contract_count!: number;
}

/** 周重点僵尸项（→ 接口 §5.13 `zombie_weekly`）：`urgency=weekly` 且 ≥14 天无有效跟进 */
export class ZombieWeeklyItemDto {
  @ApiProperty({ description: '业务关系 id（十进制字符串）' })
  relation_id!: string;

  @ApiProperty({ nullable: true, description: '关系展示名（公司名）' })
  relation_name!: string | null;

  @ApiProperty({ nullable: true, description: '在位 owner 员工 id' })
  owner_id!: string | null;

  @ApiProperty({ nullable: true, description: '在位 owner 姓名' })
  owner_name!: string | null;

  @ApiProperty({ nullable: true, description: '最近一次有效跟进时间（ISO8601，无则 null）' })
  last_event_at!: string | null;

  @ApiProperty({ description: '距最近有效跟进的自然日数（无跟进＝9999）' })
  no_progress_days!: number;
}

/**
 * 看板结果（→ 接口 §5.13 `GET /reports/dashboard`）。
 *
 * ★ 5 个列表分区（pending_todo / warnings / dept_compare / top_sales / zombie_weekly）**形状以本 DTO 为唯一真相源**，
 *   本版已落真实数据（→ 欠账 D-02 ⑤ 关闭）；派生口径见 `report.service.ts` 文件头。
 * ★ `sea_todo` 直接复用 `GET /sea/manager-todo`（同一套规则解析，不重复实现）。
 * ★ 报表/看板**不脱敏**（§2.4）返回真实金额。
 */
export class DashboardResultDto {
  @ApiProperty({ type: DashboardKpiDto })
  kpi!: DashboardKpiDto;

  @ApiProperty({ type: [PendingTodoItemDto], description: '今日/逾期待跟进明细（承诺 `status=open` 且 due_at≤今日结束，逾期置顶红）' })
  pending_todo!: PendingTodoItemDto[];

  @ApiProperty({ type: [WarningItemDto], description: '活跃预警 3 卡：签约到期 / 新商机 / 掉公海（→ 需求 §8 续约预警、§6.3 掉海）' })
  warnings!: WarningItemDto[];

  @ApiProperty({ type: [DeptCompareItemDto], description: '部门对比：各管辖部门当月签约额 ＋ 当前私海关系数（按签约额降序）' })
  dept_compare!: DeptCompareItemDto[];

  @ApiProperty({ type: [TopSalesItemDto], description: '销冠榜：按签单人（业绩归属）聚当月签约额，Top 10（降序）' })
  top_sales!: TopSalesItemDto[];

  @ApiProperty({ type: [ZombieWeeklyItemDto], description: '周重点僵尸榜：`urgency=weekly` 且 ≥14 天无有效跟进（→ 需求 §8.2）' })
  zombie_weekly!: ZombieWeeklyItemDto[];

  @ApiProperty({ type: SeaManagerTodoResultDto, description: '公海停留超期待决策（复用 `GET /sea/manager-todo`）' })
  sea_todo!: SeaManagerTodoResultDto;
}
