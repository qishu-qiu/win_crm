import { Controller, Get, Module } from '@nestjs/common';

// 桩模块：企业档案。对应接口 G 组 + 数据库设计"客户资产域"。
@Controller('companies')
export class CompanyController {
  @Get('ping')
  ping() {
    return { module: 'company', ok: true };
  }
}

@Module({ controllers: [CompanyController] })
export class CompanyModule {}
