# CODEBUDDY.md

> 本项目为**文档驱动（spec-driven）**的销售 CRM 系统：**真相源是文档，不是代码**。
> 本文件常驻上下文，**只放永久生效的项目规则**；状态快照 / 命令详解 / 踩坑复盘一律指针化，不在此复述。

## 0. 动工前必读（唯一指针层）

| 内容 | 唯一落点 |
| --- | --- |
| AI 行为硬约束 / 踩坑复盘 / 元规则 | `技术决策/AI协作铁律与踩坑复盘.md` |
| 当前进度 / 证据 / 缺口 / 下一步 | `过程产出/交接说明-M1（2026-09-14 窗口）.md` |
| 项目章程与全部对齐铁律 | `README.md`（根） |
| 已被推翻的旧口径 | `需求规格/废止口径登记表.md` |
| 数据落库口径（Prisma 7 / 生成列 / 分区 / 视图 / CHECK） | `服务端/prisma/README.md` |
| 5 份现行规格（需求 / 数据架构 / API / 前端交互 / 设计规范） | `需求规格/` |
| 代码结构 / 模块边界 / 进程 / 扩展 | `技术决策/销售CRM架构设计说明.md` |

**凡「写文件 / 装依赖 / 跑命令 / 调用有副作用工具」前，先读《AI协作铁律与踩坑复盘.md》**；新窗口开工先读交接说明。

## 1. 唯一真相源（最高优先级）

上游优于下游，**下游只写指针不复制**：
① 业务需求文档 → ② 数据架构文档 → ③ 接口 API 文档 → ④ 前端页面与交互文档 / 设计规范 → ⑤ 架构设计说明。

- 标「**索引·非规范**」的章节（速查表 / 总目录 / 追溯索引）**只作导航**，实现以正文为准。
- 需求 **§十六〈否决与后置清单〉是★规范级**：只有"表里没有"才代表"允许"；改文档时负面约束必须收全在该节。
- `归档/` 是被取代的旧内容，**不得作为实现依据**（`.ignore` 已让 ripgrep 默认跳过）。
- **变更联动铁律 L0**：需求一改 → 接口 / 前端 / 数据架构同批升版、进同一次 git 提交；下游不得自造业务规则。版本沿革**只存在于 git**。

## 2. 架构形态

模块化单体：**一个代码库、两个进程**（Web `main.ts` / Worker `worker.ts`，**Worker 全局只允许 1 个实例**）、MySQL 8 单库 ＋ Redis、7 个业务域一目录（`服务端/src/modules/`），边界用 ESLint `no-restricted-imports` 硬卡。

**域内四层（固定）**：
`*.controller.ts`（解析请求 → 调 1 个 service → 返回，不写判断、不碰 Prisma）→ `*.service.ts`（编排 / `$transaction` / 发领域事件）→ `domain/`（**纯业务规则保险箱**：不 import `@nestjs/*`、不 import Prisma、不查库，假数据即可单测）→ `*.repository.ts`（**唯一允许 import Prisma 的地方**）。

## 3. 模块边界（只能依赖更低的层）

```
L0 kernel → L1 org(A) → L2 company(B) → L3 relation(C) → L4 engine(D)/trade(E)/sea(F)/approval(G)
```

- **同层禁止直接依赖**（D 不许 import E）；A 域不依赖任何业务域；`domain/**` 不 import 框架/Prisma。
- **跨域三条路**：① 要同步结果 → 调对方 exports 的 service（**禁止查对方的表**）；② 不等结果 → 发领域事件；③ 多表一致性 → **本域内** `$transaction`，**禁止跨域大事务**。

## 4. 横切层口径（收口处，详见架构说明 §7.2）

- **请求上下文**：守卫解析「我是谁 / 管哪些部门 / 角色 / 数据范围」，横切层**只读上下文、不查库**。
- **数据范围四档**：`all`（总经理/管理员；管理员另加只读 ＋ 每次查看写 `operation_log` ＋ 不解除金额脱敏）> `dept`（经理＝管辖部门）> `self`（销售＝本人 ∪ 有效协同人 ∪ 公海）> `serving`（交付/客服＝仅合同服务期内客户，只读、不进公海）。一人多角色**取更宽的一档**；**禁止在 repository 手写 `where owner_id = ...`**。
- **脱敏**：出口统一渲染，详见需求 §8 与《废止口径登记表》#30。要点：**联系方式不按角色分档**——详情给全号、列表/卡片给 `phone_masked`；owner 上锁时非 owner 只见 `phone_locked`；**报表 / 看板 / 汇总出口不脱敏**。
- **审计**：敏感动作在**业务事务内**写 `operation_log`，随业务回滚。
- **异常映射**：唯一冲突认 Prisma **`P2002`**（不是 MySQL 1062）→ 409/422（分档与约束名取值 → `服务端/prisma/README.md §七`）。

