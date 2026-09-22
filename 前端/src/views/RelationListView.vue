<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter, type LocationQuery, type LocationQueryRaw } from 'vue-router'
import { Modal, message, type TablePaginationConfig } from 'ant-design-vue'

import {
  createCommitment,
  listCommitments,
  listEvents,
  quickMark,
  recordEvent,
  updateCommitment,
  type ActionEvent,
  type Commitment,
  type RecordEventInput,
} from '../api/engine'
import {
  RELATION_PAGE_SIZE_DEFAULT,
  listRelations,
  updateRelation,
  type RelationListItem,
  type RelationTab,
  type RelationVo,
} from '../api/relation'
import { claimSeaRelation } from '../api/sea'
import {
  ACTION_TYPE_OPTIONS,
  COMMITMENT_CTYPE_OPTIONS,
  COMMITMENT_PARTY_OPTIONS,
  EFFECTIVE_OUTCOME_OPTIONS,
  QUICK_MARK_OUTCOME_OPTIONS,
  actionTypeNameOf,
  branchNameOf,
  commitmentPartyNameOf,
  commitmentStatusNameOf,
  outcomeNameOf,
} from '../engine'
import {
  RELATION_VIEW_OPTIONS,
  URGENCY_OPTIONS,
  VALUE_TIER_OPTIONS,
  dropInDaysIsUrgent,
  dropInDaysText,
  stageNameOf,
  toValueTier,
  urgencyColorOf,
  urgencyNameOf,
  valueTierNameOf,
  type ValueTierValue,
} from '../relation'
import { formatDateTime } from '../format'

/**
 * 业务关系列表页（M3-14 起 · 方案 A 最小页）—— **私海 / 公海两个页签**，
 * M4-17 起每行可**点开时间线**（写跟单 / 看承诺）。
 *
 * ★ **公海（无主）＝可读不可写**（2026-09-18 拍板）：抽屉在公海只给**两个**入口 ——
 *   「**领取到我的私海**」（F-01 片 2；领取＝把客户接过来，不是"写内容"，→ 接口 §4.5）＋
 *   「**开发价值**」（唯一可写的属性）；其余写动作一概不出现；跟单 / 承诺**照旧可读**
 *   （→ 前端文档 §5 第 9/10 条 / 需求 §6.3 动线「看号 → 翻历史 → 打 → 有戏就领取」/ D-32）。
 *
 * 判据逐字（《开发计划-V1》M3-14 / M4-17）：
 *   · M3-14「页面上能看到两条列表，**数据与 curl 一致**」；
 *   · M4-17「**页面上写跟单后，时间线看得到**」。
 *
 * 口径来源（★ 真相源，勿自造）：
 *   · 两个页签与列 →《销售CRM接口API文档》§4.4 / §5.6（列表项字段）。
 *     ★ **2026-09-22 补「掉海」列**：值＝服务端派生的 `drop_in_x_days`（距掉海还剩几个自然日，
 *       由桥③ 聚合层 `relation-aggregate` 拼装），**到期当天 / 已过期才标红**
 *       （→《前端页面与交互文档》§5 页 5「**到期当天掉公海⚠**」）；本页**不算天数**，只翻译。
 *   · **数据由服务端按数据范围收敛**（→ §2.2），页面**不再自己过滤**：
 *     前端过滤＝第二套范围口径（改了服务端忘了前端就露客户），这是本项目反复点名的
 *     「双真相源」；页面只负责**把服务端的答案显示出来**。
 *   · **交付 / 客服点公海 → 403** 是**正常分支**（§2.2「不进公海」）：显示内联无权限说明，
 *     不是报错崩溃（→ 设计规范 §5.1 空态 / §4.6 错误态）。
 *   · 空态用 `a-empty`；**不预填演示数据**（→ 设计规范 §3.2 第 11 条）。
 *   · **筛选状态写入 URL query**（→ 设计规范 §4.2「筛选 / 查询栏」：可分享 / 刷新不丢）——
 *     实现见下方「URL ↔ 筛选 双向同步」一段（原欠账 D-21）。
 *
 * ★ 时间线抽屉**不自己写业务规则**：有效沟通要不要写「一句话结果」、快速标记算不算有效跟进、
 *   同内容重复提交算不算重复 —— 全部由服务端判（页面只把服务端的人话 show 出来）。
 *   前端再判一遍＝第二套规则，迟早与后端分叉（本项目点名的坑）。
 *
 * ★ **M6-07 分页**（→ 接口 §2.3 分页形态 / §2.7；设计规范 §4.3「列表类一律分页、不用无限滚动」）：
 *   页码 / 每页条数交给**表格自带分页器**（表格右下、「共 N 条」＋ 20/50/100 ＋ 快速跳页）；
 *   翻页即**重新取数**（服务端分页）。
 *   ⚠ **不许把全量拉回来在前端切片**：那是假分页 —— 数据一多就白拉全表，且「共 N 条」
 *     会退化成「本页 N 条」（`list.length` 不是总数，`total` 只有服务端知道）。
 */
const route = useRoute()
const router = useRouter()

const tab = ref<RelationTab>('private')
// ★ 列表项类型（＝ `RelationVo` ＋ `drop_in_x_days`，→ 接口 §5.6）：抽屉里仍用 `RelationVo`
//   （详情不带那个字段），两者不可混（混了就会在详情侧读到 `undefined` 却显示成 `—`）
const rows = ref<RelationListItem[]>([])
const loading = ref(false)
const errorText = ref('')

/** 页码（从 1 起）/ 每页条数 / 总条数：三者**都以后端出参为准**，页面不自己算 */
const page = ref(1)
const pageSize = ref(RELATION_PAGE_SIZE_DEFAULT)
const total = ref(0)

