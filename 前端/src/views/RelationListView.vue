<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { message } from 'ant-design-vue'

import {
  createCommitment,
  listCommitments,
  listEvents,
  recordEvent,
  updateCommitment,
  type ActionEvent,
  type Commitment,
  type RecordEventInput,
} from '../api/engine'
import { listRelations, type RelationTab, type RelationVo } from '../api/relation'
import {
  ACTION_TYPE_OPTIONS,
  COMMITMENT_CTYPE_OPTIONS,
  COMMITMENT_PARTY_OPTIONS,
  EFFECTIVE_OUTCOME_OPTIONS,
  QUICK_MARK_OUTCOME_OPTIONS,
  actionTypeNameOf,
  branchNameOf,
  commitmentPartyNameOf,
  commitmentStatusNameOf,
  outcomeNameOf,
} from '../engine'
import {
  formatDateTime,
  stageNameOf,
  urgencyColorOf,
  urgencyNameOf,
  valueTierNameOf,
} from '../relation'

/**
 * 业务关系列表页（M3-14 起 · 方案 A 最小页）—— **私海 / 公海两个页签**，
 * M4-17 起每行可**点开时间线**（写跟单 / 看承诺）。
 *
 * 判据逐字（《开发计划-V1》M3-14 / M4-17）：
 *   · M3-14「页面上能看到两条列表，**数据与 curl 一致**」；
 *   · M4-17「**页面上写跟单后，时间线看得到**」。
 *
 * 口径来源（★ 真相源，勿自造）：
 *   · 两个页签与列 →《销售CRM接口API文档》§4.4 / §5.6（列表项字段）。
 *   · **数据由服务端按数据范围收敛**（→ §2.2），页面**不再自己过滤**：
 *     前端过滤＝第二套范围口径（改了服务端忘了前端就露客户），这是本项目反复点名的
 *     「双真相源」；页面只负责**把服务端的答案显示出来**。
 *   · **交付 / 客服点公海 → 403** 是**正常分支**（§2.2「不进公海」）：显示内联无权限说明，
 *     不是报错崩溃（→ 设计规范 §5.1 空态 / §4.6 错误态）。
 *   · 空态用 `a-empty`；**不预填演示数据**（→ 设计规范 §3.2 第 11 条）。
 *
 * ★ 时间线抽屉**不自己写业务规则**：有效沟通要不要写「一句话结果」、快速标记算不算有效跟进、
 *   同内容重复提交算不算重复 —— 全部由服务端判（页面只把服务端的人话 show 出来）。
 *   前端再判一遍＝第二套规则，迟早与后端分叉（本项目点名的坑）。
 */
const tab = ref<RelationTab>('private')
const rows = ref<RelationVo[]>([])
const loading = ref(false)
const errorText = ref('')

const tabLabel = computed(() => (tab.value === 'private' ? '私海' : '公海'))

