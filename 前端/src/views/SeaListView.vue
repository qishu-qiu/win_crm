<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { message } from 'ant-design-vue'

import {
  claimSeaRelation,
  listCompanySea,
  listDepartmentSea,
  type SeaListItem,
  type SeaListPageVo,
} from '../api/sea'
import { listDepartments, type DepartmentVo } from '../api/org'
import { formatDateTime } from '../format'

import PageContainer from '../components/PageContainer.vue'
import EmptyState from '../components/EmptyState.vue'
import ErrorBlock from '../components/ErrorBlock.vue'

/**
 * 公海卡片列表（§五 页 9/10）—— 系统公海 / 部门公海**共用一套卡片流**，靠 `scope` 区分：
 *   · `company` ＝ `GET /sea/company`（销售＝本部门 / 经理＝管辖 / 总·管＝全部；交付·客服 403）；
 *   · `department` ＝ `GET /sea/department?dept_id=`（在 viewer 可读范围内按单部门收敛）。
 *
 * 口径来源（★ 真相源，勿自造）：
 *   · 卡片字段 = 关系列表项 ＋ 公海停留信息（`sea_entered_at` / `sea_reason` / `days_in_sea` /
 *     `stay_days` / `remaining_days`），**全部来自服务端**（→ 接口 §5.16）；前端不自己算倒计时。
 *   · 「剩余 X 天」＝ `remaining_days`：`null` ⇒ 规则未配（显示「未配置」）、`<0` ⇒ 已超期（红）。
 *   · **领取按钮**调 `POST /sea/company/:id/claim`（`companyId`＝公司 id，req 含 `dept_id` /
 *     `product_line_id`）；谁能领由服务端判（越权 / 越部门 → 403，页面不翻译人话由请求层弹）。
 *   · 卡片「地区·规模·行业 / 脱敏联系人」属公司详情维度，**列表形状不含** ⇒ 本页不摆
 *     （摆了就是空值 / 假数据；需要时走关系详情下钻）。
 */
const props = defineProps<{ scope: 'company' | 'department' }>()

const route = useRoute()
const router = useRouter()

const PAGE_SIZE = 20

const loading = ref(false)
const errorText = ref('')
const page = ref<SeaListPageVo | null>(null)
const current = ref(1)

// 部门公海：从路由 query 取 dept_id；缺省时由下方部门选择器决定
const deptId = ref<string>((route.query.dept_id as string) ?? '')
const departments = ref<DepartmentVo[]>([])
const deptLoading = ref(false)

const urgencyLabel: Record<string, string> = {
  weekly: '周重点',
  monthly: '月重点',
  quarterly: '季度跟',
  long_term: '长期跟',
  gray: '灰度',
}
const reasonLabel: Record<string, string> = {
  follow_timeout: '跟进超时',
}

const title = computed(() => (props.scope === 'company' ? '系统公海' : '部门公海'))

const rows = computed<SeaListItem[]>(() => (page.value?.list ?? []) as SeaListItem[])

/** 进入原因 tag 文案（取不到 / 未知码 → 原始码，不编中文） */
function reasonTextOf(row: SeaListItem): string {
  return row.sea_reason === null ? '—' : (reasonLabel[row.sea_reason] ?? row.sea_reason)
}

/** 剩余天数文案：null ⇒ 未配置；<0 ⇒ 已超期 N 天；≥0 ⇒ 剩余 N 天 */
function remainingTextOf(row: SeaListItem): { text: string; danger: boolean; muted: boolean } {
  const n = row.remaining_days
  if (n === null) return { text: '未配置', danger: false, muted: true }
  if (n < 0) return { text: `已超期 ${Math.abs(n)} 天`, danger: true, muted: false }
  return { text: `剩余 ${n} 天`, danger: false, muted: false }
}

const canClaim = computed(() => props.scope === 'company' || deptId.value !== '')