/**
 * 筛选状态（→ 接口 §5.6）：`view` 单选（视图 4 档）、`urgencies` **多选**（紧迫档 5 档，空＝不筛）。
 * ★ **筛选一律由服务端做**（`GET /relations?view=&urgency=`）—— 页面**不许**本地过滤：
 *   一分页就只能筛当前页（第 2 页的「周重点」会被漏掉），「共 N 条」也会退化成"本页条数"。
 * ★ 初始值交给 URL 还原（见下方「URL ↔ 筛选 双向同步」）：本页**唯一的筛选真相源是「筛选状态 ＋ URL」这一对**，
 *   两边必须同步 —— 地址栏写着 `view=cooperated` 而页面筛着「我的全部」，就是"同一件事两处记录"。
 */
/** 默认视图 ＝**视图选项表的第一项**（不另写 `'all'` 字面量：选项表一改，这里就静默分叉） */
const DEFAULT_VIEW: string = RELATION_VIEW_OPTIONS[0].value

const view = ref(DEFAULT_VIEW)
const urgencies = ref<string[]>([])

// ===== URL ↔ 筛选 双向同步（→ 设计规范 §4.2：筛选状态写入 URL query，可分享 / 刷新不丢 · 原欠账 D-21）=====
//
// 判据：**分享出去的链接 / 刷新回来，看到的必须是同一份结果**；地址栏与页面筛选永远同源。

/** URL query 键名 —— **与接口 §5.6 的参数名同字**（`view` / `urgency`），两边对照时不易错位 */
const VIEW_QUERY_KEY = 'view'
const URGENCY_QUERY_KEY = 'urgency'

/** 合法值域**取自选项表本身**（不在这里另抄清单 —— 抄的那份迟早与 chip 显示的值分叉） */
const VIEW_VALUES: readonly string[] = RELATION_VIEW_OPTIONS.map((item) => item.value)
const URGENCY_VALUES: readonly string[] = URGENCY_OPTIONS.map((item) => item.value)

/**
 * 把 URL 上的一个键**摊平成候选值**。
 * · 兼容 `?urgency=weekly,gray`（本页写出的形态）与 `?urgency=weekly&urgency=gray`（手拼 / 别处拼的形态）；
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
 * · 默认值给空串＝**该键不该出现在 URL 上**：链接才短（`view=all` ＋ 无紧迫档 ⇒ 裸 `/relations`）；
 * · 多选按**选项表顺序**（例：先点灰度再点周重点，URL 仍是 `weekly,gray`）——
 *   同一组选择恒等同一个链接，才谈得上"可分享 / 可对比"。
 */
function normalizedFilter(): { view: string; urgency: string } {
  return {
    view: view.value === DEFAULT_VIEW ? '' : view.value,
    urgency: URGENCY_VALUES.filter((value) => urgencies.value.includes(value)).join(','),
  }
}

/**
 * 从 URL query 还原筛选。
 * ★ **只认值域内的值**：认不出的（手改的 `view=overdue`、别处传错的码）一律**丢弃回落默认** ——
 *   原样转发给服务端只会换来一个 400 错误页，而"链接是别人发来的"不该由用户买单。
 *   ⚠ 这里收敛的是**URL 形状**（不可信输入），不是业务规则：值与判定口径仍取自**同一份选项表**。
 */
function parseFilterFromQuery(query: LocationQuery): { view: string; urgencies: string[] } {
  const rawUrgencies = queryValues(query[URGENCY_QUERY_KEY])
  return {
    view: queryValues(query[VIEW_QUERY_KEY]).find((item) => VIEW_VALUES.includes(item)) ?? DEFAULT_VIEW,
    urgencies: URGENCY_VALUES.filter((value) => rawUrgencies.includes(value)),
  }
}

/** URL 上的筛选是否已是**规范形态**（不是才纠正一次 —— 免得每次进页都平白多一次导航） */
function queryIsNormalized(): boolean {
  const expected = normalizedFilter()
  return (
    queryValues(route.query[VIEW_QUERY_KEY]).join(',') === expected.view &&
    queryValues(route.query[URGENCY_QUERY_KEY]).join(',') === expected.urgency
  )
}

/**
 * 筛选 → URL。
 * ★ 用 `replace` 而非 `push`：改筛选不该让人按"后退"退出一串中间态（后退应回上一页，不是上一次筛选）。
 * ★ 保留 URL 上**其它键**（将来加了别的参数，别在这里被抹掉）；但默认值那两键要**先删后写**——
 *   只 `Object.assign` 是删不掉的（`view=all` 会一直赖在地址栏）。
 * ★ 改 query 不会重建本组件（同路由复用），故**不会**再触发一次 `onMounted` / 取数，不会自激。
 */
function syncQuery(): void {
  const query: LocationQueryRaw = { ...route.query }
  delete query[VIEW_QUERY_KEY]
  delete query[URGENCY_QUERY_KEY]
  const { view: viewValue, urgency } = normalizedFilter()
  if (viewValue !== '') query[VIEW_QUERY_KEY] = viewValue
  if (urgency !== '') query[URGENCY_QUERY_KEY] = urgency
  void router.replace({ query })
}

/** 每页条数可选值：逐字取设计规范 §4.3「20 / 50 / 100」（AntD 的 `pageSizeOptions` 收字符串） */
const PAGE_SIZE_OPTIONS = ['20', '50', '100']