const columns = [
  { title: '公司', dataIndex: 'company', key: 'company', width: 220 },
  { title: '部门', dataIndex: 'dept', key: 'dept', width: 110 },
  { title: '产品线', dataIndex: 'productLine', key: 'productLine', width: 110 },
  { title: '阶段', dataIndex: 'stage', key: 'stage', width: 120 },
  { title: '紧迫', dataIndex: 'urgency', key: 'urgency', width: 100 },
  { title: '开发价值', dataIndex: 'valueTier', key: 'valueTier', width: 90 },
  { title: '主责', dataIndex: 'owner', key: 'owner', width: 100 },
  { title: '最近沟通', dataIndex: 'lastEventAt', key: 'lastEventAt', width: 150 },
  { title: '操作', dataIndex: 'actions', key: 'actions', width: 90 },
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

// ===== M4-17 时间线抽屉 =====

const drawerOpen = ref(false)
const activeRelation = ref<RelationVo | null>(null)
const events = ref<ActionEvent[]>([])
const commitments = ref<Commitment[]>([])
const timelineLoading = ref(false)
const timelineError = ref('')
const submittingEvent = ref(false)
const submittingCommitment = ref(false)

const drawerTitle = computed(() =>
  activeRelation.value === null
    ? '关系时间线'
    : `时间线 · ${activeRelation.value.company?.name ?? '（档案已删除）'}`,
)

/** 写跟单表单（默认「电话 + 有进展」——最常见的一次有效沟通） */
const eventForm = ref<{
  action_type: string
  outcome: string
  summary: string
  duration_min: number | null
}>({ action_type: 'phone', outcome: 'advanced', summary: '', duration_min: null })

/** 建承诺表单（→ 需求 §10.1：三快选：我发资料 / 他给答复 / 约见面） */
const commitmentForm = ref({ party: 'me', ctype: 'deliver', content: '', due_at: '' })

const eventColumns = [
  { title: '动作', dataIndex: 'actionType', key: 'actionType', width: 90 },
  { title: '一句话结果', dataIndex: 'summary', key: 'summary' },
  { title: '结果', dataIndex: 'outcome', key: 'outcome', width: 100 },
  { title: '谁写的', dataIndex: 'actor', key: 'actor', width: 90 },
  { title: '分线', dataIndex: 'branch', key: 'branch', width: 70 },
  { title: '时间', dataIndex: 'eventAt', key: 'eventAt', width: 150 },
]

const commitmentColumns = [
  { title: '承诺人', dataIndex: 'party', key: 'party', width: 110 },
  { title: '内容', dataIndex: 'content', key: 'content' },
  { title: '到期', dataIndex: 'due', key: 'due', width: 150 },
  { title: '状态', dataIndex: 'status', key: 'status', width: 90 },
  { title: '操作', dataIndex: 'actions', key: 'actions', width: 80 },
]

const actionTypeOptions = ACTION_TYPE_OPTIONS.map((code) => ({
  value: code,
  label: actionTypeNameOf(code),
}))

const outcomeOptions = [
  { value: '', label: '（不填结果）' },
  ...EFFECTIVE_OUTCOME_OPTIONS.map((code) => ({ value: code, label: outcomeNameOf(code) })),
  ...QUICK_MARK_OUTCOME_OPTIONS.map((code) => ({
    value: code,
    label: `快速标记·${outcomeNameOf(code)}`,
  })),
]

function openTimeline(record: RelationVo): void {
  activeRelation.value = record
  drawerOpen.value = true
  void refreshTimeline()
}

async function refreshTimeline(): Promise<void> {
  const relation = activeRelation.value
  if (relation === null) return

  timelineError.value = ''
  timelineLoading.value = true
  try {
    const [eventRows, commitmentRows] = await Promise.all([
      listEvents(relation.id),
      listCommitments(relation.id),
    ])
    events.value = eventRows
    commitments.value = commitmentRows
  } catch (error) {
    events.value = []
    commitments.value = []
    timelineError.value = error instanceof Error ? error.message : '加载失败，请稍后重试'
  } finally {
    timelineLoading.value = false
  }
}

function onDrawerClose(): void {
  activeRelation.value = null
  events.value = []
  commitments.value = []
  timelineError.value = ''
}

async function submitEvent(): Promise<void> {
  const relation = activeRelation.value
  if (relation === null) return

  const input: RecordEventInput = { action_type: eventForm.value.action_type }
  if (eventForm.value.outcome !== '') input.outcome = eventForm.value.outcome
  if (eventForm.value.summary.trim() !== '') input.summary = eventForm.value.summary.trim()
  if (eventForm.value.duration_min !== null) input.duration_min = eventForm.value.duration_min

  submittingEvent.value = true
  try {
    await recordEvent(relation.id, input)
    message.success('已记下这条跟单')
    eventForm.value.summary = ''
    eventForm.value.duration_min = null
    await refreshTimeline()
    // 列表上的「最近沟通」也要跟着变（同一次动作，两处显示不能不一致）
    await load()
  } catch {
    // 失败原因（含「有效沟通必须写一句话结果」）由请求层统一弹出，这里不重复堆一层提示
  } finally {
    submittingEvent.value = false
  }
}

async function submitCommitment(): Promise<void> {
  const relation = activeRelation.value
  if (relation === null) return

  submittingCommitment.value = true
  try {
    await createCommitment(relation.id, {
      party: commitmentForm.value.party,
      ctype: commitmentForm.value.ctype,
      content: commitmentForm.value.content.trim(),
      ...(commitmentForm.value.due_at === ''
        ? {}
        : { due_at: new Date(`${commitmentForm.value.due_at}T00:00:00`).toISOString() }),
    })
    message.success('承诺已建')
    commitmentForm.value.content = ''
    commitmentForm.value.due_at = ''
    await refreshTimeline()
  } catch {
    // 同上：错误由请求层统一表达
  } finally {
    submittingCommitment.value = false
  }
}

async function markDone(commitment: Commitment): Promise<void> {
  const relation = activeRelation.value
  if (relation === null) return

  try {
    await updateCommitment(relation.id, { id: commitment.id, status: 'done' })
    message.success('已兑现')
    await refreshTimeline()
  } catch {
    // 同上
  }
}

/** 正在填豁免原因的那条承诺（`null` ＝ 没在填） */
const waivingId = ref<string | null>(null)
const waiveReasonDraft = ref('')
const submittingWaive = ref(false)

/**
 * 点「豁免」→ 展开原因输入。
 * ★ 为什么要展开：豁免＝**确有其事但做不成**，服务端**必填原因**（→ 需求 §10.1）；
 *   与「取消」（录错了 / 不成立，不填原因）是两件事，不能合并成一个按钮。
 */
function startWaive(commitment: Commitment): void {
  waivingId.value = commitment.id
  waiveReasonDraft.value = ''
}

function cancelWaive(): void {
  waivingId.value = null
  waiveReasonDraft.value = ''
}

/** 提交豁免（空原因不发请求：服务端也会 422，但本地先拦一步，省一个来回） */
async function submitWaive(commitment: Commitment): Promise<void> {
  const relation = activeRelation.value
  if (relation === null) return

  const reason = waiveReasonDraft.value.trim()
  if (reason === '') {
    message.warning('豁免必须填原因（写清为什么做不成）')
    return
  }

  submittingWaive.value = true
  try {
    await updateCommitment(relation.id, {
      id: commitment.id,
      status: 'waived',
      waive_reason: reason,
    })
    message.success('已豁免')
    cancelWaive()
    await refreshTimeline()
  } catch {
    // 同上：错误由请求层统一表达
  } finally {
    submittingWaive.value = false
  }
}
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
        <template v-else-if="column.key === 'actions'">
          <a-button type="link" size="small" @click="openTimeline(record)">时间线</a-button>
        </template>
      </template>

      <template #emptyText>
        <a-empty :description="errorText === '' ? `${tabLabel}暂无业务关系` : '无权限查看该列表'" />
      </template>
    </a-table>

    <a-drawer
      v-model:open="drawerOpen"
      :title="drawerTitle"
      :width="760"
      @close="onDrawerClose"
    >
      <p v-if="timelineError" class="relations-error">{{ timelineError }}</p>

      <h3 class="drawer-section">记一条跟单</h3>
      <div class="drawer-form">
        <a-select
          v-model:value="eventForm.action_type"
          :options="actionTypeOptions"
          style="width: 120px"
        />
        <a-select
          v-model:value="eventForm.outcome"
          :options="outcomeOptions"
          style="width: 170px"
        />
        <a-input
          v-model:value="eventForm.summary"
          placeholder="一句话结果（有效沟通必填）"
          style="width: 240px"
        />
        <a-input-number
          v-model:value="eventForm.duration_min"
          :min="1"
          placeholder="分钟"
          style="width: 100px"
        />
        <a-button type="primary" :loading="submittingEvent" @click="submitEvent">记下来</a-button>
      </div>

      <h3 class="drawer-section">时间线（按时间倒序，默认近 1 个月）</h3>
      <a-table
        :columns="eventColumns"
        :data-source="events"
        :loading="timelineLoading"
        :pagination="false"
        row-key="id"
        size="small"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'actionType'">{{ actionTypeNameOf(record.action_type) }}</template>
          <template v-else-if="column.key === 'summary'">{{ record.summary ?? '—' }}</template>
          <template v-else-if="column.key === 'outcome'">{{ outcomeNameOf(record.outcome) }}</template>
          <template v-else-if="column.key === 'actor'">{{ record.actor?.name ?? '—' }}</template>
          <template v-else-if="column.key === 'branch'">{{ branchNameOf(record.branch) }}</template>
          <template v-else-if="column.key === 'eventAt'">{{ formatDateTime(record.event_at) }}</template>
        </template>
        <template #emptyText>
          <a-empty description="近 1 个月还没有跟单记录" />
        </template>
      </a-table>

      <h3 class="drawer-section">承诺</h3>
      <div class="drawer-form">
        <a-select
          v-model:value="commitmentForm.party"
          :options="COMMITMENT_PARTY_OPTIONS"
          style="width: 200px"
        />
        <a-select
          v-model:value="commitmentForm.ctype"
          :options="COMMITMENT_CTYPE_OPTIONS"
          style="width: 130px"
        />
        <a-input
          v-model:value="commitmentForm.content"
          placeholder="一句话承诺"
          style="width: 200px"
        />
        <input v-model="commitmentForm.due_at" type="date" class="drawer-date" />
        <a-button :loading="submittingCommitment" @click="submitCommitment">建承诺</a-button>
      </div>

      <a-table
        :columns="commitmentColumns"
        :data-source="commitments"
        :pagination="false"
        row-key="id"
        size="small"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'party'">{{ commitmentPartyNameOf(record.party) }}</template>
          <template v-else-if="column.key === 'content'">{{ record.content }}</template>
          <template v-else-if="column.key === 'due'">{{ formatDateTime(record.due_at) }}</template>
          <template v-else-if="column.key === 'status'">
            {{ commitmentStatusNameOf(record.status) }}
            <span v-if="record.waive_reason">（{{ record.waive_reason }}）</span>
          </template>
          <template v-else-if="column.key === 'actions'">
            <template v-if="record.status === 'open'">
              <template v-if="waivingId === record.id">
                <a-input
                  v-model:value="waiveReasonDraft"
                  size="small"
                  placeholder="为什么做不成（客户变卦 / 预算冻结…）"
                  style="width: 200px"
                />
                <a-button
                  type="link"
                  size="small"
                  :loading="submittingWaive"
                  @click="submitWaive(record)"
                >
                  确定豁免
                </a-button>
                <a-button type="link" size="small" @click="cancelWaive">不豁免</a-button>
              </template>
              <template v-else>
                <a-button type="link" size="small" @click="markDone(record)">兑现</a-button>
                <a-button type="link" size="small" @click="startWaive(record)">豁免</a-button>
              </template>
            </template>
            <span v-else>—</span>
          </template>
        </template>
        <template #emptyText>
          <a-empty description="暂无承诺" />
        </template>
      </a-table>
    </a-drawer>
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

.drawer-section {
  margin: var(--crm-space-lg) 0 var(--crm-space-sm);
  font-size: var(--crm-font-size-lg);
  font-weight: var(--crm-font-weight-strong);
  color: var(--crm-color-text);
}

.drawer-section:first-of-type {
  margin-top: 0;
}

.drawer-form {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--crm-space-sm);
  margin-bottom: var(--crm-space-md);
}

/** 原生日期输入：与 antd 输入框视觉对齐（不为一处小控件再引一个日期组件） */
.drawer-date {
  height: 32px;
  padding: 0 var(--crm-space-xs);
  font-size: var(--crm-font-size-base);
  color: var(--crm-color-text);
  background: var(--crm-color-bg-container);
  border: var(--crm-border-width) solid var(--crm-color-border-secondary);
  border-radius: var(--crm-radius-sm);
}
</style>
