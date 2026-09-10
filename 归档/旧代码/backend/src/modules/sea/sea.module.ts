import { Module } from '@nestjs/common';
import { SeaController } from './sea.controller.js';
import { SeaService } from './sea.service.js';

@Module({
  controllers: [SeaController],
  providers: [SeaService],
})
export class SeaModule {}
