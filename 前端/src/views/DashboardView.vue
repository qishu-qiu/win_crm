<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import ContentCard from '../components/ContentCard.vue'
import EmptyState from '../components/EmptyState.vue'
import KpiCard from '../components/KpiCard.vue'
import PageContainer from '../components/PageContainer.vue'
import {
  fetchDashboard,
  type DashboardResult,
  type WarningItem,
  type WarningType,
} from '../api/report'
import { currentUser } from '../session'
import { formatDate, formatDateTime } from '../format'

/**
 * 数据看板（§五 页面清单 #2 / 接口 §5.13 `GET /reports/dashboard`）。
 *
 * 口径来源（★ 真相源，勿自造）：
 *   · 接口 §5.13：`{kpi, pending_todo, warnings, dept_compare, top_sales, zombie_weekly, sea_todo}`；
 *     5 区形状唯一落点＝`服务端/src/modules/report/dto/report-response.dto.ts`。
 *   · 前端文档 §六-2：4 KPI ＋ 左「今日待跟进」＋ 右状态/预警 ＋ 周重点僵尸榜 ＋ 公海决策待办；
 *     第 3 块起折叠（本页未做折叠持久化，列为后续交互项）。
 *   · 需求 §8：签约到期预警；§8.2：周重点僵尸（≥14 天无推进）。
 *
 * ★ **页面不排序 / 不过滤**：顺序（如 pending_todo 逾期置顶、dept_compare 按签约额降序、
 *   top_sales Top10）全由服务端定 —— 前端再排一次就是第二套口径。
 * ★ **不脱敏**（§2.4）：看板/报表出口直出真实金额，本页如实展示。
 * ★ **可见性**由 `access.ts` 的 `dashboard` 矩阵行判（经理/总经理 🔒✅、销售 🔒个人视角、
 *   客服/交付/管理员 ➖）；本页不写角色判断。销售现被接口 403（个人视角端点未建），
 *   页面对 403 给「个人视角即将上线」占位，不冒充数据。
 *
 * ⚠ 本页消费的 5 区 item 类型由 `api/report.ts` 从权威 DTO 转录（运行后端 OpenAPI 滞后），
 *   后端重新部署 ＋ `gen:types` 后即可换回生成物。
 */

const data = ref<DashboardResult | null>(null)
const loading = ref(false)
const errorText = ref('')

/** 当前角色（用于「个人视角」占位与副标题） */
const role = computed(() => currentUser.value?.role ?? '')

/** 销售角色：接口 403（个人视角端点未建）→ 显示占位而非报错 */
const isPersonalViewRole = computed(() => role.value === 'sale')

/** 副标题（纯展示，不参与判定） */
const description = computed(() => {
  if (role.value === 'gm') return '全公司视角'
  if (role.value === 'dept_manager') return '管辖部门视角'
  if (isPersonalViewRole.value) return '个人视角（即将上线）'
  return ''
})

// ===== 格式化（展示口径，集中此处避免散落）=====

/** 金额（元）→ `X.X 万`（≥1 万）或千分位元；看板不脱敏，真实金额直出 */
function formatWan(value: number): string {
  if (value >= 10000) return `${(value / 10000).toFixed(1)} 万`
  return Math.round(value).toLocaleString('zh-CN')
}

