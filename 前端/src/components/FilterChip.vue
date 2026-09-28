<script setup lang="ts">
/**
 * 筛选 chip / 页签（设计规范 §4.2 / §4.4）：圆角胶囊，选中＝主色描边 ＋ 浅底；
 * 可选前置圆点（用于紧迫档等状态色）。单选（页签 / 视图）与多选（紧迫档）通用，
 * 选中态由父页控制（`active` prop），点击抛 `toggle` 事件（父页决定单选还是多选）。
 */
withDefaults(
  defineProps<{
    label: string
    active?: boolean
    /** 前置圆点颜色（token 变量或 CSS 色）；不传无圆点 */
    dotColor?: string
  }>(),
  { active: false, dotColor: '' },
)
const emit = defineEmits<{ toggle: [] }>()
</script>

<template>
  <button
    type="button"
    class="crm-chip"
    :class="{ 'is-active': active }"
    :aria-pressed="active"
    @click="emit('toggle')"
  >
    <span v-if="dotColor" class="crm-chip-dot" :style="{ background: dotColor }" />
    {{ label }}
  </button>
</template>

<style scoped>
.crm-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--crm-space-xxs);
  height: 28px;
  padding: 0 var(--crm-space-sm);
  font-size: var(--crm-font-size-xs);
  color: var(--crm-color-text-secondary);
  background: var(--crm-color-bg-container);
  border: var(--crm-border-width) solid var(--crm-color-border-secondary);
  border-radius: var(--crm-radius-pill);
  cursor: pointer;
}

.crm-chip.is-active {
  color: var(--crm-color-primary);
  border-color: var(--crm-color-primary);
  background: var(--crm-color-primary-bg);
}

.crm-chip-dot {
  width: 8px;
  height: 8px;
  border-radius: var(--crm-radius-pill);
  flex: none;
}
</style>
