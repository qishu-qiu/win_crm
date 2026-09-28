<script setup lang="ts">
/**
 * 空状态（设计规范 §5.1）：线性图标（非 emoji）＋ 一句说明 ＋ 一个主行动（slot）。
 * 三类文案：noData（还没有…）／ noResult（没有符合条件…）／ noPermission（不在可见范围）。
 */
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    type?: 'noData' | 'noResult' | 'noPermission'
    /** 自定义说明：传了覆盖默认三类文案 */
    description?: string
  }>(),
  { type: 'noData', description: '' },
)

const text = computed(() => {
  if (props.description) return props.description
  if (props.type === 'noResult') return '没有符合条件的客户，试试放宽筛选'
  if (props.type === 'noPermission') return '此处数据不在你的可见范围'
  return '还没有数据，去录入一条'
})
</script>

<template>
  <div class="crm-empty">
    <svg class="crm-empty-icon" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <rect x="8" y="12" width="32" height="24" rx="3" stroke="currentColor" stroke-width="2" />
      <path d="M8 20h32" stroke="currentColor" stroke-width="2" />
      <path d="M16 28h10" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
    </svg>
    <p class="crm-empty-text">{{ text }}</p>
    <div v-if="$slots.action" class="crm-empty-action">
      <slot name="action" />
    </div>
  </div>
</template>

<style scoped>
.crm-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--crm-space-sm);
  padding: var(--crm-space-2xl) var(--crm-space-lg);
  color: var(--crm-color-text-tertiary);
}

.crm-empty-icon {
  width: 48px;
  height: 48px;
}

.crm-empty-text {
  margin: 0;
  font-size: var(--crm-font-size-base);
  color: var(--crm-color-text-tertiary);
}

.crm-empty-action {
  margin-top: var(--crm-space-xxs);
}
</style>
