// =============================================================================
// B 域模块（M2-01 · 客户资产与公司档案）
//
// 口径来源（★ 真相源，勿自造）：
//   · 《开发计划-V1》M2-01 判据：建 `modules/company/` 四层（controller / service / domain /
//     repository）＋ `company.module.ts`，**`app.module` import 后起服正常**。
//   · 《销售CRM架构设计说明》V1.3 §5.2：`company (B)` 是**第 2 层**，**只能依赖更低的 `kernel`**
//     —— 不许 import `org(A)`（第 1 层）以外的任何业务域，也不许 import `shared/**`。
//   · 同 §四 目录树：`modules/company/` ＝ 「客户资产」这一域的落点（`→架构文档` 域 B）。
//
// ★ 本文件当前**刻意是空的**（没有 controller / provider）：M2-01 只要求「骨架立起来且装配得上」，
//   真正的 controller / service / repository 随 M2-02 起逐个进来 —— 一次性把空壳 provider 全声明了，
//   等于**先写实现再想接口**，与「先竖切一条能跑的最小线」的开工口径相反。
//   **四层目录已按 M2-01 建好**：`domain/`（已落 `contact-phone.ts`，M2-07）、
//   `dto/`、`*.controller.ts`、`*.service.ts`、`*.repository.ts` 随后续任务落位。
// =============================================================================
import { Module } from '@nestjs/common';

@Module({})
export class CompanyModule {}
