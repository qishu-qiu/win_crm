<script setup lang="ts">
import { message } from 'ant-design-vue'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import {
  activateContactRelation,
  createCompany,
  getContact,
  searchDupCompanies,
  type ContactDetail,
} from '../api/company'
import {
  listDepartments,
  listProductLines,
  type DepartmentVo,
  type ProductLineVo,
} from '../api/org'
import CompanyDupPicker from '../components/CompanyDupPicker.vue'
import RelationTargetPicker from '../components/RelationTargetPicker.vue'
import { type CompanyChoice } from '../company'
import { currentUser } from '../session'
import { recordContactEvent, type RecordEventInput } from '../api/engine'
import {
  ACTION_TYPE_OPTIONS,
  EFFECTIVE_OUTCOME_OPTIONS,
  QUICK_MARK_OUTCOME_OPTIONS,
  actionTypeNameOf,
  outcomeNameOf,
} from '../engine'
import {
  contactStatusNameOf,
  decisionRoleNameOf,
  extraPhoneTypeNameOf,
  genderNameOf,
  traitLabelOf,
} from '../contact'
import { formatDate } from '../format'

/**
 * 联系人详情页（页 15，→《销售CRM前端页面与交互文档》§5 第 14/15 条）—— M6-16。
 *
 * 口径来源（★ 真相源，勿自造）：
 *   · 详情出参 →《销售CRM接口API文档》§5.5：**详情一律全号 `phone`**（是**出参形态、不是权限**，
 *     与角色无关）；**唯一例外**＝该联系人**被上锁**且查看者**不是落锁人** —— 此时
 *     `phone` 与 `extra_phones` **两个键都不出现**（锁跟人：主号与备用号一并隐藏），
 *     改给 `phone_locked` ＋ `phone_locked_by`（→ 需求 §4.3 二）。
 *     ⚠ 故一律按 **`'phone' in detail`** 判：写成 `detail.phone ?? '—'` 会把「已上锁」
 *     误显示成「没填号码」。
 *   · 「⚠ 尚未关联公司」横幅 ＋「关联公司」入口 → 前端文档 §5 第 14/15 条；
 *     补全路径＝**联系人详情「关联公司」→ 走撞库 → 激活关系** → 需求 §6.1 ③ ／ §12.1 分支 4。
 *   · 三态齐全（→ 设计规范 §五）：加载 / 错误 / 空 都要有；**403 是正常分支**，内联说清原因。
 *
 * ⛔ **本页不做、也不摆假入口**（每条都对应一条已登记欠账）：
 *   · **「申请解锁」按钮** —— 解锁走 G 域审批（`phone_unlock`），其入参出参都未定
 *     （→ 欠账 **D-04**）：本页只把**服务端给的状态**（`phone_locked` ＋ 落锁人）标出来；
 *   · **就职历史里的公司名 / 落锁人姓名的可点入口** —— 公司与员工详情（一层抽屉 / 悬浮卡）
 *     属 M9，服务端尚无对应端点（→ 欠账 **D-13**）：故此处是**纯文本**（实体可点铁律
 *     「当前页即该实体详情页除外」，而这两者都不是本页）；
 *   · **谈判特质 / 决策角色的编辑面**（`PUT /contacts/:id/traits` 未实现 → 欠账 **D-48**）：
 *     只读展示；
 *   · **悬浮卡**（规格提到）—— 跨页复用件属后续（→ 欠账 **D-50**）。
 *
 * ★ **前端不许自判业务规则**：能不能激活（部门越权 → 403）、算不算撞单（→ 409）、
 *   这个人还是不是「待关联」（→ 409）**全看服务端返回值与人话** —— 本页再判一遍＝第二套规则。
 */

const route = useRoute()
const router = useRouter()

const detail = ref<ContactDetail | null>(null)
const loading = ref(false)
const errorText = ref('')

