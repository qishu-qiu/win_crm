<script setup lang="ts">
import { computed, reactive, ref } from 'vue'

import {
  createCompany,
  createContact,
  listCompanyContacts,
  searchDupCompanies,
  type ContactBrief,
  type CreatedContact,
  type DupCandidate,
} from '../api/company'

/**
 * 建档页（M2-17 · 方案 A 最小页）—— **建公司 ＋ 查重提示 ＋ 建联系人**。
 *
 * 判据逐字（《开发计划-V1》M2-17）：「页面上建成 1 公司 + 1 联系人；重复手机号显示人话提示」。
 *
 * 口径来源（★ 真相源，勿自造）：
 *   · 流程与分支 →《销售CRM业务需求文档》§12.1 撞库 4 分支之**分支 4「挂现有公司」**：
 *     输入公司名 / 信用代码 → 命中候选 → **由人点选**「挂在现有公司」或「确认新建（强行）」；
 *     **系统不自动合并、不阻断销售**。
 *   · 出参形态 →《销售CRM接口API文档》V1.18 §5.4 / §5.5：查重候选带 `credit_code_masked`（打码）、
 *     公司联系人列表带 `phone_masked`（打码）、**建档联系人出参给全号**（详情形态）。
 *   · 校验与错误态 →《前端页面与交互文档》§4.6「blur 即时 ＋ 提交汇总；错误文案红 12px 置于控件下」；
 *     §5.1 空态（`a-empty`）；设计规范 §3.2 第 11 条「**禁假数据撑页面**」⇒ 本页**不预填任何演示数据**。
 *
 * ★ 状态机只有两步（不引 router、不做步骤条组件）：
 *   ① 选公司（查重 → 新建 / 用现有）→ ② 建联系人。这正是 §12.1 分支 4 的最小可用形态。
 * ★ 「用现有公司」为什么不显示公司详情：**`GET /companies/:id` 不在本批**（M2 只交付列表 / 建档 /
 *   查重 / 联系人），拿不到详情就**不假装有** —— 只带 `id ＋ 全称` 往下走，不编字段。
 */
interface TargetCompany {
  id: string
  full_name: string
  /** 新建时为服务端生成的 `name_core`（查重第一段用的核心词）；用现有公司时为 `null`（列表候选里没有该字段） */
  name_core: string | null
  /** 是否为本次新建（用于文案「已建档」/「沿用已有档案」） */
  isNew: boolean
}

const fullName = ref('')
const creditCode = ref('')
const checking = ref(false)
const creating = ref(false)
const companyError = ref('')
const candidates = ref<DupCandidate[]>([])
const target = ref<TargetCompany | null>(null)

const contacts = ref<ContactBrief[]>([])
const contactForm = reactive({ name: '', phone: '', position: '' })
const savingContact = ref(false)
const contactError = ref('')
const createdContacts = ref<CreatedContact[]>([])

const hasCandidates = computed(() => candidates.value.length > 0)

