<script setup lang="ts">
/**
 * 人员芯片（设计规范 §4.9）：头像（姓名哈希取 12 色底 ＋ 首字、圆 50%）＋ 姓名。
 * 列表 mini（默认）；可扩展 `subtitle`（详情完整）。未指派时显示「未指派」（配合 `assignable`＋`unassigned`）。
 * ⚠ 头像底色＝姓名哈希派生（装饰性、非业务色，故用 hsl 程序生成，不占用 token）。
 */
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    name: string
    subtitle?: string
    /** 未指派态：显示「未指派」占位（§4.9「＋指派」由调用方决定放不放入口） */
    unassigned?: boolean
  }>(),
  { subtitle: '', unassigned: false },
)

const initial = computed(() => props.name.slice(0, 1) ?? '')
const avatarStyle = computed(() => {
  if (props.unassigned) return {}
  let hash = 0
  for (let i = 0; i < props.name.length; i += 1) hash = (hash * 31 + props.name.charCodeAt(i)) % 360
  return {
    background: `hsl(${hash}, 60%, 88%)`,
    color: `hsl(${hash}, 45%, 35%)`,
  }
})
</script>

<template>
  <span class="crm-person">
    <span class="crm-person-avatar" :style="avatarStyle">{{ unassigned ? '＋' : initial }}</span>
    <span class="crm-person-meta">
      <span class="crm-person-name">{{ unassigned ? '未指派' : name }}</span>
      <span v-if="subtitle" class="crm-person-sub">{{ subtitle }}</span>
    </span>
  </span>
</template>

<style scoped>
.crm-person {
  display: inline-flex;
  align-items: center;
  gap: var(--crm-space-xs);
}

.crm-person-avatar {
  width: 24px;
  height: 24px;
  border-radius: var(--crm-radius-pill);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: var(--crm-font-size-xs);
  font-weight: var(--crm-font-weight-strong);
  flex: none;
}

.crm-person-meta {
  display: inline-flex;
  flex-direction: column;
  line-height: 1.2;
}

.crm-person-name {
  font-size: var(--crm-font-size-base);
  color: var(--crm-color-text);
}

.crm-person-sub {
  font-size: var(--crm-font-size-xs);
  color: var(--crm-color-text-tertiary);
}
</style>
