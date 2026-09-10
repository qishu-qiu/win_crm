import { randomUUID } from 'crypto';
import { ActiveKeyConflictException } from '../../common/exceptions.js';
import { RelationStatus } from './business-relation.dto.js';

export interface BusinessRelation {
  id: string;
  companyId: string;
  departmentId: string;
  productLineId: string;
  ownerId: string;
  ownerName: string;
  /** 生成列：companyId|departmentId|productLineId，唯一索引兜底 */
  activeKey: string;
  status: RelationStatus;
  createdAt: Date;
}

export type NewBusinessRelation = Omit<
  BusinessRelation,
  'id' | 'activeKey' | 'createdAt' | 'status'
> & { activeKey: string };

export interface BusinessRelationRepository {
  findByActiveKey(activeKey: string): Promise<BusinessRelation | null>;
  create(data: NewBusinessRelation): Promise<BusinessRelation>;
}

/**
 * 内存实现：用于骨架阶段验证"应用层守卫"逻辑。
 * 真实环境由 TypeORM/Prisma + MySQL8 生成列唯一索引兜底（撞 activeKey → 1062）；
 * 此处用 create 内的二次检查模拟该约束，证明"撞单必返冲突、绝不静默建重复"。
 */
export class InMemoryBusinessRelationRepository implements BusinessRelationRepository {
  private items: BusinessRelation[] = [];

  async findByActiveKey(activeKey: string): Promise<BusinessRelation | null> {
    return this.items.find((i) => i.activeKey === activeKey) ?? null;
  }

  async create(data: NewBusinessRelation): Promise<BusinessRelation> {
    const existing = await this.findByActiveKey(data.activeKey);
    if (existing) {
      // 模拟 DB 唯一索引冲突
      throw new ActiveKeyConflictException(existing.ownerId, existing.ownerName);
    }
    const created: BusinessRelation = {
      id: randomUUID(),
      createdAt: new Date(),
      status: RelationStatus.INTENTION,
      ...data,
    };
    this.items.push(created);
    return created;
  }
}
