// =============================================================================
// 外出登记（visit）出参 DTO —— 纯行政考勤（→ 接口 §4.7·§5.8）
// =============================================================================
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** 一条外出登记（→ 接口 §5.8 形状） */
export class VisitLogDto {
  @ApiProperty({ description: '外出登记 id（十进制字符串）' })
  id!: string;

  @ApiProperty({ description: '登记人（员工 id，＝当前登录人）' })
  employee_id!: string;

  @ApiProperty({ description: '出去时间（ISO 8601）' })
  depart_at!: string;

  @ApiProperty({ description: '去干什么（一句话）' })
  reason!: string;

  @ApiPropertyOptional({ description: '回来时间（ISO 8601）；`null`＝还没回', type: String })
  actual_return_at?: string | null;

  @ApiPropertyOptional({ description: '去了哪些客户（业务关系 id 数组；空＝只登记行踪）', type: [String] })
  relation_ids?: string[];

  @ApiProperty({ description: '创建时间（ISO 8601）' })
  created_at!: string;
}
