import { computed, ref, watch } from 'vue'
import { ConfigProvider, theme as antdTheme, type ConfigProviderProps } from 'ant-design-vue'

/**
 * 主题（白天 / 夜间）—— **本项目「外观」的唯一落点**（M6-11）。
 *
 * 口径来源（★ 真相源，勿自造）：
 *   · 《销售CRM设计规范》§一.5：全部数值编译为 CSS 变量（`--crm-*`）挂根节点，
 *     **V1 主题 ＝ light（白天，默认）/ dark（夜间）两套**，切换只换变量值、**不改组件**；
 *   · §八：入口在《前端页面与交互文档》**页 28**（`/me/appearance`）；公司只锁**默认值**（light）、
 *     **全员可自由切**；夜间不用纯黑底、语义色在深底上要仍达 AA；
 *   · §九 视觉验收：「白天 / 夜间两套**生效**、个人外观**持久化**」。
 *
 * ★ 三件事各在一处（**别混**）：
 *   ① **变量值**（哪个主题什么颜色）→ `styles/tokens.css`（`[data-theme='dark']` 块，唯一数值落点）；
 *   ② **谁在什么时候挂 `data-theme`** → 本文件（唯一开关，页面与顶栏都调 `setTheme`）；
 *   ③ **首屏不闪烁** → `index.html` 的内联预置脚本（Vue 还没起来就得先把主题定下来）。
 *
 * ★ 为什么要给 AntD 传 token（见文末 `antdThemeConfig`）：AntD 组件（表格 / 抽屉 / 按钮 / 弹层…）
 *   的观感由它自己的 `algorithm` ＋ token 决定 —— **光换 `--crm-*` 变量，它们不会变黑**。
 *   故这里把 tokens.css 的**计算值原样读出来**喂给它：数值仍只有一个落点，本文件只"搬运"。
 *
 * ★ 持久化现状：本轮存**浏览器本地**（`crm_theme`）。规格 §八 写的是「存账号」，
 *   对应接口 §4.14.9 的 `PUT /account/preferences {theme}` —— 该端点**服务端尚未实现**，
 *   且《数据架构文档》里没有 theme 字段的落点（→《欠账登记表》D-37）。**别在前端自造账号侧存储**。
 */

/** 主题码（＝接口 §4.14.9 的取值，也是规格 §八 的两套） */
export type ThemeName = 'light' | 'dark'

/** 默认主题（→ 设计规范 §八.1「公司只锁默认值（默认 light）」） */
export const DEFAULT_THEME: ThemeName = 'light'

/**
 * 本地持久化键。
 * ⚠ **必须与 `index.html` 内联脚本里的 `crm_theme` 一致** —— 「Vue 起来之前也要能读」逼出了
 *   这两处同名，改一处必须改另一处（不一致的表现＝刷新后主题回默认）。
 */
export const THEME_STORAGE_KEY = 'crm_theme'

/** 主题挂载点：`<html data-theme="light|dark">`（tokens.css 的 dark 块就按这个选择器命中） */
export const THEME_ATTR = 'data-theme'

/** 页 28 的切换项（文案逐字取设计规范 §八 的「白天 / 夜间」） */
export const THEME_OPTIONS: ReadonlyArray<{ value: ThemeName; label: string }> = [
  { value: 'light', label: '白天' },
  { value: 'dark', label: '夜间' },
]

/** 非白即夜：只认 `dark`，其余（含 null / 脏值）一律回白天 —— 免得脏数据把页面卡在"无主题" */
function normalize(value: string | null): ThemeName {
  return value === 'dark' ? 'dark' : DEFAULT_THEME
}

/**
 * 起始值取**已经挂在根节点上的那个**（`index.html` 内联脚本已按本地存储设好），
 * **不再重复读一次 localStorage** —— 这样"首屏画出来的主题"与"Vue 认的主题"永远是同一个；
 * 否则会出现"页面是夜间的、状态却是白天"（下一次任何交互就把页面翻回白色＝闪烁）。
 * 内联脚本没跑（被 CSP 拦 / 文件被改）时才自己读一次存储兜底。
 */
function bootstrapTheme(): ThemeName {
  const applied = document.documentElement.getAttribute(THEME_ATTR)
  if (applied === 'light' || applied === 'dark') return applied
  try {
    return normalize(localStorage.getItem(THEME_STORAGE_KEY))
  } catch {
    return DEFAULT_THEME
  }
}

/** 当前主题（**唯一一份**，→ 页 28 与顶栏入口都读它） */
export const theme = ref<ThemeName>(bootstrapTheme())

/** 是否夜间（页面只据此选选中项，**不做别的判断**） */
export const isDark = computed(() => theme.value === 'dark')

/**
 * 切换主题 —— **唯一入口**。
 * 顺序有意义：先改根节点属性（DOM 立刻生效）**再**改 `theme.value`（触发 AntD token 重算），
 * 反过来的话 AntD 会按旧变量值取一次色，出现"底色变了、组件还是旧色"的一帧。
 */
