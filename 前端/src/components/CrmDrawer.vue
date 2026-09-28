<script setup lang="ts">
/**
 * 抽屉（设计规范 §4.7）：一层、宽 480(小)/640(中)、标题栏、底部操作区固定、禁玻璃拟态。
 * 透传 a-drawer 其余属性与插槽（footer 用具名 slot）；组件不连接口。
 * 用 `v-model:open`（避免 `defineModel` 版本要求），`close` 事件透传给父页做收尾。
 */
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    open: boolean
    title?: string
    width?: number | string
  }>(),
  { title: '', width: 640 },
)
const emit = defineEmits<{ 'update:open': [boolean]; close: [] }>()

const open = computed({
  get: () => props.open,
  set: (value: boolean) => emit('update:open', value),
})
</script>

<template>
  <a-drawer
    v-model:open="open"
    :title="title"
    :width="width"
    :mask-closable="true"
    class="crm-drawer"
    @close="emit('close')"
  >
    <slot />
    <template v-if="$slots.footer" #footer>
      <slot name="footer" />
    </template>
  </a-drawer>
</template>

<style scoped>
.crm-drawer :deep(.ant-drawer-body) {
  background: var(--crm-color-bg-container);
}
</style>
