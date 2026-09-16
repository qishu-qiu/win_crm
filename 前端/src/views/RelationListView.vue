<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { message, type TablePaginationConfig } from 'ant-design-vue'

import {
  createCommitment,
  listCommitments,
  listEvents,
  quickMark,
  recordEvent,
  updateCommitment,
  type ActionEvent,
  type Commitment,
  type RecordEventInput,
} from '../api/engine'
import {
  RELATION_PAGE_SIZE_DEFAULT,
  listRelations,
  type RelationTab,
  type RelationVo,
} from '../api/relation'
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
  RELATION_VIEW_OPTIONS,
  URGENCY_OPTIONS,
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
 *
 * ★ **M6-07 分页**（→ 接口 §2.3 分页形态 / §2.7；设计规范 §4.3「列表类一律分页、不用无限滚动」）：
 *   页码 / 每页条数交给**表格自带分页器**（表格右下、「共 N 条」＋ 20/50/100 ＋ 快速跳页）；
 *   翻页即**重新取数**（服务端分页）。
 *   ⚠ **不许把全量拉回来在前端切片**：那是假分页 —— 数据一多就白拉全表，且「共 N 条」
 *     会退化成「本页 N 条」（`list.length` 不是总数，`total` 只有服务端知道）。
 */
const tab = ref<RelationTab>('private')
const rows = ref<RelationVo[]>([])
const loading = ref(false)
const errorText = ref('')

/** 页码（从 1 起）/ 每页条数 / 总条数：三者**都以后端出参为准**，页面不自己算 */
const page = ref(1)
const pageSize = ref(RELATION_PAGE_SIZE_DEFAULT)
const total = ref(0)

/**
 * 筛选状态（→ 接口 §5.6）：`view` 单选（视图 4 档）、`urgencies` **多选**（紧迫档 5 档，空＝不筛）。
 * ★ **筛选一律由服务端做**（`GET /relations?view=&urgency=`）—— 页面**不许**本地过滤：
 *   一分页就只能筛当前页（第 2 页的「周重点」会被漏掉），「共 N 条」也会退化成"本页条数"。
 */
const view = ref('all')
const urgencies = ref<string[]>([])

/** 每页条数可选值：逐字取设计规范 §4.3「20 / 50 / 100」（AntD 的 `pageSizeOptions` 收字符串） */
const PAGE_SIZE_OPTIONS = ['20', '50', '100']

/**
 * 批量快速标记（M6-09 片 3）—— 勾选多行 → 三选一（未联系 / 未接电话 / 说两句挂了）。
 *
 * 口径来源（★ 真相源，勿自造）：
 *   · 功能 →《销售CRM前端页面与交互文档》§5 第 5 条（业务关系列表「含批量快速标记」）
 *     ＋ §3（「勾选多客户 → 一次性标记」；落库但**不算有效跟进、不重置掉海倒计时**）。
 *   · ⚠ **公海不提供标记**（同文档 §9/10「公海内不做任何动作」，2026-09-12 定）：
 *     故动作条**只在「私海」页签出现** —— 公海是"看号 → 打 → 领取"的动线，领取后才进推进态。
 *     （⚠ 已知缺口：服务端 `requireWritableRelation` **暂未拦公海关系**，写跟单 / 快速标记
 *     在公海也能落库 —— 已登记欠账，本页**不据此放宽**：规格说不行就是不行。）
 *
 * ★ 判定全在服务端（→ 接口 §5.7）：关系侧判**可写**（越权 / 只读 → 403）；
 *   页面**不自己判**"这条能不能标"（判一遍＝第二套规则）。
 * ★ 报数**只信服务端**的 `marked`（＝实际落库条数），不拿"勾了几条"当结果 ——
 *   服务端会做去重（同一对象勾两次＝一条）。
 */
type QuickMarkOutcome = (typeof QUICK_MARK_OUTCOME_OPTIONS)[number]

/** 勾选中的关系 id（**只是选择状态**，不代表能标 —— 能不能标由服务端说了算） */
const selectedRelationIds = ref<string[]>([])
/** 正在提交的那一型（用于按钮 loading；同时也用来禁用其它两个按钮，防连点两下写两批） */
const markingOutcome = ref<QuickMarkOutcome | null>(null)

