<script setup lang="ts">
import { message } from 'ant-design-vue'
import { computed } from 'vue'

import { pushPreferences } from '../session'
import { THEME_OPTIONS, setTheme, theme, type ThemeName } from '../theme'

/**
 * 外观设置（`/me/appearance`）—— **M6-11 主题（白天 / 夜间）** 的切换落点。
 *
 * 口径来源（★ 真相源，勿自造）：
 *   · 《销售CRM前端页面与交互文档》§五 页 28「个人中心 / 外观设置」：
 *     **主题切换（白天 / 夜间两套）**；个人资料 / 改密 / 通知偏好；§4.1「顶部头像菜单 → `/me/appearance`」；
 *   · 主题本身（两套、默认值、深底约束）→《销售CRM设计规范》§八，本页**只做开关**，
 *     颜色数值一律在 `styles/tokens.css`，本页不碰。
 *   · 持久化 → 接口 §4.14.9 `PUT /account/preferences`（**存账号**）＋ 数据架构
 *     `employee.theme`（migration 0009）；本机 `localStorage` 只兜**首屏**（→ `theme.ts`）。
 *
 * ★ 本页**只做「主题」一项**（与规格页 28 的其余项不冲突）：页 28 还列着「个人资料 /
 *   改密 / 通知偏好」—— 其中「通知偏好」就是 `PUT /account/preferences` 的 `notif`，
 *   而规格的 `notif?:{...}` **从没给出括号里是什么**（不许由实现反过来定义契约）；
 *   个人资料 / 改密更是另有端点。⇒ 三者一律**先不摆**（→《欠账登记表》D-42），
 *   摆上去就是**点了没用的假入口**（＝设计规范 §3.2 第 11 条「禁假数据撑页面」同类）。
 *
 * ★ 兼做"持久化是否真的生效"的现场：
 *   ① 本机 —— 切换后**刷新页面**，选中的还是刚才那个（`index.html` 内联脚本 ＋
 *      `theme.ts` ＋ `tokens.css` 三者接上了）；
 *   ② 账号 —— 换一个浏览器 / 换台设备登录同一账号，看到的仍是这一套（走服务端）。
 */

/**
 * 切换项 ↔ 当前主题（写回统一走 `setTheme`，页面不自建第二套状态）。
 *
 * ★ 顺序有意义：先 `setTheme`（**本地立刻生效**，切换零延迟）**再**推账号 ——
 *   反过来的话，弱网下用户会盯着一个"点了没反应"的开关等一次往返。
 * ★ 推送失败**不回滚本地**：用户看到的就是他要的那套，只是没存上账号；
 *   如实告诉他"本机已生效、账号没存上"，比默默假装成功或偷偷弹回旧值都好。
 */
const selected = computed<ThemeName>({
  get: () => theme.value,
  set: (value) => {
    setTheme(value)
    void pushPreferences({ theme: value }).catch(() => {
      message.warning('主题已在本机生效，但保存到账号失败 —— 换设备后可能看到旧的那套')
    })
  },
})
</script>

<template>
  <section class="appearance">
    <h2 class="appearance-title">外观设置</h2>
    <p class="appearance-desc">
      主题只影响你自己看到的外观（白天 / 夜间两套），不影响任何数据与他人界面。
    </p>

    <a-card :bordered="false" class="appearance-card">
      <h3 class="appearance-card-title">主题</h3>
      <a-radio-group v-model:value="selected" button-style="solid">
        <a-radio-button v-for="item in THEME_OPTIONS" :key="item.value" :value="item.value">
          {{ item.label }}
        </a-radio-button>
      </a-radio-group>
      <p class="appearance-hint">
        切换立即生效并保存到你的账号 —— 刷新页面、换台设备登录，看到的都还是这一套。
      </p>
    </a-card>

    <p class="appearance-hint">
      个人资料 / 修改密码 / 通知偏好属后续里程碑（通知偏好的字段规格尚未定稿）——
      本页不摆点了没用的入口。
    </p>
  </section>
</template>

<style scoped>
.appearance {
  max-width: 720px;
}

.appearance-title {
  margin: 0 0 var(--crm-space-xs);
  font-size: var(--crm-font-size-2xl);
  font-weight: var(--crm-font-weight-strong);
  color: var(--crm-color-text);
}

.appearance-desc {
  margin: 0 0 var(--crm-space-lg);
  font-size: var(--crm-font-size-base);
  color: var(--crm-color-text-secondary);
}

.appearance-card {
  margin-bottom: var(--crm-space-lg);
}

.appearance-card-title {
  margin: 0 0 var(--crm-space-md);
  font-size: var(--crm-font-size-lg);
  font-weight: var(--crm-font-weight-strong);
  color: var(--crm-color-text);
}

.appearance-hint {
  margin: var(--crm-space-md) 0 0;
  font-size: var(--crm-font-size-xs);
  color: var(--crm-color-text-tertiary);
}
</style>
