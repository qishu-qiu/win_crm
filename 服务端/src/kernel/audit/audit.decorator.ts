// =============================================================================
// `@Audit('模块.动词')` / `@AuditSkip()` —— 写操作留痕标记（M5-07 · 2026-09-15）
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM架构设计说明》§7.4：**所有增删改**都要留痕（2026-09-15 七叔口径：
//     「符合等保标准，所有的增删改都有迹可查」）—— 实现方式＝**统一审计切面**
//     （→ `shared/interceptors/audit-log.interceptor.ts`），**不许在每个 service 里各写一遍**
//     （那正是 §七 首段「散在 ~80 个接口里各写一遍，必然有漏的」）。
//   · 《销售CRM数据架构文档》V1.32 A10：`action` 统一编码 `模块.动词`
//     （例：`approval.approve` / `event.create` / `sea.phone.view`）；
//     `target_type / target_id` 记「对什么对象」。
//   · 《销售CRM业务需求文档》§4.2 ★ ＋ §4.3 三：管理员「每次查看写 `operation_log`」——
//     查看**不走本标记**（GET 不在切面范围），走 D 域 service 里的 `recordStandalone`。
//
// ★ 为什么标记住在 `kernel/`（与 `@Public()` / `@DesensitizeExempt()` 同一理由）：
//   它是**业务域 controller 要 import 的东西**，而 §5.4 硬卡「域只许引 `kernel/**`、禁 `shared/**`」
//   （→ `public.decorator.ts` 文件头 ★ 段）。放 kernel 就不必给边界规则开洞。
//
// ★ 白名单式（★ 别改成"默认不记"）：
//   **写方法默认留痕**（切面按 HTTP 方法判定）；本标记只用来①**给动作起名**、②**声明对象类型**、
//   ③（`@AuditSkip()`）**显式豁免**语义上是读的接口（如 `POST /companies/search-dup`）。
//   即：**忘标 = 仍留痕（用兜底名 `http.post`），不会漏审计**；漏标由 `audit-coverage` 自检抓出来。
// =============================================================================
import { type CustomDecorator, SetMetadata } from '@nestjs/common';

/** 动作元数据键（切面用 `readAuditMeta` 读，**不许在别处再写一遍这个字符串**） */
export const AUDIT_ACTION_KEY = 'audit:action';

/** 豁免元数据键（`@AuditSkip()`） */
export const AUDIT_SKIP_KEY = 'audit:skip';

/** 一个写端点的留痕元信息 */
export interface AuditMeta {
  /** `模块.动词`（A10 口径） */
  readonly action: string;
  /** 操作对象类型（A10 `target_type`，如 `business_relation` / `company`）；缺省则由切面留空 */
  readonly targetType?: string;
}

/**
 * 标一个写端点的留痕动作名（→ A10 `action`）。
 *
 * 用法：`@Audit('relation.activate', 'business_relation')`
 * ★ 动作名一旦发布就是**契约**：只增不改（改名＝历史审计再也查不到），故一律走各域的
 *   `*_AUDIT_ACTIONS` 常量（同 `ORG_AUDIT_ACTIONS` 先例），**不在装饰器里写裸字符串**。
 */
export function Audit(action: string, targetType?: string): CustomDecorator {
  return SetMetadata(AUDIT_ACTION_KEY, {
    action,
    ...(targetType === undefined ? {} : { targetType }),
  });
}

/**
 * 显式声明「本写方法**不是**增删改」——切面跳过留痕。
 *
 * ★ 只给**语义上是读**的 POST 用（如撞库查重 `POST /companies/search-dup`），
 *   以及**已有专门审计**的端点（登录：含失败分支与 detail，见 `org.service.ts`，
 *   再让切面写一条就是同一动作两条记录）。**不许拿它图省事跳过真正的写操作。**
 */
export function AuditSkip(): CustomDecorator {
  return SetMetadata(AUDIT_SKIP_KEY, true);
}

/** 读 handler 上的留痕动作名；未标 / 形状不对 → `undefined`（切面改用兜底名，**不静默不漏**） */
export function readAuditMeta(handler: unknown): AuditMeta | undefined {
  if (handler === null || (typeof handler !== 'function' && typeof handler !== 'object')) {
    return undefined;
  }
  const meta: unknown = Reflect.getMetadata(AUDIT_ACTION_KEY, handler);
  if (typeof meta !== 'object' || meta === null) return undefined;
  const action = (meta as { action?: unknown }).action;
  if (typeof action !== 'string' || action === '') return undefined;
  const targetType = (meta as { targetType?: unknown }).targetType;
  return {
    action,
    ...(typeof targetType === 'string' && targetType !== '' ? { targetType } : {}),
  };
}

/** 读 handler 上的豁免标记；只有显式 `true` 才算豁免（与 `@Public()` / `@DesensitizeExempt()` 同款） */
export function isAuditSkipped(handler: unknown): boolean {
  if (handler === null || (typeof handler !== 'function' && typeof handler !== 'object')) {
    return false;
  }
  return Reflect.getMetadata(AUDIT_SKIP_KEY, handler) === true;
}
