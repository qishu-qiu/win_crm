import { homeNameOf } from './home'

/**
 * 角色 × 页面可见性（M6-10）—— 本项目「谁看得到哪个页面」的**唯一落点**。
 *
 * 口径来源（★ 真相源，勿自造）：《销售CRM前端页面与交互文档》
 *   · §4.2「角色 × 页面可见性矩阵」：✅ 全功能 ｜ 🔒 受限 ｜ ➖ 不显示；
 *   · §4.2 落地规则 4：「菜单与按钮可见性由 **role ＋ `permission_matrix`** 决定；
 *     **不可见的页面不下发路由**（不是"显示了再禁用"），越权访问返回 403」。
 *
 * ★ 为什么这里只看 `role`、不看 `permission_matrix`：
 *   `GET /account/me` 回的 `permissions` 只有 3 个 key（`contact_phone` /
 *   `relation_timeline` / `contract_amount`），**全是"越出本分范围时的数据可见档"**
 *   （→《数据架构文档》A6、《废止口径登记表》#31）——**不是菜单权限**。
 *   把它们当菜单开关＝造出一张无人消费的矩阵。
 *
 * ★ 只登记**已建成的页面**（工作台 / 建档 / 业务关系列表与详情 / 联系人档案 / 外观设置）：
 *   §五 页面清单的其余 24 页属后续里程碑，不在这里预写规则（写了也没有消费者）——
 *   与 M6-05「不注册空路由」同款做法。加页面时**在这里扩一行**，不要在页面 / 守卫里
 *   另写一套判断（那是第二套真相源）。
 *
 * ★ `readonly`（🔒）本轮**只登记、不消费**：M6-10 只做**页面级**（路由 ＋ 导航）收敛，
 *   按钮级写入口随各页面后续统一收（2026-09-18 七叔拍板 P-02）。理由：前端不许自判业务
 *   规则（M6-09 口径 4）——「能不能写」的数据侧判定由内核数据范围承担，而 `serving` 档
 *   现按 `self` 收敛（→《欠账登记表》D-01），前端再判一遍必然分叉。
 */

/** 内置角色码（→《数据架构文档》A4；内置 6 条不可删） */
export type RoleCode = 'sale' | 'service' | 'delivery' | 'dept_manager' | 'gm' | 'admin'

/** 已建页面的键（与 §五 页面清单的编号对应关系写在下方各行注释里） */
export type PageKey =
  | 'workbench'
  | 'entry'
  | 'relations'
  | 'relationDetail'
  | 'contacts'
  | 'appearance'

/** ✅ 全功能 ｜ 🔒 受限（只读 / 个人范围）｜ ➖ 不显示 */
export type PageAccess = 'full' | 'readonly' | 'hidden'

/** 矩阵里「交付 / 客服」同列（两角色码权限一致，→ 前端文档 §4.2 表头注） */
const RELATION_PAGE_ROW: Record<RoleCode, PageAccess> = {
  sale: 'full',
  service: 'readonly',
  delivery: 'readonly',
  dept_manager: 'full',
  gm: 'full',
  admin: 'readonly',
}

