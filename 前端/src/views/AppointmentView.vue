<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import dayjs from 'dayjs'
import { message, Modal } from 'ant-design-vue'

import {
  completeAppointment,
  createAppointment,
  listAppointments,
  rescheduleAppointment,
  type AppointmentItem,
  type AppointmentTab,
} from '../api/appointment'
import { getRelation, listRelations, type RelationListItem } from '../api/relation'
import type { ContactPage } from '../api/company'
import { listCompanyContacts } from '../api/company'
import { formatDateTime } from '../format'

import CrmTable from '../components/CrmTable.vue'
import EmptyState from '../components/EmptyState.vue'
import ErrorBlock from '../components/ErrorBlock.vue'
import PageContainer from '../components/PageContainer.vue'

/**
 * 预约管理页（§五 页 4）—— 4 Tab（今日 / 未来 / 过期 / 未预约）。
 *
 * 口径来源（★ 真相源，勿自造）：
 *   · 接口 →《销售CRM接口API文档》§5.8 `GET /appointments?tab=`；列表**统一形状**
 *     （`appointment_id` 为 `null` ＝「未预约」行，只有关系）。
 *   · 默认显「过期」Tab 且红色警示（→ §五 页 4）；过期行 `row-danger`。
 *   · 距掉公海 X 天：D 域不跨 F 域算倒计时（→ 架构 §3），前端按 `relation_id` 从
 *     `GET /relations`（私海）的列表项取 `drop_in_x_days`（**只信服务端**）。
 *   · 完成预约＝一次有效跟进：服务端强制生成跟单事件（否则 422，→ §5.8）。
 *
 * ★ 范围：列表由后端按可见私海关系收敛，前端不自己判角色。
 */
const route = useRoute()
const router = useRouter()

const TAB_ORDER: AppointmentTab[] = ['today', 'future', 'expired', 'missing']
const TAB_LABEL: Record<AppointmentTab, string> = {
  today: '今日',
  future: '未来',
  expired: '过期',
  missing: '未预约',
}

const activeTab = ref<AppointmentTab>((route.params.tab as AppointmentTab) ?? 'expired')
if (!TAB_ORDER.includes(activeTab.value)) activeTab.value = 'expired'

const loading = ref(false)
const errorText = ref('')
const rows = ref<AppointmentItem[]>([])

/** `relation_id` → 距掉公海天数（来自私海关系列表，→ §5.6） */
const dropMap = ref<Map<string, number | null>>(new Map())

async function loadDropMap(): Promise<void> {
  try {
    const page = await listRelations({ tab: 'private', pageSize: 100 })
    const map = new Map<string, number | null>()
    for (const item of page.items as RelationListItem[]) {
      map.set(item.id, item.drop_in_x_days)
    }
    dropMap.value = map
  } catch {
    // 取不到倒计时不影响主表：没对上的行显示「—」
    dropMap.value = new Map()
  }
}

