import { IsInt, IsString, Min } from 'class-validator';

/**
 * 公海判定入参（扁平结构，叶子级校验，不依赖 class-transformer 元数据）。
 * 日期以 ISO 字符串传入，由 SeaService 统一转换成 Date —— service 与传输层解耦。
 */
export class SeaEvaluateDto {
  /** 维护人岗位，客服岗不掉落 */
  @IsString()
  maintainerRole!: string;

  /** 最近跟单时间（ISO 字符串，可空） */
  @IsString()
  lastFollowUpAt!: string;

  /** 创建时间（ISO 字符串） */
  @IsString()
  createdAt!: string;

  /** 当前时间（ISO 字符串，注入假时钟，便于测试/时间快进） */
  @IsString()
  now!: string;

  /** 超过此天数无跟单 → 掉公海 */
  @IsInt()
  @Min(0)
  noFollowUpDays!: number;
}
