import { ConflictException } from '@nestjs/common';

/**
 * 业务关系激活冲突（HTTP 409）。
 * 对应数据库设计文档铁律：active_key 生成列唯一索引。
 * 应用层返回归属人，便于前端弹"已有归属"提示（不替代 DB 唯一约束）。
 */
export class ActiveKeyConflictException extends ConflictException {
  constructor(
    public readonly ownerId: string,
    public readonly ownerName: string,
  ) {
    super({
      code: '20201',
      message: 'ACTIVATION_CONFLICT',
      owner: { id: ownerId, name: ownerName },
    });
  }
}
