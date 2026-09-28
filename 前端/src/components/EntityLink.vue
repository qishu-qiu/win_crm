<script setup lang="ts">
/**
 * 实体链接（前端 §3.1 A1：公司 / 联系人 / 员工任何位置名称都可点）：统一主色链接，不重复下划线噪音。
 * 默认 router-link；`to` 不传时退化为纯文本（当前页即该实体详情页时，→ A1 例外）。
 */
withDefaults(defineProps<{ to?: string; label: string }>(), { to: '' })
</script>

<template>
  <router-link v-if="to" :to="to" class="crm-entity-link">{{ label }}</router-link>
  <span v-else class="crm-entity-text">{{ label }}</span>
</template>

<style scoped>
.crm-entity-link {
  color: var(--crm-color-primary);
}

.crm-entity-link:hover {
  color: var(--crm-color-primary-hover);
}

.crm-entity-text {
  color: var(--crm-color-text);
}
</style>