/** 路由参数 `:id`（十进制字符串）—— 本页**只往下传**，不解析成数字（后端主键是 bigint） */
const contactId = computed(() => String(route.params.id ?? ''))

// ===== 「待关联」阶段记跟单（→ 接口 §5.7 第 4 行；D-45 前端接线）=====
/**
 * ⛔ **入口只在 `unlinked`（尚未关联公司）时出现**：已挂公司的联系人调本端点，服务端一律
 *   **403** 并指引「到业务关系里记」 —— 摆在别处就是点了必报错的**假入口**（设计规范 §3.2 第 11 条）。
 * ⚠ 本页**不展示"已记的跟单"历史**：联系人层**没有列表端点**（规格只给了"写" → 接口 §5.5 / §5.7），
 *   所以记完只 toast ＋ 清表单，**不编**「已记 N 条」这种没有数据源的话；
 *   历史要等**关联公司之后**到业务关系时间线看（那时服务端会把它们挂过去）。
 * ★ 表单字段与关系页抽屉**同款**（不另造第二种范式）：动作 ＋ 结果 ＋ 一句话结果 ＋ 时长。
 */
const eventForm = ref<{
  action_type: string
  outcome: string
  summary: string
  duration_min: number | null
}>({ action_type: 'phone', outcome: 'advanced', summary: '', duration_min: null })

const submittingEvent = ref(false)

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

async function submitContactEvent(): Promise<void> {
  const input: RecordEventInput = { action_type: eventForm.value.action_type }
  if (eventForm.value.outcome !== '') input.outcome = eventForm.value.outcome
  if (eventForm.value.summary.trim() !== '') input.summary = eventForm.value.summary.trim()
  if (eventForm.value.duration_min !== null) input.duration_min = eventForm.value.duration_min

  submittingEvent.value = true
  try {
    await recordContactEvent(contactId.value, input)
    // ★ 只说"挂到新关系上"这个**服务端确实会做**的事（激活时批量回填 `relation_id`），
    //   不说「已刷新跟进时间」—— 本端点**不回写 `last_event_at`**（→ 需求 §6.3）
    message.success('已记下这条跟单（关联公司后会挂到新关系的时间线上）')
    eventForm.value.summary = ''
    eventForm.value.duration_min = null
  } catch (error) {
    message.error(error instanceof Error ? error.message : '记跟单失败，请稍后重试')
  } finally {
    submittingEvent.value = false
  }
}

// ===== 「关联公司并激活业务关系」（→ 需求 §6.1 ③ / §12.1 分支 4）=====

const linking = ref(false)
const linkChoice = ref<CompanyChoice | null>(null)
const linkForm = reactive({ dept_id: '', product_line_id: '', position: '' })
const departments = ref<DepartmentVo[]>([])
const productLines = ref<ProductLineVo[]>([])
const optionsLoading = ref(false)
const optionsError = ref('')
const optionsLoaded = ref(false)
const submitting = ref(false)
const submitError = ref('')

/**
 * 部门 / 产品线下拉的数据源（展开面板时拉一次）。
 *
 * ★ 与录入页**逐字同一口径**：
 *   ① **部门候选** ＝ `me.activatable_dept_ids`（＝ `checkActivateScope` 同集，`all` 档空数组＝不限制），
 *      **不在其上再加规则**（曾误加「业务线交集」→ 比服务端宽 → 选中即 403，→ D-73）；越权兜底仍是服务端 403。
 *   ② **产品线候选**（2026-09-22 拍板，→《欠账登记表》**D-74** / 架构 §7.2）＝ **所选部门承接的产品线**，
 *      由复用件 `RelationTargetPicker` 内部派生 ⇒ 本页**原样喂全量**、不再按 `me.product_line_ids` 过滤
 *      （那是**假限制**：缩到"我挂的线"，比口径窄）。
 * ★ **不隐藏停用项**（能不能建由服务端判）。
 */