/** 判级标签（→ §5.4 `match_type`，只用这两个码；中文是**展示文案**，不另造码） */
function matchLabel(matchType: string): string {
  return matchType === 'same' ? '核心词完全相同' : '高度疑似'
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

/** 拉一次该公司的联系人（**打码形态**，证明 M2-14 这条链路也通） */
async function refreshContacts(): Promise<void> {
  if (target.value === null) return
  contacts.value = await listCompanyContacts(target.value.id)
}

/**
 * 第一步：**先查重，再决定建不建**。
 * ★ 命中候选时**不建档**，把选择权交回给人（分支 4 的原话：「疑似同一家默认选现有，
 *   仍须保留『强行新建』出口」）。
 */
async function submitCompany(): Promise<void> {
  companyError.value = ''
  candidates.value = []

  const name = fullName.value.trim()
  const code = creditCode.value.trim()
  if (name === '' && code === '') {
    companyError.value = '请填写公司全称或统一社会信用代码'
    return
  }

  checking.value = true
  try {
    const result = await searchDupCompanies({
      ...(name === '' ? {} : { name }),
      ...(code === '' ? {} : { credit_code: code }),
    })
    if (result.candidates.length > 0) {
      candidates.value = result.candidates
      return
    }
    await createNewCompany()
  } catch (error) {
    companyError.value = errorText(error, '查重失败，请稍后重试')
  } finally {
    checking.value = false
  }
}

/** 「确认新建」——分支 4 的出口之一（另一出口是「用这家」） */
async function createNewCompany(): Promise<void> {
  const name = fullName.value.trim()
  const code = creditCode.value.trim()
  if (name === '') {
    // 只给了信用代码时，也必须先有全称（数据架构 B1：`full_name` 非空）
    companyError.value = '新建档案需要填写公司全称'
    return
  }

  creating.value = true
  try {
    const company = await createCompany({
      full_name: name,
      ...(code === '' ? {} : { credit_code: code }),
    })
    target.value = { id: company.id, full_name: company.full_name, name_core: company.name_core ?? null, isNew: true }
    candidates.value = []
    await refreshContacts()
  } catch (error) {
    companyError.value = errorText(error, '建档失败，请稍后重试')
  } finally {
    creating.value = false
  }
}

/** 「用这家」——沿用已有档案（**不新建、不合并**，只是把后续联系人挂到它下面） */
function useExisting(candidate: DupCandidate): void {
  target.value = { id: candidate.id, full_name: candidate.full_name, name_core: null, isNew: false }
  candidates.value = []
}

/** 换一家重来（清掉目标与列表，回到第一步） */
function resetCompany(): void {
  target.value = null
  candidates.value = []
  contacts.value = []
  createdContacts.value = []
  contactError.value = ''
}

/** 第二步：建档联系人（挂到已选公司下） */
async function submitContact(): Promise<void> {
  contactError.value = ''

  const name = contactForm.name.trim()
  const phone = contactForm.phone.trim()
  if (name === '' || phone === '') {
    contactError.value = '请填写联系人姓名与手机号'
    return
  }

  savingContact.value = true
  try {
    const created = await createContact({
      name,
      phone,
      ...(target.value === null ? {} : { company_id: target.value.id }),
      ...(contactForm.position.trim() === '' ? {} : { position: contactForm.position.trim() }),
    })
    // 详情形态：**给全号**（§5.5；与列表的 `phone_masked` 是两个出口，别混）
    createdContacts.value = [created, ...createdContacts.value]
    contactForm.name = ''
    contactForm.phone = ''
    contactForm.position = ''
    await refreshContacts()
  } catch (error) {
    // 重复手机号 → 后端 409「该手机号已存在」（**人话，不是 DB 原话**）；此处内联显示
    contactError.value = errorText(error, '建档联系人失败，请稍后重试')
  } finally {
    savingContact.value = false
  }
}
</script>

<template>
  <section class="entry">
    <h2 class="entry-title">建档</h2>
    <p class="entry-hint">
      先查重再建档：命中候选时由你决定——沿用已有公司，还是确认新建（系统不自动合并、也不拦你建）。
    </p>

    <!-- 第一步：公司 -->
    <div class="entry-card">
      <h3 class="entry-card-title">1 · 公司</h3>

      <a-form layout="vertical" @finish="submitCompany">
        <a-form-item label="公司全称">
          <a-input
            v-model:value="fullName"
            :disabled="target !== null"
            placeholder="例如：安徽鑫中网信息技术有限公司"
            allow-clear
          />
        </a-form-item>

        <a-form-item label="统一社会信用代码（可空）">
          <a-input
            v-model:value="creditCode"
            :disabled="target !== null"
            placeholder="撞码时会提示改用已有档案"
            allow-clear
          />
        </a-form-item>

        <p v-if="companyError" class="entry-error">{{ companyError }}</p>

        <a-button
          v-if="target === null"
          type="primary"
          html-type="submit"
          :loading="checking || creating"
        >
          查重并建档
        </a-button>
        <a-button v-else type="text" @click="resetCompany">换一家</a-button>
      </a-form>

      <!-- 查重命中：交给人选（分支 4） -->
      <div v-if="hasCandidates" class="entry-dups">
        <a-alert
          type="warning"
          show-icon
          message="疑似已有这家公司"
          description="以下候选按判级排序；确认是同一家请点「用这家」，确认不是再点「确认新建」。"
        />
        <ul class="entry-dup-list">
          <li v-for="item in candidates" :key="item.id" class="entry-dup-item">
            <div class="entry-dup-main">
              <span class="entry-dup-name">{{ item.full_name }}</span>
              <a-tag :color="item.match_type === 'same' ? 'red' : 'orange'">
                {{ matchLabel(item.match_type) }}
              </a-tag>
              <span class="entry-dup-meta">
                相似度 {{ item.similarity }}<template v-if="item.credit_code_masked">
                  ｜信用代码 {{ item.credit_code_masked }}</template>
              </span>
            </div>
            <a-button size="small" @click="useExisting(item)">用这家</a-button>
          </li>
        </ul>
        <a-button type="link" :loading="creating" @click="createNewCompany">
          都不是，确认新建（强行）
        </a-button>
      </div>

      <!-- 已选定目标公司 -->
      <div v-if="target !== null" class="entry-target">
        <div class="entry-target-main">
          <span class="entry-target-name">{{ target.full_name }}</span>
          <a-tag :color="target.isNew ? 'green' : 'blue'">
            {{ target.isNew ? '本次新建' : '沿用已有档案' }}
          </a-tag>
          <span v-if="target.name_core" class="entry-dup-meta">核心词 {{ target.name_core }}</span>
        </div>

        <div class="entry-contacts">
          <h4 class="entry-contacts-title">该公司的联系人（列表形态，号码打码）</h4>
          <a-empty v-if="contacts.length === 0" description="还没有联系人" />
          <ul v-else class="entry-contact-list">
            <li v-for="person in contacts" :key="person.id" class="entry-contact-item">
              <span class="entry-contact-name">{{ person.name }}</span>
              <span class="entry-dup-meta">
                {{ person.phone_masked }}<template v-if="person.position">
                  ｜{{ person.position }}</template>
              </span>
              <a-tag v-if="!person.is_current" color="default">已离职</a-tag>
            </li>
          </ul>
        </div>
      </div>
    </div>

    <!-- 第二步：联系人（选定公司后才出现） -->
    <div v-if="target !== null" class="entry-card">
      <h3 class="entry-card-title">2 · 联系人</h3>

      <a-form layout="vertical" @finish="submitContact">
        <a-form-item label="姓名">
          <a-input v-model:value="contactForm.name" placeholder="例如：张伟" allow-clear />
        </a-form-item>

        <a-form-item label="手机号（主号，撞单校验核心）">
          <a-input
            v-model:value="contactForm.phone"
            placeholder="138 0000 0000（空格 / +86 / - 都会被归一）"
            allow-clear
          />
        </a-form-item>

        <a-form-item label="职位（可空）">
          <a-input v-model:value="contactForm.position" placeholder="例如：采购总监" allow-clear />
        </a-form-item>

        <p v-if="contactError" class="entry-error">{{ contactError }}</p>

        <a-button type="primary" html-type="submit" :loading="savingContact">建档联系人</a-button>
      </a-form>

      <div v-if="createdContacts.length > 0" class="entry-created">
        <a-alert
          v-for="item in createdContacts"
          :key="item.id"
          type="success"
          show-icon
          :message="`已建档：${item.name}（${item.phone}）`"
          :description="item.phone_history_hint ?? ''"
        />
      </div>
    </div>
  </section>
</template>

<style scoped>
.entry {
  max-width: 720px;
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

.entry-dup-main,
.entry-target-main {
  display: flex;
  align-items: center;
  gap: var(--crm-space-xs);
  flex-wrap: wrap;
}

.entry-dup-name,
.entry-target-name,
.entry-contact-name {
  font-size: var(--crm-font-size-base);
  color: var(--crm-color-text);
}

.entry-dup-meta {
  font-size: var(--crm-font-size-xs);
  color: var(--crm-color-text-secondary);
}

.entry-target {
  margin-top: var(--crm-space-md);
  padding-top: var(--crm-space-md);
  border-top: var(--crm-border-width) solid var(--crm-color-border-secondary);
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

.entry-created {
  margin-top: var(--crm-space-md);
  display: flex;
  flex-direction: column;
  gap: var(--crm-space-xs);
}
</style>
