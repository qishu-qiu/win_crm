<script setup lang="ts">
/**
 * 页面容器（应用骨架）：统一「标题 ＋ 描述 ＋ 右侧操作区 ＋ 正文」。
 * 所有业务页共用，替代各页散写的 <h2> ＋ <p> ＋ 操作按钮布局（设计规范 §七 信息层级）。
 * 容器最大宽 1440 居中（§六.2）；正文沿用外壳的 padding，本件不再加。
 */
withDefaults(defineProps<{ title?: string; description?: string }>(), {})
</script>

<template>
  <section class="page-container">
    <header v-if="title || $slots.extra" class="page-container-head">
      <div class="page-container-titles">
        <h2 v-if="title" class="page-container-title">{{ title }}</h2>
        <p v-if="description" class="page-container-desc">{{ description }}</p>
      </div>
      <div v-if="$slots.extra" class="page-container-extra">
        <slot name="extra" />
      </div>
    </header>
    <slot />
  </section>
</template>

<style scoped>
.page-container {
  max-width: var(--crm-content-max-width, 1440px);
  margin: 0 auto;
}

.page-container-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--crm-space-lg);
  margin-bottom: var(--crm-space-lg);
}

.page-container-title {
  margin: 0 0 var(--crm-space-xxs);
  font-size: var(--crm-font-size-2xl);
  font-weight: var(--crm-font-weight-strong);
  color: var(--crm-color-text);
}

.page-container-desc {
  margin: 0;
  font-size: var(--crm-font-size-base);
  color: var(--crm-color-text-tertiary);
}

.page-container-extra {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--crm-space-sm);
}
</style>