/**
 * 批量快速标记（M6-09 片 3）—— 勾选多行 → 三选一（未联系 / 未接电话 / 说两句挂了）。
 *
 * 口径来源（★ 真相源，勿自造）：
 *   · 功能 →《销售CRM前端页面与交互文档》§5 第 5 条（业务关系列表「含批量快速标记」）
 *     ＋ §3（「勾选多客户 → 一次性标记」；落库但**不算有效跟进、不重置掉海倒计时**）。
 *   · ⚠ **公海不提供标记**（同文档 §9/10「公海内不做任何动作」，2026-09-12 定；
 *     2026-09-18 补例外「唯一可改开发价值」）：故动作条**只在「私海」页签出现** ——
 *     公海是"看号 → 翻历史 → 打 → 领取"的动线，领取后才进推进态。
 *     ★ 原先此处记的「服务端暂未拦公海」**已修复**（2026-09-18，→《欠账登记表》D-32②：
 *     `requireWritableRelation` / `checkRelationWrite` 均已判无主 → 422 / `20408`）——
 *     服务端已是硬口径，但**页面照旧不摆这些入口**：不靠"点了会报错"来体现规则。
 *
 * ★ 判定全在服务端（→ 接口 §5.7）：关系侧判**可写**（越权 / 只读 → 403）；
 *   页面**不自己判**"这条能不能标"（判一遍＝第二套规则）。
 * ★ 报数**只信服务端**的 `marked`（＝实际落库条数），不拿"勾了几条"当结果 ——
 *   服务端会做去重（同一对象勾两次＝一条）。
 */
type QuickMarkOutcome = (typeof QUICK_MARK_OUTCOME_OPTIONS)[number]

/** 勾选中的关系 id（**只是选择状态**，不代表能标 —— 能不能标由服务端说了算） */
const selectedRelationIds = ref<string[]>([])
/** 正在提交的那一型（用于按钮 loading；同时也用来禁用其它两个按钮，防连点两下写两批） */
const markingOutcome = ref<QuickMarkOutcome | null>(null)

/** 勾选框只在**私海**出现：公海不提供任何动作（→ 前端文档 §9/10），给了勾选框就是给假入口 */
const rowSelection = computed(() =>
  tab.value === 'private'
    ? {
        selectedRowKeys: selectedRelationIds.value,
        onChange: (keys: (string | number)[]): void => {
          selectedRelationIds.value = keys.map((key) => String(key))
        },
      }
    : undefined,
)

/**
 * 提交批量标记。
 * ★ 成功后**清空勾选**并重新取数：服务端不回写 `last_event_at`，列表看着可能"没变化"，
 *   但勾选必须清掉 —— 留着勾选会让人以为"上一批没标上"，再点一次就多落一批。
 */
async function batchMark(outcome: QuickMarkOutcome): Promise<void> {
  if (selectedRelationIds.value.length === 0) return

  markingOutcome.value = outcome
  try {
    const result = await quickMark({
      relation_ids: [...selectedRelationIds.value],
      outcome,
    })
    message.success(`已标记 ${result.marked} 条`)
    selectedRelationIds.value = []
    await load()
  } catch {
    // 失败原因（403 / 参数）由请求层统一弹出，这里不重复堆一层提示；勾选**保留**，便于换了再试
  } finally {
    markingOutcome.value = null
  }
}

function clearSelection(): void {
  selectedRelationIds.value = []
}

const paginationConfig = computed(() => ({
  current: page.value,
  pageSize: pageSize.value,
  total: total.value,
  showSizeChanger: true,
  pageSizeOptions: PAGE_SIZE_OPTIONS,
  showQuickJumper: true,
  showTotal: (count: number) => `共 ${count} 条`,
}))

const tabLabel = computed(() => (tab.value === 'private' ? '私海' : '公海'))

const columns = [
  { title: '公司', dataIndex: 'company', key: 'company', width: 220 },
  { title: '部门', dataIndex: 'dept', key: 'dept', width: 110 },
  { title: '产品线', dataIndex: 'productLine', key: 'productLine', width: 110 },
  { title: '阶段', dataIndex: 'stage', key: 'stage', width: 120 },
  { title: '紧迫', dataIndex: 'urgency', key: 'urgency', width: 100 },
  { title: '开发价值', dataIndex: 'valueTier', key: 'valueTier', width: 90 },
  { title: '主责', dataIndex: 'owner', key: 'owner', width: 100 },
  { title: '最近沟通', dataIndex: 'lastEventAt', key: 'lastEventAt', width: 150 },
  // 「距掉海」：数值来自服务端（§5.6 `drop_in_x_days`，按自然日）；本页只翻译成人话、
  // 到期当天 / 已过期才标红（→ 前端文档 §5 页 5「到期当天掉公海⚠」）
  { title: '掉海', dataIndex: 'dropInXDays', key: 'dropInXDays', width: 150 },
  { title: '操作', dataIndex: 'actions', key: 'actions', width: 90 },
]

