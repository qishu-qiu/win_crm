import { Controller, Get, Module } from '@nestjs/common';

// 桩模块：联系人。对应接口 G 组 + 数据库设计"客户资产域"。
@Controller('contacts')
export class ContactController {
  @Get('ping')
  ping() {
    return { module: 'contact', ok: true };
  }
}

@Module({ controllers: [ContactController] })
export class ContactModule {}