/** 勾选框只在**私海**出现：公海不提供任何动作（→ 前端文档 §9/10），给了勾选框就是给假入口 */
const rowSelection = computed(() =>
  tab.value === 'private'
    ? {
        selectedRowKeys: selectedRelationIds.value,
        onChange: (keys: (string | number)[]): void => {
          selectedRelationIds.value = keys.map((key) => String(key))
        },
      }
    : undefined,
)

/**
 * 提交批量标记。
 * ★ 成功后**清空勾选**并重新取数：服务端不回写 `last_event_at`，列表看着可能"没变化"，
 *   但勾选必须清掉 —— 留着勾选会让人以为"上一批没标上"，再点一次就多落一批。
 */
async function batchMark(outcome: QuickMarkOutcome): Promise<void> {
  if (selectedRelationIds.value.length === 0) return

  markingOutcome.value = outcome
  try {
    const result = await quickMark({
      relation_ids: [...selectedRelationIds.value],
      outcome,
    })
    message.success(`已标记 ${result.marked} 条`)
    selectedRelationIds.value = []
    await load()
  } catch {
    // 失败原因（403 / 参数）由请求层统一弹出，这里不重复堆一层提示；勾选**保留**，便于换了再试
  } finally {
    markingOutcome.value = null
  }
}

function clearSelection(): void {
  selectedRelationIds.value = []
}