async function loadOptions(): Promise<void> {
  optionsError.value = ''
  optionsLoading.value = true
  try {
    const [deptRows, lineRows] = await Promise.all([listDepartments(), listProductLines()])
    const myDeptIds = currentUser.value?.activatable_dept_ids ?? []
    departments.value = deptRows.filter(
      (d) => myDeptIds.length === 0 || myDeptIds.includes(d.id),
    )
    productLines.value = lineRows
    optionsLoaded.value = true
  } catch (error) {
    optionsError.value = errorTextOf(error, '部门 / 产品线加载失败，请稍后重试')
  } finally {
    optionsLoading.value = false
  }
}

function errorTextOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

/** 展开「关联公司」面板（重开即回到未选状态：件是 `v-if` 挂上去的，天然重新挂载） */
function openLinkPanel(): void {
  linking.value = true
  linkChoice.value = null
  linkForm.dept_id = ''
  linkForm.product_line_id = ''
  linkForm.position = ''
  submitError.value = ''
  if (!optionsLoaded.value) void loadOptions()
}

function closeLinkPanel(): void {
  linking.value = false
  submitError.value = ''
}

/** 撞库件选定 / 重选后回填（件只交回一个 `CompanyChoice`，其余由本页持有） */
function onChoiceChange(choice: CompanyChoice | null): void {
  linkChoice.value = choice
}

const canSubmitLink = computed(
  () =>
    linkChoice.value !== null &&
    linkForm.dept_id !== '' &&
    linkForm.product_line_id !== '',
)

/**
 * 提交：① 公司（仅「将新建」时真正建档）→ ② 一次 `activate-relation`。
 * ★ **三件事（写就职 / 建关系 / 搬孤儿跟单）全在服务端**，前端不做任何编排、更不自作补偿
 *   （→ `api/company.ts` 头注：跨 B / C / D 三域且**不共享事务**，前端补一套＝第二套口径）。
 * ★ **重试不重复建模档**：建成后立刻改写为「沿用已有档案」—— 否则「撞了 409 改一下再交」
 *   会在库里留下第二条空档案（与录入页同一姿势）。
 */
async function submitLink(): Promise<void> {
  submitError.value = ''
  const choice = linkChoice.value
  if (choice === null) {
    submitError.value = '请先选择或新建公司'
    return
  }

  submitting.value = true
  try {
    let companyId: string
    if (choice.kind === 'existing') {
      companyId = choice.id
    } else {
      const company = await createCompany({
        full_name: choice.full_name,
        ...(choice.credit_code === '' ? {} : { credit_code: choice.credit_code }),
      })
      companyId = company.id
      linkChoice.value = { kind: 'existing', id: company.id, full_name: company.full_name }
    }

    const relation = await activateContactRelation(contactId.value, {
      company_id: companyId,
      dept_id: linkForm.dept_id,
      product_line_id: linkForm.product_line_id,
      ...(linkForm.position.trim() === '' ? {} : { position: linkForm.position.trim() }),
    })

    message.success(
      relation.linked_events > 0
        ? `已关联公司并激活业务关系（同时把 ${relation.linked_events} 条跟单挂到新关系）`
        : '已关联公司并激活业务关系',
    )
    await router.push(`/relations/${relation.id}`)
  } catch (error) {
    // 409（三元组已有活跃关系 / 该联系人已挂过公司）、403（部门越权 / 只读角色）、400：都是服务端人话
    submitError.value = errorTextOf(error, '提交失败，请稍后重试')
  } finally {
    submitting.value = false
  }
}

// ===== 展示 =====

/**
 * 「待关联」＝**没挂公司**：判定＝该联系人**没有任何就职记录**（**派生、不加字段**，
 * → 需求 §6.1 ③）。⚠ 这里判的只是**要不要显示横幅**（显示层）：真判定在服务端
 * （已挂过公司 → **409**），前端不拿它当写门槛。
 */
const unlinked = computed(() => detail.value !== null && detail.value.employments.length === 0)

