import { Controller, Get, Module } from '@nestjs/common';

// 桩模块：通知（站内/预留微信推送）。对应接口 + 数据库设计"通知域"。
@Controller('notifications')
export class NotificationController {
  @Get('ping')
  ping() {
    return { module: 'notification', ok: true };
  }
}

@Module({ controllers: [NotificationController] })
export class NotificationModule {}