const paginationConfig = computed(() => ({
  current: page.value,
  pageSize: pageSize.value,
  total: total.value,
  showSizeChanger: true,
  pageSizeOptions: PAGE_SIZE_OPTIONS,
  showQuickJumper: true,
  showTotal: (count: number) => `共 ${count} 条`,
}))

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
  // ★ 每次重新取数前**先清勾选**：翻页 / 换页签 / 改筛选之后，选中的行可能已经不在这一屏 ——
  //   留着勾选会让人对着一屏没勾的行点「快速标记」，标到他看不见的旧行上
  selectedRelationIds.value = []
  loading.value = true
  try {
    const result = await listRelations({
      tab: tab.value,
      page: page.value,
      pageSize: pageSize.value,
      view: view.value,
      urgencies: urgencies.value,
    })
    rows.value = result.list
    total.value = result.total
  } catch (error) {
    // 403（交付 / 客服不进公海）与网络错误都走这里：**内联**说清，列表清空（不显示上次的残留）
    rows.value = []
    total.value = 0
    errorText.value = error instanceof Error ? error.message : '加载失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

/** 分页器交互（翻页 / 改每页条数）→ 重新取数 */
function onPageChange(pager: TablePaginationConfig): void {
  page.value = pager.current ?? 1
  pageSize.value = pager.pageSize ?? RELATION_PAGE_SIZE_DEFAULT
  void load()
}

/**
 * 筛选变化 → **页码必须回第 1 页**再取数。
 * ★ 不回会看到**空表**：停在第 3 页时一筛，结果集可能只剩 1 页 ——
 *   用户会以为"没数据"，实际只是页码越界（这类假空态最费口舌）。
 */
function onFilterChange(): void {
  page.value = 1
  void load()
}

function selectView(next: string): void {
  if (view.value === next) return
  view.value = next
  onFilterChange()
}

/** 紧迫档**多选**：再点一次＝取消该档（与 chip 的通用交互一致，不另造"清空"按钮） */
function toggleUrgency(code: string): void {
  urgencies.value = urgencies.value.includes(code)
    ? urgencies.value.filter((item) => item !== code)
    : [...urgencies.value, code]
  onFilterChange()
}

watch(tab, () => {
  // ★ 换页签＝换一份结果集，页码必须回第 1 页：停在第 3 页切过去时新页签可能只有 1 页，
  //   用户看到空表会以为「没数据」（实际只是页码越界）
  page.value = 1
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

    <!-- 筛选栏（→ 前端文档 §5；**筛选在服务端做**，见脚本头注释） -->
    <div class="relations-filters">
      <span class="relations-filter-label">视图</span>
      <button
        v-for="item in RELATION_VIEW_OPTIONS"
        :key="item.value"
        type="button"
        class="relations-chip"
        :class="{ 'is-active': view === item.value }"
        @click="selectView(item.value)"
      >
        {{ item.label }}
      </button>

      <span class="relations-filter-label">紧迫档</span>
      <button
        v-for="item in URGENCY_OPTIONS"
        :key="item.value"
        type="button"
        class="relations-chip"
        :class="{ 'is-active': urgencies.includes(item.value) }"
        @click="toggleUrgency(item.value)"
      >
        <span class="relations-dot" :style="{ background: urgencyColorOf(item.value) }" />
        {{ item.label }}
      </button>
    </div>

    <p v-if="errorText" class="relations-error">{{ errorText }}</p>

    <!-- 批量快速标记动作条（→ 前端文档 §5 第 5 条 / §3）：**只在私海**（公海不提供动作，→ §9/10） -->
    <div v-if="tab === 'private' && selectedRelationIds.length > 0" class="relations-bulk">
      <span class="relations-bulk-count">已选 {{ selectedRelationIds.length }} 条</span>
      <span class="relations-filter-label">快速标记</span>
      <a-button
        v-for="code in QUICK_MARK_OUTCOME_OPTIONS"
        :key="code"
        size="small"
        :loading="markingOutcome === code"
        :disabled="markingOutcome !== null"
        @click="batchMark(code)"
      >
        {{ outcomeNameOf(code) }}
      </a-button>
      <a-button
        type="text"
        size="small"
        :disabled="markingOutcome !== null"
        @click="clearSelection"
      >
        取消选择
      </a-button>
      <span class="relations-bulk-hint">
        快速标记只记一笔「尝试联系」：不算有效跟进、也不重置掉海倒计时。
      </span>
    </div>

    <a-table
      :columns="columns"
      :data-source="rows"
      :loading="loading"
      :pagination="paginationConfig"
      :row-selection="rowSelection"
      row-key="id"
      size="middle"
      @change="onPageChange"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'company'">
          <!-- 实体可点（→ README §九 不变量⑥「任何位置出现都可点开」；解欠账 D-13） -->
          <router-link v-if="record.company" :to="`/relations/${record.id}`" class="relations-link">
            {{ record.company.name }}
          </router-link>
          <template v-else>（档案已删除）</template>
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

/** 筛选栏：视图 seg ＋ 紧迫档 chip（→ 设计规范 §4.2 单行 inline、控件高统一、高频筛选项 ≤5） */
.relations-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--crm-space-xs);
  margin-bottom: var(--crm-space-md);
}

.relations-filter-label {
  margin-left: var(--crm-space-sm);
  font-size: var(--crm-font-size-xs);
  color: var(--crm-color-text-tertiary);
}

.relations-filter-label:first-child {
  margin-left: 0;
}

/** chip 与页签**同一族视觉**（选中＝主色描边 ＋ 浅底），不为一处控件新造一套 */
.relations-chip {
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
  cursor: pointer;
}

.relations-chip.is-active {
  color: var(--crm-color-primary);
  border-color: var(--crm-color-primary);
  background: var(--crm-color-primary-bg);
}

/** 批量动作条：同类操作聚成一条、只勾选后才出现（→ 设计规范 §4.4） */
.relations-bulk {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--crm-space-xs);
  padding: var(--crm-space-xs) var(--crm-space-sm);
  margin-bottom: var(--crm-space-md);
  background: var(--crm-color-primary-bg);
  border: var(--crm-border-width) solid var(--crm-color-primary);
  border-radius: var(--crm-radius-sm);
}

.relations-bulk-count {
  font-size: var(--crm-font-size-base);
  font-weight: var(--crm-font-weight-strong);
  color: var(--crm-color-primary);
}

.relations-bulk-hint {
  font-size: var(--crm-font-size-xs);
  color: var(--crm-color-text-secondary);
}

/** 错误态：§4.6「错误文案红 12px」（与登录页 / 建档页同一形态） */
.relations-error {
  margin: 0 0 var(--crm-space-sm);
  font-size: var(--crm-font-size-xs);
  color: var(--crm-color-error);
}

/** 可点实体（→ README §九 不变量⑥「任何位置出现都可点开」，与链接同色、不加下划线噪音） */
.relations-link {
  color: var(--crm-color-primary);
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
