<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { getRelation, type RelationDetail } from '../api/relation'
import {
  formatDateTime,
  stageNameOf,
  urgencyColorOf,
  urgencyNameOf,
  valueTierNameOf,
} from '../relation'

/**
 * 业务关系详情页（M6-08）—— **本片只做「详情 ＋ 成员」**。
 *
 * 判据逐字（《开发计划-V1》M6-08）：「关系详情页（详情 ＋ 成员；时间线最小版已于 M4-17 落地）
 *   ｜ 与 M4 接口一致」。
 *
 * 口径来源（★ 真相源，勿自造）：
 *   · 详情出参 →《销售CRM接口API文档》§5.6（＝列表项 ＋ `members`，本批范围）。
 *   · **不摆「点了没用」的入口**：规格 §5 的 8 Tab（合同 / 工单 / 关系网 / 复盘…）分属
 *     E / G / D / F 域，服务端**尚未返回**对应字段（→《欠账登记表》D-11）——
 *     摆上去就是假入口（＝设计规范 §3.2 第 11 条「禁假数据撑页面」的同类）。
 *   · 三态齐全（→ 设计规范 §五）：加载 / 错误 / 空 都要有。
 *   · **能不能看由服务端按数据范围判**（→ 接口 §2.2）：越权给 403，页面把 403 当
 *     **正常分支**显示（人说清"为什么看不到"），不是崩掉。
 *   · 时间线沿用列表页的抽屉（M4-17 已落），本页不重复造一份。
 */
const route = useRoute()
const router = useRouter()

const detail = ref<RelationDetail | null>(null)
const loading = ref(false)
const errorText = ref('')

/** 路由参数 `:id`（十进制字符串）—— 本页**只往下传**，不解析成数字（后端主键是 bigint） */
const relationId = computed(() => String(route.params.id ?? ''))

