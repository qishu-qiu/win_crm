<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { listSeaRecords, type SeaRecordItem, type SeaRecordListResult } from '../api/sea'
import { formatDateTime } from '../format'

import PageContainer from '../components/PageContainer.vue'
import EmptyState from '../components/EmptyState.vue'
import ErrorBlock from '../components/ErrorBlock.vue'

/**
 * 掉海记录列表（§五 页 9/10「入公海历史」的全局视图；→ 接口 §5.16 `GET /sea/records`）。
 *
 * ★ 口径来源（★ 真相源，勿自造）：**谁看得到什么由服务端按数据范围收敛**
 *   （销售＝本部门 / 经理＝管辖部门 / 总经理·管理员＝全部；交付·客服 → 403）—— 前端**不自己判角色**，
 *   把 403 当正常分支（「该角色不进公海」），不是崩掉。
 * ★ `total` **只信服务端**（同一个 where 的全量计数），不拿 `list.length` 当总数。
 * ★ 原因码（`reason`）原样透传；本页只做已知码的中文映射，取不到的码显示原始码（不编中文）。
 */
const PAGE_SIZE = 20

const loading = ref(false)
const errorText = ref('')
const result = ref<SeaRecordListResult | null>(null)
const rows = ref<SeaRecordItem[]>([])
const current = ref(1)

const reasonLabel: Record<string, string> = {
  follow_timeout: '跟进超时',
  dept_manager_delete: '经理删除',
}

function reasonTextOf(r: SeaRecordItem): string {
  return reasonLabel[r.reason] ?? r.reason
}

const columns = [
  { title: '掉海时间', key: 'dropped_at', width: 170 },
  { title: '公司', key: 'company' },
  { title: '部门', key: 'dept' },
  { title: '产品线', key: 'product_line' },
  { title: '原因', key: 'reason' },
  { title: '领回人', key: 'claimed_by' },
  { title: '领回时间', key: 'claimed_at', width: 170 },
]

async function load(): Promise<void> {
  errorText.value = ''
  loading.value = true
  try {
    const data = await listSeaRecords(current.value, PAGE_SIZE)
    result.value = data
    rows.value = (data.list ?? []) as SeaRecordItem[]
  } catch (error) {
    result.value = null
    rows.value = []
    errorText.value = error instanceof Error ? error.message : '加载失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

function onPageChange(next: number): void {
  current.value = next
  void load()
}

onMounted(() => void load())
</script>

<template>
  <PageContainer title="掉海记录">
    <ErrorBlock v-if="errorText" :message="errorText" @retry="load" />
    <template v-else>
      <div v-if="rows.length === 0 && !loading" class="records-empty">
        <EmptyState description="暂无掉海记录" />
      </div>

      <a-spin :spinning="loading">
        <a-table
          :data-source="rows"
          :columns="columns"
          :pagination="false"
          row-key="record_id"
          size="middle"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'company'">{{ record.company?.name ?? '—' }}</template>
            <template v-else-if="column.key === 'dept'">{{ record.dept?.name ?? '—' }}</template>
            <template v-else-if="column.key === 'product_line'">{{ record.product_line?.name ?? '—' }}</template>
            <template v-else-if="column.key === 'reason'">
              <a-tag :bordered="false">{{ reasonTextOf(record) }}</a-tag>
            </template>
            <template v-else-if="column.key === 'dropped_at'">
              {{ formatDateTime(record.dropped_at) }}
            </template>
            <template v-else-if="column.key === 'claimed_by'">{{ record.claimed_by?.name ?? '未领回' }}</template>
            <template v-else-if="column.key === 'claimed_at'">
              {{ record.claimed_at ? formatDateTime(record.claimed_at) : '—' }}
            </template>
          </template>
        </a-table>
      </a-spin>

      <a-pagination
        v-if="result && result.total > 0"
        class="records-pagination"
        :current="result.page"
        :page-size="result.page_size"
        :total="result.total"
        show-quick-jumper
        @change="onPageChange"
      />
    </template>
  </PageContainer>
</template>

<style scoped>
.records-empty {
  padding: 48px 0;
}
.records-pagination {
  margin-top: 16px;
  text-align: right;
}
</style>