/** 环比（小数）→ 带符号百分比；`null`＝上月为 0，无法计算 */
function formatRatio(ratio: number | null): string {
  if (ratio === null) return '—'
  const pct = ratio * 100
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`
}

/** 环比配色：涨红（§六「红涨」）／ 跌绿（「绿跌」）／ 持平中性 */
function ratioClass(ratio: number | null): string {
  if (ratio === null) return 'is-flat'
  return ratio >= 0 ? 'is-up' : 'is-down'
}

const WARNING_LABELS: Record<WarningType, string> = {
  contract_expire: '签约到期',
  new_biz: '新商机',
  sea_drop: '掉公海',
}

/** 预警三块固定顺序（枚举顺序，不按数量重排） */
const WARNING_TYPES: WarningType[] = ['contract_expire', 'new_biz', 'sea_drop']

/** 按类型分组（仅分组，组内顺序＝服务端给的顺序） */
const warningsByType = computed<Record<WarningType, WarningItem[]>>(() => {
  const map: Record<WarningType, WarningItem[]> = {
    contract_expire: [],
    new_biz: [],
    sea_drop: [],
  }
  for (const w of warnings.value) map[w.type].push(w)
  return map
})

function warningLabel(type: WarningType): string {
  return WARNING_LABELS[type]
}

// ===== 5 区派生（仅分组，不重排；分组顺序＝枚举顺序，不按数量）=====

const pendingTodo = computed(() => data.value?.pending_todo ?? [])
const warnings = computed(() => data.value?.warnings ?? [])
const deptCompare = computed(() => data.value?.dept_compare ?? [])
const topSales = computed(() => data.value?.top_sales ?? [])
const zombieWeekly = computed(() => data.value?.zombie_weekly ?? [])
const seaTodo = computed(() => data.value?.sea_todo)

/** 部门对比按签约额降序的「最值」用于条形占比（不重排，只取最大值做分母） */
const maxDeptSigned = computed(() =>
  deptCompare.value.reduce((max, item) => Math.max(max, item.signed_amount), 0),
)

/** 销冠榜最大值（用于条形占比） */
const maxTopSigned = computed(() =>
  topSales.value.reduce((max, item) => Math.max(max, item.signed_amount), 0),
)

/** 销售被 403 → 占位；其余错误 → 正常错误态 */
const isBlocked = computed(() => isPersonalViewRole.value && errorText.value !== '')

async function load(): Promise<void> {
  errorText.value = ''
  loading.value = true
  try {
    data.value = await fetchDashboard()
  } catch (error) {
    data.value = null
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
  <PageContainer title="数据看板" :description="description">
    <!-- 销售个人视角未建：接口 403，给占位而非报错 -->
    <EmptyState
      v-if="isBlocked"
      type="noPermission"
      description="你的「个人视角数据看板（含我的日报）」规划中，先用顶部「工作台」跟进今日动线"
    />

    <!-- 其余角色的错误态 -->
    <EmptyState
      v-else-if="errorText !== ''"
      type="noData"
      :description="errorText"
    >
      <template #action>
        <a-button @click="load">重试</a-button>
      </template>
    </EmptyState>

    <!-- 加载中：整页骨架 -->
    <a-skeleton v-else-if="loading" :paragraph="{ rows: 10 }" active />

    <!-- 正常：KPI ＋ 5 区 ＋ 公海决策待办 -->
    <template v-else-if="data !== null">
      <!-- KPI 三指标：今日新增 / 今日待跟进 / 本月签约额（含环比红涨） -->
      <a-row :gutter="16" class="dash-kpi-row">
        <a-col :span="8">
          <KpiCard label="今日新增" :value="data.kpi.today_new" />
        </a-col>
        <a-col :span="8">
          <KpiCard label="今日待跟进" :value="data.kpi.today_todo" accent />
        </a-col>
        <a-col :span="8">
          <KpiCard label="本月签约额" :value="formatWan(data.kpi.month_signed.amount)">
            <template #hint>
              环比
              <span class="dash-ratio" :class="ratioClass(data.kpi.month_signed.chain_ratio)">
                {{ formatRatio(data.kpi.month_signed.chain_ratio) }}
              </span>
            </template>
          </KpiCard>
        </a-col>
      </a-row>

      <a-row :gutter="[16, 16]" class="dash-grid">
        <!-- 区①：今日待跟进明细（逾期红置顶，由服务端排好） -->
        <a-col :xs="24" :lg="12">
          <ContentCard title="今日待跟进">
            <EmptyState v-if="pendingTodo.length === 0" description="今天没有待跟进的承诺" />
            <ul v-else class="dash-list">
              <li v-for="item in pendingTodo" :key="item.relation_id" class="dash-row">
                <div class="dash-main">
                  <span class="dash-entity">{{ item.relation_name ?? '（未命名关系）' }}</span>
                  <span v-if="item.contact_name" class="dash-meta">· {{ item.contact_name }}</span>
                </div>
                <div class="dash-line">
                  <span v-if="item.content" class="dash-meta">{{ item.content }}</span>
                  <span class="dash-meta">到期 {{ formatDateTime(item.due_at) }}</span>
                </div>
                <span v-if="item.overdue" class="dash-badge is-danger">逾期</span>
              </li>
            </ul>
          </ContentCard>
        </a-col>

        <!-- 区②：活跃预警 3 卡（签约到期 / 新商机 / 掉公海） -->
        <a-col :xs="24" :lg="12">
          <ContentCard title="活跃预警">
            <EmptyState v-if="warnings.length === 0" description="暂无活跃预警" />
            <div v-else class="dash-warn">
              <div v-for="type in WARNING_TYPES" :key="type" class="dash-warn-block">
                <div class="dash-warn-head">{{ warningLabel(type) }}</div>
                <ul class="dash-list">
                  <li
                    v-for="w in warningsByType[type]"
                    :key="w.relation_id"
                    class="dash-row"
                  >
                    <div class="dash-main">
                      <span class="dash-entity">{{ w.relation_name ?? '（未命名关系）' }}</span>
                    </div>
                    <div class="dash-line">
                      <span v-if="type === 'contract_expire'" class="dash-meta">
                        {{ w.days_left !== null && w.days_left < 0 ? '已过期' : '剩' }}
                        {{ w.days_left !== null ? Math.abs(w.days_left) + ' 天' : '' }}
                        （{{ formatDate(w.service_end) }}）
                      </span>
                      <span v-else-if="type === 'new_biz'" class="dash-meta">
                        {{ w.owner_name ?? '未分配' }} · 建档 {{ formatDate(w.created_at) }}
                      </span>
                      <span v-else class="dash-meta">已停留公海 {{ w.dropped_days ?? '?' }} 天</span>
                    </div>
                  </li>
                  <li
                    v-if="warningsByType[type].length === 0"
                    class="dash-row dash-row--muted"
                  >
                    无
                  </li>
                </ul>
              </div>
            </div>
          </ContentCard>
        </a-col>

        <!-- 区③：部门对比（签约额 ＋ 私海关系数） -->
        <a-col :xs="24" :lg="12">
          <ContentCard title="部门对比">
            <EmptyState v-if="deptCompare.length === 0" description="暂无管辖部门数据" />
            <ul v-else class="dash-list">
              <li v-for="item in deptCompare" :key="item.dept_id" class="dash-row dash-row--bar">
                <div class="dash-bar-head">
                  <span class="dash-entity">{{ item.dept_name }}</span>
                  <span class="dash-meta">{{ formatWan(item.signed_amount) }} · {{ item.relation_count }} 家</span>
                </div>
                <div class="dash-bar">
                  <div
                    class="dash-bar-fill"
                    :style="{ width: maxDeptSigned > 0 ? `${(item.signed_amount / maxDeptSigned) * 100}%` : '0%' }"
                  />
                </div>
              </li>
            </ul>
          </ContentCard>
        </a-col>

        <!-- 区④：销冠榜 Top 10 -->
        <a-col :xs="24" :lg="12">
          <ContentCard title="销冠榜 Top 10">
            <EmptyState v-if="topSales.length === 0" description="本月暂无签单" />
            <ul v-else class="dash-list">
              <li v-for="(item, idx) in topSales" :key="item.owner_id" class="dash-row dash-row--rank">
                <span class="dash-rank">{{ idx + 1 }}</span>
                <div class="dash-main">
                  <span class="dash-entity">{{ item.owner_name }}</span>
                  <span class="dash-meta">{{ item.contract_count }} 单</span>
                </div>
                <span class="dash-amount">{{ formatWan(item.signed_amount) }}</span>
                <div class="dash-bar dash-bar--inline">
                  <div
                    class="dash-bar-fill"
                    :style="{ width: maxTopSigned > 0 ? `${(item.signed_amount / maxTopSigned) * 100}%` : '0%' }"
                  />
                </div>
              </li>
            </ul>
          </ContentCard>
        </a-col>

        <!-- 区⑤：周重点僵尸榜（≥14 天无推进） -->
        <a-col :xs="24" :lg="12">
          <ContentCard title="周重点僵尸榜">
            <EmptyState v-if="zombieWeekly.length === 0" description="没有周重点僵尸客户，保持得不错" />
            <ul v-else class="dash-list">
              <li v-for="item in zombieWeekly" :key="item.relation_id" class="dash-row">
                <div class="dash-main">
                  <span class="dash-entity">{{ item.relation_name ?? '（未命名关系）' }}</span>
                  <span v-if="item.owner_name" class="dash-meta">· {{ item.owner_name }}</span>
                </div>
                <div class="dash-line">
                  <span class="dash-meta">最近跟进 {{ formatDate(item.last_event_at) }}</span>
                  <span class="dash-badge" :class="item.no_progress_days >= 14 ? 'is-danger' : ''">
                    {{ item.no_progress_days }} 天无推进
                  </span>
                </div>
              </li>
            </ul>
          </ContentCard>
        </a-col>

        <!-- 公海超期决策待办（复用 `GET /sea/manager-todo`；经理/总经理可见） -->
        <a-col :xs="24" :lg="12">
          <ContentCard title="公海超期决策待办" :meta="`共 ${seaTodo?.total ?? 0} 项`">
            <EmptyState
              v-if="(seaTodo?.total ?? 0) === 0"
              description="没有超期未决策的公海客户"
            />
            <ul v-else class="dash-list">
              <li
                v-for="item in seaTodo?.items ?? []"
                :key="item.relation_id"
                class="dash-row"
              >
                <div class="dash-main">
                  <span class="dash-entity">{{ item.company?.name ?? '（公司档案已删）' }}</span>
                  <span v-if="item.dept" class="dash-meta">· {{ item.dept.name }}</span>
                </div>
                <div class="dash-line">
                  <span class="dash-meta">超期 {{ item.overdue_days }} 天</span>
                  <span class="dash-meta">（阈值 {{ item.stay_days ?? '未配' }} 天）</span>
                </div>
              </li>
            </ul>
          </ContentCard>
        </a-col>
      </a-row>
    </template>
  </PageContainer>
</template>

<style scoped>
.dash-kpi-row {
  margin-bottom: var(--crm-space-md);
}

.dash-grid {
  margin-top: var(--crm-space-md);
}

/* 列表与行（沿用工作台的信息密度与分隔线语言，→ WorkbenchView） */
.dash-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.dash-row {
  display: flex;
  align-items: flex-start;
  gap: var(--crm-space-sm);
  padding: var(--crm-space-sm) 0;
  border-bottom: var(--crm-border-width) solid var(--crm-color-border-secondary);
}

.dash-row:last-child {
  border-bottom: 0;
}

.dash-row--muted {
  color: var(--crm-color-text-tertiary);
  font-size: var(--crm-font-size-xs);
}

.dash-main {
  flex: 1;
  min-width: 0;
}

.dash-line {
  display: flex;
  align-items: center;
  gap: var(--crm-space-xs);
  flex-wrap: wrap;
  margin-top: var(--crm-space-xxs);
}

.dash-entity {
  font-size: var(--crm-font-size-base);
  font-weight: var(--crm-font-weight-medium);
  color: var(--crm-color-text);
}

.dash-meta {
  font-size: var(--crm-font-size-xs);
  color: var(--crm-color-text-tertiary);
}

/* 逾期 / 风险：红只给这类语义（§三.1 B5） */
.dash-badge {
  flex: none;
  padding: 0 var(--crm-space-xs);
  font-size: var(--crm-font-size-xs);
  line-height: 20px;
  color: var(--crm-color-text-secondary);
  background: var(--crm-color-fill-alter);
  border: var(--crm-border-width) solid var(--crm-color-border-secondary);
  border-radius: var(--crm-radius-sm);
}

.dash-badge.is-danger {
  font-weight: var(--crm-font-weight-strong);
  color: var(--crm-color-error);
  background: var(--crm-color-error-bg, #fff2f0);
  border-color: var(--crm-color-error);
}

/* 环比：涨红 / 跌绿（§六「红涨绿跌」） */
.dash-ratio {
  font-weight: var(--crm-font-weight-medium);
}

.dash-ratio.is-up {
  color: var(--crm-color-error);
}

.dash-ratio.is-down {
  color: var(--crm-color-success);
}

.dash-ratio.is-flat {
  color: var(--crm-color-text-tertiary);
}

/* 预警三块 */
.dash-warn {
  display: flex;
  flex-direction: column;
  gap: var(--crm-space-md);
}

.dash-warn-block + .dash-warn-block {
  padding-top: var(--crm-space-md);
  border-top: var(--crm-border-width) solid var(--crm-color-border-secondary);
}

.dash-warn-head {
  font-size: var(--crm-font-size-sm);
  font-weight: var(--crm-font-weight-strong);
  color: var(--crm-color-text-secondary);
  margin-bottom: var(--crm-space-xxs);
}

/* 条形占比（部门对比 / 销冠榜） */
.dash-row--bar {
  flex-direction: column;
  align-items: stretch;
  gap: var(--crm-space-xxs);
}

.dash-bar-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--crm-space-sm);
}

.dash-bar {
  height: 6px;
  background: var(--crm-color-fill-alter);
  border-radius: var(--crm-radius-pill);
  overflow: hidden;
}

.dash-bar--inline {
  flex: 1;
  min-width: 80px;
  align-self: center;
}

.dash-bar-fill {
  height: 100%;
  background: var(--crm-color-primary);
  border-radius: var(--crm-radius-pill);
}

.dash-row--rank {
  align-items: center;
}

.dash-rank {
  flex: none;
  width: 20px;
  text-align: center;
  font-size: var(--crm-font-size-lg);
  font-weight: var(--crm-font-weight-strong);
  color: var(--crm-color-text-tertiary);
}

.dash-amount {
  flex: none;
  font-size: var(--crm-font-size-base);
  font-weight: var(--crm-font-weight-medium);
  color: var(--crm-color-text);
}
</style>
