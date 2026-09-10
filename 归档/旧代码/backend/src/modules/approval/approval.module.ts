import { Controller, Get, Module } from '@nestjs/common';

// 桩模块：审批（激活冲突/转交/报销/字段停用）。对应接口 L 组 + 数据库设计"审批系统域"。
@Controller('approvals')
export class ApprovalController {
  @Get('ping')
  ping() {
    return { module: 'approval', ok: true };
  }
}

@Module({ controllers: [ApprovalController] })
export class ApprovalModule {}