/** 逐行抄自 §4.2 矩阵（已建页面那 5 行；每行注释＝矩阵里对应的「页面」格） */
const ACCESS: Record<PageKey, Record<RoleCode, PageAccess>> = {
  // 工作台：销售 ✅ ｜ 交付 / 客服 ✅ ｜ 经理 ✅ ｜ 总经理 ✅ ｜ 管理员 ➖
  workbench: {
    sale: 'full',
    service: 'full',
    delivery: 'full',
    dept_manager: 'full',
    gm: 'full',
    admin: 'hidden',
  },
  // 录入客户：销售 ✅ ｜ 交付 / 客服 ➖ ｜ 经理 ✅ ｜ 总经理 ✅ ｜ 管理员 ➖
  entry: {
    sale: 'full',
    service: 'hidden',
    delivery: 'hidden',
    dept_manager: 'full',
    gm: 'full',
    admin: 'hidden',
  },
  // 业务关系（列表 / 详情）：销售 ✅ ｜ 交付 / 客服 🔒 ｜ 经理 ✅ ｜ 总经理 ✅ ｜ 管理员 🔒
  relations: RELATION_PAGE_ROW,
  relationDetail: RELATION_PAGE_ROW,
  // 公司档案 / 联系人档案：销售 ✅ ｜ 交付 / 客服 🔒 ｜ 经理 ✅ ｜ 总经理 ✅ ｜ 管理员 🔒
  contacts: RELATION_PAGE_ROW,
  // 个人中心 / 外观设置（§五 页 28）：矩阵那一行是「登录 / 消息中心 / 个人中心」＝ 5 类角色全 ✅
  // ⚠ 它**不进 `NAV_ITEMS`**：§4.1 把它挂在「顶部头像菜单」，不是一级菜单 ——
  //   塞进导航会凭空多出一项、打乱 §4.1 的一级菜单顺序（→ 欠账 D-36）。
  appearance: {
    sale: 'full',
    service: 'full',
    delivery: 'full',
    dept_manager: 'full',
    gm: 'full',
    admin: 'full',
  },
}

/** 内置角色码清单（用于识别未知 / 自定义码） */
const BUILTIN_ROLES: readonly string[] = ['sale', 'service', 'delivery', 'dept_manager', 'gm', 'admin']

/**
 * 未知 / 自定义角色码的兜底：**只给工作台**，其余一律不见。
 *
 * ★ 这是**防御性兜底、不是业务口径** —— §4.2 矩阵只列了内置 5 类角色；真出现自定义角色，
 *   必须**先回填矩阵**再在这里放开（不许由实现反过来定义契约）。
 * ★ 给「工作台」而不是全隐藏：工作台＝**本人的今日动线**（数据侧按 `self` 收敛，后端兜底），
 *   兜底掉不至于把人锁在空壳里 —— 与 `home.ts`「未知角色回落最中性页面」同一风格。
 */
function accessOfUnknownRole(page: PageKey): PageAccess {
  return page === 'workbench' ? 'full' : 'hidden'
}

/** 取某角色对某页面的档位（✅ / 🔒 / ➖） */
export function pageAccessOf(role: string, page: PageKey): PageAccess {
  if (!BUILTIN_ROLES.includes(role)) return accessOfUnknownRole(page)
  return ACCESS[page][role as RoleCode]
}

/** 该页面是否对该角色可见（`➖` 即不可见 —— 路由与导航据此下发） */
export function isPageVisible(role: string, page: PageKey): boolean {
  return pageAccessOf(role, page) !== 'hidden'
}

/** 顶栏导航项（顺序沿用现行顶栏；**只下发对本人可见的项**） */
const NAV_ITEMS: ReadonlyArray<{ page: PageKey; path: string; label?: string }> = [
  // 工作台的名字按角色不同（销售＝工作台 / 交付·客服＝工作台（工单待办版）…），故不写死
  { page: 'workbench', path: '/' },
  { page: 'entry', path: '/entry', label: '建档' },
  { page: 'relations', path: '/relations', label: '业务关系' },
  { page: 'contacts', path: '/contacts', label: '联系人' },
]

export interface NavItem {
  path: string
  label: string
}

/** 该角色的导航项（不可见者**不下发**，不是"显示了再禁用"） */
export function navItemsOf(role: string): NavItem[] {
  return NAV_ITEMS.filter((item) => isPageVisible(role, item.page)).map((item) => ({
    path: item.path,
    label: item.label ?? homeNameOf(role),
  }))
}

/**
 * 该角色登录 / 越权后的落点 ＝ **第一个可见的导航项**。
 *
 * ★ 为什么不用 §4.1 的「主入口」列：那是**目标形态**（经理 / 总经理＝数据看板、管理员＝组织
 *   架构），而这三页尚属后续里程碑 —— 直接跳过去就是**假入口**。故本函数只在下发出去的页面
 *   里取第一个；等数据看板 / 组织架构建成后，把主入口接进这张表即可（一处改）。
 */
export function firstVisiblePathOf(role: string): string {
  return navItemsOf(role)[0]?.path ?? '/'
}
