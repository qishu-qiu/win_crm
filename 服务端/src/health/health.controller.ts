// =============================================================================
// 健康检查（M0-50）—— 全项目唯一一个「真的打库」的接口
//
// 口径来源（★ 真相源，勿自造）：
//   · 《过程产出/开发计划-V1.md》M0-50：`GET /health`（**真查库**后返回 ok）；
//     判据逐字＝「`curl /health` → 统一包且 `data.ok=true`」—— 故出参**必须**含 `ok: true`。
//
// ★ 为什么非「真查库」不可、直接 return 一个静态 ok 不行：
//   静态 JSON 在数据库挂掉时**照样返回 200**，那这个接口就只是自我安慰 ——
//   探活的价值恰恰在于把「进程活着」与「依赖可用」分开报。故真跑一次 `SELECT 1`。
//
// ★ `@Public()` 是必需品、不是顺手加的：守卫自 M0-38 起**全局生效**（`APP_GUARD`），
//   而探活 / 负载均衡**不可能**带 token，不豁免就会被 401 挡在门外（豁免口口径见 kernel/context/public.decorator.ts）。
//
// ⚠ 查库结果**刻意不直接回吐**：`$queryRaw` 的返回值可能含 BigInt（本库主键即 BigInt），
//   直接交给 JSON.stringify 会抛 "Do not know how to serialize a BigInt"。
//   此处只用它证明链路通，对外只给稳定的布尔 / 字符串。
// =============================================================================
import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';

import { Public } from '../kernel';
import { PrismaService } from '../prisma/prisma.service';

/**
 * `/health` 出参。
 * ⚠ 必须是 **class**（不能是 interface）：接口在运行时不留类型信息，Swagger 生不出 schema。
 */
export class HealthDto {
  @ApiProperty({ description: '服务可用', example: true })
  ok!: boolean;

  @ApiProperty({ description: '数据库连通状态（真跑了一次 SELECT 1）', example: 'up' })
  db!: string;
}

@ApiTags('系统')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: '健康检查',
    description: '真查库一次（SELECT 1）后返回；数据库不可用时由异常过滤器统一收口为失败包',
  })
  @ApiOkResponse({ type: HealthDto })
  async check(): Promise<HealthDto> {
    await this.prisma.$queryRaw`SELECT 1`;
    return { ok: true, db: 'up' };
  }
}