async function load(): Promise<void> {
  errorText.value = ''
  loading.value = true
  try {
    const [list] = await Promise.all([listAppointments(activeTab.value), loadDropMap()])
    rows.value = list
  } catch (error) {
    rows.value = []
    errorText.value = error instanceof Error ? error.message : '加载失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

function onTabChange(tab: string | number): void {
  const next = tab as AppointmentTab
  activeTab.value = next
  // 路由联动（`:tab` 参数），便于刷新 / 深链回到当前 Tab
  void router.replace(`/appointment/${next}`)
  void load()
}

watch(
  () => route.params.tab,
  (tab) => {
    const next = (tab as AppointmentTab) ?? 'expired'
    if (next !== activeTab.value && TAB_ORDER.includes(next)) {
      activeTab.value = next
      void load()
    }
  },
)

onMounted(() => {
  void load()
})

const columns = [
  { title: '公司', dataIndex: 'company_name', key: 'company_name' },
  { title: '联系人', dataIndex: 'contact', key: 'contact', width: 140 },
  { title: '预约时间', dataIndex: 'appointment_at', key: 'appointment_at', width: 170 },
  { title: '距掉公海', dataIndex: 'drop_in_x_days', key: 'drop_in_x_days', width: 110 },
  { title: '备注', dataIndex: 'note', key: 'note', ellipsis: true },
  { title: '操作', key: 'actions', width: 230, fixed: 'right' as const },
]

function contactNameOf(row: AppointmentItem): string {
  return row.contact?.name ?? '—'
}

function dropTextOf(row: AppointmentItem): string {
  const n = row.drop_in_x_days ?? dropMap.value.get(row.relation_id) ?? null
  return n === null || n === undefined ? '—' : `${n} 天`
}

/** 过期 Tab 的逾期行标红（→ §五 页 4） */
function rowClassName(row: AppointmentItem): string {
  if (activeTab.value === 'expired' && row.row_type === 'appointment') return 'row-danger'
  return ''
}

// ===== 改期弹窗 =====
const rescheduleState = ref<{
  visible: boolean
  id: string
  at: string | null
  note: string
}>({ visible: false, id: '', at: null, note: '' })

function openReschedule(row: AppointmentItem): void {
  if (row.appointment_id === null) return
  rescheduleState.value = {
    visible: true,
    id: row.appointment_id,
    at: row.appointment_at,
    note: row.note ?? '',
  }
}

async function submitReschedule(): Promise<void> {
  const { id, at, note } = rescheduleState.value
  if (at === null) {
    message.warning('请选择改期时间')
    return
  }
  try {
    await rescheduleAppointment(id, { appointment_at: dayjs(at).toISOString(), note })
    message.success('已改期')
    rescheduleState.value.visible = false
    void load()
  } catch (error) {
    message.error(error instanceof Error ? error.message : '改期失败')
  }
}

// ===== 完成预约 =====
function confirmComplete(row: AppointmentItem): void {
  if (row.appointment_id === null) return
  Modal.confirm({
    title: '完成预约',
    content: '完成会生成一条跟单记录（＝一次有效跟进），确认完成？',
    okText: '完成',
    onOk: async () => {
      try {
        await completeAppointment(row.appointment_id as string)
        message.success('已完成并生成跟单')
        void load()
      } catch (error) {
        message.error(error instanceof Error ? error.message : '完成失败')
      }
    },
  })
}

// ===== 写跟进（→ 关系详情的时间线抽屉，后续里程碑接） =====
function writeFollowUp(row: AppointmentItem): void {
  void router.push(`/relations/${row.relation_id}`)
}

// ===== 新增预约弹窗（缺约行 / 关系详情按钮复用） =====
const createState = ref<{
  visible: boolean
  relationId: string
  companyName: string
  contactId: string | null
  at: string | null
  note: string
  contacts: { id: string; name: string }[]
  contactsLoading: boolean
}>({
  visible: false,
  relationId: '',
  companyName: '',
  contactId: null,
  at: null,
  note: '',
  contacts: [],
  contactsLoading: false,
})

async function openCreate(row: AppointmentItem): Promise<void> {
  createState.value = {
    visible: true,
    relationId: row.relation_id,
    companyName: row.company_name,
    contactId: null,
    at: null,
    note: '',
    contacts: [],
    contactsLoading: true,
  }
  // 取该公司联系人（→ `GET /companies/:id/contacts`），用于选「对着谁」
  try {
    const detail = await getRelation(row.relation_id)
    const companyId = detail.company?.id
    if (companyId) {
      const page: ContactPage = await listCompanyContacts(companyId, { pageSize: 100 })
      createState.value.contacts = (page.items ?? []).map((c) => ({ id: c.id, name: c.name }))
    }
  } catch {
    createState.value.contacts = []
  } finally {
    createState.value.contactsLoading = false
  }
}

async function submitCreate(): Promise<void> {
  const { relationId, contactId, at, note } = createState.value
  if (at === null) {
    message.warning('请选择预约时间')
    return
  }
  try {
    await createAppointment({
      relation_id: relationId,
      contact_id: contactId ?? undefined,
      appointment_at: dayjs(at).toISOString(),
      note: note || undefined,
    })
    message.success('已新增预约')
    createState.value.visible = false
    void load()
  } catch (error) {
    message.error(error instanceof Error ? error.message : '新增预约失败')
  }
}
</script>

<template>
  <PageContainer :title="`预约管理 · ${TAB_LABEL[activeTab]}`">
    <a-tabs :active-key="activeTab" @change="onTabChange">
      <a-tab-pane v-for="t in TAB_ORDER" :key="t" :tab="TAB_LABEL[t]">
        <template #tab>
          <span :class="{ 'expired-tab': t === 'expired' }">{{ TAB_LABEL[t] }}</span>
        </template>
      </a-tab-pane>
    </a-tabs>

    <ErrorBlock v-if="errorText" :message="errorText" @retry="load" />

    <CrmTable
      v-else
      :columns="columns"
      :data-source="rows"
      :loading="loading"
      :pagination="false"
      row-key="appointment_id"
      :row-class-name="rowClassName"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'contact'">
          {{ contactNameOf(record as AppointmentItem) }}
        </template>
        <template v-else-if="column.key === 'appointment_at'">
          {{ (record as AppointmentItem).appointment_at ? formatDateTime((record as AppointmentItem).appointment_at as string) : '—' }}
        </template>
        <template v-else-if="column.key === 'drop_in_x_days'">
          {{ dropTextOf(record as AppointmentItem) }}
        </template>
        <template v-else-if="column.key === 'actions'">
          <a-space>
            <a-button
              v-if="(record as AppointmentItem).row_type === 'appointment'"
              type="link"
              size="small"
              @click="writeFollowUp(record as AppointmentItem)"
            >
              写跟进
            </a-button>
            <a-button
              v-if="(record as AppointmentItem).row_type === 'appointment'"
              type="link"
              size="small"
              @click="openReschedule(record as AppointmentItem)"
            >
              改期
            </a-button>
            <a-button
              v-if="(record as AppointmentItem).row_type === 'appointment'"
              type="link"
              size="small"
              danger
              @click="confirmComplete(record as AppointmentItem)"
            >
              完成预约
            </a-button>
            <a-button
              v-if="(record as AppointmentItem).row_type === 'missing'"
              type="link"
              size="small"
              @click="openCreate(record as AppointmentItem)"
            >
              新增预约
            </a-button>
          </a-space>
        </template>
      </template>
      <template #emptyText>
        <EmptyState :description="`「${TAB_LABEL[activeTab]}」暂无数据`" />
      </template>
    </CrmTable>

    <!-- 改期 -->
    <a-modal
      v-model:open="rescheduleState.visible"
      title="改期"
      @ok="submitReschedule"
    >
      <a-form layout="vertical">
        <a-form-item label="改到" required>
          <a-date-picker
            v-model:value="rescheduleState.at"
            show-time
            format="YYYY-MM-DD HH:mm"
            style="width: 100%"
          />
        </a-form-item>
        <a-form-item label="备注">
          <a-textarea v-model:value="rescheduleState.note" :rows="3" />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 新增预约 -->
    <a-modal v-model:open="createState.visible" title="新增预约" @ok="submitCreate">
      <a-form layout="vertical">
        <a-form-item label="客户">
          <span>{{ createState.companyName }}</span>
        </a-form-item>
        <a-form-item label="对着联系人">
          <a-select
            v-model:value="createState.contactId"
            :loading="createState.contactsLoading"
            allow-clear
            placeholder="可选"
            style="width: 100%"
          >
            <a-select-option v-for="c in createState.contacts" :key="c.id" :value="c.id">
              {{ c.name }}
            </a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="预约时间" required>
          <a-date-picker
            v-model:value="createState.at"
            show-time
            format="YYYY-MM-DD HH:mm"
            style="width: 100%"
          />
        </a-form-item>
        <a-form-item label="备注">
          <a-textarea v-model:value="createState.note" :rows="3" />
        </a-form-item>
      </a-form>
    </a-modal>
  </PageContainer>
</template>

<style scoped>
.expired-tab {
  color: var(--crm-color-error, #cf1322);
  font-weight: var(--crm-font-weight-strong, 600);
}

:deep(.row-danger > td) {
  background: var(--crm-color-error-bg, #fff1f0);
}
</style>