async function load(): Promise<void> {
  errorText.value = ''
  loading.value = true
  try {
    detail.value = await getRelation(relationId.value)
  } catch (error) {
    // 403（越权 / 不进公海）与网络错误都走这里：**内联**说清，内容清空（不留上次残留）
    detail.value = null
    errorText.value = error instanceof Error ? error.message : '加载失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

// 详情页可能**在页内换 id**（从"同公司其他关系"跳过来是后续里程碑的事，但监听成本为零）
watch(relationId, () => {
  void load()
})

onMounted(() => {
  void load()
})

/** 字段卡（顺序＝销售看一行的顺序：客户 → 归属 → 最近 → 下一步） */
const facts = computed(() => {
  const row = detail.value
  if (row === null) return []
  return [
    { label: '公司', value: row.company?.name ?? '（档案已删除）' },
    { label: '部门', value: row.dept?.name ?? '—' },
    { label: '产品线', value: row.product_line?.name ?? '—' },
    { label: '主责', value: row.owner?.name ?? '（公海 · 待领取）' },
    { label: '最近沟通', value: formatDateTime(row.last_event_at) },
    { label: '下一步', value: row.next_action_hint ?? '—' },
  ]
})

const memberColumns = [
  { title: '成员', dataIndex: 'employee', key: 'employee' },
  { title: '类型', dataIndex: 'memberType', key: 'memberType', width: 110 },
  { title: '来源', dataIndex: 'source', key: 'source', width: 140 },
  { title: '有效期至', dataIndex: 'validUntil', key: 'validUntil', width: 160 },
]

/** 成员类型 / 来源中文名（→ 数据架构 C2）；**未知码值原样回显**，不显示成空白（空白会被当成"没填"） */
const MEMBER_TYPE_NAMES: Record<string, string> = { owner: '主责销售', collaborator: '协同人' }
const MEMBER_SOURCE_NAMES: Record<string, string> = { collaborate: '正式协同', ask_help: '@求助' }

function memberTypeNameOf(code: string): string {
  return MEMBER_TYPE_NAMES[code] ?? code
}

function memberSourceNameOf(code: string | null): string {
  return code === null || code === '' ? '—' : (MEMBER_SOURCE_NAMES[code] ?? code)
}
</script>

<template>
  <section class="detail">
    <a-button type="link" size="small" class="detail-back" @click="router.push('/relations')">
      ← 返回业务关系列表
    </a-button>

    <p v-if="errorText" class="detail-error">{{ errorText }}</p>

    <a-spin :spinning="loading">
      <template v-if="detail">
        <h2 class="detail-title">{{ detail.company?.name ?? '（档案已删除）' }}</h2>

        <div class="detail-badges">
          <span class="detail-badge">阶段：{{ stageNameOf(detail.stage) }}</span>
          <span class="detail-badge">
            <span class="detail-dot" :style="{ background: urgencyColorOf(detail.urgency) }" />
            {{ urgencyNameOf(detail.urgency) }}
          </span>
          <span class="detail-badge">开发价值：{{ valueTierNameOf(detail.value_tier) }}</span>
          <span class="detail-badge">{{ detail.sea_status === 'private' ? '私海' : '公海' }}</span>
        </div>

        <a-descriptions :column="3" size="small" bordered class="detail-facts">
          <a-descriptions-item v-for="item in facts" :key="item.label" :label="item.label">
            {{ item.value }}
          </a-descriptions-item>
        </a-descriptions>

        <h3 class="detail-section">成员</h3>
        <a-table
          :columns="memberColumns"
          :data-source="detail.members"
          :pagination="false"
          row-key="employee.id"
          size="small"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'employee'">
              {{ record.employee?.name ?? '（员工已停用）' }}
            </template>
            <template v-else-if="column.key === 'memberType'">
              {{ memberTypeNameOf(record.member_type) }}
            </template>
            <template v-else-if="column.key === 'source'">
              {{ memberSourceNameOf(record.source) }}
            </template>
            <template v-else-if="column.key === 'validUntil'">
              {{ formatDateTime(record.valid_until) }}
            </template>
          </template>
          <template #emptyText>
            <a-empty description="暂无成员" />
          </template>
        </a-table>

        <p class="detail-hint">
          合同 / 工单 / 关系网 / 复盘等分组属后续里程碑（服务端尚未提供对应数据）——
          本页**不摆点了没用的入口**；时间线仍在列表页那一行的「时间线」抽屉里（M4-17 已落）。
        </p>
      </template>

      <a-empty v-else-if="!loading && errorText === ''" description="没有这条业务关系" />
    </a-spin>
  </section>
</template>

<style scoped>
.detail {
  max-width: 1080px;
}

.detail-back {
  padding-left: 0;
  margin-bottom: var(--crm-space-sm);
}

.detail-title {
  margin: 0 0 var(--crm-space-sm);
  font-size: var(--crm-font-size-2xl);
  font-weight: var(--crm-font-weight-strong);
  color: var(--crm-color-text);
}

.detail-badges {
  display: flex;
  flex-wrap: wrap;
  gap: var(--crm-space-xs);
  margin-bottom: var(--crm-space-md);
}

.detail-badge {
  display: inline-flex;
  align-items: center;
  gap: var(--crm-space-xxs);
  height: 28px;
  padding: 0 var(--crm-space-sm);
  font-size: var(--crm-font-size-xs);
  color: var(--crm-color-text-secondary);
  background: var(--crm-color-bg-container);
  border: var(--crm-border-width) solid var(--crm-color-border-secondary);
  border-radius: var(--crm-radius-pill);
}

.detail-dot {
  width: 8px;
  height: 8px;
  border-radius: var(--crm-radius-pill);
}

.detail-facts {
  margin-bottom: var(--crm-space-lg);
}

.detail-section {
  margin: var(--crm-space-lg) 0 var(--crm-space-sm);
  font-size: var(--crm-font-size-lg);
  font-weight: var(--crm-font-weight-strong);
  color: var(--crm-color-text);
}

.detail-error {
  margin: 0 0 var(--crm-space-sm);
  font-size: var(--crm-font-size-xs);
  color: var(--crm-color-error);
}

.detail-hint {
  margin: var(--crm-space-lg) 0 0;
  font-size: var(--crm-font-size-xs);
  color: var(--crm-color-text-tertiary);
}
</style>
