<script setup lang="ts">
import { reactive } from 'vue'

/**
 * 记一条跟单（写跟单表单的**复用件**）—— 架构 §4.4 约定 2「第二次出现就必须搬进 `components/`」。
 *
 * ★ 本件是**第三次**出现同款表单（关系列表页时间线抽屉 / 联系人详情页 / 录入页结果态），
 *   抽件收口、统一一处。两处既有内联表单**本批迁移留作下一批**（登记欠账），新增调用方一律用本件。
 *
 * ★ **架构约束（§4.4）**：组件**不许 import `api/`**——下拉选项由**页面喂进**（`actionTypeOptions` /
 *   `outcomeOptions`），提交也由**页面接 `submit` 事件后自己调接口**（组件不连接口、不弹提示）。
 *   否则每个页面各配一次取数＝又一份真相源。
 *
 * 口径来源（★ 真相源，勿自造）：
 *   · 字段与「有效沟通必写一句话结果」→ 接口 §5.7（`POST /relations/:id/events` ／ `POST /contacts/:id/events`）；
 *     快速标记点一下即可（落库但不回写 `last_event_at`、不算有效跟进——那是另一条路径，本件特指"写跟单"）。
 *   · 选项值域 → 前端 `src/engine.ts`（**由页面传入**，本件不抄：`ACTION_TYPE_OPTIONS` /
 *     `EFFECTIVE_OUTCOME_OPTIONS` / `QUICK_MARK_OUTCOME_OPTIONS` ＋ `actionTypeNameOf` / `outcomeNameOf`）。
 *
 * ★ `mode` 仅用于语义标注（页面据此决定调哪个端点、给什么提示），组件自身不分支；
 *   `contact` 模式**只允许在「待关联」态用**（联系人未挂公司）—— 已挂公司时服务端
 *   `POST /contacts/:id/events` 会 403 指引改到关系里记（→ 接口 §5.7），故页面只在待关联处摆本件。
 */
/** 写跟单表单抛给父页的草稿（→ 架构 §4.4：组件不连接口，由页面接 `submit` 后自己调） */
interface EventComposerDraft {
  action_type: string
  outcome?: string
  summary?: string
  duration_min?: number
}

type Mode = 'relation' | 'contact'
type Option = { value: string; label: string }

const props = defineProps<{
  mode: Mode
  actionTypeOptions: Option[]
  outcomeOptions: Option[]
  /** 提交中：禁用按钮（父页把接口等待态传进来） */
  submitting?: boolean
}>()

const emit = defineEmits<{ submit: [draft: EventComposerDraft] }>()

const eventForm = reactive({
  action_type: 'phone',
  outcome: 'advanced',
  summary: '',
  duration_min: null as number | null,
})

/**
 * 收集表单 → 抛给父页（父页负责调接口 ＋ 提示）。
 * ★ 抛完**就地清空一句话 / 时长**（动作类型 + 结果保留，连续记多条不用每次重选）。
 */
function submitEvent(): void {
  const draft: EventComposerDraft = { action_type: eventForm.action_type }
  if (eventForm.outcome !== '') draft.outcome = eventForm.outcome
  if (eventForm.summary.trim() !== '') draft.summary = eventForm.summary.trim()
  if (eventForm.duration_min !== null) draft.duration_min = eventForm.duration_min

  emit('submit', draft)
  eventForm.summary = ''
  eventForm.duration_min = null
  // ⚠ `props.mode` 本件不用于分支；仅占位语义（避免父页误以为组件会自己判断可否提交）
  void props.mode
}
</script>

<template>
  <div class="event-composer">
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
    <a-button type="primary" :loading="submitting" @click="submitEvent">记下来</a-button>
  </div>
</template>

<style scoped>
.event-composer {
  display: flex;
  flex-wrap: wrap;
  gap: var(--crm-space-xs);
  align-items: center;
}
</style>