/** 号是否**对当前查看者**可见：键在＝可见（上锁时服务端**不给这两个键**，→ 接口 §5.5） */
const phonesLocked = computed(() => detail.value !== null && !('extra_phones' in detail.value))

const extraPhones = computed(() => detail.value?.extra_phones ?? [])

const lockerName = computed(() => detail.value?.phone_locked_by?.name ?? '')

const employmentColumns = [
  { title: '公司', dataIndex: 'company', key: 'company' },
  { title: '职位', dataIndex: 'position', key: 'position', width: 160 },
  { title: '入职', dataIndex: 'joined', key: 'joined', width: 120 },
  { title: '离职', dataIndex: 'left', key: 'left', width: 120 },
  { title: '在职', dataIndex: 'current', key: 'current', width: 100 },
]

/** `company_id` 可能重复（离职后回到同一家）⇒ 行键带上下标，避免键冲突 */
function employmentRowKey(record: { company_id: string }, index: number): string {
  return `${record.company_id}-${index}`
}

async function load(): Promise<void> {
  errorText.value = ''
  loading.value = true
  // 换人（同一页内换 id）时收起上一个人的面板，避免"看着 A、操作着 B"
  linking.value = false
  submitError.value = ''
  linkChoice.value = null
  try {
    detail.value = await getContact(contactId.value)
  } catch (error) {
    // 403（「待关联」只对归属人可见 / 越权）与网络错误都走这里：**内联**说清，内容清空
    detail.value = null
    errorText.value = errorTextOf(error, '加载失败，请稍后重试')
  } finally {
    loading.value = false
  }
}

watch(contactId, () => {
  void load()
})

onMounted(() => {
  void load()
})
</script>

