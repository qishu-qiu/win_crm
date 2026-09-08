import { Controller, Get, Module } from '@nestjs/common';

// 桩模块：跟单/预约/外出。对应接口 C 组 + 数据库设计"业务关系域"。
@Controller('follow-ups')
export class FollowUpController {
  @Get('ping')
  ping() {
    return { module: 'follow-up', ok: true };
  }
}

@Module({ controllers: [FollowUpController] })
export class FollowUpModule {}