## 5. 数据层硬口径

- **Prisma 7.10.0**：① 连接串只写在 `服务端/prisma.config.ts`；② `.env` 不再自动加载（故 prisma 命令**一律在 `服务端/` 内执行**）；③ 运行时 `PrismaClient` 必传 driver adapter。
- **已废弃 / 严禁**：重生成或改动 `migrations/0001_init`（已 `resolve --applied` 登记为基线，改了就与 `_prisma_migrations` 校验和不一致），变更一律**新增量 migration**；`migrate diff` 的输出**只作核对、绝不能直接执行**（会把分区表主键 / 生成列唯一索引生成成 DROP）。完整说明见 `服务端/prisma/README.md`。
- **命名**：表/字段 `snake_case`；主键 `BigInt @db.UnsignedBigInt`；金额 `Decimal(12,2)`；索引 `idx_` / `uk_`；审计字段统一 `created_by/at`、`updated_by/at`；逻辑删除 `deleted_at`。
- **枚举一律 String（VARCHAR(32) 英文码）**，文案走字典 `dict_item`，**不用 DB ENUM**。
- **表达不了就用 `$queryRaw` ＋ `Prisma.sql`**（复杂查询 / 报表 / 递归 CTE），不为迁就 Client API 牺牲 SQL。

## 6. 业务模型速记

两层：**公司档案（＝公司公海，全公司唯一共享）＋ 业务关系（部门 × 产品线 × 销售，CRM 最小单元；掉公海＝没 owner 但部门不变）**。「部门公海」＝本部门关系集合，不是独立一层。工作流 **6 阶段**；客户等级按**部门维度**挂业务关系。

## 7. 高频坑（其余见《AI协作铁律与踩坑复盘.md》）

- ⚠ **`服务端/src/generated/`（Prisma Client）被 `.gitignore` 忽略**：改了 `schema.prisma` 必须显式 `npm run prisma:generate`（`npm run build` 会带跑），否则 `select` 新列直接编译报错。
- ⚠ **端口**：后端 **3000**，前端 dev **5173**；vite 只监听 `::1` → 探针用 `http://localhost:5173`（`127.0.0.1` 连不上）。
- ⚠ **入参 DTO 必须带 `@ApiProperty`**，否则 OpenAPI 退化为 `Record<string, never>`，`gen:types` 产出的前端类型不可用。

## 8. Git 约定

**本地单线，直接在 `main` 提交**（不切 feat/dev）。一个独立阶段一次提交，提交信息写清「改了什么 / 为什么 / 联动哪几份文档」；提交即还原点。**改文档必须提交**，否则版本沿革断档。多人并行时**严禁 `git add -A` / `git add .` / `git commit -a`**，只显式 add 本轮自己动过的路径。

## 9. 常用命令（速记，详解见各自文档）

```bash
# 在 服务端/ 内
npm run prisma:validate | prisma:format | prisma:status | prisma:deploy
npm run prisma:generate          # 改 schema.prisma 后必跑
npm run lint                     # 含模块边界硬卡，提交前必跑
npm test [-- <文件 | -t 名称>]   # domain/ 层用假数据单测即可，无需真库
npm run start:web | start:worker # Worker 全局只能 1 个
npm run gen:types                # 需后端在线：OpenAPI → 前端/src/api/types.ts
# 在 前端/ 内
npm run dev                      # 5173，/api 代理到 3000
npm run build                    # vue-tsc 类型检查 + 打包
```

**禁止手写对接、禁止前后端各维护一份接口类型**（双真相源是 AI 出错重灾区）。

## 10. 技能路由（强制，命中即先 `use_skill`）

| 场景 | 技能 |
| --- | --- |
| 开发计划 / 排期 / 迭代 / 需求文档转开发方案 / PRD / 任务拆解 / 代码评审 / 上线发版 | `生产级工程生命周期技能` |
| 测试用例 / 用例设计 / 测试计划 / 用例覆盖 | `测试用例设计` |
| 初始化项目 / 新建工作台 / 六件套 | `MASTER万能工作台` |

本项目「生成开发计划」属 `生产级工程生命周期技能` 的 Define→Plan 阶段，**不得**用 IDE 自带 Plan 能力绕过。
