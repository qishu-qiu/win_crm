<script setup lang="ts">
import { ref } from 'vue'

import { dupMatchLabelOf, type CompanyChoice } from '../company'

/**
 * 「撞库选公司」件（**业务组件 · 跨页复用** →《销售CRM架构设计说明》§4.4）。
 *
 * ★ **为什么抽出来**：同一段东西出现**两次** —— ① 录入页第 2 步「公司」② 联系人详情页
 *   「关联公司」（→ 需求 §6.1 ③「补全路径：联系人详情『关联公司』→ 走撞库 → 激活关系」）。
 *   §4.4 约定 2 写死「**第二次出现就必须搬进 `components/`**」—— 各写一份＝改了这页漏那页
 *   （本项目一号坑「双真相源」的前端版）。
 *
 * ★ **本件不 import `api/`**（§4.4 约定 1：数据由**页面喂进来**）：查重取数函数由页面**注入**
 *   （`:search="searchDupCompanies"`）。本件只回答「长什么样 ＋ 点了会怎样」，不自己连接口。
 * ★ **中文文案**取自 `src/company.ts`（§4.4 约定 3：展示口径不进组件）；本件只管渲染。
 *
 * 口径来源（★ 真相源，勿自造）：
 *   · 撞库**分支 4「挂现有公司」** →《销售CRM业务需求文档》§12.1：命中候选**由人选**，
 *     「疑似同一家默认选现有，**仍须保留『强行新建』出口**」（同名不同司真实存在）；
 *     强行新建的**留痕由服务端**在 `POST /companies` 里写，本件不代办。
 *   · 候选出参 →《接口API文档》§5.4：`{id,full_name,credit_code_masked,similarity,match_type}`
 *     （信用代码**打码**；公司全称**给全** —— 销售要认出是不是这家）。
 *   · ⛔ **分支 1（公海可直领）/ 分支 3（跨部门可并行）本件做不了也不摆**：前者依赖 F 域认领、
 *     后者需要「该公司的其它部门关系」信息，候选出参里**没有部门**、也没有对应端点
 *     （→《欠账登记表》D-30）。
 *
 * ★ **本件不做**（由页面负责）：真正建档（`POST /companies`，仅当选项是「将新建」时）、
 *   以及后续的部门 / 产品线选择与激活提交 —— 本件只交回一个 `CompanyChoice`。
 */

/**
 * 本件真正会用到的候选字段（**结构性视图**，不是第二份接口类型：接口类型一律取自生成物）。
 * ⚠ 字段可空性须与生成物一致（如信用代码在 DTO 里是 `@ApiPropertyOptional` ⇒ 这里也得可省），
 *   否则页面把 `DupCandidateVoDto` 递进来会**类型不兼容**（可选 → 必填不可赋值）。
 */
interface CandidateView {
  id: string
  full_name: string
  credit_code_masked?: string | null
  similarity: number
  match_type: string
}

const props = defineProps<{
  /**
   * 查重取数（**页面注入**，如 `searchDupCompanies`）。入参只用到 `name` / `credit_code`
   * —— 手机号那路（录入页第 1 步）不属本件职责。
   */
  search: (input: {
    name?: string
    credit_code?: string
  }) => Promise<{ candidates: CandidateView[] }>
  /** 页面正在忙（如正在提交）时禁用交互 */
  disabled?: boolean
}>()

const emit = defineEmits<{ change: [choice: CompanyChoice | null] }>()

const fullName = ref('')
const creditCode = ref('')
const candidates = ref<CandidateView[]>([])
const choice = ref<CompanyChoice | null>(null)
const checking = ref(false)
const errorText = ref('')

/** 选定 / 清空都从这里出去 —— 保证「页面看到的 choice」与「本件显示的 choice」永远同一份 */
function setChoice(next: CompanyChoice | null): void {
  choice.value = next
  emit('change', next)
}

/**
 * 查重：命中候选就**交回给人选**；**一条候选都没有才**直接用输入的名字标成「将新建」
 * —— 此时**仍不写库**（真正的 `POST /companies` 在页面提交时）。
 */
async function runSearch(): Promise<void> {
  errorText.value = ''
  candidates.value = []

  const name = fullName.value.trim()
  const code = creditCode.value.trim()
  if (name === '' && code === '') {
    errorText.value = '请填写公司全称或统一社会信用代码'
    return
  }

  checking.value = true
  try {
    const result = await props.search({
      ...(name === '' ? {} : { name }),
      ...(code === '' ? {} : { credit_code: code }),
    })
    if (result.candidates.length > 0) {
      candidates.value = result.candidates
      return
    }
    pickNew()
  } catch (error) {
    // 网络 / 权限错误都是**服务端人话**（请求层已统一拆包），内联显示
    errorText.value = error instanceof Error && error.message ? error.message : '查重失败，请稍后重试'
  } finally {
    checking.value = false
  }
}

/** 「用这家」——沿用已有档案（**不新建、不合并**，只把后续关系挂到它下面） */
function pickExisting(candidate: CandidateView): void {
  setChoice({ kind: 'existing', id: candidate.id, full_name: candidate.full_name })
  candidates.value = []
  errorText.value = ''
}

