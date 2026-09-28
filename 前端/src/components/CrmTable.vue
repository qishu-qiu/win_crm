<script setup lang="ts">
/**
 * 表格（设计规范 §4.1）：封装 AntD Table，统一默认（rowKey=id、size=middle、**默认不分页**——
 * 本系统列表一律服务端分页，分页器由页面显式传入）。
 * 无斑马纹 / hover 唯一背景变化，AntD 默认即符合；列对齐 / 状态居中由页面在 columns 里定。
 * 透传所有属性与具名插槽（bodyCell / emptyText 等）。组件不连接口、不预设列。
 */
withDefaults(
  defineProps<{
    rowKey?: string
    size?: 'small' | 'middle' | 'large'
  }>(),
  { rowKey: 'id', size: 'middle' },
)
</script>

<template>
  <a-table class="crm-table" v-bind="$attrs" :row-key="rowKey" :size="size">
    <template v-for="(_, name) in $slots" #[name]="slotProps">
      <slot :name="name" v-bind="slotProps" />
    </template>
  </a-table>
</template>

<style scoped>
.crm-table :deep(.ant-table-thead > tr > th) {
  background: var(--crm-color-bg-container);
  font-weight: var(--crm-font-weight-strong);
  font-size: var(--crm-font-size-base);
  color: var(--crm-color-text);
}

.crm-table :deep(.ant-table-tbody > tr > td) {
  font-size: var(--crm-font-size-base);
}
</style>
