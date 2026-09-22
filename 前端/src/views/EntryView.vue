<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { message } from 'ant-design-vue'

import {
  createCompany,
  createContact,
  listCompanyContacts,
  searchDupCompanies,
  type ContactBrief,
  type CreatedContact,
  type DupCandidate,
} from '../api/company'
import {
  listDepartments,
  listProductLines,
  type DepartmentVo,
  type ProductLineVo,
} from '../api/org'
import { createRelation, type RelationVo } from '../api/relation'
import { currentUser } from '../session'
import {
  recordEvent,
  recordContactEvent,
  type RecordEventInput,
} from '../api/engine'
import {
  ACTION_TYPE_OPTIONS,
  EFFECTIVE_OUTCOME_OPTIONS,
  QUICK_MARK_OUTCOME_OPTIONS,
  actionTypeNameOf,
  outcomeNameOf,
} from '../engine'
import CompanyDupPicker from '../components/CompanyDupPicker.vue'
import RelationTargetPicker from '../components/RelationTargetPicker.vue'
import EventComposer from '../components/EventComposer.vue'
import { type CompanyChoice } from '../company'

/**
 * 录入页（M6-09 片 1）—— **3 步步骤条：① 联系人 → ② 公司 → ③ 确认**，
 * 第 3 步「确认」＝**激活一条业务关系**（第 2 步也可跳过，只建联系人）。
 *
 * 口径来源（★ 真相源，勿自造）：
 *   · 步骤与跳过的语义 →《销售CRM前端页面与交互文档》**§5 第 7 条**：3 步步骤条；
 *     第 2 步「公司」可跳过（「暂不填公司，先存为待跟进」→ 只建联系人＝「待关联公司」）；
 *     第 3 步「确认」＝激活业务关系。**跳过时不让选部门 / 产品线** —— 部门 × 产品线是
 *     **业务关系**的属性，没有公司就没有关系（→ 需求 §6.1 ⑧）。
 *   · 撞库 4 分支 →《销售CRM业务需求文档》**§12.1**（本片做到哪几支见下方 ★）。
 *   · 「待关联」＝**没挂公司**（判定＝该联系人无任何 `company_contact` 记录，**派生、不加字段**）、
 *     归属＝**建档人**、未关联期间**不占部门 / 不占产品线 / 不进业务关系列表 / 不掉海**（→ 需求 §6.1 ③⑦⑧）。
 *   · 出参形态 →《接口API文档》§5.4 / §5.5：查重候选带 `credit_code_masked`（打码）、
 *     公司联系人列表带 `phone_masked`（打码）、建档联系人出参给全号（详情形态）。
 *
 * ★ **本片落地的撞库分支**（§12.1）：
 *   · **分支 4「挂现有公司」**：查重命中候选 → 由**人**点选「用这家」或「确认新建（强行）」；
 *     系统**不自动合并、不阻断销售**（强行新建的留痕由**服务端**在 `POST /companies` 里写，前端不代办）。
 *     ⚠ 这一支的**界面与交互已抽成复用件** `components/CompanyDupPicker.vue`（M6-16：联系人详情页的
 *     「关联公司」走的是**同一条动线**，→ 架构 §4.4 约定 2「第二次出现就必须搬进 `components/`」）——
 *     本页只持有**结果**（`companyChoice`）与自己那部分取数（「该公司的联系人」）。
 *   · **触发点 ①（按手机号查重）**：第 1 步提交时先查一次 —— 命中说明这个号**已建过档**，
 *     同号**不能再建**（服务端 `uk_phone_active` → 409「该手机号已存在」），故**当场提示并停住**，
 *     给「去联系人档案」的出口，而不是等用户在最后一步撞 409。
 *   · **分支 2「本部门已激活」**：撞单是**服务端**在 `POST /relations` 判的（**409 / 20401**）——
 *     页面**把服务端那句人话直接显示**，不自己判「是不是重复」；「申请转交 / 协同」属 G 域审批（未建），
 *     **不摆假入口**（→ 欠账）。
 *   · ⛔ **做不了（不摆假入口）**：**分支 1**（公海可直领 → 依赖 F 域认领）、
 *     **分支 3**（跨部门可并行 → 需要「该公司的其它部门关系」信息，`search-dup` 候选**不含部门**、
 *     也没有「某公司已有关系」的端点 → 已登记欠账 `D-30`）。
 *
 * ★ **前端不许自己判业务规则**（→ 施工单 §二.4）：能不能建关系（部门越权 → 403）、
 *   算不算撞单（409）、这个号能不能再建 —— **全看服务端返回值与人话**；前端再判一遍＝第二套规则，
 *   迟早与后端分叉。
 * ★ 禁假数据撑页面（→ 设计规范 §3.2 第 11 条）：本页**不预填任何演示数据**，空态用 `a-empty`。
 * ★ 页码 / 步骤以外的状态一律**页内**：本页不把中间态写进 URL（刷新即重来，录入页是一次性动线）。
 */

