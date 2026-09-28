<script setup lang="ts">
/**
 * 内容卡（设计规范 §七.2：中、padding 24、描边 ＋ shadow-1）。业务区块容器，标题 / 操作区可选。
 */
</script>

<template>
  <section class="crm-card">
    <header v-if="$slots.title || $slots.extra" class="crm-card-head">
      <h3 v-if="$slots.title" class="crm-card-title"><slot name="title" /></h3>
      <div v-if="$slots.extra" class="crm-card-extra"><slot name="extra" /></div>
    </header>
    <div class="crm-card-body"><slot /></div>
  </section>
</template>

<style scoped>
.crm-card {
  background: var(--crm-color-bg-container);
  border: var(--crm-border-width) solid var(--crm-color-border-secondary);
  border-radius: var(--crm-radius-lg);
  padding: var(--crm-space-lg);
  box-shadow: var(--crm-shadow-1);
}

.crm-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--crm-space-sm);
  margin-bottom: var(--crm-space-sm);
}

.crm-card-title {
  margin: 0;
  font-size: var(--crm-font-size-lg);
  font-weight: var(--crm-font-weight-strong);
  color: var(--crm-color-text);
}
</style>
