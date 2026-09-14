// =============================================================================
// 鉴权守卫（M0-32）—— 解 JWT → 填请求上下文
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM接口API文档》V1.13 §2.2：`Authorization: Bearer <access_token>`；
//     §2.4：缺 / 错 Authorization → **401 / 20002**「未认证 / token 失效」。
//   · 《销售CRM架构设计说明》V1.3 §7.1：守卫解析登录凭证后把「当前是谁」塞进上下文 ——
//     即本守卫的**唯一职责**；★ 横切层**只读上下文、不查库**，故「我是谁」全部来自令牌声明
//     （映射契约见 `kernel/context/jwt-claims.ts`），**这里绝不注入 org 域的 service**。
//   · 同 §5.4：`shared/**` 只依赖更低层 —— 本文件只 import `kernel`、`@nestjs/*`。
//   · M0-32 判据：无 token → 401。见 `jwt-auth.guard.spec.ts`。
//
// 注册方式（→ M0-38）：`APP_GUARD` 全局生效（`shared.module.ts`），而非在 main.ts 逐个 useGlobal*，
//   目的是让「守卫 / 拦截器 / 过滤器 / 管道」四件套在**装配层**一处可见、可测（DI 也能注入依赖）。
// =============================================================================
import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';

import { AppError, ContextService, ErrorCode, fromClaims, IS_PUBLIC_KEY } from '../../kernel/index';

/** 鉴权失败的统一人话（→ §2.3：message 是给销售看的；§2.4：401 / 20002） */
const UNAUTHENTICATED_MESSAGE = '未登录或登录已过期';

/**
 * 从 `Authorization` 头里取出 Bearer 令牌；取不到返回 `undefined`。
 * 容忍大小写与多余空白（`bearer` / `Bearer  token`），但**不接受**其他 scheme —— 免得把 Basic 当令牌。
 */
export function extractBearerToken(headerValue: unknown): string | undefined {
  if (typeof headerValue !== 'string') {
    return undefined;
  }
  const matched = /^Bearer\s+(\S+)$/i.exec(headerValue.trim());
  return matched?.[1];
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly contexts: ContextService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(executionContext: ExecutionContext): boolean {
    // ① 免鉴权白名单（登录 / 刷新 token / 健康检查）：类级或方法级任一标注即放行
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      executionContext.getHandler(),
      executionContext.getClass(),
    ]);
    if (isPublic === true) {
      return true;
    }

    // ② 非 HTTP（Worker 定时任务 / 应用启动期）：没有「请求」可鉴权，守卫不该拦死进程。
    //    Worker 侧要「有人」的场景由各任务显式造系统上下文（→ kernel/context/request-context.ts）。
    if (executionContext.getType() !== 'http') {
      return true;
    }

    const request = executionContext.switchToHttp().getRequest<{ headers?: Record<string, unknown> }>();
    const token = extractBearerToken(request.headers?.authorization);

    // ③ 判据：无 token → 401 / 20002（缺头与坏 token **对外同一句人话**，细节只进 constraint 供排错）
    if (token === undefined) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 401, UNAUTHENTICATED_MESSAGE, {
        constraint: '缺少 Authorization: Bearer 请求头',
      });
    }

    // ④ 验签 + 有效期由 JwtService 负责（密钥来自 JWT_SECRET，见 shared.module.ts）
    let payload: unknown;
    try {
      payload = this.jwt.verify(token);
    } catch (error) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 401, UNAUTHENTICATED_MESSAGE, {
        constraint: '令牌验签或有效期校验未通过',
        cause: error,
      });
    }

    // ⑤ 判据：「解 JWT → 填 context」。声明形状非法时 fromClaims 抛 401（令牌的错，不是服务端 500）
    this.contexts.set(fromClaims(payload));
    return true;
  }
}
