<script setup lang="ts">
import { computed } from 'vue'

import { THEME_OPTIONS, setTheme, theme, type ThemeName } from '../theme'

/**
 * 外观设置（`/me/appearance`）—— **M6-11 主题（白天 / 夜间）** 的切换落点。
 *
 * 口径来源（★ 真相源，勿自造）：
 *   · 《销售CRM前端页面与交互文档》§五 页 28「个人中心 / 外观设置」：
 *     **主题切换（白天 / 夜间两套）**；个人资料 / 改密 / 通知偏好；§4.1「顶部头像菜单 → `/me/appearance`」；
 *   · 主题本身（两套、默认值、深底约束）→《销售CRM设计规范》§八，本页**只做开关**，
 *     颜色数值一律在 `styles/tokens.css`，本页不碰。
 *
 * ★ 本页**只做「主题」一项**（与规格页 28 的其余项不冲突）：
 *   个人资料 / 改密 / 通知偏好都要落 `PUT /account/preferences` 这类端点，
 *   服务端尚未实现（→《欠账登记表》D-37）—— 摆上去就是**点了没用的假入口**
 *   （＝设计规范 §3.2 第 11 条「禁假数据撑页面」的同类，M6-08 / M6-09 同款处理）。
 *
 * ★ 兼做"持久化是否真的生效"的现场：切换后**刷新页面**，选中的还是刚才那个 —— 那就是
 *   `index.html` 内联预置脚本 ＋ `theme.ts` ＋ `tokens.css` 三者接上了。
 */

/** 切换项 ↔ 当前主题（写回统一走 `setTheme`，页面不自建第二套状态） */
const selected = computed<ThemeName>({
  get: () => theme.value,
  set: (value) => setTheme(value),
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
      <p class="appearance-hint">切换立即生效；刷新页面后仍是你选的那一套。</p>
    </a-card>

    <p class="appearance-hint">
      个人资料 / 修改密码 / 通知偏好属后续里程碑（服务端尚未提供对应端点）——
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
