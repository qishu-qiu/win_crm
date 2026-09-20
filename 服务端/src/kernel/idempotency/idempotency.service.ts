// =============================================================================
// 幂等键存取（D-06 · 2026-09-20 七叔拍板落地）
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM接口API文档》§2.5：「所有**非幂等写操作**请求头带 `Idempotency-Key: <uuid>`；
//     重复同 key → **返回首次结果（200），不重复执行**」（防网络重试导致的双写 / 双领公海）。
//   · 2026-09-20 拍板补齐 §2.5 未定的五条（逐条见 `prisma/migrations/0010_idempotency_key` 头注释）。
//
// 分层约束（架构 §5.4）：kernel 零业务 —— 本文件只做「按作用域**读一行 / 写一行**」，
//   不做任何「命中之后怎么办」的判断（那是 shared 拦截器的活）。
//   `PrismaService`（`src/prisma/`）是基础设施、不属于任何业务域，内核注入它不成环
//   （ESLint 的 kernel 块只禁 `modules/**` 与 `shared/**`，同 `audit.service.ts`）。
//
// ★ 唯一冲突（P2002 / `uk_idem_scope`）**在 `save` 里吞掉**、不冒泡：并发同 key 时
//   另一次请求已经写进去了，本次照常返回即可（取舍见 `save` 方法注释）。
// =============================================================================
import { Injectable, Logger } from '@nestjs/common';

import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PRISMA_UNIQUE_CONFLICT } from '../errors/prisma-error.mapper';

/** 幂等有效期 **24h**（拍板③）：`created_at` 早于此刻的行**视为不存在** */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * 幂等作用域（拍板②）＝ **登录人 × 端点 × key**。
 * ⚠ `endpoint` 是**路由模板**（如 `POST /relations`），不是实际路径 —— 否则 `/relations/5` 与
 *   `/relations/6` 会各占一行，唯一键形同虚设。
 */
export interface IdempotencyScope {
  employeeId: bigint;
  endpoint: string;
  idemKey: string;
}

/** 命中的首次结果 */
export interface IdempotencyHit {
  /** 首次请求的入参指纹（与本次比对：不同 → 409，拍板④） */
  requestHash: string;
  statusCode: number;
  /** 首次出参（handler 原始 `data`；重放时原样返回） */
  responseBody: unknown;
}

@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 查「本作用域在 24h 内有没有首次结果」；**过期行当没有**（拍板③） */
  async find(scope: IdempotencyScope): Promise<IdempotencyHit | null> {
    const row = await this.prisma.idempotencyKey.findFirst({
      where: {
        employee_id: scope.employeeId,
        endpoint: scope.endpoint,
        idem_key: scope.idemKey,
        created_at: { gte: new Date(Date.now() - IDEMPOTENCY_TTL_MS) },
      },
      select: { request_hash: true, status_code: true, response_body: true },
    });
    if (row === null) return null;
    return {
      requestHash: row.request_hash,
      statusCode: row.status_code,
      responseBody: row.response_body,
    };
  }

  /**
   * 落一行首次结果；返回是否真的写进去了。
   *
   * ★ **并发同 key 的取舍**（读之前先读这段）：本实现是「**业务成功后才落库**」，不是「先占位」。
   *   · 好处：**失败请求不占 key**（占位方案要额外写"失败撤销"，撤销本身又会失败）；
   *   · 代价：两个请求同时第一次到 → **两次都真的执行了**，后到者撞 `uk_idem_scope`，
   *     这里吞掉并返回 `false`。客户端**重试**时会拿到先写那一次的结果（正是 §2.5 要的语义）。
   *   ⚠ 真正要防"并发双写"的端点（抢公海）**已有条件 UPDATE**（→ 数据架构 §10.2-3），
   *     不依赖本表 —— 本表防的是**网络重试**这一类串行重复。
   */
  async save(
    scope: IdempotencyScope,
    requestHash: string,
    statusCode: number,
    responseBody: unknown,
  ): Promise<boolean> {
    try {
      await this.prisma.idempotencyKey.create({
        data: {
          employee_id: scope.employeeId,
          endpoint: scope.endpoint,
          idem_key: scope.idemKey,
          request_hash: requestHash,
          status_code: statusCode,
          // ⚠ JSON 列：`undefined` 会被 Prisma 拒绝；要存「JSON 字面量 null」必须显式用 `Prisma.JsonNull`
          //   （直接给 JS `null` 会被当成 `DbNull`，对 NOT NULL 的 JSON 列不合法）
          response_body: (responseBody === null ? Prisma.JsonNull : responseBody) as Prisma.InputJsonValue,
        },
      });
      return true;
    } catch (error) {
      if (isUniqueConflict(error)) {
        // 并发同 key：另一次请求已写入 → 本次不重复写，业务结果照常返回
        this.logger.warn(
          `幂等键并发写入（已存在，本次不落库）：${scope.endpoint} key=${scope.idemKey}`,
        );
        return false;
      }
      throw error;
    }
  }
}

/** 鸭子类型判唯一冲突（**只认 code**，不解析约束名 —— 这里不需要人话） */
function isUniqueConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  return (error as { code?: unknown }).code === PRISMA_UNIQUE_CONFLICT;
}
