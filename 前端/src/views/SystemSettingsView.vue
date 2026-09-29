<script setup lang="ts">
import { message } from 'ant-design-vue'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import PageContainer from '../components/PageContainer.vue'
import { listDepartments, listProductLines } from '../api/org'
import {
  listSeaRules,
  updateSeaRules,
  type SeaRuleVo,
  type UpdateSeaRuleInput,
} from '../api/sea'

/**
 * 系统设置（§五 页 25）—— 本轮**只建成「公海规则」一个子页**，其余 5 子页（组织与字典 /
 * 权限与角色 / 通知 / 审计 / 其他）按「不摆假入口」只在页内显示「建设中」（→ 欠账 D-70）。
 *
 * 口径来源（★ 真相源，勿自造）：《销售CRM接口API文档》§5.16 `GET/PUT /sea/rules` ＋ 需求 §6.3
 *   · 列表**含待生效行**（`pending`＝7 天缓冲期内）；各天数 `null`＝该维度**未配置**，
 *     前端显示「未配置」、**不回落成默认天数**（接口 §5.16 明写）。
 *   · 提交＝**两段式确认**（不新增端点）：`confirmed=false` 只回预告（`affected_customers`，零写库）；
 *     `true` 落库（插新版本行 ＋ 旧行 `status=disabled`，新版本 **7 天后生效**）。
 *   · 整行覆盖：没给的字段＝该维度不配（落 `null`），不做「缺省＝沿用」推断。
 *   · 谁能看 / 改由服务端判（gm/admin 全量、部门经理管辖部门、销售/交付/客服 403），前端不自己判角色。
 *   · 失败人话由请求层统一弹出（层级与 key 搭配错 → 400；越权 → 403），页面不翻译。
 */

const LEVEL_LABELS: Record<number, string> = { 1: '全局', 2: '产品线', 3: '部门', 4: '部门×产品线' }

const rules = ref<SeaRuleVo[]>([])
const loading = ref(false)
const departments = ref<{ id: string; name: string }[]>([])
const productLines = ref<{ id: string; name: string }[]>([])

const editing = ref(false)
const submitting = ref(false)
const preview = ref<{ affected_customers: number; effective_from: string } | null>(null)

const form = reactive({
  level: 1 as 1 | 2 | 3 | 4,
  dept_id: undefined as string | undefined,
  product_line_id: undefined as string | undefined,
  follow_freq_days: null as number | null,
  deal_cycle_days: null as number | null,
  stay_days: null as number | null,
  no_progress_max: null as number | null,
})

const needsDept = computed(() => form.level === 3 || form.level === 4)
const needsProduct = computed(() => form.level === 2 || form.level === 4)

// 层级变了，不再需要的 key 清掉（避免把上一个层级的残留 id 带进新层级 → 400 搭配错）
watch(() => form.level, () => {
  if (!needsDept.value) form.dept_id = undefined
  if (!needsProduct.value) form.product_line_id = undefined
})

function fmtDay(value: number | null): string {
  return value === null || value === undefined ? '未配置' : `${value} 天`
}

function scopeLabel(rule: SeaRuleVo): string {
  if (rule.dept !== null) return rule.dept.name
  if (rule.product_line !== null) return rule.product_line.name
  return '全局'
}

async function loadAll() {
  loading.value = true
  try {
    const [r, d, p] = await Promise.all([listSeaRules(), listDepartments(), listProductLines()])
    rules.value = r
    departments.value = d.map((x) => ({ id: x.id, name: x.name }))
    productLines.value = p.map((x) => ({ id: x.id, name: x.name }))
  } catch {
    message.error('加载失败，请重试')
  } finally {
    loading.value = false
  }
}

function openEditor() {
  preview.value = null
  editing.value = true
}

function buildPayload(confirmed: boolean): UpdateSeaRuleInput {
  const payload: UpdateSeaRuleInput = { level: form.level, confirmed }
  if (needsDept.value && form.dept_id !== undefined) payload.dept_id = form.dept_id
  if (needsProduct.value && form.product_line_id !== undefined) payload.product_line_id = form.product_line_id
  if (form.follow_freq_days !== null) payload.follow_freq_days = form.follow_freq_days
  if (form.deal_cycle_days !== null) payload.deal_cycle_days = form.deal_cycle_days
  if (form.stay_days !== null) payload.stay_days = form.stay_days
  if (form.no_progress_max !== null) payload.no_progress_max = form.no_progress_max
  return payload
}

async function previewImpact() {
  submitting.value = true
  try {
    const res = await updateSeaRules(buildPayload(false))
    preview.value = { affected_customers: res.affected_customers, effective_from: res.effective_from }
  } finally {
    submitting.value = false
  }
}

async function submitRules() {
  submitting.value = true
  try {
    const res = await updateSeaRules(buildPayload(true))
    message.success(
      `已提交，新版本将于 ${new Date(res.effective_from).toLocaleDateString('zh-CN')} 生效（影响 ${res.affected_customers} 个客户）`,
    )
    editing.value = false
    preview.value = null
    await loadAll()
  } finally {
    submitting.value = false
  }
}

onMounted(loadAll)
</script>