/** 步骤：① 联系人 → ② 公司 → ③ 确认（顺序照前端文档 §5 第 7 条，**不是**「先公司后联系人」） */
type Step = 1 | 2 | 3

const STEP_ITEMS = [{ title: '联系人' }, { title: '公司' }, { title: '确认' }]

const router = useRouter()
const step = ref<Step>(1)

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

// ===== 第 1 步：联系人 =====

const contactForm = reactive({ name: '', phone: '', position: '' })
const contactError = ref('')
const checkingPhone = ref(false)
/** 手机号命中：这个号**已被建档**（返回的是它现在的公司）⇒ 同号不能再建，当场停住 */
const phoneDupCompanies = ref<DupCandidate[]>([])

/**
 * 第 1 步提交：**先按手机号查重，再放行**（→ 需求 §12.1 触发点 ①）。
 * ★ 命中时**不进第 2 步**：不是"疑似"而是**硬冲突**（服务端 `uk_phone_active`），
 *   往下走只会在最后一步撞 409、白填一遍公司信息。
 */
async function submitContactStep(): Promise<void> {
  contactError.value = ''
  phoneDupCompanies.value = []

  const name = contactForm.name.trim()
  const phone = contactForm.phone.trim()
  if (name === '' || phone === '') {
    contactError.value = '请填写联系人姓名与手机号'
    return
  }

  checkingPhone.value = true
  try {
    const result = await searchDupCompanies({ phone })
    if (result.candidates.length > 0) {
      phoneDupCompanies.value = result.candidates
      return
    }
    step.value = 2
  } catch (error) {
    contactError.value = errorText(error, '手机号查重失败，请稍后重试')
  } finally {
    checkingPhone.value = false
  }
}

// ===== 第 2 步：公司 =====

/**
 * 选定的公司 —— **本页只持有结果**：查重表单 / 候选 / 「用这家」与「确认新建」全在
 * `CompanyDupPicker` 里（跨页复用件，本页与联系人详情页共用一份，→ 架构 §4.4）。
 * · `existing` ＝ 沿用已有档案（查重候选里选中的，**或**「本次新建」成功后的实际档案）
 * · `new` ＝ **将新建**（还没写库 —— 真正的 `POST /companies` 发生在第 3 步提交时）
 */
const companyChoice = ref<CompanyChoice | null>(null)

/**
 * 撞库件的重挂键：`resetAll()` / 「跳过公司」时 +1 ⇒ 件**重新挂载**，表单与候选一并归零。
 * ★ 重挂优于"远程调用子件方法"：少一条隐式契约（子件不必为此暴露 `reset`）。
 */
const companyPickerKey = ref(0)

/** 沿用已有公司时：这家已有哪些联系人（**打码形态**，用来确认"是不是同一家"） */
const companyContacts = ref<ContactBrief[]>([])
const contactsLoading = ref(false)

async function loadCompanyContacts(companyId: string): Promise<void> {
  contactsLoading.value = true
  try {
    // **D-08**：该端点已分页（→ §2.3）⇒ 取 `list`。这里只作**建档前的辅助判断**，第 1 页够用；
    //   本页**不摆分页器**（要看全就到公司 / 关系详情里看，摆一个半截列表反而误导）。
    const result = await listCompanyContacts(companyId)
    companyContacts.value = result.list
  } catch {
    // 打不开就**空着**（这只是辅助判断，不是本步的前置条件）——错误由请求层统一表达
    companyContacts.value = []
  } finally {
    contactsLoading.value = false
  }
}

/** 撞库件的选定结果回填：沿用已有档案时顺手拉「该公司的联系人」做辅助确认 */
function onCompanyChoiceChange(choice: CompanyChoice | null): void {
  companyChoice.value = choice
  if (choice !== null && choice.kind === 'existing') {
    void loadCompanyContacts(choice.id)
    return
  }
  companyContacts.value = []
}

