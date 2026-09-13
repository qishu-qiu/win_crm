// =============================================================================
// Prisma 数据库服务（M0-46）—— 全进程唯一的 PrismaClient 实例
//
// 口径来源（★ 真相源，勿自造）：
//   · 《过程产出/开发计划-V1.md》M0-46：`src/prisma/prisma.service.ts`（`onModuleInit` → `$connect`）；
//     判据逐字＝「起服后 `$queryRaw select 1` 成功」。
//   · 《销售CRM架构设计说明》V1.1 §5.4：`domain/**` 与业务域**不许** import Prisma ——
//     Client 只允许出现在数据访问层（`*.repository.ts` 与本文所在这类基础设施）。
//   · 《服务端/prisma/README.md》「★ Prisma 7 升级」：**v7 的 `PrismaClient` 必须显式传 driver adapter**
//     （MySQL → `@prisma/adapter-mariadb`；**`@prisma/adapter-mysql2` 这个包不存在**）。
//     即「迁移命令读 `prisma.config.ts`、运行时传 adapter」—— ★ **两处都要 `DATABASE_URL`**。
//
// ★ 为什么自己再读一次 `DATABASE_URL`、而不是「从 `prisma.config.ts` 取」：
//   那两条是**互相独立的链** —— `prisma.config.ts` 只被 prisma CLI 消费（迁移 / diff），
//   v7 起**没有任何 API** 把 config 里的 url 交给运行时。故这里如实重读 `process.env`；
//   入口 `main.ts` 已在其之前 `process.loadEnvFile('.env')`，此处读得到。
//
// ★ 为什么不图省事写成 `new PrismaMariaDb(process.env.DATABASE_URL)`：
//   mariadb 驱动的连接串解析**只认 `mariadb://` scheme**，而本项目（含 `.env.example`）用的是
//   通行的 `mysql://`。故此处**显式解析成 PoolConfig 对象**再交给适配器：
//   ① 不赌驱动对 scheme 的宽容度（那是「本机跑通、换台机就炸」的典型来源）；
//   ② 缺库名 / 协议写错能**当场**报人话，而不是连到一半才炸。
//
// ★ 为什么缺连接串直接抛错、不设默认值：与 `shared.module.ts` 的 `requireJwtSecret` 同一口径 ——
//   一枚「默认连 localhost:3306」的服务一旦被误部署，会把生产流量打到开发者机器上，
//   而这类事故在日志里**看不出任何异常**。宁可起不来。
// =============================================================================
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import type { PoolConfig } from 'mariadb';

import { PrismaClient } from '../generated/prisma/client';

/** MySQL 默认端口：`DATABASE_URL` 未写端口时的兜底 */
const DEFAULT_MYSQL_PORT = 3306;
/** 连接池上限：M0 只有健康检查在打库，10 足够；真调优等压测阶段（勿提前拍脑袋放大） */
const CONNECTION_LIMIT = 10;

/** 取连接串：缺失 / 空白 → 抛错拒绝启动（★ 同 requireJwtSecret 的口径） */
function requireDatabaseUrl(): string {
  const raw = process.env.DATABASE_URL;
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new Error(
      '缺少 DATABASE_URL：请在 服务端/.env 配置形如 mysql://<用户>:<密码>@<主机>:<端口>/<库名> 的连接串（→ 服务端/prisma/README.md）',
    );
  }
  return raw.trim();
}

/** 脱敏：回吐连接串时把 `://用户:密码@` 段抹掉（★ 日志 / 报错绝不出明文口令） */
function maskCredential(raw: string): string {
  return raw.replace(/:\/\/[^:@/]*:[^:@/]*@/, '://***:***@');
}

/**
 * `mysql://` 连接串 → mariadb 驱动的 `PoolConfig`。
 * 失败一律抛「能自证错在哪」的人话（格式 / 协议 / 库名），**不猜默认值**。
 */
export function toPoolConfig(raw: string): PoolConfig {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(
      `DATABASE_URL 不是合法连接串：${maskCredential(raw)}（应形如 mysql://用户:密码@主机:3306/库名）`,
    );
  }

  if (url.protocol !== 'mysql:' && url.protocol !== 'mariadb:') {
    throw new Error(
      `DATABASE_URL 的协议必须是 mysql:// 或 mariadb://，当前为 ${url.protocol}（${maskCredential(raw)}）`,
    );
  }

  const database = url.pathname.replace(/^\//, '');
  if (database === '') {
    throw new Error(
      `DATABASE_URL 缺少库名：${maskCredential(raw)}（应形如 mysql://用户:密码@主机:3306/库名）`,
    );
  }

  return {
    host: url.hostname,
    port: url.port === '' ? DEFAULT_MYSQL_PORT : Number(url.port),
    // 连接串里的用户名 / 口令是百分号编码的（口令含 @ : / 时必须编码），故此处解码
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
    connectionLimit: CONNECTION_LIMIT,
  };
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const poolConfig = toPoolConfig(requireDatabaseUrl());
    super({ adapter: new PrismaMariaDb(poolConfig) });
    // ★ 只打「主机:端口/库名」，绝不回吐整条连接串（含口令）
    this.logger.log(`已装配 Prisma driver adapter：${poolConfig.host}:${poolConfig.port}/${poolConfig.database}`);
  }

  /** 起服时建连 —— ★ M0-46 判据「起服后 $queryRaw select 1 成功」的前置 */
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  /** 关服时释放连接池（配合入口的 `enableShutdownHooks`，否则本钩子不会被触发） */
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
