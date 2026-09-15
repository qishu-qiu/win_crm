// =============================================================================
// 脱敏拦截器（M0-37 立 · **M5-04 / M5-06 起职责定稿**）
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM架构设计说明》V1.3 §7.3 脱敏渲染（**出口统一处理**）＋ §7.1（横切层**只读上下文、不查库**）。
//   · 《销售CRM业务需求文档》V1.27 §4.3：联系方式（默认全可见 ＋ 联系人可上锁）· 跟单全文（跨部门互不可见）·
//     金额（跨业务线脱敏）· ★ **报表 / 看板 / 汇总不脱敏**（经理 / 老板出口，2026-09-11 定）。
//   · 《销售CRM数据架构文档》V1.32 §十一 ＋《接口API文档》V1.18 §2.8：字段级**出参形态**。
//   · ⚠ **2026-09-14 口径已整体重写**（→《废止口径登记表》#30）：联系方式**不再按角色 / 场景分档脱敏**，
//     改为「**详情默认全可见 ＋ 联系人可上锁**」（列表 / 卡片给 `phone_masked`、详情给全号、
//     被 owner 上锁且查看者非 owner 时给 `phone_locked` 不给号）。**别再照本文件旧注释里
//     「销售看他人私海才脱敏」那套写。**
//
// ★ **本类不是「逐字段改写出参」的地方** —— 这是 M5 开工时定的口径（2026-09-15，与
//   `data-scope.interceptor.ts` 同一次定稿）：
//   本类挂在 Nest 的**响应式管道**上，只看得见请求与最终的 Observable。「这条记录属于谁 /
//   我能不能看这个号」**只有业务查询时才知道**（锁要读 `contact.phone_locked_*`、金额要读关系归属部门），
//   在这里按**字段名**猜规则，等于把「哪张表哪个字段该怎么脱敏」再写一遍 ＝ 第二真相源（→ 踩坑 #9）。
//   真正的收口点是另外两处：
//     ① **判定规则** ＝ `kernel/common/desensitize.ts`（跨业务线按部门判，M5-05）
//        ＋ 各域 `domain/`（本域私有规则，如 B 域联系人「锁」的可见性）；
//     ② **出口渲染** ＝ 各域 service 组装出参时按规则填（列表给 `phone_masked`、详情给 `phone`）。
//
// ★ 故本类只做**能验证且不会返工**的两件事：
//   ① **出口豁免**（M5-06）：controller 标 `@DesensitizeExempt()`（报表 / 看板 / 汇总）→ 读到标记
//      **原样放行**，并把标记**打标到请求上**（供出口侧 / 审计 / 测试用**同一把键**取；
//      键名与读法唯一落点＝ `kernel/context/desensitize-exempt.decorator.ts`）；
//   ② **不做「越权兜底」的假动作**：越界访问统一 **403 / 20003** 的落点是**数据范围**（M5-01/08）
//      ＋ 各域出口的身份判定（如 B 域 `requireOperatorId()` → 401）。本层**不猜、不兜底、不放行式补全**
//      —— 写一段「看起来在工作」的兜底代码，只会让下个窗口以为「越权已经有人管了」。
//
// ★ 三条硬约束（写在文件里，比写在文档里更难被绕过）：
//   ① 本文件**永不注入 Prisma / repository**（§7.1 横切层不查库）；
//   ② 判断「记录属于谁」**不许查库** —— 需要归属信息时，由业务侧在查询阶段一并带出；
//   ③ **零构造依赖**：读元数据直接用 `Reflect.getMetadata`，**不注入 `Reflector`**
//      （spec 钉死构造参数个数＝0：少一个依赖，装配时就少一处能坏的地方 —— 踩坑 #31 的同类防线）。
// =============================================================================
import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import { type Observable } from 'rxjs';

import {
  DESENSITIZE_EXEMPT_REQUEST_KEY,
  isDesensitizeExempt,
} from '../../kernel/index';

@Injectable()
export class DesensitizeInterceptor implements NestInterceptor {
  intercept(executionContext: ExecutionContext, next: CallHandler): Observable<unknown> {
    // 非 HTTP（Worker）：Worker 出口不经横切层，直接放行（与 `data-scope.interceptor.ts` 同口径）
    if (executionContext.getType() !== 'http') {
      return next.handle();
    }

    // ★ M5-06 出口豁免：读**方法级**元数据（豁免是逐个出口的性质，不是整个 controller）
    const exempt = isDesensitizeExempt(executionContext.getHandler());
    if (exempt) {
      const request = executionContext.switchToHttp().getRequest<Record<string, unknown>>();
      request[DESENSITIZE_EXEMPT_REQUEST_KEY] = true;
    }

    // 豁免与非豁免**都原样放行**：非豁免出口的脱敏在**各域 service 组装出参时**完成（见文件头 ① ②）。
    // ⚠ 这里**不做任何字段改写** —— 本层拿不到「记录属于谁」，强行改写会造出第二套脱敏口径。
    return next.handle();
  }
}
