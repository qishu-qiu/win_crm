<script setup lang="ts">
/**
 * KPI 卡（设计规范 §七.2：小、数字 30px/600、最轻，仅描边无阴影）。看板 / 首页指标用。
 */
withDefaults(defineProps<{ label: string; value?: string | number }>(), { value: '' })
</script>

<template>
  <div class="crm-kpi">
    <span class="crm-kpi-value">{{ value }}</span>
    <span class="crm-kpi-label">{{ label }}</span>
  </div>
</template>

<style scoped>
.crm-kpi {
  display: flex;
  flex-direction: column;
  gap: var(--crm-space-xxs);
  padding: var(--crm-space-md);
  background: var(--crm-color-bg-container);
  border: var(--crm-border-width) solid var(--crm-color-border-secondary);
  border-radius: var(--crm-radius-lg);
}

.crm-kpi-value {
  font-size: var(--crm-font-size-3xl);
  font-weight: var(--crm-font-weight-strong);
  color: var(--crm-color-text);
  line-height: 1.1;
}

.crm-kpi-label {
  font-size: var(--crm-font-size-xs);
  color: var(--crm-color-text-tertiary);
}
</style>
