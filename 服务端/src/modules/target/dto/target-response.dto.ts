// =============================================================================
// 目标进度出参（M8-06 Phase 4 切片 1）
//
// 口径来源（★ 真相源）：《销售CRM接口API文档》§5.13 `GET /targets/progress`
//   → `{stat_unit:"company",items:[{scope_type,scope_id,name,target_amount,paid_amount,
//      signed_amount,rate,time_rate,diff_points,adjusted}]}`
// =============================================================================
import { ApiProperty } from '@nestjs/swagger';

/** 单条目标进度（→ §5.13） */
export class TargetProgressItemDto {
  @ApiProperty({ description: 'scope 类型：company / dept / employee' })
  scope_type!: string;

  @ApiProperty({ description: 'scope id（十进制字符串；company 层恒 "0"）' })
  scope_id!: string;

  @ApiProperty({ description: 'scope 名称（company＝全公司；dept/employee＝档案名）' })
  name!: string;

  @ApiProperty({ description: '目标额（回款口径，→ 数据架构 `target.amount`）' })
  target_amount!: number;

  @ApiProperty({ description: '当月已回款额（Contract.paid_amount 合计）' })
  paid_amount!: number;

  @ApiProperty({ description: '当月签约额（Contract.amount 合计）' })
  signed_amount!: number;

  @ApiProperty({ description: '回款完成率 ＝ paid_amount / target_amount（0~1+）' })
  rate!: number;

  @ApiProperty({ description: '时间进度 ＝ 当月已过时间占比（0~1，封顶 1）' })
  time_rate!: number;

  @ApiProperty({ description: '差额 ＝ paid_amount − target_amount' })
  diff_points!: number;

  @ApiProperty({ description: '是否已被调整（当前无调整追踪，恒 false）' })
  adjusted!: boolean;
}

/** 目标进度结果（→ §5.13） */
export class TargetProgressResultDto {
  @ApiProperty({ description: '统计单元（目标按组织口径聚合，恒 company）' })
  stat_unit!: 'company';

  @ApiProperty({ type: [TargetProgressItemDto], description: '各 scope 目标进度条' })
  items!: TargetProgressItemDto[];
}
