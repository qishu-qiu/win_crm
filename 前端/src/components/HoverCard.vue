<script setup lang="ts">
/**
 * 悬浮卡（设计规范 §4.7 PopCard ＋ 前端 §3.1 A3/A7）：hover ＋ click 钉住。
 * 触发器用默认插槽（实体名 / 头像），内容用 `content` 插槽。
 * 用 AntD Popover 承载定位与「hover+click」触发，组件只做语义封装与 token 容器样式。
 * 移动端 → 底部轻面板（.sheet）留待铺开阶段按 §3.1 A7 细化。
 */
withDefaults(
  defineProps<{
    title?: string
    placement?: 'top' | 'bottom' | 'left' | 'right' | 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight'
  }>(),
  { title: '', placement: 'bottomLeft' },
)
</script>

<template>
  <a-popover :trigger="['hover', 'click']" :placement="placement" class="crm-hover-card">
    <slot />
    <template #content>
      <div class="crm-hover-card-body">
        <p v-if="title" class="crm-hover-card-title">{{ title }}</p>
        <slot name="content" />
      </div>
    </template>
  </a-popover>
</template>

<style scoped>
.crm-hover-card-body {
  max-width: 320px;
  padding: var(--crm-space-sm);
}

.crm-hover-card-title {
  margin: 0 0 var(--crm-space-xs);
  font-size: var(--crm-font-size-base);
  font-weight: var(--crm-font-weight-strong);
  color: var(--crm-color-text);
}
</style>
