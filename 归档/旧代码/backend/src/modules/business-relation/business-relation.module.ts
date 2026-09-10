import { Module } from '@nestjs/common';
import { BusinessRelationController } from './business-relation.controller.js';
import { BusinessRelationService } from './business-relation.service.js';
import { InMemoryBusinessRelationRepository } from './business-relation.repository.js';

@Module({
  controllers: [BusinessRelationController],
  providers: [
    BusinessRelationService,
    {
      provide: 'BUSINESS_RELATION_REPO',
      useClass: InMemoryBusinessRelationRepository,
    },
  ],
  exports: [BusinessRelationService],
})
export class BusinessRelationModule {}
