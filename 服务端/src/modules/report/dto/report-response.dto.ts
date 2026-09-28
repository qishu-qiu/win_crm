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

/**
 * 看板结果（→ 接口 §5.13 `GET /reports/dashboard`）。
 *
 * ★ `pending_todo` / `warnings` / `dept_compare` / `top_sales` / `zombie_weekly` 在接口 §5.13 仍是 `[]`
 *   占位、**item 形状未定义**（无独立存储模型、需派生）→ 本版先回 `[]`，待规格补全（→ 欠账 D-33 ⑤），
 *   ★不编业务字段**（文档驱动，下游不得自造规则）。
 * ★ `sea_todo` 直接复用 `GET /sea/manager-todo`（同一套规则解析，不重复实现）。
 * ★ 报表/看板**不脱敏**（§2.4）返回真实金额。
 */
export class DashboardResultDto {
  @ApiProperty({ type: DashboardKpiDto })
  kpi!: DashboardKpiDto;

  @ApiProperty({ type: [Object], description: '今日待跟进明细（接口 §5.13 占位，形状待定 → 欠账 D-33 ⑤）' })
  pending_todo!: unknown[];

  @ApiProperty({ type: [Object], description: '活跃预警（接口 §5.13 占位；无独立预警表，纯派生，形状待定）' })
  warnings!: unknown[];

  @ApiProperty({ type: [Object], description: '部门业绩对比（接口 §5.13 占位，形状待定）' })
  dept_compare!: unknown[];

  @ApiProperty({ type: [Object], description: '销冠榜（接口 §5.13 占位，形状待定）' })
  top_sales!: unknown[];

  @ApiProperty({ type: [Object], description: '周重点僵尸榜（接口 §5.13 占位；`business_relation.urgency=weekly` 派生，形状待定）' })
  zombie_weekly!: unknown[];

  @ApiProperty({ type: SeaManagerTodoResultDto, description: '公海停留超期待决策（复用 `GET /sea/manager-todo`）' })
  sea_todo!: SeaManagerTodoResultDto;
}
