<script setup lang="ts">
import { computed, watch } from 'vue'

import { deptLabelOf, productLineLabelOf } from '../org'

/**
 * 「公司 × 部门 × 产品线」里的**部门 ＋ 产品线**选择件（**业务组件 · 跨页复用** → 架构 §4.4）。
 *
 * ★ **为什么抽出来**：同一段东西出现**两次** —— ① 录入页第 3 步「确认」② 联系人详情页
 *   「关联公司」；§4.4 约定 2 写死「第二次出现就必须搬进 `components/`」。
 * ★ **本件不 import `api/`**（约定 1）：选项数据由**页面**拉好喂进来（`:departments` /
 *   `:productLines`），本件只管渲染；中文 / 停用标注取自 `src/org.ts`（约定 3）。
 *
 * 口径来源（★ 真相源，勿自造）：
 *   · 这两项是**业务关系**的属性（→ 需求 §6.1 ⑧：没有公司就没有关系）；
 *     接口 `POST /relations` / `POST /contacts/:id/activate-relation` 的入参就是它们（→ 接口 §5.6）。
 *   · 选项来自 `GET /org/departments` / `GET /org/product-lines`（→ 接口 §5.3）。
 *
 * ★ 三条口径（两页共用这一份，别再各写一套）：
 *   ① **部门候选**由页面按 `me.activatable_dept_ids` 预先收敛（空＝不限制；与 `checkActivateScope`
 *      同集，→ 架构 §7.2「新建（激活）时的部门范围」）；越权兜底仍是服务端 **403**；
 *   ② **产品线候选 ＝ 所选部门承接的产品线**（2026-09-22 拍板，→《欠账登记表》**D-74** /
 *      架构 §7.2）：判据是 `product_line.dept_ids` 含所选部门（→ 数据架构 **A7**）——
 *      ⚠ **不是**「我挂的产品线」`me.product_line_ids`（那是**假限制**，方向与 D-73 相反：比口径窄）；
 *      未选部门 ⇒ 不摆候选；**换部门 ⇒ 不在新候选里的已选线一并清空**（不留非法组合）；
 *   ③ **停用项不隐藏、只标注**：隐藏＝替服务端做了决定，且用户看不到"为什么少了那条线"。
 */
interface ProductLineOption {
  id: string
  name: string
  status: string
  /** `color_key` **可空**：未配置就**不画色块**，不编默认色（→ 数据架构 A7） */
  color_key: string | null
  /** 承接部门集合（→ 数据架构 A7）—— 本件算候选项的唯一判据 */
  dept_ids: string[]
}

const props = defineProps<{
  deptId: string
  productLineId: string
  /** 部门候选（**页面**按 `me.activatable_dept_ids` 收敛后喂进来；结构只需 id / name / status） */
  departments: Array<{ id: string; name: string; status: string }>
  /** 产品线**全量**（页面原样喂）：候选项由本件按「所选部门承接」派生 —— 见口径② */
  productLines: ProductLineOption[]
  loading?: boolean
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:deptId': [value: string]
  'update:productLineId': [value: string]
}>()

/** 产品线候选 ＝ **所选部门承接的产品线**（口径②；未选部门 ⇒ 空） */
const candidateLines = computed(() =>
  props.deptId === ''
    ? []
    : props.productLines.filter((line) => line.dept_ids.includes(props.deptId)),
)

/** 空态**说清为什么**：没选部门 / 该部门一条线都没承接（否则用户只看到一个灰掉的下拉） */
const linePlaceholder = computed(() => {
  if (props.deptId === '') return '请先选承接部门'
  return candidateLines.value.length === 0 ? '该部门未承接产品线' : '选一条产品线'
})

/**
 * 换部门（或清空部门）→ 已选产品线**不在新候选里就一并清掉**。
 * ★ 不静默留着：留着就是一条**没摆在候选里的非法组合**，提交后只能等服务端拒 ——
 *   前端摆出个自相矛盾的假状态，与 D-73 那次「失败却粉饰成已建档」同一类错。
 */
watch(
  () => props.deptId,
  () => {
    const current = props.productLineId
    if (current !== '' && !candidateLines.value.some((line) => line.id === current)) {
      emit('update:productLineId', '')
    }
  },
)

/**
 * 下拉的回填：`allow-clear` 清空时 AntD 给的是 `undefined`
 * —— 一律折算成空串（本项目的「未选」＝空串，不是 `null`：空串才好直接判 `!== ''`）。
 */
function onDeptChange(value: unknown): void {
  emit('update:deptId', typeof value === 'string' ? value : '')
}

function onProductLineChange(value: unknown): void {
  emit('update:productLineId', typeof value === 'string' ? value : '')
}
</script>

<template>
  <a-form layout="vertical">
    <a-form-item label="承接部门">
      <a-select
        :value="deptId"
        :loading="loading === true"
        :disabled="disabled === true"
        placeholder="选一个我能建的部门"
        allow-clear
        @update:value="onDeptChange"
      >
        <a-select-option v-for="dept in departments" :key="dept.id" :value="dept.id">
          {{ deptLabelOf(dept) }}
        </a-select-option>
      </a-select>
    </a-form-item>

    <a-form-item label="产品线">
      <!-- 候选项＝所选部门承接的产品线（口径②）；空态在 placeholder 里说清原因，不摆灰盒了事 -->
      <a-select
        :value="productLineId"
        :loading="loading === true"
        :disabled="disabled === true || candidateLines.length === 0"
        :placeholder="linePlaceholder"
        allow-clear
        @update:value="onProductLineChange"
      >
        <a-select-option v-for="line in candidateLines" :key="line.id" :value="line.id">
          <span class="target-line-option">
            <!-- `color_key` 为 null 时**不画色块**（不编默认色，→ 数据架构 A7） -->
            <span
              v-if="line.color_key"
              class="target-line-dot"
              :style="{ background: line.color_key }"
            />
            {{ productLineLabelOf(line) }}
          </span>
        </a-select-option>
      </a-select>
    </a-form-item>
  </a-form>
</template>

<style scoped>
.target-line-option {
  display: inline-flex;
  align-items: center;
  gap: var(--crm-space-xxs);
}

.target-line-dot {
  width: 8px;
  height: 8px;
  border-radius: var(--crm-radius-pill);
}
</style>
