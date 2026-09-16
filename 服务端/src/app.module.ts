// =============================================================================
// Web 根模块（M0-49；M1-01 起逐域接入）—— 一处看清「这个进程装了哪些东西」
//
// 口径来源（★ 真相源，勿自造）：
//   · 《过程产出/开发计划-V1.md》M0-49：`app.module.ts`（**组装 kernel ＋ shared ＋ prisma**）；
//     判据逐字＝「`start:web` 起且 `/docs` 有」。
//     ★ M1-01 判据：`modules/org`（`OrgModule`）被本文件 import 后**起服正常**。
//   · 《销售CRM架构设计说明》§四 目录树：`app.module.ts` ＝ Web 组装全部域的那一层。
//     ⚠ 七域（`modules/*`）自 M1 起逐个进来；M1 只到 A 域（org）。
//
// ★ 各 import 的角色（顺序＝依赖方向，别写反）：
//   ① `ContextModule` —— kernel 的请求上下文（`@Global`）：当前人 / 角色 / 管辖部门 / 数据范围，横切层与业务域都读它；
//      同组还有 `EventBusModule`（M4-11）：进程内领域事件总线（`@Global`，**全进程唯一实例**）——
//      C 域发 `RelationCreated`、D 域收并落首条建档事件（架构 §5.3）。
//   ② `PrismaModule`  —— 数据库访问（`@Global`）：**只有数据访问层该注入它**（`domain/**` 与业务域禁碰，ESLint 硬卡）；
//   ③ `AuditModule`   —— 审计留痕（`@Global`，M1 补齐）：敏感动作要在**业务事务内**写 `operation_log`（§7.4）；
//   ④ `SharedModule`  —— 横切四件套：靠 `APP_GUARD / APP_INTERCEPTOR / APP_FILTER / APP_PIPE` **全局生效**。
//      ⚠ 业务域**不许 import 它**（M0-44c 硬卡），所以「挂上去」这件事只能在根模块发生 —— 本行即唯一入口。
//   ⑤ `OrgModule`     —— 第 1 层业务域（A 域 / 组织与权限）：登录 / 刷新 / me ＋ 四个组织只读接口。
//   ⑥ `CompanyModule` —— 第 2 层业务域（B 域 / 客户资产）：**M2 起逐个接入**（M2-01 先立骨架）。
//   ⑦ `RelationModule`—— 第 3 层业务域（C 域 / 业务关系）：**M3 接入** —— 私海 / 公海列表、
//      激活（撞单 409）、改属性（非灰度必标开发价值）、成员（一关系一 owner）。
//   ⑧ `EngineModule`  —— 第 4 层业务域（D 域 / 跟单引擎）：**M4 接入** —— 跟单事件（有效沟通
//      vs 快速标记）、承诺、工作台。⚠ M4-01 只建骨架（**无 controller**，M4-12 才挂接口）。
//
// · `ContextModule` 内部已被 `SharedModule` import（为让横切层自给自足）。此处**再显式列一次**：
//   Nest 按**模块类**去重，不会产生第二个实例，但能让「本进程装了 kernel」在根模块**一眼可见**
//   —— 符合「装配知识一处可见」的口径（同 shared.module.ts 用 APP_* 令牌而非 useGlobalXxx 的理由）。
//
// · Worker 的根模块是**另一个**（`worker.module.ts`，M7-01）：jobs 只被 Worker 加载，
//   别把定时任务挂到这里 —— 否则 Web 多开几份就会重复执行（架构说明 §六）。
// =============================================================================
import { Module } from '@nestjs/common';

import { HealthController } from './health/health.controller';
import { AuditModule, ContextModule, EventBusModule } from './kernel/index';
import { CompanyModule } from './modules/company/company.module';
import { EngineModule } from './modules/engine/engine.module';
import { OrgModule } from './modules/org/org.module';
import { RelationModule } from './modules/relation/relation.module';
import { PrismaModule } from './prisma/prisma.module';
import { SharedModule } from './shared/shared.module';

@Module({
  imports: [
    ContextModule,
    EventBusModule,
    PrismaModule,
    AuditModule,
    SharedModule,
    OrgModule,
    CompanyModule,
    RelationModule,
    EngineModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
