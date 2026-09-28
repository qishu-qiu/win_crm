<script setup lang="ts">
/**
 * 状态标签（设计规范 §4.4）：圆点 ＋ 文字，色盲友好。
 * 业务色由调用方传入 token 变量（如 `var(--crm-color-urgency-week)`），组件不硬编码业务色。
 * 高危语义（逾期 / 风险）用 `danger`，文字加粗 ＋ 取 error 色（§三.1 B5：红只给逾期 / 风险）。
 */
withDefaults(
  defineProps<{
    text: string
    /** 圆点颜色：CSS 颜色或 token 变量；不传则 neutral */
    color?: string
    danger?: boolean
  }>(),
  { color: 'var(--crm-color-text-tertiary)', danger: false },
)
</script>

<template>
  <span class="crm-status-tag" :class="{ 'is-danger': danger }">
    <span class="crm-status-dot" :style="{ background: danger ? 'var(--crm-color-error)' : color }" />
    <span class="crm-status-text">{{ text }}</span>
  </span>
</template>

<style scoped>
.crm-status-tag {
  display: inline-flex;
  align-items: center;
  gap: var(--crm-space-xxs);
}

.crm-status-dot {
  width: 8px;
  height: 8px;
  border-radius: var(--crm-radius-pill);
  flex: none;
}

.crm-status-text {
  font-size: var(--crm-font-size-xs);
  color: var(--crm-color-text-secondary);
}

.crm-status-tag.is-danger .crm-status-text {
  font-weight: var(--crm-font-weight-strong);
  color: var(--crm-color-error);
}
</style>