/** 「都不是，确认新建（强行）」——分支 4 的另一出口；**留痕由服务端写**，本件不代办 */
function pickNew(): void {
  const name = fullName.value.trim()
  if (name === '') {
    // 只给了信用代码时也必须先有全称（数据架构 B1：`full_name` 非空）
    errorText.value = '新建档案需要填写公司全称'
    return
  }
  setChoice({ kind: 'new', full_name: name, credit_code: creditCode.value.trim() })
  candidates.value = []
  errorText.value = ''
}

/** 重选（退回「未选」状态）——页面把它也当作「换一家」用 */
function reset(): void {
  setChoice(null)
  candidates.value = []
  errorText.value = ''
}
</script>

<template>
  <div class="dup">
    <!--
      ⚠ **不复用 `<a-form @finish>` 提交**：本件没有 `:model` / `name` 字段，实测 `@finish`
        根本不会触发（提交按钮点了没反应）—— 与登录页（有 `:model` ＋ `name`，可用）对照可复现。
        故按钮走 `@click` ＋ 输入框 `@press-enter`（与本项目「时间线写跟单」同一姿势）。
        ⚠ 这是踩过的坑，别把它"改回去"当美化。
    -->
    <a-form layout="vertical">
      <a-form-item label="公司全称">
        <a-input
          v-model:value="fullName"
          :disabled="choice !== null || disabled === true"
          placeholder="例如：安徽鑫中网信息技术有限公司"
          allow-clear
          @press-enter="runSearch"
        />
      </a-form-item>

      <a-form-item label="统一社会信用代码（可空）">
        <a-input
          v-model:value="creditCode"
          :disabled="choice !== null || disabled === true"
          placeholder="撞码时会提示改用已有档案"
          allow-clear
          @press-enter="runSearch"
        />
      </a-form-item>

      <p v-if="errorText" class="dup-error">{{ errorText }}</p>

      <a-button
        v-if="choice === null"
        type="primary"
        :loading="checking"
        :disabled="disabled === true"
        @click="runSearch"
      >
        查重
      </a-button>
    </a-form>

    <!-- 查重命中：交给人选（分支 4） -->
    <div v-if="candidates.length > 0" class="dup-block">
      <a-alert
        type="warning"
        show-icon
        message="疑似已有这家公司"
        description="以下候选按判级排序；确认是同一家请点「用这家」，确认不是再点「确认新建」。"
      />
      <ul class="dup-list">
        <li v-for="item in candidates" :key="item.id" class="dup-item">
          <div class="dup-main">
            <span class="dup-name">{{ item.full_name }}</span>
            <a-tag :color="item.match_type === 'same' ? 'red' : 'orange'">
              {{ dupMatchLabelOf(item.match_type) }}
            </a-tag>
            <span class="dup-meta">
              相似度 {{ item.similarity }}<template v-if="item.credit_code_masked">
                ｜信用代码 {{ item.credit_code_masked }}</template>
            </span>
          </div>
          <a-button size="small" :disabled="disabled === true" @click="pickExisting(item)">
            用这家
          </a-button>
        </li>
      </ul>
      <a-button type="link" :disabled="disabled === true" @click="pickNew">
        都不是，确认新建（强行）
      </a-button>
    </div>

    <!-- 已选定公司 -->
    <div v-if="choice !== null" class="dup-target">
      <div class="dup-target-main">
        <span class="dup-name">{{ choice.full_name }}</span>
        <a-tag :color="choice.kind === 'new' ? 'green' : 'blue'">
          {{ choice.kind === 'new' ? '待新建（提交时建档）' : '沿用已有档案' }}
        </a-tag>
        <a-button type="text" size="small" :disabled="disabled === true" @click="reset">重选</a-button>
      </div>
      <!-- 页面可在此塞「该公司的联系人」等辅助信息（本件不取数） -->
      <slot />
    </div>
  </div>
</template>

<style scoped>
.dup-error {
  margin: 0 0 var(--crm-space-sm);
  font-size: var(--crm-font-size-xs);
  color: var(--crm-color-error);
}

.dup-block {
  margin-top: var(--crm-space-md);
  padding-top: var(--crm-space-md);
  border-top: var(--crm-border-width) solid var(--crm-color-border-secondary);
}

.dup-list {
  margin: var(--crm-space-sm) 0;
  padding: 0;
  list-style: none;
}

.dup-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--crm-space-sm);
  padding: var(--crm-space-xs) 0;
}

.dup-main,
.dup-target-main {
  display: flex;
  align-items: center;
  gap: var(--crm-space-xs);
  flex-wrap: wrap;
}

.dup-name {
  font-size: var(--crm-font-size-base);
  color: var(--crm-color-text);
}

.dup-meta {
  font-size: var(--crm-font-size-xs);
  color: var(--crm-color-text-secondary);
}

.dup-target {
  margin-top: var(--crm-space-md);
  padding-top: var(--crm-space-md);
  border-top: var(--crm-border-width) solid var(--crm-color-border-secondary);
}
</style>