// ===== 第 3 步：确认 / 激活 =====

const departments = ref<DepartmentVo[]>([])
const productLines = ref<ProductLineVo[]>([])
const optionsLoading = ref(false)
const optionsError = ref('')
const optionsLoaded = ref(false)
const relationForm = reactive({ dept_id: '', product_line_id: '' })

const submitting = ref(false)
const submitError = ref('')
/** 提交结果：建成的关系 / 建成的联系人（**只建联系人＝跳过了公司**） */
const createdRelation = ref<RelationVo | null>(null)
const createdContact = ref<CreatedContact | null>(null)

/** 写跟单下拉选项（值域来自 `src/engine.ts`，**不在这里抄**；喂给 `EventComposer`） */
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

/** 写跟单草稿（与 `EventComposer` 的 `submit` 载荷同形；页面侧不依赖组件导出类型） */
interface EntryEventDraft {
  action_type: string
  outcome?: string
  summary?: string
  duration_min?: number
}

/**
 * 录入页结果态的写跟单提交（→ 接口 §5.7）。
 * ★ 关系态走 `recordEvent`、待关联态走 `recordContactEvent`（两态互斥，按哪个非 `null` 判）。
 *   失败原因（含「有效沟通必须写一句话结果」→ 422）由**请求层统一弹**，本页不重复堆一层。
 */
async function onEntryEventSubmit(draft: EntryEventDraft): Promise<void> {
  const input: RecordEventInput = { action_type: draft.action_type }
  if (draft.outcome) input.outcome = draft.outcome
  if (draft.summary?.trim()) input.summary = draft.summary.trim()
  if (draft.duration_min != null) input.duration_min = draft.duration_min

  try {
    if (createdRelation.value !== null) {
      await recordEvent(createdRelation.value.id, input)
      message.success('已记下这条跟单')
    } else if (createdContact.value !== null) {
      await recordContactEvent(createdContact.value.id, input)
      // ★ 只说服务端确实会做（激活时批量回填 `relation_id`，→ 需求 §6.1 ④）；不说「已刷新跟进时间」
      message.success('已记下这条跟单（关联公司后会挂到新关系的时间线上）')
    }
  } catch {
    // 请求层统一弹
  }
}

/**
 * 部门 / 产品线下拉的数据源（进入第 3 步且有公司时才拉）。
 *
 * ★ **部门候选** ＝ `me.activatable_dept_ids`，与 `relation` 域 `checkActivateScope` **逐字同集**
 *   （→ D-73，单一真相源）：`all` 档＝空数组＝不限制；`dept` 档＝管辖部门；`self` 档＝本人所属部门（含兼部门）。
 *   ★ **绝不在此之上再加规则** —— 曾误加「承接我业务线的部门也给」，比服务端宽 ⇒ 选中即 403
 *   （＝第二套权限口径；2026-09-22 真账号走查实测：销售二部承接了王海涛的产品线 1/2，被错误放进下拉，
 *   选中 → `relation.out_of_scope`）。越权兜底仍是 `POST /relations` 的 403：下拉收窄只是 UX。
 * ★ **产品线候选**（2026-09-22 拍板，→《欠账登记表》**D-74** / 架构 §7.2）＝ **所选部门承接的产品线**，
 *   由复用件 `RelationTargetPicker` 内部派生 ⇒ 本页**原样喂全量**、**不再按 `me.product_line_ids` 过滤**
 *   （那个过滤是**假限制**：把可选线缩到"我挂的"，比口径窄 —— 与 D-73 那条方向相反）。
 * ★ **不隐藏停用项、只标注**：能不能用是**服务端**的判断，前端把状态**显示出来**即可。
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
    optionsError.value = errorText(error, '部门 / 产品线加载失败，请稍后重试')
  } finally {
    optionsLoading.value = false
  }
}

// ★ 部门 / 产品线的**显示文案与选择件**已抽到跨页复用件（`components/RelationTargetPicker.vue`
//   ＋ 展示口径 `src/org.ts`）—— 联系人详情页的「关联公司」用的是同一份（→ 架构 §4.4 约定 2）。

const canSubmit = computed(() => {
  if (companyChoice.value === null) return true
  return relationForm.dept_id !== '' && relationForm.product_line_id !== ''
})

async function goConfirm(): Promise<void> {
  step.value = 3
  // 有公司才需要部门 / 产品线；没有公司（跳过）时**不拉**（也不必选，见文件头口径）
  if (companyChoice.value !== null && !optionsLoaded.value) await loadOptions()
}

/** 「暂不填公司，先存为待跟进」——只建联系人＝「待关联」，**下一步不选部门 / 产品线** */
function skipCompany(): void {
  companyChoice.value = null
  companyContacts.value = []
  // 跳过＝本步作废：让撞库件也归零（否则退回第 2 步时它还留着上次选过的公司，
  // 而本页的 `companyChoice` 已经是 null —— 两处不一致就是「页面显示的 ≠ 实际提交的」）
  companyPickerKey.value += 1
  void goConfirm()
}