async function load(): Promise<void> {
  if (props.scope === 'department' && deptId.value === '') {
    page.value = null
    return
  }
  errorText.value = ''
  loading.value = true
  try {
    const query = { page: current.value, pageSize: PAGE_SIZE }
    const result: SeaListPageVo =
      props.scope === 'company'
        ? await listCompanySea(query)
        : await listDepartmentSea(deptId.value, query)
    page.value = result
  } catch (error) {
    page.value = null
    errorText.value = error instanceof Error ? error.message : '加载失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

function onPageChange(next: number): void {
  current.value = next
  void load()
}

async function loadDepartments(): Promise<void> {
  if (props.scope !== 'department' || departments.value.length > 0) return
  deptLoading.value = true
  try {
    departments.value = await listDepartments()
  } catch {
    departments.value = []
  } finally {
    deptLoading.value = false
  }
}

function onDeptChange(next: string): void {
  deptId.value = next
  current.value = 1
  void router.replace({ path: '/sea/department', query: { dept_id: next } })
  void load()
}

const claiming = ref<string | null>(null)

async function onClaim(row: SeaListItem): Promise<void> {
  const companyId = row.company?.id
  const dId = row.dept?.id
  const pId = row.product_line?.id
  if (companyId === undefined || dId === undefined || pId === undefined) {
    message.warning('该公海关系缺少部门 / 产品线信息，无法领取')
    return
  }
  claiming.value = row.id
  try {
    await claimSeaRelation(companyId, { dept_id: dId, product_line_id: pId })
    message.success('已领取到私海')
    void load()
  } catch (error) {
    message.error(error instanceof Error ? error.message : '领取失败')
  } finally {
    claiming.value = null
  }
}

onMounted(() => {
  void loadDepartments()
  void load()
})

watch(
  () => route.query.dept_id,
  (next) => {
    const id = (next as string) ?? ''
    if (props.scope === 'department' && id !== deptId.value) {
      deptId.value = id
      current.value = 1
      void load()
    }
  },
)
</script>

<template>
  <PageContainer :title="title">
    <!-- 部门公海：先选部门 -->
    <a-form v-if="props.scope === 'department'" layout="inline" class="sea-dept-bar">
      <a-form-item label="部门">
        <a-select
          v-model:value="deptId"
          :loading="deptLoading"
          placeholder="选择部门"
          style="width: 240px"
          @change="onDeptChange"
        >
          <a-select-option v-for="d in departments" :key="d.id" :value="d.id">
            {{ d.name }}
          </a-select-option>
        </a-select>
      </a-form-item>
    </a-form>

    <ErrorBlock v-if="errorText" :message="errorText" @retry="load" />

    <template v-else>
      <div v-if="rows.length === 0 && !loading" class="sea-empty">
        <EmptyState :description="props.scope === 'company' ? '系统公海暂无数据' : '该部门公海暂无数据'" />
      </div>

      <a-spin :spinning="loading">
        <div class="sea-card-grid">
          <a-card
            v-for="row in rows"
            :key="row.id"
            class="sea-card"
            :bordered="true"
          >
            <div class="sea-card-title">{{ row.company?.name ?? '—' }}</div>
            <div class="sea-card-sub">
              {{ row.dept?.name ?? '—' }} · {{ row.product_line?.name ?? '—' }}
            </div>
            <div class="sea-card-meta">
              <a-tag v-if="row.urgency">{{ urgencyLabel[row.urgency] ?? row.urgency }}</a-tag>
              <span class="sea-card-stage">阶段 {{ row.stage }}</span>
            </div>
            <a-divider class="sea-card-divider" />
            <div class="sea-card-info">
              <div>进入时间：{{ row.sea_entered_at ? formatDateTime(row.sea_entered_at) : '—' }}</div>
              <div>
                进入原因：
                <a-tag :bordered="false">{{ reasonTextOf(row) }}</a-tag>
              </div>
              <div>
                停留：{{ row.days_in_sea }} 天
                <span
                  class="sea-card-remaining"
                  :class="{
                    'is-danger': remainingTextOf(row).danger,
                    'is-muted': remainingTextOf(row).muted,
                  }"
                >
                  {{ remainingTextOf(row).text }}
                </span>
              </div>
            </div>
            <div class="sea-card-footer">
              <a-button
                type="primary"
                size="small"
                :loading="claiming === row.id"
                :disabled="!canClaim"
                @click="onClaim(row)"
              >
                领取
              </a-button>
            </div>
            <!-- 部门公海水印 -->
            <div v-if="props.scope === 'department'" class="sea-card-watermark">
              {{ row.dept?.name ?? '部门公海' }}
            </div>
          </a-card>
        </div>
      </a-spin>

      <a-pagination
        v-if="page && page.total > 0"
        class="sea-pagination"
        :current="page.page"
        :page-size="page.page_size"
        :total="page.total"
        show-quick-jumper
        @change="onPageChange"
      />
    </template>
  </PageContainer>
</template>

<style scoped>
.sea-dept-bar {
  margin-bottom: 16px;
}
.sea-card-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}
.sea-card {
  position: relative;
  overflow: hidden;
}
.sea-card-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--crm-text, #1f1f1f);
}
.sea-card-sub {
  margin-top: 4px;
  color: var(--crm-text-secondary, #8c8c8c);
  font-size: 13px;
}
.sea-card-meta {
  margin-top: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.sea-card-stage {
  font-size: 12px;
  color: var(--crm-text-secondary, #8c8c8c);
}
.sea-card-divider {
  margin: 12px 0;
}
.sea-card-info {
  font-size: 13px;
  line-height: 1.9;
  color: var(--crm-text, #1f1f1f);
}
.sea-card-remaining {
  margin-left: 8px;
  font-weight: 600;
}
.sea-card-remaining.is-danger {
  color: var(--crm-color-error, #cf1322);
}
.sea-card-remaining.is-muted {
  color: var(--crm-text-secondary, #8c8c8c);
  font-weight: 400;
}
.sea-card-footer {
  margin-top: 12px;
  text-align: right;
}
.sea-card-watermark {
  position: absolute;
  right: -8px;
  bottom: -10px;
  font-size: 48px;
  font-weight: 700;
  color: rgba(0, 0, 0, 0.04);
  pointer-events: none;
  user-select: none;
  transform: rotate(-12deg);
}
.sea-pagination {
  margin-top: 16px;
  text-align: right;
}
.sea-empty {
  padding: 48px 0;
}
</style>
