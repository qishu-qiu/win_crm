<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import { listContacts, type ContactBrief } from '../api/company'
import {
  CONTACT_LINK_FILTERS,
  decisionRoleNameOf,
  type ContactLinkFilter,
} from '../contact'

/**
 * 联系人档案 · 列表页（M6-09 片 2）—— **最小版**：列表 ＋ 筛选（全部 / 未关联公司）＋ 三态。
 *
 * 口径来源（★ 真相源，勿自造）：
 *   · 页面与筛选 →《销售CRM前端页面与交互文档》§5 第 14/15 条：联系人档案列表**支持筛选
 *     「未关联公司」**（＝待关联，→ 需求 §6.1 ③）。
 *   · 「待关联」＝ **没挂公司**：判定＝该联系人**无任何 `company_contact` 记录**（**派生、不加字段**），
 *     归属＝**建档人**，未关联期间**不占部门 / 不占产品线 / 不进业务关系列表 / 不掉海**（→ 需求 §6.1 ③⑦⑧）。
 *   · 出参形态 →《接口API文档》§5.5：**列表一律 `phone_masked`**（**这是出参形态、不是权限**）——
 *     页面**不要再打一次码**（再打一遍＝同一个号码两套形态，改一处漏一处）。
 *
 * ★ **可见范围由服务端收敛**（服务端 §5.5）：「待关联」（未挂公司）**只给归属人自己**；
 *   已挂公司者暂按现状（公司维度收敛待补，→《欠账登记表》D-28）。页面**不为了"看到更多"
 *   自己拼参数**（前端再筛一遍＝第二套范围口径，改了服务端忘了前端就露客户）。
 *
 * ⛔ **本片不做、也不摆假入口**：
 *   · **详情页**（谈判特质 / 就职历史 / 上锁状态 / 「⚠ 尚未关联公司」横幅 ＋「关联公司」入口）
 *     —— 属 M9（→《欠账登记表》D-03 / D-04）；
 *   · **「申请解锁」按钮** —— 解锁审批属 G 域（→《欠账登记表》D-04）：本页只把
 *     `phone_locked` **标注出来**（那是服务端给的**状态**），不摆一个点了没用的按钮；
 *   · **联系人姓名可点跳转** —— 落点页未建（→《欠账登记表》D-13），此处**是纯文本**。
 *
 * ★ 空态用 `a-empty`、**不预填演示数据**（→ 设计规范 §3.2 第 11 条）。
 */

const filter = ref<ContactLinkFilter>('all')
const rows = ref<ContactBrief[]>([])
const loading = ref(false)
const errorText = ref('')

const filterLabel = computed(
  () => CONTACT_LINK_FILTERS.find((item) => item.value === filter.value)?.label ?? '全部',
)

const filterHint = computed(() =>
  filter.value === 'unlinked'
    ? '只显示「未关联公司」的待跟进联系人：没挂公司，归建档人待跟进，不进业务关系列表、不掉海。'
    : '包含已挂公司与「未关联公司」的联系人；能看到谁由服务端按你的数据范围收敛。'
)

const columns = [
  { title: '姓名', dataIndex: 'name', key: 'name', width: 140 },
  { title: '职位', dataIndex: 'position', key: 'position', width: 160 },
  { title: '手机号', dataIndex: 'phone', key: 'phone', width: 200 },
  { title: '状态', dataIndex: 'status', key: 'status', width: 100 },
  { title: '决策角色', dataIndex: 'decisionRole', key: 'decisionRole', width: 110 },
]

async function load(): Promise<void> {
  errorText.value = ''
  loading.value = true
  try {
    rows.value = await listContacts({ onlyUnlinked: filter.value === 'unlinked' })
  } catch (error) {
    // 网络错误 / 权限边界都走这里：**内联**说清，并清空列表（不显示上一次的残留）
    rows.value = []
    errorText.value = error instanceof Error ? error.message : '加载失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

function selectFilter(next: ContactLinkFilter): void {
  if (filter.value === next) return
  filter.value = next
}

// 筛选一变**重新取数**（筛选在服务端做，→ `only_unlinked`）
watch(filter, () => {
  void load()
})

onMounted(() => {
  void load()
})
</script>

<template>
  <section class="contacts">
    <h2 class="contacts-title">联系人档案</h2>
    <p class="contacts-hint">{{ filterHint }}</p>

    <div class="contacts-filters">
      <span class="contacts-filter-label">范围</span>
      <button
        v-for="item in CONTACT_LINK_FILTERS"
        :key="item.value"
        type="button"
        class="contacts-chip"
        :class="{ 'is-active': filter === item.value }"
        @click="selectFilter(item.value)"
      >
        {{ item.label }}
      </button>
    </div>

    <p v-if="errorText" class="contacts-error">{{ errorText }}</p>

    <a-table
      :columns="columns"
      :data-source="rows"
      :loading="loading"
      :pagination="false"
      row-key="id"
      size="middle"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'name'">{{ record.name }}</template>
        <template v-else-if="column.key === 'position'">{{ record.position ?? '—' }}</template>
        <template v-else-if="column.key === 'phone'">
          {{ record.phone_masked }}
          <!-- 上锁是**服务端给的状态**（本页只标注）：「申请解锁」属 G 域审批，未建 → 不摆假入口 -->
          <a-tag v-if="record.phone_locked" color="default">已上锁</a-tag>
        </template>
        <template v-else-if="column.key === 'status'">
          <a-tag :color="record.is_current ? 'green' : 'default'">
            {{ record.is_current ? '在职' : '已离职' }}
          </a-tag>
        </template>
        <template v-else-if="column.key === 'decisionRole'">
          {{ decisionRoleNameOf(record.decision_role) }}
        </template>
      </template>

      <template #emptyText>
        <a-empty :description="`${filterLabel}：没有联系人`" />
      </template>
    </a-table>
  </section>
</template>

<style scoped>
.contacts {
  max-width: 1080px;
}

.contacts-title {
  margin: 0 0 var(--crm-space-xs);
  font-size: var(--crm-font-size-2xl);
  font-weight: var(--crm-font-weight-strong);
  color: var(--crm-color-text);
}

.contacts-hint {
  margin: 0 0 var(--crm-space-lg);
  font-size: var(--crm-font-size-base);
  color: var(--crm-color-text-tertiary);
}

/** 筛选栏：单行 inline、控件高统一（与业务关系列表的 chip 同款视觉，不为一处控件新造一套） */
.contacts-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--crm-space-xs);
  margin-bottom: var(--crm-space-md);
}

.contacts-filter-label {
  font-size: var(--crm-font-size-xs);
  color: var(--crm-color-text-tertiary);
}

.contacts-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--crm-space-xxs);
  height: 28px;
  padding: 0 var(--crm-space-sm);
  font-size: var(--crm-font-size-xs);
  color: var(--crm-color-text-secondary);
  background: var(--crm-color-bg-container);
  border: var(--crm-border-width) solid var(--crm-color-border-secondary);
  border-radius: var(--crm-radius-pill);
  cursor: pointer;
}

.contacts-chip.is-active {
  color: var(--crm-color-primary);
  border-color: var(--crm-color-primary);
  background: var(--crm-color-primary-bg);
}

/** 错误态：§4.6「错误文案红 12px」（与登录页 / 建档页 / 关系列表同一形态） */
.contacts-error {
  margin: 0 0 var(--crm-space-sm);
  font-size: var(--crm-font-size-xs);
  color: var(--crm-color-error);
}
</style>