/**
 * 第 3 步提交：**公司（若新建）→ 联系人 → 业务关系**，顺序不能反
 * （联系人要带 `company_id` 才写得出就职关系，→ 接口 §5.5）。
 *
 * ★ **重试不重复写**：公司建成 / 联系人建成后立刻记下来，下次提交直接复用 ——
 *   否则「撞了 409 改一下再交」就会在库里留下第二条空档案 / 第二个联系人。
 *   （这不是幂等键：`Idempotency-Key` 横切能力尚未做，→《欠账登记表》D-06；
 *     这里只保证**同一个页面会话内**不重复提交。）
 */
async function submitEntry(): Promise<void> {
  submitError.value = ''

  submitting.value = true
  try {
    // ① 公司：选「新建」时才真正建档（选「沿用已有」不动库）
    let companyId: string | null = null
    const choice = companyChoice.value
    if (choice !== null) {
      if (choice.kind === 'existing') {
        companyId = choice.id
      } else {
        const company = await createCompany({
          full_name: choice.full_name,
          ...(choice.credit_code === '' ? {} : { credit_code: choice.credit_code }),
        })
        companyId = company.id
        // ★ 建成即改写为「沿用已有档案」：再提交时**不会又建一家**
        companyChoice.value = { kind: 'existing', id: company.id, full_name: company.full_name }
      }
    }

    // ② 联系人（**详情形态：给全号**，→ §5.5；重试时直接复用上次建成的那条）
    if (createdContact.value === null) {
      createdContact.value = await createContact({
        name: contactForm.name.trim(),
        phone: contactForm.phone.trim(),
        ...(companyId === null ? {} : { company_id: companyId }),
        ...(contactForm.position.trim() === '' ? {} : { position: contactForm.position.trim() }),
      })
    }

    // ③ 业务关系（跳过了公司就没有这一步；归属＝发起人自己，由服务端定）
    if (companyId === null) {
      message.success('已建档（待关联）')
      return
    }

    createdRelation.value = await createRelation({
      company_id: companyId,
      dept_id: relationForm.dept_id,
      product_line_id: relationForm.product_line_id,
    })
    message.success('业务关系已激活')
  } catch (error) {
    // 409（手机号已存在 / 撞单已有归属）与 403（部门越权）都是**服务端人话**，内联显示
    submitError.value = errorText(error, '提交失败，请稍后重试')
  } finally {
    submitting.value = false
  }
}

/** 再录一个（清空全部状态，回到第 1 步） */
function resetAll(): void {
  step.value = 1
  contactForm.name = ''
  contactForm.phone = ''
  contactForm.position = ''
  contactError.value = ''
  phoneDupCompanies.value = []
  // 撞库件重挂＝它的表单 / 候选 / 已选一并归零（本页只清自己持有的结果）
  companyPickerKey.value += 1
  companyChoice.value = null
  companyContacts.value = []
  relationForm.dept_id = ''
  relationForm.product_line_id = ''
  submitError.value = ''
  createdRelation.value = null
  createdContact.value = null
}

function goContacts(): void {
  void router.push('/contacts')
}

function goRelationDetail(): void {
  const relation = createdRelation.value
  if (relation === null) return
  void router.push(`/relations/${relation.id}`)
}
</script>