export function setTheme(name: ThemeName): void {
  const next = normalize(name)
  const root = document.documentElement
  root.setAttribute(THEME_ATTR, next)
  // 让浏览器**原生**部分跟随（滚动条 / 日期面板 / 输入法候选 / 首屏画布底色）——
  // 不设它，夜间会挂一条亮色滚动条；它也是"无闪烁"的一半（见 index.html）
  root.style.colorScheme = next
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next)
  } catch {
    // localStorage 不可用（隐私模式 / 被禁）：本次会话内照样生效，只是刷新后回默认
  }
  theme.value = next
}

/**
 * 喂给 AntD 的 token：**AntD 键名 → tokens.css 的变量名**。
 * 只列 AntD 真正会用到的键；**不在这里出现任何色值**（→ §一.1「一切数值走 token」）。
 */
const ANTD_TOKEN_SOURCES: Readonly<Record<string, string>> = {
  colorPrimary: '--crm-color-primary',
  colorInfo: '--crm-color-info',
  colorSuccess: '--crm-color-success',
  colorWarning: '--crm-color-warning',
  colorError: '--crm-color-error',
  colorBgLayout: '--crm-color-bg-layout',
  colorBgContainer: '--crm-color-bg-container',
  colorBgElevated: '--crm-color-bg-elevated',
  colorBgMask: '--crm-color-bg-mask',
  colorFillAlter: '--crm-color-fill-alter',
  colorText: '--crm-color-text',
  colorTextSecondary: '--crm-color-text-secondary',
  colorTextTertiary: '--crm-color-text-tertiary',
  colorTextDisabled: '--crm-color-text-disabled',
  colorBorder: '--crm-color-border',
  colorBorderSecondary: '--crm-color-border-secondary',
  fontFamily: '--crm-font-family',
}

/**
 * ⚠ 这几个 AntD 要的是**数字**（不是 `14px` 这种字符串）：AntD 会拿它们**做算术**
 * （字号派生 SM/LG、圆角 ×2、控件高派生 SM/LG）—— 传 `'14px'` 会算出 `NaN`，
 * 生成一堆无效声明（**三绿与打包都发现不了**，只有真跑页面才看得见）。
 * 故这一组单独一张表、单独解析。
 */
const ANTD_NUMERIC_TOKEN_SOURCES: Readonly<Record<string, string>> = {
  fontSize: '--crm-font-size-base',
  borderRadius: '--crm-radius-base',
  controlHeight: '--crm-control-height',
}

/** 把两张表**按当前主题的计算值**读出来（CSS 变量已在 `[data-theme]` 切换时换过值） */
function readTokensFromCss(): Record<string, string | number> {
  const declared = getComputedStyle(document.documentElement)
  const tokens: Record<string, string | number> = {}
  for (const [antdKey, cssVar] of Object.entries(ANTD_TOKEN_SOURCES)) {
    const value = declared.getPropertyValue(cssVar).trim()
    // 变量缺失就不传（留给 AntD 默认值），**不编造**
    if (value !== '') tokens[antdKey] = value
  }
  for (const [antdKey, cssVar] of Object.entries(ANTD_NUMERIC_TOKEN_SOURCES)) {
    const size = Number.parseFloat(declared.getPropertyValue(cssVar))
    if (Number.isFinite(size)) tokens[antdKey] = size
  }
  return tokens
}

/**
 * 给 `<a-config-provider :theme>` 用的配置：`algorithm` 决定 AntD 自己那套明暗，
 * `token` 把我们的变量值钉进去（含主色 —— 否则夜间的按钮蓝会与我们的链接蓝不是同一个蓝）。
 */
export const antdThemeConfig = computed<ConfigProviderProps['theme']>(() => ({
  algorithm: isDark.value ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
  token: readTokensFromCss(),
}))

/**
 * 静态方法（`message.success()` 这类不挂在组件树上的调用）**包不住** ConfigProvider ——
 * 它们走 AntD 的全局配置（`vc-notification` 给**每条提示**都包一层
 * `<ConfigProvider {...globalConfigForApi}>`），故这里同步一份，免得夜间弹出一片亮色提示。
 * 放在模块作用域（import 即生效、随主题变化重算），省得每个入口各自记得调一次。
 *
 * ⚠ 那一句 `as unknown as`：`ConfigProvider.config` 的类型把 `theme` 写成了 cssinjs 的
 *   `Theme`（那是**CSS 变量模式**用的另一种形状），而实现是**原样透传**给它内部的
 *   `<ConfigProvider :theme>` —— 实际要传的就是 `ThemeConfig`。属于**上游类型与实现不一致**，
 *   按实现断言一次；不是为了绕本项目任何规则。
 */
watch(
  antdThemeConfig,
  (config) => {
    ConfigProvider.config({
      theme: config,
    } as unknown as Parameters<typeof ConfigProvider.config>[0])
  },
  { immediate: true },
)