async function load(): Promise<void> {
  errorText.value = ''
  // ★ 每次重新取数前**先清勾选**：翻页 / 换页签 / 改筛选之后，选中的行可能已经不在这一屏 ——
  //   留着勾选会让人对着一屏没勾的行点「快速标记」，标到他看不见的旧行上
  selectedRelationIds.value = []
  loading.value = true
  try {
    const result = await listRelations({
      tab: tab.value,
      page: page.value,
      pageSize: pageSize.value,
      view: view.value,
      urgencies: urgencies.value,
    })
    rows.value = result.list
    total.value = result.total
  } catch (error) {
    // 403（交付 / 客服不进公海）与网络错误都走这里：**内联**说清，列表清空（不显示上次的残留）
    rows.value = []
    total.value = 0
    errorText.value = error instanceof Error ? error.message : '加载失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

/** 分页器交互（翻页 / 改每页条数）→ 重新取数 */
function onPageChange(pager: TablePaginationConfig): void {
  page.value = pager.current ?? 1
  pageSize.value = pager.pageSize ?? RELATION_PAGE_SIZE_DEFAULT
  void load()
}

/**
 * 筛选变化 → **页码必须回第 1 页**再取数。
 * ★ 不回会看到**空表**：停在第 3 页时一筛，结果集可能只剩 1 页 ——
 *   用户会以为"没数据"，实际只是页码越界（这类假空态最费口舌）。
 */
function onFilterChange(): void {
  page.value = 1
  void load()
}

function selectView(next: string): void {
  if (view.value === next) return
  view.value = next
  // 先写 URL 再取数：两者都是同步动作，同一次交互里完成，地址栏不会短暂地与页面不一致
  syncQuery()
  onFilterChange()
}

/** 紧迫档**多选**：再点一次＝取消该档（与 chip 的通用交互一致，不另造"清空"按钮） */
function toggleUrgency(code: string): void {
  urgencies.value = urgencies.value.includes(code)
    ? urgencies.value.filter((item) => item !== code)
    : [...urgencies.value, code]
  syncQuery()
  onFilterChange()
}

watch(tab, () => {
  // ★ 换页签＝换一份结果集，页码必须回第 1 页：停在第 3 页切过去时新页签可能只有 1 页，
  //   用户看到空表会以为「没数据」（实际只是页码越界）
  page.value = 1
  void load()
})

onMounted(() => {
  // ★ 进页（刷新 / 深链 / 别人分享来的链接）**先从 URL 还原筛选**，再按它取数（→ 设计规范 §4.2）。
  //   URL 带脏值（手改的非法档 / 别名形态）时顺手把地址栏归一化：否则就成了
  //   「地址栏写着 A、页面筛着 B」的第二套真相 —— 本页头注释反复点名的那个坑。
  const restored = parseFilterFromQuery(route.query)
  view.value = restored.view
  urgencies.value = restored.urgencies
  if (!queryIsNormalized()) syncQuery()
  void load()
})

// ===== M4-17 时间线抽屉 =====

const drawerOpen = ref(false)
const activeRelation = ref<RelationVo | null>(null)
const events = ref<ActionEvent[]>([])
const commitments = ref<Commitment[]>([])
const timelineLoading = ref(false)
const timelineError = ref('')
const submittingEvent = ref(false)
const submittingCommitment = ref(false)

/**
 * 公海（无主）＝**可读不可写**（2026-09-18 拍板 → 前端文档 §5 第 9/10 条 / 需求 §6.3。
 * ⚠ 原文「公海内不做任何动作」已于同日**补例外**：「改开发价值」是唯一可做的）：
 *   · **留读**：跟单全文 ＋ 承诺**照旧拉出来**（看不到历史就判断不出值不值得捞）——
 *     服务端已按「所属部门」放开（销售＝本部门 / 经理＝管辖部门；→《欠账登记表》D-32①）；
 *   · **封写**：「记一条跟单」「建承诺」「兑现 / 豁免」在公海**一律不出现**（**不是禁用**）——
 *     摆一个点了报 422 的按钮＝假入口（设计规范 §3.2 第 11 条，本项目已犯过）；
 *   · **唯一例外**：改「开发价值」`value_tier` —— 开发价值＝**部门共同维护**，**销售也能标**。
 *
 * ★ 判据取服务端出的 `sea_status`（`company_sea` ＝ 无主），**不自己拿 `owner === null` 再推一遍**：
 *   同一件事两处判定，将来 owner 语义一变（例：掉海时留着 `owner` 行做留痕）就分叉。
 */
const activeIsSea = computed(() => activeRelation.value?.sea_status === 'company_sea')

/**
 * 开发价值草稿：打开抽屉时按**当前值**初始化（`null` ＝ 未标，**与「待定」是两回事**）。
 * ⚠ 类型是**收窄后的值域**（`toValueTier` 逐项校验得来），不是 `string` ——
 *   出参是宽 `string | null`，直接塞进表单再原样回传，就会把库里的怪值送回去挨 400。
 */
const valueTierDraft = ref<ValueTierValue | null>(null)
const savingValueTier = ref(false)

/** 选项顺序照规格表（→ `relation.ts` 的 `VALUE_TIER_OPTIONS`），本层只做形状转换 */
const valueTierOptions = VALUE_TIER_OPTIONS.map((item) => ({ value: item.value, label: item.label }))

/**
 * 「保存」只在**选了值且与当前值不同**时可点。
 * ★ 为什么卡这么死：公海的写入被服务端限定为「**只传 `value_tier`**」（→ 接口 §5.6）——
 *   草稿为空时提交出去就是一个**空 body**，服务端照判「写」→ 422 / `20408`。
 *   与其让用户点了报错，不如让按钮本来就点不动（**不让用户走到会失败的那一步**）。
 */
const canSaveValueTier = computed(
  () =>
    valueTierDraft.value !== null &&
    valueTierDraft.value !== activeRelation.value?.value_tier,
)

const drawerTitle = computed(() =>
  activeRelation.value === null
    ? '关系时间线'
    : `时间线 · ${activeRelation.value.company?.name ?? '（档案已删除）'}`,
)

/** 写跟单表单（默认「电话 + 有进展」——最常见的一次有效沟通） */
const eventForm = ref<{
  action_type: string
  outcome: string
  summary: string
  duration_min: number | null
}>({ action_type: 'phone', outcome: 'advanced', summary: '', duration_min: null })

/** 建承诺表单（→ 需求 §10.1：三快选：我发资料 / 他给答复 / 约见面） */
const commitmentForm = ref({ party: 'me', ctype: 'deliver', content: '', due_at: '' })

const eventColumns = [
  { title: '动作', dataIndex: 'actionType', key: 'actionType', width: 90 },
  { title: '一句话结果', dataIndex: 'summary', key: 'summary' },
  { title: '结果', dataIndex: 'outcome', key: 'outcome', width: 100 },
  { title: '谁写的', dataIndex: 'actor', key: 'actor', width: 90 },
  { title: '分线', dataIndex: 'branch', key: 'branch', width: 70 },
  { title: '时间', dataIndex: 'eventAt', key: 'eventAt', width: 150 },
]

const commitmentColumns = [
  { title: '承诺人', dataIndex: 'party', key: 'party', width: 110 },
  { title: '内容', dataIndex: 'content', key: 'content' },
  { title: '到期', dataIndex: 'due', key: 'due', width: 150 },
  { title: '状态', dataIndex: 'status', key: 'status', width: 90 },
  { title: '操作', dataIndex: 'actions', key: 'actions', width: 80 },
]

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

function openTimeline(record: RelationVo): void {
  activeRelation.value = record
  valueTierDraft.value = toValueTier(record.value_tier)
  drawerOpen.value = true
  void refreshTimeline()
}

/**
 * 保存开发价值（**公海唯一放行的写动作**，→ 接口 §5.6 / D-32②）。
 *
 * ⚠ 请求体**只有 `value_tier`** —— 多带任何一个字段，服务端就按「写」判 **422 / `20408`**。
 * ★ 成功后就地更新 `activeRelation`（抽屉里的值立刻为准），并重新取列表：
 *   列表有「开发价值」列，同一次动作两处显示不能不一致（与写跟单后的做法一致）。
 */
async function saveValueTier(): Promise<void> {
  const relation = activeRelation.value
  if (relation === null || !canSaveValueTier.value) return

  savingValueTier.value = true
  try {
    const updated = await updateRelation(relation.id, { value_tier: valueTierDraft.value ?? undefined })
    activeRelation.value = updated
    valueTierDraft.value = toValueTier(updated.value_tier)
    message.success('开发价值已更新')
    await load()
  } catch {
    // 失败原因（403 / 422 / 网络）由请求层统一弹出，这里不重复堆一层提示
  } finally {
    savingValueTier.value = false
  }
}

// ===== F-01 片 2：公海「领取到我的私海」（→ 接口 §4.5 / 需求 §6.3）=====

const claiming = ref(false)

/**
 * 能不能领 —— 只判**形状**：`dept_id` / `product_line_id` 是定位这条公海关系的入参，
 * 公司档案被逻辑删（`company === null`）时**请求根本构造不出来**，点了必然 400 ⇒ 不摆这个按钮（假入口）。
 *
 * ⚠ **角色 / 权限一概不在前端判**：谁能领（可写角色 ＋ 读范围）是**服务端口径** ——
 *   前端再判一遍＝第二套权限口径（改了服务端忘了前端就分叉，本项目点名的坑）；
 *   管理员（只读档）点了会拿到服务端 **403** 的人话，那是对的，不是缺陷。
 * ⚠ 「是不是公海」取的也是**服务端出的 `sea_status`**（见 `activeIsSea`），
 *   不自己拿 `owner === null` 再推一遍。
 */
const canClaim = computed(() => {
  const relation = activeRelation.value
  return (
    relation !== null &&
    relation.company !== null &&
    relation.dept !== null &&
    relation.product_line !== null
  )
})

/**
 * 领取**不可逆**（领取后不会再放回公海）⇒ 先确认再发（→ 前端文档 §9.3「危险操作二次确认」）。
 * ★ 确认按钮**不用 danger**：规范里 danger 是给「删除 / 判死」的（→ 设计规范 §二）；
 *   领取是把客户接过来，不是销毁。
 */
function confirmClaim(): void {
  if (!canClaim.value) return
  Modal.confirm({
    title: '领取到我的私海？',
    content: '领取后这条关系归你：原跟单全部继承，阶段从「初步建联」重新开始；此动作不可撤销。',
    okText: '确认领取',
    cancelText: '取消',
    onOk: () => claimToMyPrivate(),
  })
}

/**
 * 调领取端点 → 成功**跳关系详情页**（领取后才进推进态，动线终点在详情页 ——→ 需求 §6.3 / 接口 §5.16）。
 *
 * ★ 失败一律「**关抽屉 ＋ 重新拉列表**」：失败本身就说明**列表已经过期**
 *   （409＝刚被同事领走 / 400＝这条已不在公海 / 403＝越部门或只读角色）——
 *   继续摆着一行"其实已经领不了"的数据比刷新更糟。失败人话**由请求层统一弹出**，这里不重复堆提示。
 */
async function claimToMyPrivate(): Promise<void> {
  const relation = activeRelation.value
  if (
    relation === null ||
    relation.company === null ||
    relation.dept === null ||
    relation.product_line === null
  ) {
    return
  }

  claiming.value = true
  try {
    const claimed = await claimSeaRelation(relation.company.id, {
      dept_id: relation.dept.id,
      product_line_id: relation.product_line.id,
    })
    message.success('已领取到你的私海')
    drawerOpen.value = false
    onDrawerClose()
    await router.push(`/relations/${claimed.id}`)
  } catch {
    drawerOpen.value = false
    onDrawerClose()
    await load()
  } finally {
    claiming.value = false
  }
}

async function refreshTimeline(): Promise<void> {
  const relation = activeRelation.value
  if (relation === null) return

  timelineError.value = ''
  timelineLoading.value = true
  try {
    const [eventRows, commitmentRows] = await Promise.all([
      listEvents(relation.id),
      listCommitments(relation.id),
    ])
    events.value = eventRows
    commitments.value = commitmentRows
  } catch (error) {
    events.value = []
    commitments.value = []
    timelineError.value = error instanceof Error ? error.message : '加载失败，请稍后重试'
  } finally {
    timelineLoading.value = false
  }
}

function onDrawerClose(): void {
  activeRelation.value = null
  events.value = []
  commitments.value = []
  timelineError.value = ''
  valueTierDraft.value = null
}

async function submitEvent(): Promise<void> {
  const relation = activeRelation.value
  if (relation === null) return

  const input: RecordEventInput = { action_type: eventForm.value.action_type }
  if (eventForm.value.outcome !== '') input.outcome = eventForm.value.outcome
  if (eventForm.value.summary.trim() !== '') input.summary = eventForm.value.summary.trim()
  if (eventForm.value.duration_min !== null) input.duration_min = eventForm.value.duration_min

  submittingEvent.value = true
  try {
    await recordEvent(relation.id, input)
    message.success('已记下这条跟单')
    eventForm.value.summary = ''
    eventForm.value.duration_min = null
    await refreshTimeline()
    // 列表上的「最近沟通」也要跟着变（同一次动作，两处显示不能不一致）
    await load()
  } catch {
    // 失败原因（含「有效沟通必须写一句话结果」）由请求层统一弹出，这里不重复堆一层提示
  } finally {
    submittingEvent.value = false
  }
}

async function submitCommitment(): Promise<void> {
  const relation = activeRelation.value
  if (relation === null) return

  submittingCommitment.value = true
  try {
    await createCommitment(relation.id, {
      party: commitmentForm.value.party,
      ctype: commitmentForm.value.ctype,
      content: commitmentForm.value.content.trim(),
      ...(commitmentForm.value.due_at === ''
        ? {}
        : { due_at: new Date(`${commitmentForm.value.due_at}T00:00:00`).toISOString() }),
    })
    message.success('承诺已建')
    commitmentForm.value.content = ''
    commitmentForm.value.due_at = ''
    await refreshTimeline()
  } catch {
    // 同上：错误由请求层统一表达
  } finally {
    submittingCommitment.value = false
  }
}

async function markDone(commitment: Commitment): Promise<void> {
  const relation = activeRelation.value
  if (relation === null) return

  try {
    await updateCommitment(relation.id, { id: commitment.id, status: 'done' })
    message.success('已兑现')
    await refreshTimeline()
  } catch {
    // 同上
  }
}

/** 正在填豁免原因的那条承诺（`null` ＝ 没在填） */
const waivingId = ref<string | null>(null)
const waiveReasonDraft = ref('')
const submittingWaive = ref(false)

/**
 * 点「豁免」→ 展开原因输入。
 * ★ 为什么要展开：豁免＝**确有其事但做不成**，服务端**必填原因**（→ 需求 §10.1）；
 *   与「取消」（录错了 / 不成立，不填原因）是两件事，不能合并成一个按钮。
 */
function startWaive(commitment: Commitment): void {
  waivingId.value = commitment.id
  waiveReasonDraft.value = ''
}

function cancelWaive(): void {
  waivingId.value = null
  waiveReasonDraft.value = ''
}

/** 提交豁免（空原因不发请求：服务端也会 422，但本地先拦一步，省一个来回） */
async function submitWaive(commitment: Commitment): Promise<void> {
  const relation = activeRelation.value
  if (relation === null) return

  const reason = waiveReasonDraft.value.trim()
  if (reason === '') {
    message.warning('豁免必须填原因（写清为什么做不成）')
    return
  }

  submittingWaive.value = true
  try {
    await updateCommitment(relation.id, {
      id: commitment.id,
      status: 'waived',
      waive_reason: reason,
    })
    message.success('已豁免')
    cancelWaive()
    await refreshTimeline()
  } catch {
    // 同上：错误由请求层统一表达
  } finally {
    submittingWaive.value = false
  }
}
</script>

<template>
  <section class="relations">
    <h2 class="relations-title">业务关系</h2>
    <p class="relations-hint">
      列表由服务端按你的数据范围收敛：销售＝我参与的关系 ＋ 我所属部门的公海；经理＝管辖部门；
      总经理 / 管理员＝全部。
    </p>

    <div class="relations-tabs">
      <button
        v-for="item in (['private', 'sea'] as RelationTab[])"
        :key="item"
        type="button"
        class="relations-tab"
        :class="{ 'is-active': tab === item }"
        :aria-current="tab === item ? 'page' : undefined"
        @click="tab = item"
      >
        {{ item === 'private' ? '私海' : '公海' }}
      </button>
    </div>

    <!-- 筛选栏（→ 前端文档 §5；**筛选在服务端做**，见脚本头注释） -->
    <div class="relations-filters">
      <span class="relations-filter-label">视图</span>
      <button
        v-for="item in RELATION_VIEW_OPTIONS"
        :key="item.value"
        type="button"
        class="relations-chip"
        :class="{ 'is-active': view === item.value }"
        @click="selectView(item.value)"
      >
        {{ item.label }}
      </button>

      <span class="relations-filter-label">紧迫档</span>
      <button
        v-for="item in URGENCY_OPTIONS"
        :key="item.value"
        type="button"
        class="relations-chip"
        :class="{ 'is-active': urgencies.includes(item.value) }"
        @click="toggleUrgency(item.value)"
      >
        <span class="relations-dot" :style="{ background: urgencyColorOf(item.value) }" />
        {{ item.label }}
      </button>
    </div>

    <p v-if="errorText" class="relations-error">{{ errorText }}</p>

    <!-- 批量快速标记动作条（→ 前端文档 §5 第 5 条 / §3）：**只在私海**（公海不提供动作，→ §9/10） -->
    <div v-if="tab === 'private' && selectedRelationIds.length > 0" class="relations-bulk">
      <span class="relations-bulk-count">已选 {{ selectedRelationIds.length }} 条</span>
      <span class="relations-filter-label">快速标记</span>
      <a-button
        v-for="code in QUICK_MARK_OUTCOME_OPTIONS"
        :key="code"
        size="small"
        :loading="markingOutcome === code"
        :disabled="markingOutcome !== null"
        @click="batchMark(code)"
      >
        {{ outcomeNameOf(code) }}
      </a-button>
      <a-button
        type="text"
        size="small"
        :disabled="markingOutcome !== null"
        @click="clearSelection"
      >
        取消选择
      </a-button>
      <span class="relations-bulk-hint">
        快速标记只记一笔「尝试联系」：不算有效跟进、也不重置掉海倒计时。
      </span>
    </div>

    <a-table
      :columns="columns"
      :data-source="rows"
      :loading="loading"
      :pagination="paginationConfig"
      :row-selection="rowSelection"
      row-key="id"
      size="middle"
      @change="onPageChange"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'company'">
          <!-- 实体可点（→ README §九 不变量⑥「任何位置出现都可点开」；解欠账 D-13） -->
          <router-link v-if="record.company" :to="`/relations/${record.id}`" class="relations-link">
            {{ record.company.name }}
          </router-link>
          <template v-else>（档案已删除）</template>
        </template>
        <template v-else-if="column.key === 'dept'">{{ record.dept?.name ?? '—' }}</template>
        <template v-else-if="column.key === 'productLine'">
          {{ record.product_line?.name ?? '—' }}
        </template>
        <template v-else-if="column.key === 'stage'">{{ stageNameOf(record.stage) }}</template>
        <template v-else-if="column.key === 'urgency'">
          <span class="relations-urgency">
            <span class="relations-dot" :style="{ background: urgencyColorOf(record.urgency) }" />
            {{ urgencyNameOf(record.urgency) }}
          </span>
        </template>
        <template v-else-if="column.key === 'valueTier'">
          {{ valueTierNameOf(record.value_tier) }}
        </template>
        <template v-else-if="column.key === 'owner'">
          {{ record.owner?.name ?? '（公海 · 待领取）' }}
        </template>
        <template v-else-if="column.key === 'lastEventAt'">
          {{ formatDateTime(record.last_event_at) }}
        </template>
        <!-- 距掉海：**服务端算好的天数**，页面不参与计算（→ 接口 §5.6）；
             `null`（公海 / 判不了）显示 `—` 而**不是 0 天** —— 那会把"算不出"伪装成"今天到期" -->
        <template v-else-if="column.key === 'dropInXDays'">
          <span :class="{ 'relations-drop-urgent': dropInDaysIsUrgent(record.drop_in_x_days) }">
            {{ dropInDaysText(record.drop_in_x_days) }}
          </span>
        </template>
        <template v-else-if="column.key === 'actions'">
          <a-button type="link" size="small" @click="openTimeline(record)">时间线</a-button>
        </template>
      </template>

      <template #emptyText>
        <a-empty :description="errorText === '' ? `${tabLabel}暂无业务关系` : '无权限查看该列表'" />
      </template>
    </a-table>

    <a-drawer
      v-model:open="drawerOpen"
      :title="drawerTitle"
      :width="760"
      @close="onDrawerClose"
    >
      <p v-if="timelineError" class="relations-error">{{ timelineError }}</p>

      <!-- ★ 公海（无主）：**只给「领取到私海」＋「开发价值」两个入口**，其余写动作一概不出现
           （→ 前端文档 §5 第 9/10 条 / 需求 §6.3） -->
      <template v-if="activeIsSea">
        <h3 class="drawer-section">领取到私海</h3>
        <div class="drawer-form">
          <!-- 领取＝把客户接过来（动线终点），故用主按钮；能不能领**由服务端判**（→ 接口 §4.5） -->
          <a-button type="primary" :loading="claiming" :disabled="!canClaim" @click="confirmClaim">
            领取到我的私海
          </a-button>
          <span class="relations-bulk-hint">
            领取后这条关系归你：原跟单全部继承，阶段从「初步建联」重新开始。
          </span>
        </div>

        <h3 class="drawer-section">开发价值</h3>
        <div class="drawer-form">
          <a-select
            v-model:value="valueTierDraft"
            :options="valueTierOptions"
            placeholder="未标"
            style="width: 140px"
          />
          <a-button type="primary" :loading="savingValueTier" :disabled="!canSaveValueTier" @click="saveValueTier">
            保存
          </a-button>
          <span class="relations-bulk-hint">
            该客户还在公海：开发价值由部门共同维护，这儿谁都能标；
            写跟单 / 建承诺要先点上面的「领取到我的私海」。
          </span>
        </div>
      </template>

      <template v-else>
        <h3 class="drawer-section">记一条跟单</h3>
        <div class="drawer-form">
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
          <a-button type="primary" :loading="submittingEvent" @click="submitEvent">记下来</a-button>
        </div>
      </template>

      <h3 class="drawer-section">时间线（按时间倒序，默认近 1 个月）</h3>
      <a-table
        :columns="eventColumns"
        :data-source="events"
        :loading="timelineLoading"
        :pagination="false"
        row-key="id"
        size="small"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'actionType'">{{ actionTypeNameOf(record.action_type) }}</template>
          <template v-else-if="column.key === 'summary'">{{ record.summary ?? '—' }}</template>
          <template v-else-if="column.key === 'outcome'">{{ outcomeNameOf(record.outcome) }}</template>
          <template v-else-if="column.key === 'actor'">{{ record.actor?.name ?? '—' }}</template>
          <template v-else-if="column.key === 'branch'">{{ branchNameOf(record.branch) }}</template>
          <template v-else-if="column.key === 'eventAt'">{{ formatDateTime(record.event_at) }}</template>
        </template>
        <template #emptyText>
          <a-empty description="近 1 个月还没有跟单记录" />
        </template>
      </a-table>

      <h3 class="drawer-section">承诺</h3>
      <!-- 建承诺也是写：公海不出现（列表照旧可读） -->
      <div v-if="!activeIsSea" class="drawer-form">
        <a-select
          v-model:value="commitmentForm.party"
          :options="COMMITMENT_PARTY_OPTIONS"
          style="width: 200px"
        />
        <a-select
          v-model:value="commitmentForm.ctype"
          :options="COMMITMENT_CTYPE_OPTIONS"
          style="width: 130px"
        />
        <a-input
          v-model:value="commitmentForm.content"
          placeholder="一句话承诺"
          style="width: 200px"
        />
        <input v-model="commitmentForm.due_at" type="date" class="drawer-date" />
        <a-button :loading="submittingCommitment" @click="submitCommitment">建承诺</a-button>
      </div>

      <a-table
        :columns="commitmentColumns"
        :data-source="commitments"
        :pagination="false"
        row-key="id"
        size="small"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'party'">{{ commitmentPartyNameOf(record.party) }}</template>
          <template v-else-if="column.key === 'content'">{{ record.content }}</template>
          <template v-else-if="column.key === 'due'">{{ formatDateTime(record.due_at) }}</template>
          <template v-else-if="column.key === 'status'">
            {{ commitmentStatusNameOf(record.status) }}
            <span v-if="record.waive_reason">（{{ record.waive_reason }}）</span>
          </template>
          <template v-else-if="column.key === 'actions'">
            <!-- 公海：承诺不收尾（唯一例外是上方的「开发价值」，→ 前端文档 §5 第 9/10 条） -->
            <span v-if="activeIsSea">—</span>
            <template v-else-if="record.status === 'open'">
              <template v-if="waivingId === record.id">
                <a-input
                  v-model:value="waiveReasonDraft"
                  size="small"
                  placeholder="为什么做不成（客户变卦 / 预算冻结…）"
                  style="width: 200px"
                />
                <a-button
                  type="link"
                  size="small"
                  :loading="submittingWaive"
                  @click="submitWaive(record)"
                >
                  确定豁免
                </a-button>
                <a-button type="link" size="small" @click="cancelWaive">不豁免</a-button>
              </template>
              <template v-else>
                <a-button type="link" size="small" @click="markDone(record)">兑现</a-button>
                <a-button type="link" size="small" @click="startWaive(record)">豁免</a-button>
              </template>
            </template>
            <span v-else>—</span>
          </template>
        </template>
        <template #emptyText>
          <a-empty description="暂无承诺" />
        </template>
      </a-table>
    </a-drawer>
  </section>
</template>

<style scoped>
.relations {
  max-width: 1080px;
}

.relations-title {
  margin: 0 0 var(--crm-space-xs);
  font-size: var(--crm-font-size-2xl);
  font-weight: var(--crm-font-weight-strong);
  color: var(--crm-color-text);
}

.relations-hint {
  margin: 0 0 var(--crm-space-lg);
  font-size: var(--crm-font-size-base);
  color: var(--crm-color-text-tertiary);
}

.relations-tabs {
  display: flex;
  gap: var(--crm-space-xs);
  margin-bottom: var(--crm-space-md);
}

/** 页签＝同一控件的两种状态，不靠加粗堆层级（与外壳导航同款样式） */
.relations-tab {
  height: 32px;
  padding: 0 var(--crm-space-md);
  font-size: var(--crm-font-size-base);
  color: var(--crm-color-text-secondary);
  background: var(--crm-color-bg-container);
  border: var(--crm-border-width) solid var(--crm-color-border-secondary);
  border-radius: var(--crm-radius-sm);
  cursor: pointer;
}

.relations-tab.is-active {
  color: var(--crm-color-primary);
  border-color: var(--crm-color-primary);
  background: var(--crm-color-primary-bg);
}

/** 筛选栏：视图 seg ＋ 紧迫档 chip（→ 设计规范 §4.2 单行 inline、控件高统一、高频筛选项 ≤5） */
.relations-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--crm-space-xs);
  margin-bottom: var(--crm-space-md);
}