<template>
  <section class="entry">
    <h2 class="entry-title">录入</h2>
    <p class="entry-hint">
      三步走完一次录入：先记人，再挂公司，最后确认激活业务关系。第 2 步可以跳过（暂不填公司，
      先存为待跟进）。
    </p>

    <!-- 结果态：建成后不再显示步骤条与表单（避免"填了会怎样"的误会） -->
    <div v-if="createdRelation !== null" class="entry-card">
      <a-result
        status="success"
        title="业务关系已激活"
        :sub-title="`${contactForm.name}（${contactForm.phone}）· ${createdRelation.company?.name ?? '（档案已删除）'}`"
      >
        <template #extra>
          <a-button type="primary" @click="goRelationDetail">查看关系详情</a-button>
          <a-button @click="resetAll">再录一个</a-button>
        </template>
      </a-result>

      <!-- ★ 低摩擦录入（→ 需求 §10.2「写跟单 ≤10 秒」）：录完直接记一句，不必跳到详情页 -->
      <div class="entry-after">
        <p class="entry-after-hint">顺手记一句刚聊的内容？</p>
        <EventComposer
          mode="relation"
          :action-type-options="actionTypeOptions"
          :outcome-options="outcomeOptions"
          @submit="onEntryEventSubmit"
        />
      </div>
    </div>

    <!--
      ★ 只在**跳过公司**（`companyChoice === null`）时才认「已建档（待关联）」。
        选了公司却 `createRelation` 失败（越权 403 / 撞单 409）时**不能把用户当成功** ——
        原条件只看 `createdContact !== null`，会把失败粉饰成「已建档（待关联）」，
        且那句"未挂公司"也是错的（联系人其实已挂公司）；内联错误还会被结果态盖住。
        2026-09-22 真账号走查实测。
    -->
    <div v-else-if="createdContact !== null && companyChoice === null" class="entry-card">
      <a-result
        status="success"
        title="已建档（待关联）"
        :sub-title="`${createdContact.name}（${createdContact.phone}）—— 未挂公司，归你待跟进`"
      >
        <template #extra>
          <a-button type="primary" @click="goContacts">去联系人档案</a-button>
          <a-button @click="resetAll">再录一个</a-button>
        </template>
      </a-result>

      <!-- ★ 待关联态也可记跟单（→ D-45：只绑联系人，关联公司后服务端批量挂到新关系） -->
      <div class="entry-after">
        <p class="entry-after-hint">这个人还没挂公司：先记一句，关联公司后自动挂到新关系的时间线上。</p>
        <EventComposer
          mode="contact"
          :action-type-options="actionTypeOptions"
          :outcome-options="outcomeOptions"
          @submit="onEntryEventSubmit"
        />
      </div>
    </div>

    <template v-else>
      <a-steps class="entry-steps" :current="step - 1" :items="STEP_ITEMS" size="small" />

      <!-- ===== 第 1 步：联系人 ===== -->
      <div v-if="step === 1" class="entry-card">
        <h3 class="entry-card-title">1 · 联系人</h3>

        <!--
          ⚠ **提交走 `@click` ＋ `@press-enter`，不用 `<a-form @finish>`**：本表单没有
            `:model` / `name` 字段，实测 `@finish` **不会触发**（按钮点了没反应 —— 2026-09-18
            浏览器走查实测；登录页有 `:model` ＋ `name` 故正常）→ 见《AI协作铁律与踩坑复盘》。
        -->
        <a-form layout="vertical">
          <a-form-item label="姓名">
            <a-input
              v-model:value="contactForm.name"
              placeholder="例如：张伟"
              allow-clear
              @press-enter="submitContactStep"
            />
          </a-form-item>

          <a-form-item label="手机号（主号，撞库校验核心）">
            <a-input
              v-model:value="contactForm.phone"
              placeholder="138 0000 0000（空格 / +86 / - 都会被归一）"
              allow-clear
              @press-enter="submitContactStep"
            />
          </a-form-item>

          <a-form-item label="职位（可空）">
            <a-input
              v-model:value="contactForm.position"
              placeholder="例如：采购总监"
              allow-clear
              @press-enter="submitContactStep"
            />
          </a-form-item>

          <p v-if="contactError" class="entry-error">{{ contactError }}</p>

          <a-button type="primary" :loading="checkingPhone" @click="submitContactStep">
            下一步：选公司
          </a-button>
        </a-form>

        <!-- 手机号命中：同号不能重复建档（→ 需求 §12.1 触发点 ①） -->
        <div v-if="phoneDupCompanies.length > 0" class="entry-dups">
          <a-alert
            type="warning"
            show-icon
            message="这个手机号已有档案"
            description="同一号码不能重复建档（服务端会拦）。要跟进这个人，请到已有档案里写跟单；如果是同一个人换了公司，「跳槽」动线随后续版本提供。"
          />
          <ul class="entry-dup-list">
            <li v-for="item in phoneDupCompanies" :key="item.id" class="entry-dup-item">
              <div class="entry-dup-main">
                <span class="entry-dup-name">{{ item.full_name }}</span>
                <span class="entry-dup-meta">该号码现挂在这家公司下</span>
              </div>
            </li>
          </ul>
          <a-button type="link" @click="goContacts">去联系人档案看看</a-button>
        </div>
      </div>

      <!-- ===== 第 2 步：公司（可跳过） ===== -->
      <div v-else-if="step === 2" class="entry-card">
        <h3 class="entry-card-title">2 · 公司</h3>

        <!-- 撞库选公司：**跨页复用件**（本页第 2 步 与 联系人详情页「关联公司」共用一份，→ 架构 §4.4） -->
        <CompanyDupPicker
          :key="companyPickerKey"
          :search="searchDupCompanies"
          :disabled="submitting"
          @change="onCompanyChoiceChange"
        >
          <!-- 沿用已有公司时：看看这家已有哪些人（列表形态、号码打码） -->
          <div
            v-if="companyChoice !== null && companyChoice.kind === 'existing'"
            class="entry-contacts"
          >
            <h4 class="entry-contacts-title">该公司的联系人（列表形态，号码打码）</h4>
            <a-empty
              v-if="!contactsLoading && companyContacts.length === 0"
              description="还没有联系人"
            />
            <ul v-else class="entry-contact-list">
              <li v-for="person in companyContacts" :key="person.id" class="entry-contact-item">
                <span class="entry-contact-name">{{ person.name }}</span>
                <span class="entry-dup-meta">
                  {{ person.phone_masked }}<template v-if="person.position">
                    ｜{{ person.position }}</template>
                </span>
                <a-tag v-if="!person.is_current" color="default">已离职</a-tag>
              </li>
            </ul>
          </div>
        </CompanyDupPicker>

        <div class="entry-actions">
          <a-button v-if="companyChoice !== null" type="primary" @click="goConfirm">
            下一步：确认
          </a-button>
          <a-button type="link" @click="skipCompany">暂不填公司，先存为待跟进</a-button>
          <a-button type="text" @click="step = 1">上一步</a-button>
        </div>
      </div>

      <!-- ===== 第 3 步：确认（＝激活业务关系） ===== -->
      <div v-else class="entry-card">
        <h3 class="entry-card-title">3 · 确认</h3>

        <dl class="entry-summary">
          <div class="entry-summary-row">
            <dt class="entry-summary-label">联系人</dt>
            <dd class="entry-summary-value">
              {{ contactForm.name }} ｜ {{ contactForm.phone }}<template v-if="contactForm.position">
                ｜{{ contactForm.position }}</template>
            </dd>
          </div>
          <div class="entry-summary-row">
            <dt class="entry-summary-label">公司</dt>
            <dd class="entry-summary-value">
              <template v-if="companyChoice !== null">
                {{ companyChoice.full_name }}
                <a-tag :color="companyChoice.kind === 'new' ? 'green' : 'blue'">
                  {{ companyChoice.kind === 'new' ? '本次新建' : '沿用已有档案' }}
                </a-tag>
              </template>
              <template v-else>不挂公司（存为「待关联」）</template>
            </dd>
          </div>
        </dl>

        <!-- 有公司才需要"部门 × 产品线"（它们是**业务关系**的属性） -->
        <template v-if="companyChoice !== null">
          <p v-if="optionsError" class="entry-error">{{ optionsError }}</p>

          <!-- 部门 / 产品线：**跨页复用件**（与联系人详情页「关联公司」共用一份，→ 架构 §4.4） -->
          <RelationTargetPicker
            v-model:dept-id="relationForm.dept_id"
            v-model:product-line-id="relationForm.product_line_id"
            :departments="departments"
            :product-lines="productLines"
            :loading="optionsLoading"
            :disabled="submitting"
          />

          <p class="entry-note">
            激活后这条关系归你（换人要走转交审批）。同公司 × 同部门 × 同产品线只能有一条关系，
            已有归属时服务端会拦下并说明原因。
          </p>
        </template>

        <p v-else class="entry-note">
          不挂公司 → 只建联系人＝「待关联」：这条线索归你待跟进，不进业务关系列表、不掉海。
        </p>

        <p v-if="submitError" class="entry-error">{{ submitError }}</p>

        <div class="entry-actions">
          <a-button
            type="primary"
            :loading="submitting"
            :disabled="!canSubmit"
            @click="submitEntry"
          >
            {{ companyChoice === null ? '确认建档（存为待关联）' : '确认并激活业务关系' }}
          </a-button>
          <a-button type="text" :disabled="submitting" @click="step = 2">上一步</a-button>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.entry {
  max-width: 720px;
}

