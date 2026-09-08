import { Controller, Get, Module } from '@nestjs/common';

// 桩模块：组织/部门/角色/权限。对应数据库设计"组织权限域" + 接口 N 组。
@Controller('organization')
export class OrganizationController {
  @Get('ping')
  ping() {
    return { module: 'organization', ok: true };
  }
}

@Module({ controllers: [OrganizationController] })
export class OrganizationModule {}
