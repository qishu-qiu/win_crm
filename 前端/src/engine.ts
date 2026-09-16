/**
 * 行动引擎的展示映射（与 `relation.ts` 同款：**只做「码 → 中文」**，不含任何业务判断）。
 *
 * 口径来源（★ 真相源，勿自造）：
 *   · 动作类型 / 结果码 →《销售CRM数据架构文档》D2（`action_event`）。
 *   · 承诺三型 / 状态 → 同 D1（`commitment`）。
 *   · 动线来源 `ref_type` → 同 D4（`daily_agenda`）。
 *
 * ★ 为什么映射表放前端：这些是**展示文案**（与 `relation.ts` 里的阶段名 / 紧迫档同性质），
 *   服务端出的是英文码；**服务端不返回中文**，前端不自己发明码。
 *   ⚠ 字典域（`dict_item`）落地后，这里的常量应改为**读字典** —— 届时删掉本文件的表，
 *     不要在两边各留一份（双真相源）。
 */

/** 动作类型（→ D2 `action_type`，11 种） */
const ACTION_TYPE_NAMES: Record<string, string> = {
  phone: '电话',
  wechat: '微信',
  visit: '拜访',
  onsite: '现场',
  email: '邮件',
  meal: '请客',
  gift: '送礼',
  greeting: '节点问候',
  ask_help: '@求助',
  note: '备注',
  system: '系统',
}

/** 结果码（→ D2 `outcome`：三种有效沟通 ＋ 三种快速标记） */
const OUTCOME_NAMES: Record<string, string> = {
  advanced: '有进展',
  stalled: '卡住',
  await_reply: '等回复',
  not_contacted: '未联系',
  no_answer: '未接电话',
  brief_hangup: '说两句挂了',
}

/** 承诺三型（→ D1 `party` / 需求 §10.1） */
const COMMITMENT_PARTY_NAMES: Record<string, string> = {
  me: '我答应客户',
  them: '客户答应我',
  verdict: '我定的判定点',
}

/** 承诺状态（→ D1 `status`） */
const COMMITMENT_STATUS_NAMES: Record<string, string> = {
  open: '进行中',
  done: '已兑现',
  expired: '已逾期',
  waived: '已豁免',
  cancelled: '已取消',
}

/** 动线条目来源（→ D4 `ref_type`） */
const REF_TYPE_NAMES: Record<string, string> = {
  commitment: '承诺',
  appointment: '预约',
  cadence: '节奏提醒',
  relation: '掉海提醒',
}

/** 动线处理状态（→ D4 `daily_agenda.status`；列表只会来 `open` / `snoozed`，`done` / `ignored` 不再推） */
const AGENDA_STATUS_NAMES: Record<string, string> = {
  open: '待办',
  done: '已办',
  snoozed: '已推明天',
  ignored: '已忽略',
}

/** 通用：查表取中文，查不到**原样返回码**（不编一个像中文的东西） */
function nameOf(table: Record<string, string>, code: string): string {
  return table[code] ?? code
}

export function actionTypeNameOf(code: string): string {
  return nameOf(ACTION_TYPE_NAMES, code)
}

export function outcomeNameOf(code: string | null): string {
  if (code === null || code === '') return '—'
  return nameOf(OUTCOME_NAMES, code)
}

export function commitmentPartyNameOf(code: string): string {
  return nameOf(COMMITMENT_PARTY_NAMES, code)
}

export function commitmentStatusNameOf(code: string): string {
  return nameOf(COMMITMENT_STATUS_NAMES, code)
}

export function refTypeNameOf(code: string): string {
  return nameOf(REF_TYPE_NAMES, code)
}

export function agendaStatusNameOf(code: string): string {
  return nameOf(AGENDA_STATUS_NAMES, code)
}

/** 时间线卡片的分线（→ D2 / 接口 §5.7 `branch`：`main`＝该关系 owner 写的） */
export function branchNameOf(branch: string): string {
  return branch === 'main' ? '主线' : '树杈'
}

/** 写跟单时可选的**有效沟通**结果（快速标记走另一条路径，本页不做批量标记） */
export const EFFECTIVE_OUTCOME_OPTIONS = ['advanced', 'stalled', 'await_reply'] as const

/** 写跟单时可选的**快速标记**结果（三型，点一下即可、不强制写字） */
export const QUICK_MARK_OUTCOME_OPTIONS = ['not_contacted', 'no_answer', 'brief_hangup'] as const

/** 写跟单可选的动作类型（全部 11 种 → D2） */
export const ACTION_TYPE_OPTIONS = Object.keys(ACTION_TYPE_NAMES)

/** 建承诺可选的类型（→ D1 `ctype`，9 种；`social_*` 为客情类） */
export const COMMITMENT_CTYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'reply', label: '回话' },
  { value: 'quote', label: '报价' },
  { value: 'meet', label: '见面' },
  { value: 'deliver', label: '交付资料' },
  { value: 'decision', label: '给结论' },
  { value: 'followup', label: '跟进' },
  { value: 'social_meal', label: '客情·请客' },
  { value: 'social_gift', label: '客情·送礼' },
  { value: 'social_greeting', label: '客情·问候' },
]

/** 建承诺可选的承诺人（三型，→ 需求 §10.1） */
export const COMMITMENT_PARTY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'me', label: '我答应客户（催自己）' },
  { value: 'them', label: '客户答应我（催客户）' },
  { value: 'verdict', label: '我定的判定点（给结论）' },
]