<template>
  <section class="contact">
    <a-button type="link" size="small" class="contact-back" @click="router.push('/contacts')">
      ← 返回联系人档案
    </a-button>

    <p v-if="errorText" class="contact-error">{{ errorText }}</p>

    <a-spin :spinning="loading">
      <template v-if="detail">
        <h2 class="contact-title">{{ detail.name }}</h2>

        <div class="contact-badges">
          <span class="contact-badge">状态：{{ contactStatusNameOf(detail.status) }}</span>
          <span class="contact-badge">决策角色：{{ decisionRoleNameOf(detail.decision_role) }}</span>
        </div>

        <!-- 「⚠ 尚未关联公司」横幅 ＋「关联公司」入口（→ 前端文档 §5 第 14/15 条） -->
        <div v-if="unlinked" class="contact-banner">
          <a-alert
            type="warning"
            show-icon
            message="⚠ 尚未关联公司"
            description="这条线索还没挂公司：归建档人待跟进，不进业务关系列表、不触发掉海。关联公司后会同时激活一条业务关系，并把这人名下的跟单挂过去。"
          >
            <template #action>
              <a-button v-if="!linking" size="small" type="primary" @click="openLinkPanel">
                关联公司
              </a-button>
            </template>
          </a-alert>
        </div>

        <!-- 「待关联」阶段记跟单（→ 接口 §5.7 第 4 行；D-45）——
             ⛔ 只在「尚未关联公司」时出现：已挂公司的联系人服务端一律 403（人话指引"到业务关系里记"），
             摆出来就是点了必报错的假入口（设计规范 §3.2 第 11 条） -->
        <div v-if="unlinked" class="contact-card">
          <h3 class="contact-card-title">记一条跟单</h3>
          <p class="contact-note">
            这条线索还没挂公司，跟单先记在联系人身上；关联公司后会自动挂到新关系的时间线上。
            <strong>有效沟通必须写一句话结果</strong>（只说"没打通"这类请用快速标记）。
          </p>

          <div class="contact-actions">
            <a-select
              v-model:value="eventForm.action_type"
              :options="actionTypeOptions"
              style="width: 120px"
            />
            <a-select
              v-model:value="eventForm.outcome"
              :options="outcomeOptions"
              style="width: 180px"
            />
            <a-input
              v-model:value="eventForm.summary"
              placeholder="一句话结果（有效沟通必填）"
              style="min-width: 220px"
            />
            <a-input-number
              v-model:value="eventForm.duration_min"
              :min="1"
              placeholder="分钟"
              style="width: 100px"
            />
            <a-button type="primary" :loading="submittingEvent" @click="submitContactEvent">
              记下
            </a-button>
          </div>
        </div>

        <!-- 「关联公司」面板：撞库（分支 4）→ 定部门 × 产品线 → 激活 -->
        <div v-if="linking" class="contact-card">
          <h3 class="contact-card-title">关联公司并激活业务关系</h3>

          <CompanyDupPicker
            :search="searchDupCompanies"
            :disabled="submitting"
            @change="onChoiceChange"
          />

          <p v-if="optionsError" class="contact-error">{{ optionsError }}</p>

          <RelationTargetPicker
            v-model:dept-id="linkForm.dept_id"
            v-model:product-line-id="linkForm.product_line_id"
            :departments="departments"
            :product-lines="productLines"
            :loading="optionsLoading"
            :disabled="submitting"
          />

          <a-form layout="vertical">
            <a-form-item label="此人在该公司的职位（可空）">
              <a-input v-model:value="linkForm.position" placeholder="例如：采购经理" allow-clear />
            </a-form-item>
          </a-form>

          <p class="contact-note">
            激活后这条关系归你（换人要走转交审批）。同公司 × 同部门 × 同产品线只能有一条关系，
            已有归属时服务端会拦下并说明原因。
          </p>

          <p v-if="submitError" class="contact-error">{{ submitError }}</p>

          <div class="contact-actions">
            <a-button
              type="primary"
              :loading="submitting"
              :disabled="!canSubmitLink"
              @click="submitLink"
            >
              确认并激活业务关系
            </a-button>
            <a-button type="text" :disabled="submitting" @click="closeLinkPanel">取消</a-button>
          </div>
        </div>

        <h3 class="contact-section">联系方式</h3>
        <a-descriptions :column="2" size="small" bordered class="contact-facts">
          <a-descriptions-item label="手机号（主号）">
            <template v-if="!phonesLocked">{{ detail.phone }}</template>
            <template v-else>
              🔒 已上锁<template v-if="lockerName">（by {{ lockerName }}）</template>
            </template>
          </a-descriptions-item>

          <a-descriptions-item label="备用号">
            <template v-if="phonesLocked">🔒 已上锁</template>
            <template v-else-if="extraPhones.length > 0">
              <div v-for="(item, index) in extraPhones" :key="index" class="contact-extra-phone">
                {{ item.number }}（{{ extraPhoneTypeNameOf(item.type) }}<template v-if="item.note"
                  >·{{ item.note }}</template
                >）
              </div>
            </template>
            <template v-else>—</template>
          </a-descriptions-item>

          <a-descriptions-item label="微信">{{ detail.wechat ?? '—' }}</a-descriptions-item>
          <a-descriptions-item label="邮箱">{{ detail.email ?? '—' }}</a-descriptions-item>
          <a-descriptions-item label="性别">{{ genderNameOf(detail.gender) }}</a-descriptions-item>
          <a-descriptions-item label="生日">{{ formatDate(detail.birthday) }}</a-descriptions-item>
        </a-descriptions>

        <h3 class="contact-section">谈判特质与标签</h3>
        <div class="contact-tags">
          <a-tag v-for="trait in detail.traits" :key="trait.trait_id">
            {{ traitLabelOf(trait) }}
          </a-tag>
          <a-tag v-for="(tag, index) in detail.tags" :key="`tag-${index}`" color="default">
            {{ tag }}
          </a-tag>
          <span v-if="detail.traits.length === 0 && detail.tags.length === 0" class="contact-empty">
            —
          </span>
        </div>

        <h3 class="contact-section">就职 / 跳槽历史</h3>
        <a-table
          :columns="employmentColumns"
          :data-source="detail.employments"
          :pagination="false"
          :row-key="employmentRowKey"
          size="small"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'company'">{{ record.company_name }}</template>
            <template v-else-if="column.key === 'position'">{{ record.position ?? '—' }}</template>
            <template v-else-if="column.key === 'joined'">{{ formatDate(record.joined_at) }}</template>
            <template v-else-if="column.key === 'left'">{{ formatDate(record.left_at) }}</template>
            <template v-else-if="column.key === 'current'">
              <a-tag :color="record.is_current ? 'green' : 'default'">
                {{ record.is_current ? '在职' : '已离职' }}
              </a-tag>
            </template>
          </template>
          <template #emptyText>
            <a-empty description="还没有就职记录（＝待关联）" />
          </template>
        </a-table>

        <p class="contact-note">
          「申请解锁」属后续里程碑（解锁审批未建）—— 本页只标注上锁状态，不摆点了没用的按钮；
          就职历史里的公司名 / 落锁人姓名暂为纯文本（公司与员工详情页未建）。
        </p>
      </template>

      <a-empty v-else-if="!loading && errorText === ''" description="没有这位联系人" />
    </a-spin>
  </section>
