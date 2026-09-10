import { Inject, Injectable } from '@nestjs/common';
import { ActivateRelationDto } from './business-relation.dto.js';
import {
  BusinessRelation,
  BusinessRelationRepository,
} from './business-relation.repository.js';
import { ActiveKeyConflictException } from '../../common/exceptions.js';

@Injectable()
export class BusinessRelationService {
  constructor(
    @Inject('BUSINESS_RELATION_REPO')
    private readonly repo: BusinessRelationRepository,
  ) {}

  /**
   * 业务关系激活。
   * 铁律（数据库设计文档）：同一 企业×部门×产品线 只能有一个 active 业务关系。
   * 步骤：先按 active_key 查询 → 命中则返 409 带归属人（撞单提示）；
   * 否则创建。DB 唯一索引是最终兜底，本方法提供"友好 409 + 归属人"。
   */
  async activate(dto: ActivateRelationDto): Promise<BusinessRelation> {
    const activeKey = `${dto.companyId}|${dto.departmentId}|${dto.productLineId}`;
    const existing = await this.repo.findByActiveKey(activeKey);
    if (existing) {
      throw new ActiveKeyConflictException(existing.ownerId, existing.ownerName);
    }
    return this.repo.create({
      companyId: dto.companyId,
      departmentId: dto.departmentId,
      productLineId: dto.productLineId,
      ownerId: dto.ownerId,
      ownerName: dto.ownerName,
      activeKey,
    });
  }
}
