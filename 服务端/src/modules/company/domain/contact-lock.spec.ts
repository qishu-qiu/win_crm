// =============================================================================
// 联系人「锁」可见性用例（M5-04 判据）
//
// 判据逐字（《开发计划-V1》）：
//   M5-04「…**被 owner 上锁时给 `phone_locked`**」
//   验收方式原文是 curl 举证（列表打码 / 详情全号 / 上锁后非 owner 只见 `phone_locked`）——
//   ⚠ **联系人详情接口本批尚未建**（`GET /contacts/:id` 不在 M5 计划内），故列表侧的真判定
//     用本文件（规则）＋ `company.service.spec.ts`（出口装配）两层钉住；
//     「详情不给 `phone`、`extra_phones` 一并隐藏」的落点随详情接口一起落地（已登记 → 交接说明「欠账」）。
//
// ★ 只有真函数、没有假件（domain 层不查库、不 import 框架）。
// =============================================================================
import { isPhoneLockedForViewer } from './contact-lock';

const ME = 7n;
const LOCKER = 3n;
const AT = new Date('2026-09-15T10:00:00+08:00');

describe('联系人「锁」可见性（→ 需求 §4.3 二 / 数据架构 §十一 ①）', () => {
  it('未上锁（`phone_locked_at` NULL）→ 不锁：**与查看者是谁无关**（默认全可见）', () => {
    expect(isPhoneLockedForViewer({ phone_locked_at: null, phone_locked_by: null }, ME)).toBe(false);
    expect(isPhoneLockedForViewer({ phone_locked_at: null, phone_locked_by: LOCKER }, ME)).toBe(false);
  });

  it('已上锁 ＋ 查看者**是落锁人**（＝上锁时的归属 owner）→ 不锁，他自己的号照常可见', () => {
    expect(isPhoneLockedForViewer({ phone_locked_at: AT, phone_locked_by: LOCKER }, LOCKER)).toBe(false);
  });

  it('已上锁 ＋ 查看者**不是落锁人** → 锁（**同部门同事也一样**：锁是全局的，→ §4.3 二）', () => {
    expect(isPhoneLockedForViewer({ phone_locked_at: AT, phone_locked_by: LOCKER }, ME)).toBe(true);
  });

  it('`at` 有值但 `by` 为空（数据异常）→ **从严**当作对所有人都锁，不因缺字段放行', () => {
    expect(isPhoneLockedForViewer({ phone_locked_at: AT, phone_locked_by: null }, ME)).toBe(true);
  });

  it('函数只吃「锁的事实 ＋ 查看者」两个入参：**不需要库、不需要上下文**（B 域查询时带出）', () => {
    expect(isPhoneLockedForViewer.length).toBe(2);
  });
});