<template>
  <PageContainer title="系统设置" description="系统级配置。当前可用：公海规则。其余子页建设中。">
    <a-tabs default-active-key="seaRules">
      <a-tab-pane key="seaRules" tab="公海规则">
        <div class="sea-rules-toolbar">
          <span class="sea-rules-hint">
            规则新版本提交后 <strong>7 天</strong> 生效；生效瞬间在途关系倒计时重新起算。各维度「未配置」即不约束，不会回落默认天数。
          </span>
          <a-button type="primary" :disabled="loading" @click="openEditor">调整规则</a-button>
        </div>

        <a-spin :spinning="loading">
          <a-table :data-source="rules" row-key="id" :pagination="false" size="middle">
            <a-table-column key="level" title="层级" :width="110">
              <template #default="{ record }">{{ LEVEL_LABELS[record.level] }}</template>
            </a-table-column>
            <a-table-column key="scope" title="适用范围" :width="180">
              <template #default="{ record }">{{ scopeLabel(record) }}</template>
            </a-table-column>
            <a-table-column key="follow" title="跟进频次" :width="100">
              <template #default="{ record }">{{ fmtDay(record.follow_freq_days) }}</template>
            </a-table-column>
            <a-table-column key="deal" title="成单周期" :width="100">
              <template #default="{ record }">{{ fmtDay(record.deal_cycle_days) }}</template>
            </a-table-column>
            <a-table-column key="stay" title="停留超期" :width="100">
              <template #default="{ record }">{{ fmtDay(record.stay_days) }}</template>
            </a-table-column>
            <a-table-column key="progress" title="推进停滞" :width="100">
              <template #default="{ record }">{{ fmtDay(record.no_progress_max) }}</template>
            </a-table-column>
            <a-table-column key="status" title="状态" :width="140">
              <template #default="{ record }">
                <a-tag v-if="record.pending" color="orange">待生效</a-tag>
                <a-tag v-else color="green">生效中</a-tag>
                <span class="sea-rules-sub">{{ new Date(record.effective_from).toLocaleDateString('zh-CN') }}</span>
              </template>
            </a-table-column>
          </a-table>
          <a-empty v-if="!loading && rules.length === 0" description="暂无规则" />
        </a-spin>

        <a-modal
          v-model:open="editing"
          title="调整公海规则（新版本）"
          :confirm-loading="submitting"
          ok-text="确认提交"
          cancel-text="取消"
          width="560px"
          @ok="submitRules"
        >
          <a-form layout="vertical">
            <a-form-item label="层级">
              <a-radio-group v-model:value="form.level">
                <a-radio-button v-for="(label, key) in LEVEL_LABELS" :key="key" :value="Number(key)">
                  {{ label }}
                </a-radio-button>
              </a-radio-group>
            </a-form-item>

            <a-form-item v-if="needsDept" label="部门">
              <a-select v-model:value="form.dept_id" placeholder="选择部门" :options="departments.map(d => ({ value: d.id, label: d.name }))" />
            </a-form-item>
            <a-form-item v-if="needsProduct" label="产品线">
              <a-select v-model:value="form.product_line_id" placeholder="选择产品线" :options="productLines.map(p => ({ value: p.id, label: p.name }))" />
            </a-form-item>

            <a-form-item label="跟进频次（天，留空＝不配置）">
              <a-input-number v-model:value="form.follow_freq_days" :min="1" class="sea-day-input" />
            </a-form-item>
            <a-form-item label="成单周期（天，留空＝不配置）">
              <a-input-number v-model:value="form.deal_cycle_days" :min="1" class="sea-day-input" />
            </a-form-item>
            <a-form-item label="公海停留超期（天，留空＝不配置）">
              <a-input-number v-model:value="form.stay_days" :min="1" class="sea-day-input" />
            </a-form-item>
            <a-form-item label="推进停滞（天，留空＝不配置）">
              <a-input-number v-model:value="form.no_progress_max" :min="1" class="sea-day-input" />
            </a-form-item>
          </a-form>

          <a-alert
            v-if="preview"
            type="info"
            show-icon
            :message="`本次变更将影响 ${preview.affected_customers} 个客户`"
            :description="`新版本生效时刻：${new Date(preview.effective_from).toLocaleString('zh-CN')}（提交日 + 7 天）`"
          />

          <template #extra>
            <a-button :loading="submitting" @click="previewImpact">预览影响</a-button>
          </template>
        </a-modal>
      </a-tab-pane>

      <a-tab-pane key="org" tab="组织与字典">
        <a-empty description="建设中（组织与字典配置）" />
      </a-tab-pane>
      <a-tab-pane key="permission" tab="权限与角色">
        <a-empty description="建设中（权限与角色配置）" />
      </a-tab-pane>
      <a-tab-pane key="notification" tab="通知">
        <a-empty description="建设中（通知配置）" />
      </a-tab-pane>
      <a-tab-pane key="audit" tab="审计">
        <a-empty description="建设中（审计配置）" />
      </a-tab-pane>
      <a-tab-pane key="others" tab="其他">
        <a-empty description="建设中（其他系统配置）" />
      </a-tab-pane>
    </a-tabs>
  </PageContainer>
</template>

<style scoped>
.sea-rules-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--crm-space-md);
  margin-bottom: var(--crm-space-md);
}
.sea-rules-hint {
  font-size: var(--crm-font-size-xs);
  color: var(--crm-color-text-tertiary);
}
.sea-rules-sub {
  margin-left: var(--crm-space-xs);
  font-size: var(--crm-font-size-xs);
  color: var(--crm-color-text-tertiary);
}
.sea-day-input {
  width: 100%;
}
</style>
