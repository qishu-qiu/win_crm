<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter, type LocationQuery, type LocationQueryRaw } from 'vue-router'

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
 * ⛔ **本页不做、也不摆假入口**：
 *   · **「申请解锁」按钮** —— 解锁审批属 G 域（→《欠账登记表》D-04）：本页只把
 *     `phone_locked` **标注出来**（那是服务端给的**状态**），不摆一个点了没用的按钮；
 *   · **悬浮卡**（悬停出联系人卡）—— 跨页复用件属后续（→《欠账登记表》D-50）。
 *
 * ★ **姓名可点**（M6-16）：跳到**联系人详情页** `/contacts/:id`（→ 欠账 **D-13 前半** 已收口）——
 *   实体可点铁律 A1：任何位置的人名都可点，不许出现纯文本人名（→ 需求 §13.1）。
 *
 * · **筛选状态写入 URL query**（→ 设计规范 §4.2「筛选 / 查询栏」：可分享 / 刷新不丢）——
 *   实现见下方「URL ↔ 筛选 双向同步」一段（原欠账 D-39）。
 *
 * ★ 空态用 `a-empty`、**不预填演示数据**（→ 设计规范 §3.2 第 11 条）。
 */

/** 默认档 ＝**选项表的第一项**（不另写 `'all'` 字面量：选项表一改，这里就静默分叉） */
const DEFAULT_FILTER: ContactLinkFilter = CONTACT_LINK_FILTERS[0].value

const route = useRoute()
const router = useRouter()

const filter = ref<ContactLinkFilter>(DEFAULT_FILTER)
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

// ===== URL ↔ 筛选 双向同步（→ 设计规范 §4.2：筛选状态写入 URL query，可分享 / 刷新不丢 · 原欠账 D-39）=====
//
// 判据：**分享出去的链接 / 刷新回来，看到的必须是同一份结果**；地址栏与页面筛选永远同源。
// ★ 与业务关系列表页（`RelationListView.vue`）**同款写法**：本项目只允许这一套 URL 同步范式，
//   不在第二页另造一种（改一处漏一处是本项目一号坑）。

/** URL query 键名 —— **与接口 §5.5 的参数名同字**（`only_unlinked`），两边对照时不易错位 */
const LINK_QUERY_KEY = 'only_unlinked'

/** 该键在 URL 上的**唯一合法取值**（接口只认 `true`／不给：`api/company.ts` 里就是这么传的） */
const LINK_QUERY_ON = 'true'

/**
 * 把 URL 上的一个键**摊平成候选值**。
 * · 兼容 `?only_unlinked=true` 与手拼的重复键形态（`?only_unlinked=true&only_unlinked=true`）；
 * · URL 是**不可信输入**（可手改、可被别人改了分享过来），形状先归一，后面才好比对。
 */
function queryValues(raw: LocationQuery[string]): string[] {
  const list = Array.isArray(raw) ? raw : [raw]
  return list
    .filter((item): item is string => typeof item === 'string')
    .flatMap((item) => item.split(','))
    .map((item) => item.trim())
    .filter((item) => item !== '')
}

/**
 * 当前筛选的**规范形态**（＝ URL 该写成什么样，也是"是否已归一"的判据）—— 一份逻辑两处用。
 * · 默认档给空串＝**该键不该出现在 URL 上**：链接才短（默认档 ⇒ 裸 `/contacts`）。
 */
function normalizedLink(): string {
  return filter.value === DEFAULT_FILTER ? '' : LINK_QUERY_ON
}

/**
 * 从 URL query 还原筛选。
 * ★ **只认值域内的值**：认不出的（手改的 `?only_unlinked=1` / `?only_unlinked=yes`）一律
 *   **丢弃回落默认** —— 原样转发给服务端只会换来一个错误页，而"链接是别人发来的"不该由用户买单。
 *   ⚠ 这里收敛的是**URL 形状**（不可信输入），不是业务规则：值域仍取自**同一份接口约定**。
 */
function parseFilterFromQuery(query: LocationQuery): ContactLinkFilter {
  return queryValues(query[LINK_QUERY_KEY]).includes(LINK_QUERY_ON) ? 'unlinked' : DEFAULT_FILTER
}

/** URL 上的筛选是否已是**规范形态**（不是才纠正一次 —— 免得每次进页都平白多一次导航） */
function queryIsNormalized(): boolean {
  return queryValues(route.query[LINK_QUERY_KEY]).join(',') === normalizedLink()
}

/**
 * 筛选 → URL。
 * ★ 用 `replace` 而非 `push`：改筛选不该让人按"后退"退出一串中间态（后退应回上一页，不是上一次筛选）。
 * ★ 保留 URL 上**其它键**（将来加了别的参数，别在这里被抹掉）；但默认档那键要**先删后写**——
 *   只 `Object.assign` 是删不掉的（默认档时该键会一直赖在地址栏）。
 * ★ 改 query 不会重建本组件（同路由复用），故**不会**再触发一次 `onMounted` / 取数，不会自激。
 */
function syncQuery(): void {
  const query: LocationQueryRaw = { ...route.query }
  delete query[LINK_QUERY_KEY]
  const value = normalizedLink()
  if (value !== '') query[LINK_QUERY_KEY] = value
  void router.replace({ query })
}

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

/**
 * 切档 → 写 URL ＋ 重新取数。
 * ★ 两者都是同步动作，同一次交互里完成，地址栏不会短暂地与页面不一致（与关系列表页同款）。
 * ★ 页面**不本地过滤**：筛选在服务端做（→ `only_unlinked`，见 `api/company.ts`）——
 *   前端再筛一遍＝第二套范围口径（改了服务端忘了前端就露客户）。
 */
function selectFilter(next: ContactLinkFilter): void {
  if (filter.value === next) return
  filter.value = next
  syncQuery()
  void load()
}

onMounted(() => {
  // ★ 进页（刷新 / 深链 / 别人分享来的链接）**先从 URL 还原筛选**，再按它取数（→ 设计规范 §4.2）。
  //   URL 带脏值（手改的非法档 / 别名形态）时顺手把地址栏归一化：否则就成了
  //   「地址栏写着 A、页面筛着 B」的第二套真相 —— 本页头注释点名的那个坑。
  filter.value = parseFilterFromQuery(route.query)
  if (!queryIsNormalized()) syncQuery()
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
        <!-- 实体可点（A1）：人名一律可点，落点＝联系人详情页 -->
        <template v-if="column.key === 'name'">
          <router-link class="contacts-link" :to="`/contacts/${record.id}`">
            {{ record.name }}
          </router-link>
        </template>
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

/** 可点人名：用主色 + hover 下划线（**不用 AntD Link 组件的默认蓝**，与全局主色 token 同源） */
.contacts-link {
  color: var(--crm-color-primary);
}

.contacts-link:hover {
  text-decoration: underline;
}
</style>
