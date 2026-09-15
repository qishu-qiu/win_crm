<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import type { UserVo } from '../api/auth'
import { fetchTodayAgenda, type AgendaItem } from '../api/engine'
import { refTypeNameOf } from '../engine'
import { homeNameOf } from '../home'

/**
 * 首屏工作台（M4-17）—— **今日该找谁**（`GET /today-agenda`）。
 *
 * 口径来源（★ 真相源，勿自造）：
 *   · 《销售CRM接口API文档》V1.17 §5.7 动线条目：`{id,ref_type,ref_id,relation,contact,
 *     reason,priority,action_hint,status,snooze_count}`。
 *   · 《销售CRM数据架构文档》V1.31 D4：`daily_agenda` 是**每日组装产物**，
 *     `done` / `ignored`（已办 / 已忽略）**不再推**。
 *
 * ⚠ **本批的实情（不谎报）**：动线条目由**每日 05:00 的组装任务**产生（属 M7）——
 *   本批只有「直查」这一半。所以新写的跟单**不会**立刻出现在这里；
 *   库里没有当日行就是**空数组**，页面照实说清，不用假数据撑满（→ 设计规范 §3.2 第 11 条）。
 * ★ 页面**不再自己过滤 / 排序**：范围（只给我自己的）与顺序（优先级）都由服务端定
 *   —— 前端再排一次就是第二套口径（本项目反复点名的双真相源）。
 */
const props = defineProps<{ user: UserVo }>()

const homeName = computed(() => homeNameOf(props.user.role))

const items = ref<AgendaItem[]>([])
const loading = ref(false)
const errorText = ref('')

/** 动线处理状态（→ D4 `status`；只会有 `open` / `snoozed` 两种进来，见仓储注释） */
const AGENDA_STATUS_NAMES: Record<string, string> = { open: '待办', snoozed: '已推明天' }

const columns = [
  { title: '来源', dataIndex: 'refType', key: 'refType', width: 110 },
  { title: '关系', dataIndex: 'relation', key: 'relation', width: 240 },
  { title: '为什么今天该找 TA', dataIndex: 'reason', key: 'reason' },
  { title: '建议动作', dataIndex: 'actionHint', key: 'actionHint', width: 160 },
  { title: '状态', dataIndex: 'status', key: 'status', width: 100 },
]

async function load(): Promise<void> {
  errorText.value = ''
  loading.value = true
  try {
    items.value = await fetchTodayAgenda()
  } catch (error) {
    items.value = []
    errorText.value = error instanceof Error ? error.message : '加载失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void load()
})
</script>

<template>
  <section class="workbench">
    <h2 class="workbench-title">{{ homeName }}</h2>
    <p class="workbench-hint">
      今日动线由服务端组装：承诺到点 / 预约 / 节奏命中 / 掉海提醒，按优先级排序。
      写跟单请到「业务关系」页点开某条关系的时间线。
    </p>

    <p v-if="errorText" class="workbench-error">{{ errorText }}</p>

    <a-table
      :columns="columns"
      :data-source="items"
      :loading="loading"
      :pagination="false"
      row-key="id"
      size="middle"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'refType'">{{ refTypeNameOf(record.ref_type) }}</template>
        <template v-else-if="column.key === 'relation'">
          {{ record.relation?.name ?? '—' }}
        </template>
        <template v-else-if="column.key === 'reason'">{{ record.reason ?? '—' }}</template>
        <template v-else-if="column.key === 'actionHint'">{{ record.action_hint ?? '—' }}</template>
        <template v-else-if="column.key === 'status'">
          {{ AGENDA_STATUS_NAMES[record.status] ?? record.status }}
        </template>
      </template>

      <template #emptyText>
        <a-empty
          :description="
            errorText === ''
              ? '今天还没有动线条目（动线由每日清晨自动组装，本批尚未接定时任务）'
              : '暂时取不到今日动线'
          "
        />
      </template>
    </a-table>
  </section>
</template>

<style scoped>
.workbench {
  max-width: 1080px;
}

.workbench-title {
  margin: 0 0 var(--crm-space-xs);
  font-size: var(--crm-font-size-2xl);
  font-weight: var(--crm-font-weight-strong);
  color: var(--crm-color-text);
}

.workbench-hint {
  margin: 0 0 var(--crm-space-lg);
  font-size: var(--crm-font-size-base);
  color: var(--crm-color-text-tertiary);
}

/** 错误态：§4.6「错误文案红 12px」（与登录页 / 建档页 / 关系页同一形态） */
.workbench-error {
  margin: 0 0 var(--crm-space-sm);
  font-size: var(--crm-font-size-xs);
  color: var(--crm-color-error);
}
</style>
