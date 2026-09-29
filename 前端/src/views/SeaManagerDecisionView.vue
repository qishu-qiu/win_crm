<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { message, Modal } from 'ant-design-vue'
import {
  getManagerTodo,
  managerDecision,
  type SeaManagerTodoItem,
  type SeaManagerTodoResult,
} from '../api/sea'
import { formatDateTime } from '../format'

import PageContainer from '../components/PageContainer.vue'
import ErrorBlock from '../components/ErrorBlock.vue'

/**
 * 经理决策待办（§五 页 9/10「经理决策待办：超期关系 保留/删除」；
 * → 接口 §5.16 `GET /sea/manager-todo` ＋ `POST /sea/manager-decision`）。
 *
 * ★ 口径来源（★ 真相源，勿自造）：**谁看得到由服务端判**（部门经理 / 总经理；销售 / 交付·客服 → 403）——
 *   前端**不自己判角色**，把 403 当正常分支（「该角色无待决策」），不是崩掉。
 * ★ `decision='keep'` ⇒ 维持公海、什么都不改；`decision='delete'` ⇒ 逻辑删关系（不自动流转）
 *   ＋ 写 `sea_record`（`reason=dept_manager_delete`）留痕 —— **删除前二次确认**（不可逆）。
 * ★ 失败人话由请求层统一弹出（越权 → 403；关系不在公海/已删 → 400），本页不翻译。
 */
const loading = ref(false)
const deciding = ref<string | null>(null)
const errorText = ref('')
const items = ref<SeaManagerTodoItem[]>([])

const columns = [
  { title: '进入时间', key: 'sea_entered_at', width: 170 },
  { title: '公司', key: 'company' },
  { title: '部门', key: 'dept' },
  { title: '产品线', key: 'product_line' },
  { title: '超期天数', key: 'overdue_days', width: 100 },
  { title: '决策', key: 'action', width: 160 },
]

async function load(): Promise<void> {
  errorText.value = ''
  loading.value = true
  try {
    const data: SeaManagerTodoResult = await getManagerTodo()
    items.value = (data.items ?? []) as SeaManagerTodoItem[]
  } catch (error) {
    items.value = []
    errorText.value = error instanceof Error ? error.message : '加载失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

async function decide(row: SeaManagerTodoItem, decision: 'keep' | 'delete'): Promise<void> {
  deciding.value = row.relation_id
  try {
    await managerDecision(row.relation_id, decision)
    message.success(decision === 'keep' ? '已保留（维持公海）' : '已删除该公海关系（不自动流转，已留痕）')
    void load()
  } catch (error) {
    message.error(error instanceof Error ? error.message : '操作失败')
  } finally {
    deciding.value = null
  }
}

function onDelete(row: SeaManagerTodoItem): void {
  Modal.confirm({
    title: '确认删除该公海关系？',
    content: `公司「${row.company?.name ?? '—'}」的这条公海关系将被逻辑删除（不自动流转），并写掉海记录留痕。此操作不可逆。`,
    okText: '删除',
    okType: 'danger',
    cancelText: '取消',
    onOk: () => decide(row, 'delete'),
  })
}

onMounted(() => void load())
</script>

<template>
  <PageContainer title="经理决策待办">
    <ErrorBlock v-if="errorText" :message="errorText" @retry="load" />
    <template v-else>
      <a-alert
        v-if="items.length === 0 && !loading"
        type="info"
        show-icon
        message="暂无超期待决策的公海关系"
      />
      <a-spin :spinning="loading">
        <a-table
          :data-source="items"
          :columns="columns"
          :pagination="false"
          row-key="relation_id"
          size="middle"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'company'">{{ record.company?.name ?? '—' }}</template>
            <template v-else-if="column.key === 'dept'">{{ record.dept?.name ?? '—' }}</template>
            <template v-else-if="column.key === 'product_line'">{{ record.product_line?.name ?? '—' }}</template>
            <template v-else-if="column.key === 'sea_entered_at'">
              {{ formatDateTime(record.sea_entered_at) }}
            </template>
            <template v-else-if="column.key === 'overdue_days'">
              <span class="is-danger">{{ record.overdue_days }} 天</span>
            </template>
            <template v-else-if="column.key === 'action'">
              <a-space>
                <a-button
                  size="small"
                  :loading="deciding === record.relation_id"
                  @click="decide(record, 'keep')"
                >
                  保留
                </a-button>
                <a-button
                  size="small"
                  danger
                  :loading="deciding === record.relation_id"
                  @click="onDelete(record)"
                >
                  删除
                </a-button>
              </a-space>
            </template>
          </template>
        </a-table>
      </a-spin>
    </template>
  </PageContainer>
</template>

<style scoped>
.is-danger {
  color: var(--crm-color-error, #cf1322);
  font-weight: 600;
}
</style>
