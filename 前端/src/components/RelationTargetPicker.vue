<script setup lang="ts">
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
 * ★ 两条不放宽的口径（与录入页逐字一致）：
 *   ① **不按数据范围筛选项**：「这个部门我能不能建」由服务端判（越权 → 403）——
 *      前端筛一遍＝第二套权限口径；
 *   ② **停用项不隐藏、只标注**：隐藏＝替服务端做了决定，且用户看不到"为什么少了那条线"。
 */

defineProps<{
  deptId: string
  productLineId: string
  /** 选项（页面拉好喂进来；结构只需 id / name / status） */
  departments: Array<{ id: string; name: string; status: string }>
  /** 产品线另带 `color_key`（**可空**：未配置就**不画色块**，不编默认色，→ A7） */
  productLines: Array<{ id: string; name: string; status: string; color_key: string | null }>
  loading?: boolean
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:deptId': [value: string]
  'update:productLineId': [value: string]
}>()

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
      <a-select
        :value="productLineId"
        :loading="loading === true"
        :disabled="disabled === true"
        placeholder="选一条产品线"
        allow-clear
        @update:value="onProductLineChange"
      >
        <a-select-option v-for="line in productLines" :key="line.id" :value="line.id">
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
