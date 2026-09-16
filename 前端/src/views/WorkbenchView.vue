<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { fetchTodayAgenda, type AgendaItem } from '../api/engine'
import { agendaStatusNameOf, refTypeNameOf } from '../engine'

/**
 * 工作台（M4-17 最小版 → **M6-06 补全**）—— 「今日该找谁」。
 *
 * 口径来源（★ 真相源，勿自造）：
 *   · 《销售CRM前端页面与交互文档》§3.5 / §六-3：今日概览 ＋ 动作条直通 ＋ 今日安排 ＋ 本周重点；
 *     §五 页面清单 #3＝「工作台 /workbench」（含外出登记入口）。
 *   · 《销售CRM接口API文档》§5.7 动线条目 `{id,ref_type,ref_id,relation,contact,reason,
 *     priority,action_hint,status,snooze_count}`；§4.14.4 处理反馈（`done` / `snoozed` / `ignored`）。
 *   · 《销售CRM业务需求文档》§10.4：**同类提醒自动合并**（相同类型 ＋ 相同原因）、
 *     snoozed 上限 3 次、ignored 必填原因。
 *   · 《销售CRM数据架构文档》D4：`daily_agenda` 是**每日组装产物**，`done` / `ignored` 不再推。
 *
 * ★ 页面**不自己过滤 / 排序**：范围（只给我自己的）与顺序（优先级）都由服务端定
 *   —— 前端再排一次就是第二套口径（本项目反复点名的双真相源）。
 * ★ **同类合并是「展示层分组」，不是重排**：分组按首次出现位置落座，组内顺序＝服务端给的顺序。
 *   `reason` 为空的条目**不参与合并**（拿不出"相同原因"这个前提，合了就是编）。
 *
 * ⚠ **本批的实情（不谎报）**：
 *   ① 动线条目由**每日 05:00 的组装任务**产生（属 M7）—— 本批只有「直查」这一半，
 *      库里没有当日行就是**空数组**，页面照实说清，**不用假数据撑满**（→ 设计规范 §3.2 第 11 条）。
 *   ② 规格里「逾期未跟进 / 今日预约 / 本周重点 / 今日已跟进」四个数**取不到**：动线条目
 *      不带到期时间与逾期天数，预约 / 紧迫档 / 按日事件查询的接口都还没建 ⇒ 概览只放
 *      **能从动线条目真算出来的三个数**，缺的写明缺口，**不填假数**。
 *   ③ 也因此**不用红**：动线条目没给到期时间，前端判不出"逾期" —— 红只给逾期 / 风险
 *      （→ 设计规范 §三.1 B5），凭 `priority` 涂红就是谎报。
 *   ④ `POST /today-agenda/:id/action`（处理反馈）与 `POST /visits`（外出登记）、
 *      `POST /events/quick-mark`（快速标记）**接口未建** ⇒ 动作条只放点得通的入口
 *      （写跟进 → 业务关系页），**不放"点了报错"的假按钮**（同 M6-05「不注册空路由」）。
 *
 * ★ **页标题＝页面自己的名字**（「工作台」，→ 前端文档 §五 页面清单 #3）。
 *   `homeNameOf(role)` 是**角色首屏名**（§4.1 主入口列），仍留在顶栏导航上；本页不再拿它当标题
 *   —— 否则经理登录会在**装着今日动线的页面上**写着「数据看板」（页面名与内容两套说法）。
 *   角色首屏差异属 M6-10 角色矩阵。
 */
const router = useRouter()

const items = ref<AgendaItem[]>([])
const loading = ref(false)
const errorText = ref('')

/** 今日日期（页面副标题；纯展示，不参与任何判定） */
const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function pad(value: number): string {
  return value.toString().padStart(2, '0')
}