.entry-after {
  margin-top: var(--crm-space-lg);
  padding-top: var(--crm-space-md);
  border-top: 1px solid var(--crm-color-border);
}

.entry-after-hint {
  margin: 0 0 var(--crm-space-xs);
  font-size: var(--crm-font-size-base);
  color: var(--crm-color-text-tertiary);
}

.entry-title {
  margin: 0 0 var(--crm-space-xs);
  font-size: var(--crm-font-size-2xl);
  font-weight: var(--crm-font-weight-strong);
  color: var(--crm-color-text);
}

.entry-hint {
  margin: 0 0 var(--crm-space-lg);
  font-size: var(--crm-font-size-base);
  color: var(--crm-color-text-tertiary);
}

.entry-steps {
  margin-bottom: var(--crm-space-md);
}

.entry-card {
  padding: var(--crm-space-lg);
  margin-bottom: var(--crm-space-lg);
  background: var(--crm-color-bg-container);
  border: var(--crm-border-width) solid var(--crm-color-border-secondary);
  border-radius: var(--crm-radius-lg);
}

.entry-card-title {
  margin: 0 0 var(--crm-space-md);
  font-size: var(--crm-font-size-lg);
  font-weight: var(--crm-font-weight-strong);
  color: var(--crm-color-text);
}