.relations-filter-label {
  margin-left: var(--crm-space-sm);
  font-size: var(--crm-font-size-xs);
  color: var(--crm-color-text-tertiary);
}

.relations-filter-label:first-child {
  margin-left: 0;
}

/** chip 与页签**同一族视觉**（选中＝主色描边 ＋ 浅底），不为一处控件新造一套 */
.relations-chip {
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

.relations-chip.is-active {
  color: var(--crm-color-primary);
  border-color: var(--crm-color-primary);
  background: var(--crm-color-primary-bg);
}

/** 批量动作条：同类操作聚成一条、只勾选后才出现（→ 设计规范 §4.4） */
.relations-bulk {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--crm-space-xs);
  padding: var(--crm-space-xs) var(--crm-space-sm);
  margin-bottom: var(--crm-space-md);
  background: var(--crm-color-primary-bg);
  border: var(--crm-border-width) solid var(--crm-color-primary);
  border-radius: var(--crm-radius-sm);
}

.relations-bulk-count {
  font-size: var(--crm-font-size-base);
  font-weight: var(--crm-font-weight-strong);
  color: var(--crm-color-primary);
}

.relations-bulk-hint {
  font-size: var(--crm-font-size-xs);
  color: var(--crm-color-text-secondary);
}

/** 错误态：§4.6「错误文案红 12px」（与登录页 / 建档页同一形态） */
.relations-error {
  margin: 0 0 var(--crm-space-sm);
  font-size: var(--crm-font-size-xs);
  color: var(--crm-color-error);
}

