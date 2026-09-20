// =============================================================================
// 写端点留痕「覆盖自检」（M5-07 · 2026-09-15）
//
// 为什么要有这个文件：七叔口径是「**所有**增删改都有迹可查」—— 收口靠切面（一处写），
//   但「哪个端点是增删改、叫什么动作名」是**逐个 controller 声明**的。
//   人会忘标 → 本用例**机械地**把「已建的写端点」全扫一遍，**漏标即红**。
//   （同 `M0-45` 的「故意越界 import → lint 必须报错」一个思路：把纪律变成可执行断言。）
//
// 判据（缺一不可）：
//   ① 每个写端点（POST/PUT/PATCH/DELETE）**必须显式**`@Audit('模块.动词')` 或 `@AuditSkip()`；
//   ② 写端点总数**不许为 0**（扫描逻辑写坏了要当场红，而不是"空跑全绿"）；
//   ③ `@AuditSkip()` 只允许出现在**语义是读**的端点上 —— 本文件按端点清单钉死，改一个就得改这里。
// =============================================================================
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';

import { isAuditSkipped, readAuditMeta } from '../kernel/index';
import { CompanyController } from '../modules/company/company.controller';
import { EngineController } from '../modules/engine/engine.controller';
import { OrgController } from '../modules/org/org.controller';
import { RelationController } from '../modules/relation/relation.controller';
import { SeaController } from '../modules/sea/sea.controller';

/** 属于「增删改」的 HTTP 方法（与 `AuditLogInterceptor` 同一口径） */
const WRITE_METHODS: readonly RequestMethod[] = [
  RequestMethod.POST,
  RequestMethod.PUT,
  RequestMethod.PATCH,
  RequestMethod.DELETE,
];

/** 已建的全部 controller（新增域时**必须**加进来，否则本自检形同虚设） */
const CONTROLLERS = [
  OrgController,
  CompanyController,
  RelationController,
  EngineController,
  SeaController,
];

/**
 * 允许 `@AuditSkip()` 的端点白名单（`METHOD PATH`）——**只放语义是读的写方法**：
 *   · `POST /companies/search-dup`：撞库查重（只查、不改库）
 *   · `POST /account/login`：**已有专门审计**（成功 / 凭据错 / 账号不可登录 三条＋detail）
 *   · `POST /account/refresh`：刷新令牌（不是增删改，不动业务数据）
 */
const SKIP_ALLOWLIST = new Set([
  'POST /companies/search-dup',
  'POST /account/login',
  'POST /account/refresh',
]);

interface WriteEndpoint {
  readonly key: string;
  readonly hasAction: boolean;
  readonly skipped: boolean;
}

/** 扫一个 controller 上的写端点及其留痕标记 */
function writeEndpointsOf(controller: new (...args: never[]) => unknown): WriteEndpoint[] {
  const found: WriteEndpoint[] = [];
  for (const name of Object.getOwnPropertyNames(controller.prototype)) {
    const handler: unknown = (controller.prototype as Record<string, unknown>)[name];
    if (typeof handler !== 'function') continue;

    const method: unknown = Reflect.getMetadata(METHOD_METADATA, handler);
    if (typeof method !== 'number' || !WRITE_METHODS.includes(method)) continue;

    const path: unknown = Reflect.getMetadata(PATH_METADATA, handler);
    found.push({
      // Nest 的 `PATH_METADATA` **不带前导斜杠**（`@Post('companies')` → `companies`），
      // 这里补上，让 key 长得像真实路由（白名单清单更好读）
      key: `${RequestMethod[method]} /${typeof path === 'string' ? path : ''}`,
      hasAction: readAuditMeta(handler) !== undefined,
      skipped: isAuditSkipped(handler),
    });
  }
  return found;
}

const ALL_ENDPOINTS: WriteEndpoint[] = CONTROLLERS.flatMap((controller) =>
  writeEndpointsOf(controller),
);

describe('M5-07 写端点留痕覆盖自检（七叔口径：所有增删改都有迹可查）', () => {
  it('扫到了写端点（防止扫描逻辑写坏 → 空跑全绿）', () => {
    expect(ALL_ENDPOINTS.length).toBeGreaterThanOrEqual(11);
  });

  it('每个写端点都**显式**标了 `@Audit(...)` 或 `@AuditSkip()`（漏标即红）', () => {
    const unmarked = ALL_ENDPOINTS.filter((endpoint) => !endpoint.hasAction && !endpoint.skipped);
    expect(unmarked.map((endpoint) => endpoint.key)).toEqual([]);
  });

  it('标了 `@Audit(...)` 的端点必须带动作名（兜底名 `http.*` 只用于**意外**漏标的保险）', () => {
    const labelled = ALL_ENDPOINTS.filter((endpoint) => !endpoint.skipped);
    expect(labelled.length).toBeGreaterThan(0);
    expect(labelled.every((endpoint) => endpoint.hasAction)).toBe(true);
  });

  it('`@AuditSkip()` 只出现在白名单端点（不许拿它图省事跳过真正的写操作）', () => {
    const skippedKeys = ALL_ENDPOINTS.filter((endpoint) => endpoint.skipped).map(
      (endpoint) => endpoint.key,
    );
    expect(new Set(skippedKeys)).toEqual(SKIP_ALLOWLIST);
  });
});