/** 错误态：§4.6「错误文案红色 12px 置于控件下」（与登录页同一形态） */
.entry-error {
  margin: 0 0 var(--crm-space-sm);
  font-size: var(--crm-font-size-xs);
  color: var(--crm-color-error);
}

/** 说明文字：中性小字，不抢表单主体（与 `.entry-hint` 同族） */
.entry-note {
  margin: var(--crm-space-md) 0 0;
  font-size: var(--crm-font-size-xs);
  color: var(--crm-color-text-tertiary);
}

.entry-dups {
  margin-top: var(--crm-space-md);
  padding-top: var(--crm-space-md);
  border-top: var(--crm-border-width) solid var(--crm-color-border-secondary);
}

.entry-dup-list,
.entry-contact-list {
  margin: var(--crm-space-sm) 0;
  padding: 0;
  list-style: none;
}

.entry-dup-item,
.entry-contact-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--crm-space-sm);
  padding: var(--crm-space-xs) 0;
}

.entry-dup-main {
  display: flex;
  align-items: center;
  gap: var(--crm-space-xs);
  flex-wrap: wrap;
}

.entry-dup-name,
.entry-contact-name {
  font-size: var(--crm-font-size-base);
  color: var(--crm-color-text);
}

.entry-dup-meta {
  font-size: var(--crm-font-size-xs);
  color: var(--crm-color-text-secondary);
}

.entry-contacts {
  margin-top: var(--crm-space-md);
}

.entry-contacts-title {
  margin: 0;
  font-size: var(--crm-font-size-base);
  font-weight: var(--crm-font-weight-strong);
  color: var(--crm-color-text-secondary);
}

/** 第 3 步的汇总：`dt/dd` 两列（左标签、右值），与表单字段的左对齐保持一致 */
.entry-summary {
  margin: 0 0 var(--crm-space-md);
}

.entry-summary-row {
  display: flex;
  gap: var(--crm-space-sm);
  padding: var(--crm-space-xs) 0;
}

.entry-summary-label {
  flex: 0 0 72px;
  font-size: var(--crm-font-size-base);
  color: var(--crm-color-text-tertiary);
}

.entry-summary-value {
  margin: 0;
  font-size: var(--crm-font-size-base);
  color: var(--crm-color-text);
}

.entry-actions {
  display: flex;
  align-items: center;
  gap: var(--crm-space-sm);
  margin-top: var(--crm-space-md);
}
</style>
