<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import { listRelations, type RelationTab, type RelationVo } from '../api/relation'
import { formatDateTime, stageNameOf, urgencyColorOf, urgencyNameOf, valueTierNameOf } from '../relation'

/**
 * 业务关系列表页（M3-14 · 方案 A 最小页）—— **私海 / 公海两个页签**。
 *
 * 判据逐字（《开发计划-V1》M3-14）：「页面上能看到两条列表，**数据与 curl 一致**」。
 *
 * 口径来源（★ 真相源，勿自造）：
 *   · 两个页签与列 →《销售CRM接口API文档》V1.16 §4.4 / §5.6（列表项字段）。
 *   · **数据由服务端按数据范围收敛**（→ §2.2），页面**不再自己过滤**：
 *     前端过滤＝第二套范围口径（改了服务端忘了前端就露客户），这是本项目反复点名的
 *     「双真相源」；页面只负责**把服务端的答案显示出来**。
 *   · **交付 / 客服点公海 → 403** 是**正常分支**（§2.2「不进公海」）：显示内联无权限说明，
 *     不是报错崩溃（→ 设计规范 §5.1 空态 / §4.6 错误态）。
 *   · 空态用 `a-empty`；**不预填演示数据**（→ 设计规范 §3.2 第 11 条）。
 *
 * ⚠ 本页**只读**：激活（`POST /relations`）、改属性、加成员虽然后端已可用（M3-09~11），
 *   但「建档页式的写入动线」不在 M3-14 判据里 —— 不在本页顺手加半个表单（半成品比没有更糟）。
 */
const tab = ref<RelationTab>('private')
const rows = ref<RelationVo[]>([])
const loading = ref(false)
const errorText = ref('')

const tabLabel = computed(() => (tab.value === 'private' ? '私海' : '公海'))

const columns = [
  { title: '公司', dataIndex: 'company', key: 'company', width: 240 },
  { title: '部门', dataIndex: 'dept', key: 'dept', width: 120 },
  { title: '产品线', dataIndex: 'productLine', key: 'productLine', width: 120 },
  { title: '阶段', dataIndex: 'stage', key: 'stage', width: 130 },
  { title: '紧迫', dataIndex: 'urgency', key: 'urgency', width: 110 },
  { title: '开发价值', dataIndex: 'valueTier', key: 'valueTier', width: 100 },
  { title: '主责', dataIndex: 'owner', key: 'owner', width: 110 },
  { title: '最近沟通', dataIndex: 'lastEventAt', key: 'lastEventAt', width: 160 },
]

async function load(): Promise<void> {
  errorText.value = ''
  loading.value = true
  try {
    rows.value = await listRelations(tab.value)
  } catch (error) {
    // 403（交付 / 客服不进公海）与网络错误都走这里：**内联**说清，列表清空（不显示上次的残留）
    rows.value = []
    errorText.value = error instanceof Error ? error.message : '加载失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

watch(tab, () => {
  void load()
})

onMounted(() => {
  void load()
})
</script>

<template>
  <section class="relations">
    <h2 class="relations-title">业务关系</h2>
    <p class="relations-hint">
      列表由服务端按你的数据范围收敛：销售＝我参与的关系 ＋ 我所属部门的公海；经理＝管辖部门；
      总经理 / 管理员＝全部。
    </p>

    <div class="relations-tabs">
      <button
        v-for="item in (['private', 'sea'] as RelationTab[])"
        :key="item"
        type="button"
        class="relations-tab"
        :class="{ 'is-active': tab === item }"
        :aria-current="tab === item ? 'page' : undefined"
        @click="tab = item"
      >
        {{ item === 'private' ? '私海' : '公海' }}
      </button>
    </div>

    <p v-if="errorText" class="relations-error">{{ errorText }}</p>

    <a-table
      :columns="columns"
      :data-source="rows"
      :loading="loading"
      :pagination="false"
      row-key="id"
      size="middle"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'company'">
          {{ record.company?.name ?? '（档案已删除）' }}
        </template>
        <template v-else-if="column.key === 'dept'">{{ record.dept?.name ?? '—' }}</template>
        <template v-else-if="column.key === 'productLine'">
          {{ record.product_line?.name ?? '—' }}
        </template>
        <template v-else-if="column.key === 'stage'">{{ stageNameOf(record.stage) }}</template>
        <template v-else-if="column.key === 'urgency'">
          <span class="relations-urgency">
            <span class="relations-dot" :style="{ background: urgencyColorOf(record.urgency) }" />
            {{ urgencyNameOf(record.urgency) }}
          </span>
        </template>
        <template v-else-if="column.key === 'valueTier'">
          {{ valueTierNameOf(record.value_tier) }}
        </template>
        <template v-else-if="column.key === 'owner'">
          {{ record.owner?.name ?? '（公海 · 待领取）' }}
        </template>
        <template v-else-if="column.key === 'lastEventAt'">
          {{ formatDateTime(record.last_event_at) }}
        </template>
      </template>

      <template #emptyText>
        <a-empty :description="errorText === '' ? `${tabLabel}暂无业务关系` : '无权限查看该列表'" />
      </template>
    </a-table>
  </section>
</template>

<style scoped>
.relations {
  max-width: 1080px;
}

.relations-title {
  margin: 0 0 var(--crm-space-xs);
  font-size: var(--crm-font-size-2xl);
  font-weight: var(--crm-font-weight-strong);
  color: var(--crm-color-text);
}

.relations-hint {
  margin: 0 0 var(--crm-space-lg);
  font-size: var(--crm-font-size-base);
  color: var(--crm-color-text-tertiary);
}

.relations-tabs {
  display: flex;
  gap: var(--crm-space-xs);
  margin-bottom: var(--crm-space-md);
}

/** 页签＝同一控件的两种状态，不靠加粗堆层级（与外壳导航同款样式） */
.relations-tab {
  height: 32px;
  padding: 0 var(--crm-space-md);
  font-size: var(--crm-font-size-base);
  color: var(--crm-color-text-secondary);
  background: var(--crm-color-bg-container);
  border: var(--crm-border-width) solid var(--crm-color-border-secondary);
  border-radius: var(--crm-radius-sm);
  cursor: pointer;
}

.relations-tab.is-active {
  color: var(--crm-color-primary);
  border-color: var(--crm-color-primary);
  background: var(--crm-color-primary-bg);
}

/** 错误态：§4.6「错误文案红 12px」（与登录页 / 建档页同一形态） */
.relations-error {
  margin: 0 0 var(--crm-space-sm);
  font-size: var(--crm-font-size-xs);
  color: var(--crm-color-error);
}

/** 状态＝圆点 ＋ 文字（→ 设计规范 §4.4） */
.relations-urgency {
  display: inline-flex;
  align-items: center;
  gap: var(--crm-space-xxs);
}

.relations-dot {
  width: 8px;
  height: 8px;
  border-radius: var(--crm-radius-pill);
}
</style>
