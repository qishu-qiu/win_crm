import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 第三道闸（类型安全）的入口：全局校验管道
  // whitelist + forbidNonWhitelisted → 挡"未声明字段注入"
  // transform → 按 DTO 类型自动转换 → 挡"类型错传 / 枚举乱传"
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // OpenAPI = 前端类型的唯一来源（前端用 openapi-typescript 拉 /api-json 生成）
  const config = new DocumentBuilder()
    .setTitle('销售标准管理 CRM API')
    .setDescription('spec-driven 契约：前端类型由本契约生成，禁止手写对接')
    .setVersion('0.1')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
