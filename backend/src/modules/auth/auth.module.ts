import { Controller, Get, Module } from '@nestjs/common';

// 桩模块：鉴权/权限。后续按接口API文档 A 组 + 数据库设计"组织权限域"实现。
@Controller('auth')
export class AuthController {
  @Get('ping')
  ping() {
    return { module: 'auth', ok: true };
  }
}

@Module({ controllers: [AuthController] })
export class AuthModule {}
