import { IsString, IsEnum } from 'class-validator';

export enum RelationStatus {
  INTENTION = 'intention', // 意向
  COOPERATED = 'cooperated', // 已合作
  LOST = 'lost', // 已流失
}

/**
 * 业务关系激活入参。
 * 铁律：1 业务关系 = 企业 × 部门 × 产品线（见数据库设计文档 3.3 / 5.3）
 */
export class ActivateRelationDto {
  @IsString()
  companyId: string;

  @IsString()
  departmentId: string;

  @IsString()
  productLineId: string;

  /** 主对接销售（第一个点激活的人，时间戳锁定） */
  @IsString()
  ownerId: string;

  @IsString()
  ownerName: string;
}
