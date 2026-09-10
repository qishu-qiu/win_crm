import { Controller, Get, Module } from '@nestjs/common';

// 桩模块：台账字段模板（JSON Schema 驱动 + 元数据表）。对应接口 K 组 + 数据库设计"台账域"。
@Controller('ledger-field-templates')
export class LedgerFieldTemplateController {
  @Get('ping')
  ping() {
    return { module: 'ledger-field-template', ok: true };
  }
}

@Module({ controllers: [LedgerFieldTemplateController] })
export class LedgerFieldTemplateModule {}
