<script setup lang="ts">
/**
 * 错误态块（设计规范 §5.3）：图标 ＋ 说明 ＋ 重试按钮（可局部替换失败区块）。
 * 重试由父页接 `retry` 事件后自己调接口（组件不连接口）。
 */
withDefaults(defineProps<{ message?: string }>(), { message: '加载失败，请稍后重试' })
const emit = defineEmits<{ retry: [] }>()
</script>

<template>
  <div class="crm-error">
    <svg class="crm-error-icon" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <circle cx="24" cy="24" r="16" stroke="currentColor" stroke-width="2" />
      <path d="M24 16v10" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      <circle cx="24" cy="31" r="1.6" fill="currentColor" />
    </svg>
    <p class="crm-error-text">{{ message }}</p>
    <a-button size="small" @click="emit('retry')">重试</a-button>
  </div>
</template>

<style scoped>
.crm-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--crm-space-sm);
  padding: var(--crm-space-2xl) var(--crm-space-lg);
  color: var(--crm-color-error);
}

.crm-error-icon {
  width: 40px;
  height: 40px;
}

.crm-error-text {
  margin: 0;
  font-size: var(--crm-font-size-base);
}
</style>
