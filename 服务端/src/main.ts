// =============================================================================
// Web 进程入口（M0-08 最小版 ＋ M0-38 横切装配 ＋ M0-49 根模块 ＋ M0-48 OpenAPI）
// 只做四件事：加载 .env → 建应用 → 挂 /docs → 监听端口。
//
// · ★ M0-49：根模块已换成 `app.module.ts`（组装 kernel ＋ shared ＋ prisma），
//   原占位 `BootstrapModule` 按计划**已删除**。
// · ★ M0-38：横切四件套（守卫 / 拦截器 / 过滤器 / 管道）由 `SharedModule` 用 `APP_*` 令牌全局注册，
//   本文件**只经 AppModule 引入**该模块 —— **不在这里 useGlobalGuards/...**，理由见 shared.module.ts
//   顶部注释（走 DI 才能注入 JwtService / ContextService；且四件套的生效顺序要一处可见）。
// · ★ M0-48：Swagger 挂 `/docs`（UI），并自动暴露 `/docs-json`（OpenAPI 3 描述）——
//   后者**正是** `npm run gen:types`（openapi-typescript）的输入，★ 前端类型一律从它生成，禁止手写。
//   ⚠ `/docs` 是**中间件直出的静态资源**、不经 Nest 路由与守卫，故不必（也标不上）`@Public()`。
// · `.env` 加载口径与 Prisma 侧一致，见 `服务端/prisma.config.ts`（process.loadEnvFile，不引 dotenv）；
//   入口文件负责把 .env 灌进 process.env，运行时的 DATABASE_URL / REDIS_URL / JWT_SECRET 都从这里来。
//   ⚠ 顺序要紧：loadEnvFile **必须先于** NestFactory.create —— SharedModule 的 JwtModule 工厂
//   与 PrismaService 的构造函数都在 DI 初始化期读环境变量，早于此刻会读到 undefined 而拒绝启动。
// · Worker 入口见 `worker.ts`：结构同源，但**不监听端口**，且**刻意不 import SharedModule / PrismaModule**
//   （Worker 没有 HTTP 请求可鉴权/包装；Prisma 到 M7-01 组装 worker.module 时再接）。
// =============================================================================
import { Logger, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module';

try {
  process.loadEnvFile('.env');
} catch {
  // .env 不存在（如 CI 只注入真实环境变量）→ 交给环境变量本身兜底
}

/** OpenAPI 文档版本：口径来源《销售CRM接口API文档》V1.18（★ 与接口文档同号，便于对照） */
const API_DOC_VERSION = 'V1.18';

/** 授权方案名：Swagger UI 右上角 Authorize 填入 Bearer token 后带到全部接口（→ 接口文档 §2.2） */
const BEARER_SCHEME_NAME = 'bearer';

/** 生产环境是否仍挂 `/docs`：默认**否**（理由见 `setupOpenApi` 内的 ★） */
function openApiEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.OPENAPI_ENABLED === 'true';
}

/** 挂 OpenAPI：UI 走 `/docs`，机器可读描述走 `/docs-json`（gen:types 的输入） */
function setupOpenApi(app: INestApplication): void {
  // ★ 生产环境默认**关闭**：`/docs` 是**中间件直出的静态资源、不经 Nest 路由与守卫**（见文件头 ⚠），
  //   上公网即等同**公开全部接口定义与内部结构**。确需在生产保留 → 设 `OPENAPI_ENABLED=true`，
  //   并自行加访问控制（→ `服务端/prisma/README.md`「⬆ 上服务器时必做」第 7 项）。
  if (!openApiEnabled()) {
    new Logger('OpenApi').log(
      '生产环境已跳过 /docs（如需开启：OPENAPI_ENABLED=true 并自行加访问控制）',
    );
    return;
  }

  const config = new DocumentBuilder()
    .setTitle('销售 CRM 接口')
    .setDescription(
      '口径来源：《销售CRM接口API文档》V1.18 —— 统一响应包 / 错误码 / 鉴权口径一律以其为准。',
    )
    .setVersion(API_DOC_VERSION)
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, BEARER_SCHEME_NAME)
    .build();

  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  setupOpenApi(app);

  // 让 onModuleDestroy（PrismaService.$disconnect 等）在收到停止信号时**真正被调用**。
  // ⚠ 非 M0 判据要求，但缺了它「优雅关连接」就是一句空话（Ctrl+C / SIGTERM 会直接掐断连接池）。
  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();