/** 可点实体（→ README §九 不变量⑥「任何位置出现都可点开」，与链接同色、不加下划线噪音） */
.relations-link {
  color: var(--crm-color-primary);
}

/** 掉海警示（→ 前端文档 §5 页 5「到期当天掉公海⚠」）：**只有到期当天 / 已过期**才标红 */
.relations-drop-urgent {
  font-weight: var(--crm-font-weight-strong);
  color: var(--crm-color-error);
}

/** 状态＝圆点 ＋ 文字（→ 设计规范 §4.4） */
.relations-urgency {
  display: inline-flex;
  align-items: center;
  gap: var(--crm-space-xxs);
}

.relations-dot {
  width: 8px;
  height: 8px;
  border-radius: var(--crm-radius-pill);
}

.drawer-section {
  margin: var(--crm-space-lg) 0 var(--crm-space-sm);
  font-size: var(--crm-font-size-lg);
  font-weight: var(--crm-font-weight-strong);
  color: var(--crm-color-text);
}

.drawer-section:first-of-type {
  margin-top: 0;
}

.drawer-form {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--crm-space-sm);
  margin-bottom: var(--crm-space-md);
}

/** 原生日期输入：与 antd 输入框视觉对齐（不为一处小控件再引一个日期组件） */
.drawer-date {
  height: 32px;
  padding: 0 var(--crm-space-xs);
  font-size: var(--crm-font-size-base);
  color: var(--crm-color-text);
  background: var(--crm-color-bg-container);
  border: var(--crm-border-width) solid var(--crm-color-border-secondary);
  border-radius: var(--crm-radius-sm);
}
</style>
