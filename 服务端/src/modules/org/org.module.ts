// =============================================================================
// A 域模块（M1-01）—— 组织与权限（第 1 层，只依赖 kernel）
//
// 口径来源（★ 真相源，勿自造）：
//   · 《过程产出/开发计划-V1.md》M1-01：建 `modules/org/` 四层目录 ＋ `org.module.ts`；
//     判据逐字＝「`app.module` import 后起服正常」。
//   · 《销售CRM架构设计说明》V1.3 §5.1：org(A) 是**第 1 层**，只能依赖更低的 `kernel`；
//     它**不许** import 任何业务域（同层 / 更高层），由 ESLint `no-restricted-imports` 硬卡（M0-44 系列）。
//   · 同 §5.2 跨域协作：A 域对外只 exports **service**，**绝不 exports repository**
//     （跨域直连仓储被 ESLint 拦死；此处不 exports 仓储也就无从违反）。
//
// ★ 为什么这里再注册一次 `JwtModule`（`SharedModule` 里已经注册过）：
//   ① `shared/**` 是**横切层**，业务域**不许 import** 它（M0-44c 硬卡）——
//      故 A 域登录签发令牌只能自己装配 `JwtModule`；
//   ② 两处**不是双真相源**：密钥与有效期都取 `kernel/context/jwt-settings.ts`
//      （`requireJwtSecret`）与 `kernel/context/jwt-claims.ts`（`ACCESS_TOKEN_TTL`），
//      kernel 是唯一落点；`registerAsync` 的理由同 shared.module.ts（DI 初始化期才读 .env）；
//   ③ JWT 是**无状态**的：两个 `JwtService` 实例只要同一把密钥，签发与校验天然互通。
//
// ★ `AuditService` 不在本文件 `providers` 里（M1-15 要用它）：
//   它是 kernel 设施，由 `kernel/audit/audit.module.ts` 以 `@Global()` 提供 —— 域只管**注入**，
//   不负责装配内核（否则每个域各造一个实例，「内核设施唯一一份」这条结构事实就摊平了）。
// =============================================================================
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { ACCESS_TOKEN_TTL, requireJwtSecret } from '../../kernel/index';
import { OrgController } from './org.controller';
import { OrgRepository } from './org.repository';
import { OrgService } from './org.service';

@Module({
  imports: [
    // registerAsync（而非 register）：register 在**模块加载期**求值，那时 main.ts 还没 loadEnvFile，
    // 会读到 undefined；registerAsync 的工厂在 **DI 初始化期**执行，.env 已就位。
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: requireJwtSecret(),
        // 默认按**访问令牌**有效期签；刷新令牌在 `OrgService.signTokens` 里显式覆盖为 REFRESH_TOKEN_TTL
        signOptions: { expiresIn: ACCESS_TOKEN_TTL },
      }),
    }),
  ],
  controllers: [OrgController],
  providers: [OrgService, OrgRepository],
  /**
   * 对外只暴露 service（→ §5.2「跨域请走对方 exports 出来的 service」）。
   * ⚠ **不要**把 `OrgRepository` 加进来 —— 跨域直连仓储会让「谁的 SQL 谁负责」这条边界直接消失。
   * 此刻还没有更高层域（B/C/D）来消费它，先按规格留出口，避免将来回头改 A 域。
   */
  exports: [OrgService],
})
export class OrgModule {}