</template>

<style scoped>
.contact {
  max-width: 1080px;
}

.contact-back {
  padding-left: 0;
  margin-bottom: var(--crm-space-sm);
}

.contact-title {
  margin: 0 0 var(--crm-space-sm);
  font-size: var(--crm-font-size-2xl);
  font-weight: var(--crm-font-weight-strong);
  color: var(--crm-color-text);
}

.contact-badges {
  display: flex;
  flex-wrap: wrap;
  gap: var(--crm-space-xs);
  margin-bottom: var(--crm-space-md);
}

.contact-badge {
  display: inline-flex;
  align-items: center;
  height: 28px;
  padding: 0 var(--crm-space-sm);
  font-size: var(--crm-font-size-xs);
  color: var(--crm-color-text-secondary);
  background: var(--crm-color-bg-container);
  border: var(--crm-border-width) solid var(--crm-color-border-secondary);
  border-radius: var(--crm-radius-pill);
}

.contact-banner {
  margin-bottom: var(--crm-space-md);
}

.contact-card,
.contact-facts {
  margin-bottom: var(--crm-space-lg);
}

.contact-card {
  padding: var(--crm-space-lg);
  margin-top: var(--crm-space-md);
  background: var(--crm-color-bg-container);
  border: var(--crm-border-width) solid var(--crm-color-border-secondary);
  border-radius: var(--crm-radius-lg);
}

.contact-card-title {
  margin: 0 0 var(--crm-space-md);
  font-size: var(--crm-font-size-lg);
  font-weight: var(--crm-font-weight-strong);
  color: var(--crm-color-text);
}

.contact-section {
  margin: var(--crm-space-lg) 0 var(--crm-space-sm);
  font-size: var(--crm-font-size-lg);
  font-weight: var(--crm-font-weight-strong);
  color: var(--crm-color-text);
}

.contact-tags {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--crm-space-xxs);
}

.contact-empty {
  font-size: var(--crm-font-size-base);
  color: var(--crm-color-text-tertiary);
}

.contact-extra-phone {
  font-size: var(--crm-font-size-xs);
  color: var(--crm-color-text-secondary);
}

.contact-error {
  margin: 0 0 var(--crm-space-sm);
  font-size: var(--crm-font-size-xs);
  color: var(--crm-color-error);
}

.contact-note {
  margin: var(--crm-space-md) 0 0;
  font-size: var(--crm-font-size-xs);
  color: var(--crm-color-text-tertiary);
}

.contact-actions {
  display: flex;
  align-items: center;
  gap: var(--crm-space-sm);
  margin-top: var(--crm-space-md);
}
</style>