const todayText = computed(() => {
  const now = new Date()
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${WEEKDAY_NAMES[now.getDay()]}`
})

// ===== 今日概览（只放能从动线条目真算出来的数）=====

const totalCount = computed(() => items.value.length)
const snoozedCount = computed(() => items.value.filter((item) => item.status === 'snoozed').length)
const relationCount = computed(
  () =>
    new Set(items.value.filter((item) => item.relation !== null).map((item) => item.relation?.id)).size,
)
const relationlessCount = computed(() => items.value.filter((item) => item.relation === null).length)

// ===== 同类提醒合并（→ 需求 §10.4）=====

interface AgendaGroup {
  /** 合并键：来源 ＋ 原因；`reason` 为空的条目各自成组（见文件头 ★） */
  key: string
  refType: string
  reason: string
  items: AgendaItem[]
}

const groups = computed<AgendaGroup[]>(() => {
  const grouped = new Map<string, AgendaGroup>()

  items.value.forEach((item) => {
    const reason = item.reason ?? ''
    const key = reason === '' ? `solo-${item.id}` : `${item.ref_type}|${reason}`
    const existing = grouped.get(key)

    if (existing === undefined) {
      grouped.set(key, { key, refType: item.ref_type, reason, items: [item] })
      return
    }

    existing.items.push(item)
  })

  return [...grouped.values()]
})

const expandedKeys = ref<string[]>([])

function isExpanded(key: string): boolean {
  return expandedKeys.value.includes(key)
}

function toggleGroup(key: string): void {
  expandedKeys.value = isExpanded(key)
    ? expandedKeys.value.filter((item) => item !== key)
    : [...expandedKeys.value, key]
}

/** 组内**全是被"推明天"的** → 中性灰点；否则给主色点（见文件头 ③：此处不给红） */
function dotClassOf(group: AgendaGroup): string {
  return group.items.every((item) => item.status === 'snoozed') ? 'is-muted' : 'is-open'
}

function relationNameOf(item: AgendaItem): string {
  return item.relation?.name ?? '（仅联系人 · 未挂关系）'
}

function statusNameOf(status: string): string {
  return agendaStatusNameOf(status)
}

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

/** 写跟进落在业务关系页（点开某条关系的时间线写跟单）—— 本批唯一点得通的动线入口 */
function goRelations(): void {
  void router.push('/relations')
}

onMounted(() => {
  void load()
})
</script>

<template>
  <section class="workbench">
    <header class="workbench-head">
      <h2 class="workbench-title">工作台</h2>
      <p class="workbench-sub">
        {{ todayText }} · 今日 <span class="workbench-num">{{ totalCount }}</span> 条待处理
      </p>
    </header>

    <!-- 今日概览（只放能从动线条目真算出来的数） -->
    <a-row :gutter="16" class="workbench-kpi-row">
      <a-col :span="8">
        <div class="workbench-kpi">
          <div class="workbench-kpi-label">今日待处理</div>
          <div class="workbench-kpi-value is-primary">{{ totalCount }}</div>
          <div class="workbench-kpi-note">服务端已按优先级排序</div>
        </div>
      </a-col>
      <a-col :span="8">
        <div class="workbench-kpi">
          <div class="workbench-kpi-label">已推明天</div>
          <div class="workbench-kpi-value">{{ snoozedCount }}</div>
          <div class="workbench-kpi-note">同一条最多推 3 次</div>
        </div>
      </a-col>
      <a-col :span="8">
        <div class="workbench-kpi">
          <div class="workbench-kpi-label">涉及客户</div>
          <div class="workbench-kpi-value">{{ relationCount }}</div>
          <div class="workbench-kpi-note">
            {{ relationlessCount > 0 ? `另有 ${relationlessCount} 条只有联系人` : '按业务关系去重' }}
          </div>
        </div>
      </a-col>
    </a-row>

    <p class="workbench-gap">
      规格里的「逾期未跟进 / 今日预约 / 本周重点 / 今日已跟进」四个数暂缺：动线条目不带到期时间，
      预约与紧迫档的接口未建（动线全量组装的定时任务属 M7）—— 这里只放算得出来的数，不填假数。
    </p>

    <!-- 动作条：主按钮＝写跟进（本批唯一点得通的入口） -->
    <div class="workbench-actionbar">
      <a-button type="primary" @click="goRelations">写跟进</a-button>
      <span class="workbench-actionbar-note">
        写跟单在「业务关系」页点开某条关系的时间线；外出登记 / 快速标记的接口未建，暂不放按钮
      </span>
    </div>

    <p v-if="errorText" class="workbench-error">{{ errorText }}</p>

    <div class="workbench-card">
      <div class="workbench-card-head">
        <span class="workbench-card-title">今日安排</span>
        <span class="workbench-card-meta">
          共 {{ totalCount }} 条<template v-if="groups.length < totalCount">
            · 同类合并为 {{ groups.length }} 组</template
          >
        </span>
      </div>

      <a-skeleton v-if="loading" class="workbench-skeleton" active :paragraph="{ rows: 4 }" />

      <a-empty
        v-else-if="items.length === 0"
        class="workbench-empty"
        :description="
          errorText === ''
            ? '今天还没有动线条目（动线由每日清晨自动组装，定时任务属 M7 未接）'
            : '暂时取不到今日动线'
        "
      >
        <a-button v-if="errorText !== ''" @click="load">重试</a-button>
        <a-button v-else type="primary" @click="goRelations">写跟进</a-button>
      </a-empty>

      <template v-else>
        <div v-for="group in groups" :key="group.key" class="workbench-group">
          <div class="workbench-row">
            <span class="workbench-dot" :class="dotClassOf(group)" />

            <div class="workbench-main">
              <div class="workbench-line">
                <span class="workbench-source">{{ refTypeNameOf(group.refType) }}</span>
                <template v-if="group.items.length > 1">
                  <span class="workbench-count">同类 {{ group.items.length }} 条</span>
                </template>
                <template v-else>
                  <span class="workbench-entity">{{ relationNameOf(group.items[0]) }}</span>
                  <span v-if="group.items[0].contact" class="workbench-meta">
                    · {{ group.items[0].contact.name }}
                  </span>
                </template>
              </div>

              <div class="workbench-line">
                <span class="workbench-reason">{{ group.reason === '' ? '—' : group.reason }}</span>
                <span
                  v-if="group.items.length === 1 && group.items[0].action_hint"
                  class="workbench-meta"
                >
                  · 建议：{{ group.items[0].action_hint }}
                </span>
              </div>
            </div>

            <div class="workbench-actions">
              <a-button
                v-if="group.items.length > 1"
                type="link"
                size="small"
                @click="toggleGroup(group.key)"
              >
                {{ isExpanded(group.key) ? '收起' : `看明细（${group.items.length}）` }}
              </a-button>
              <span v-else class="workbench-status">{{ statusNameOf(group.items[0].status) }}</span>
            </div>
          </div>

          <!-- 同类明细：合并的初衷是「不铺红墙」，点开要看得到具体是哪些客户、什么事（→ 需求 §10.4） -->
          <div v-if="group.items.length > 1 && isExpanded(group.key)" class="workbench-details">
            <div v-for="item in group.items" :key="item.id" class="workbench-row workbench-row--detail">
              <div class="workbench-main">
                <div class="workbench-line">
                  <span class="workbench-entity">{{ relationNameOf(item) }}</span>
                  <span v-if="item.contact" class="workbench-meta">· {{ item.contact.name }}</span>
                </div>
                <div v-if="item.action_hint" class="workbench-line">
                  <span class="workbench-meta">建议：{{ item.action_hint }}</span>
                </div>
              </div>

              <div class="workbench-actions">
                <span class="workbench-status">{{ statusNameOf(item.status) }}</span>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>
  </section>
</template>

<style scoped>
.workbench {
  max-width: 1080px;
}

.workbench-head {
  margin-bottom: var(--crm-space-lg);
}

.workbench-title {
  margin: 0 0 var(--crm-space-xs);
  font-size: var(--crm-font-size-2xl);
  font-weight: var(--crm-font-weight-strong);
  color: var(--crm-color-text);
}

.workbench-sub {
  margin: 0;
  font-size: var(--crm-font-size-base);
  color: var(--crm-color-text-secondary);
}

.workbench-num {
  font-variant-numeric: var(--crm-font-numeric);
  font-weight: var(--crm-font-weight-strong);
}

/** 概览卡：§七.2 最轻一档（描边、无阴影、padding 16） */
.workbench-kpi-row {
  margin-bottom: var(--crm-space-sm);
}

.workbench-kpi {
  padding: var(--crm-space-md);
  background: var(--crm-color-bg-container);
  border: var(--crm-border-width) solid var(--crm-color-border-secondary);
  border-radius: var(--crm-radius-lg);
}

.workbench-kpi-label {
  font-size: var(--crm-font-size-xs);
  color: var(--crm-color-text-secondary);
}

.workbench-kpi-value {
  margin-top: var(--crm-space-xxs);
  font-size: var(--crm-font-size-3xl);
  font-weight: var(--crm-font-weight-strong);
  line-height: 1.2;
  font-variant-numeric: var(--crm-font-numeric);
  color: var(--crm-color-text);
}

/** 全屏只给「待处理」这一个数上主色（不铺第二个语义色） */
.workbench-kpi-value.is-primary {
  color: var(--crm-color-primary);
}

.workbench-kpi-note {
  margin-top: var(--crm-space-xxs);
  font-size: var(--crm-font-size-xs);
  color: var(--crm-color-text-tertiary);
}

/** 缺口说明：如实登记"哪几个数还没接"，不让读者以为页面漏做 */
.workbench-gap {
  margin: 0 0 var(--crm-space-md);
  font-size: var(--crm-font-size-xs);
  color: var(--crm-color-text-tertiary);
}

.workbench-actionbar {
  display: flex;
  align-items: center;
  gap: var(--crm-space-sm);
  padding: var(--crm-space-sm) var(--crm-space-md);
  margin-bottom: var(--crm-space-md);
  background: var(--crm-color-bg-container);
  border: var(--crm-border-width) solid var(--crm-color-border-secondary);
  border-radius: var(--crm-radius-lg);
}

.workbench-actionbar-note {
  font-size: var(--crm-font-size-xs);
  color: var(--crm-color-text-tertiary);
}

/** 错误态：§4.6「错误文案红 12px」（与登录页 / 建档页 / 关系页同一形态） */
.workbench-error {
  margin: 0 0 var(--crm-space-sm);
  font-size: var(--crm-font-size-xs);
  color: var(--crm-color-error);
}

/** 列表卡：§七.2 列表一档（占主区、靠分割线、无阴影） */
.workbench-card {
  background: var(--crm-color-bg-container);
  border: var(--crm-border-width) solid var(--crm-color-border-secondary);
  border-radius: var(--crm-radius-lg);
}

.workbench-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 56px;
  padding: 0 var(--crm-space-lg);
  border-bottom: var(--crm-border-width) solid var(--crm-color-border-secondary);
}

.workbench-card-title {
  font-size: var(--crm-font-size-lg);
  font-weight: var(--crm-font-weight-strong);
  color: var(--crm-color-text);
}

.workbench-card-meta {
  font-size: var(--crm-font-size-xs);
  color: var(--crm-color-text-tertiary);
}

.workbench-skeleton {
  padding: var(--crm-space-md) var(--crm-space-lg);
}

.workbench-empty {
  padding: var(--crm-space-xl) var(--crm-space-lg);
}

.workbench-row {
  display: flex;
  align-items: flex-start;
  gap: var(--crm-space-sm);
  padding: var(--crm-space-md) var(--crm-space-lg);
  border-bottom: var(--crm-border-width) solid var(--crm-color-border-secondary);
  transition: background var(--crm-motion-duration-base) var(--crm-motion-ease);
}

.workbench-row:hover {
  background: var(--crm-color-bg-hover);
}

.workbench-row--detail {
  padding-left: var(--crm-space-3xl);
  background: var(--crm-color-fill-alter);
}

/** 最后一行不留分割线（不按"组"算，按整卡的最后一行算） */
.workbench-group:last-child .workbench-row:last-child {
  border-bottom: 0;
}

/** 状态＝圆点 ＋ 文字（→ 设计规范 §4.4，色盲友好） */
.workbench-dot {
  flex: 0 0 6px;
  width: 6px;
  height: 6px;
  margin-top: 8px;
  border-radius: var(--crm-radius-pill);
  background: var(--crm-color-text-disabled);
}

.workbench-dot.is-open {
  background: var(--crm-color-primary);
}

.workbench-dot.is-muted {
  background: var(--crm-color-text-disabled);
}

.workbench-main {
  flex: 1;
  min-width: 0;
}

.workbench-line {
  display: flex;
  align-items: center;
  gap: var(--crm-space-xs);
  flex-wrap: wrap;
}

.workbench-line + .workbench-line {
  margin-top: var(--crm-space-xxs);
}

.workbench-source {
  font-size: var(--crm-font-size-xs);
  color: var(--crm-color-text-secondary);
}

.workbench-entity {
  font-size: var(--crm-font-size-base);
  font-weight: var(--crm-font-weight-medium);
  color: var(--crm-color-text);
}

.workbench-count {
  padding: 0 var(--crm-space-xxs);
  font-size: var(--crm-font-size-xs);
  color: var(--crm-color-primary);
  background: var(--crm-color-primary-bg);
  border-radius: var(--crm-radius-sm);
}

.workbench-meta {
  font-size: var(--crm-font-size-xs);
  color: var(--crm-color-text-tertiary);
}

.workbench-reason {
  font-size: var(--crm-font-size-base);
  color: var(--crm-color-text-secondary);
}

.workbench-actions {
  display: flex;
  align-items: center;
  gap: var(--crm-space-xs);
  flex: 0 0 auto;
}

.workbench-status {
  font-size: var(--crm-font-size-xs);
  color: var(--crm-color-text-tertiary);
}
</style>
