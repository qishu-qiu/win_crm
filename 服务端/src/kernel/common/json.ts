// =============================================================================
// JSON 列拉直（M6-15 上收 kernel）
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM数据架构文档》：MySQL 的 JSON 列（A2 `employee.nav_open`、B3 `contact.tags`）
//     **不保证**元素形状 —— 手工 INSERT / 历史迁移都可能写进数字 / null / 嵌套对象。
//   · 《销售CRM架构设计说明》§5.4：kernel **零业务依赖、谁都能用** ——
//     本文件**只做形状收敛，不含任何业务判定**（哪些值有意义，由各域自己决定）。
//
// ★ 为什么放在 kernel（2026-09-18）：这段逻辑原先只存在于 A 域 `org.repository.ts`
//   （给 `nav_open` 用）。B 域联系人详情要拉直 `contact.tags` 时**没法 import 它** ——
//   「跨域直连对方的 repository」被 ESLint 硬卡（架构 §5.4）。两份实现迟早分叉，
//   故按「通用能力上收 kernel」合并成一份（**唯一落点**）。
// ⚠ 将来还有别的 JSON 列形状（如 B 域的 `extra_phones` = `{type,number,note?}[]`）时，
//   **不要**把带业务形状的解析器塞进本文件 —— 那会让 kernel 认识业务字段；
//   形状专属的解析器留在拥有该表的域里。
// =============================================================================

/**
 * JSON 列 → `string[]`：**非字符串元素一律丢弃、空白项丢弃、保序去重**。
 *
 * ★ 为什么不写 `value as string[]`：脏数据不该把 `/account/me`（`nav_open`）或
 *   联系人详情（`tags`）打成 500 —— 宁可少还原一个元素，也不让一行脏 JSON 掀翻接口。
 * ★ 为什么丢空白项：`" "` / `""` 这类值在前端会被当成"一个不存在的分组 / 一个空标签"，
 *   是纯噪音（A 域原实现只挡 `""`，上收时统一收紧到 `trim()` —— 对两处调用方都是净改善）。
 * ★ 为什么去重：两处调用方要的都是**集合语义**，重复项只会让前端状态越攒越大
 *   （`openKeys` 越开越长 / 同一标签渲染两遍）。
 */
export function parseStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter((item): item is string => typeof item === 'string' && item.trim() !== ''),
    ),
  ];
}
