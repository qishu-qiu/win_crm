// =============================================================================
// 个人偏好入参 DTO（2026-09-18 · D-37 / D-36⑥ / D-41）—— `PUT /account/preferences`
//
// 口径来源（★ 真相源，勿自造）：
//   · 《销售CRM接口API文档》§4.14.9 / §5.2：`PUT /account/preferences`
//     —— 「个人主题（**`light` 白天 / `dark` 夜间**，V1 两态；A/B/C 风格后置）……**存账号**」。
//   · 《销售CRM业务需求文档》§13.4：「全局框架规范」要求侧栏**折叠状态按账号持久化**
//     —— 业务需求已明文，此前只是**没有落点**（数据架构缺列），故由本批补（migration 0009）。
//   · 《销售CRM设计规范》§八.1：入口在页 28（`/me/appearance`），公司只锁**默认值**、全员可自由切。
//
// ★ 为什么字段**全部可选**（`?`）：这是一个**部分更新**端点 —— 前端「只切主题」不该被迫
//   把侧栏展开状态一起传回来（传回来就意味着前端得先知道旧值，多一次往返、也多一处能写错）。
//   *没给的键一律原样保留*（→ `OrgRepository.updateEmployeePreferences`）。
//
// ★ 为什么 `theme` 用 `@IsIn(['light','dark'])` 而**不是** TS 枚举：本项目「枚举一律英文码」
//   （`CODEBUDDY.md §5`），码值写在规格里；这里只是把它变成一道 400 的门，不新造类型系统。
//
// ★ 为什么 `nav_open` 要限长：它是**客户端可控数组**，不限长就是一个"随便塞百万个键"的写入口
//   （JSON 列写进去，之后每次 `/account/me` 都要把它读出来下发）。分组数是**有上限的**
//   （`access.ts` 的 `NAV_GROUPS` 当前 15 组以内），64 已是宽松的两倍余量。
//
// ★ 为什么入参 DTO 必须写 `@ApiProperty`：不写，Swagger 会把它生成为**空对象**
//   （前端生成物里变成 `Record<string, never>`），前端类型等于不可用 → 被迫手写对接
//   （违反 M0-57「禁止手写对接」，→ `login.dto.ts` 同类注释）。
// =============================================================================
import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/** 主题码（＝设计规范 §八 的两套 / 接口 §4.14.9 的取值；**V1 两态**） */
export const THEME_CODES = ['light', 'dark'] as const;

export class UpdatePreferencesDto {
  /**
   * 个人主题。**不给 = 不改**（不是"改回默认"）——
   * 「从未设置」与「显式选了白天」在库里是两件事（`theme` 可空，→ migration 0009）。
   */
  @ApiProperty({
    enum: THEME_CODES,
    required: false,
    description:
      '个人主题：`light` 白天 / `dark` 夜间（V1 两态）。**不传该键 = 不改**（部分更新）；' +
      '清空设置本轮**不提供**（前端永远有一个明确的选中态）',
    example: 'dark',
  })
  @IsOptional()
  @IsIn(THEME_CODES, { message: `theme 只能是 ${THEME_CODES.join(' / ')}` })
  theme?: 'light' | 'dark';

  /**
   * 侧栏展开的分组键集合（→ 需求 §13.4「折叠状态按账号持久化」）。
   * 存的是 `access.ts` 的分组 key，**服务端不理解它的含义**（不校验取值，只存键）。
   */
  @ApiProperty({
    type: [String],
    required: false,
    description:
      '侧栏展开的分组键集合（→ 需求 §13.4）。**不传该键 = 不改**（部分更新）；' +
      '传空数组 = 用户手动全部收起（与「从未设置过」不同，后者库里是 `null`）',
    example: ['relation'],
  })
  @IsOptional()
  @IsArray({ message: 'nav_open 必须是数组' })
  @ArrayMaxSize(64, { message: 'nav_open 最多 64 项' })
  @IsString({ each: true, message: 'nav_open 的每一项必须是字符串' })
  @MaxLength(64, { each: true, message: 'nav_open 的每一项最长 64 位' })
  nav_open?: string[];
}
