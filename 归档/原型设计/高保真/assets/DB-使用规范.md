# 数据层使用规范（工人必读）

> 你在把销售 CRM 高保真原型页面的**硬编码演示数据**替换为共享数据层渲染。先读本文件，再读你自己负责的页面，最后动手。

## 架构（已就绪，不要改这些文件）
- **唯一数据源**：`D:\WorkBuddy\销售标准管理\原型设计\高保真\assets\db\` 五个文件
  - `01-dict.js`：`window.DB.dict` —— stages(6步) / urgency(5档) / valueLevel / riskTags / coopTags / companyIdentityTags / companyPolicyTags / decisionChain / contactTraits / relationStatus / attitude / progress / decisionRole / seaStatus / followMethod / customerLevels / lostReason / seaReason / approvalType / woPriority
  - `02-org.js`：`window.DB.org` —— departments / productLines / employees / roles / permissionMatrix / currentUser（当前登录人=赵总·总经理）
  - `03-customer.js`：`window.DB.customer` —— companies（含画像 identityTagCodes/policyTagCodes/decisionChain/completeness/contactIds）/ contacts（含 traitCodes/personalTags/markedBy）/ profileMarks / traitMarks
  - `04-relation.js`：`window.DB.relation` —— relations（12条含2条公海）/ follows（6条跟单）/ appointments（8条）/ seaList / todayFollows / todayAppointments / suggestRules
  - `05-trade.js`：`window.DB.trade` —— dashboard / contracts / payments / workorders / ledger / approvals / notifications / funnel / urgencyStats / grayAlerts / seaReport / renewAlerts / slaStats
- **组装器** `assets\mock-data.js`：自动 `document.write` 加载 5 个 db 文件，暴露：
  - `window.CRM.data.xxx`：扁平 key（stages/urgency/…/depts/companies/contacts/relations/follows/appointments/seaList/contracts/workorders/approvals/notifications/funnel…）
  - `window.CRM.h.xxx`：渲染 helper
  - `window.CRM.db`：原始分域
  - 页面底部已注入 `<script src="../assets/mock-data.js"></script>` 与 `<script src="../assets/app.js"></script>`
- **全局交互** `assets\app.js`：行按钮按文本语义自动有反应（写跟进→开D1/跳工作台；详情→跳 relation-detail.html?id=xx；新增预约/改期/转交…→开对应弹窗或 toast）。**按钮文字不要改**。

## 常用 helper（用这些生成 HTML，别手写重复标签）
- `CRM.h.esc(s)` 转义；`CRM.h.money(n)` ¥千分位；`CRM.h.stageName(id)` 阶段名
- `CRM.h.empName(id)` / `empAv(id)` / `deptName(id)` / `plName(id)` 反查名字
- `CRM.h.urgencyChip(code)` 紧迫 chip（周重点红…灰度灰）
- `CRM.h.valueChip(code)` 价值 chip（高/中/低/待定灰）
- `CRM.h.riskChips(['lost_signal'])` 风险 chip（⚙只读灰）；`CRM.h.coopChips(['need_visit'])` 协同 chip；`CRM.h.traitChips(['price_sensitive'])` 谈判特质 chip
- `CRM.h.statusDot('intent')` 状态点+名；`CRM.h.followColumn(rel)` 跟进列（紧迫+价值+风险）
- `CRM.h.personChip(name, 'av0', 'r-sales', '销售')` 人员芯片（name 为空显示 —）
- `CRM.h.stageSteps(currentId, true)` 6 步进度条

## 取数建议
- 渲染业务关系相关列表 → `CRM.data.relations`，可用 `r.ownerName`（冗余名）或 `CRM.h.empName(r.ownerId)`
- 公司/联系人 → `CRM.data.companies` / `contacts`；画像标签用 code 数组 + `CRM.data.companyIdentityTags` 等字典翻译 label
- 员工/部门/产品线下拉选项 → `CRM.data.employees` / `depts` / `productLines`
- 合同/工单/台账/审批/通知/报表 → `CRM.data.contracts / workorders / ledger / approvals / notifications / funnel …`
- 拿不到对应集合时可从 `CRM.db.<域>.<集合>` 取原始结构

## 约束
1. 只改你被分配的页面文件；**禁止**改 `assets/` 下任何文件、其它页面。
2. 保留页面骨架：sidebar/topbar/卡片标题/弹窗结构/Tab 结构；只替换"数据行/卡片内容/数值"为 DB 渲染。
3. 按钮文字原样保留（全局交互靠文本识别）。若某按钮需要显式跳转目标，可加 `data-jump="relation-detail.html?id=R1001"` 或 `data-dialog="弹窗id"`。
4. 新增代码一律中文注释标记 `// V2.5 数据层` 或 `<!-- V2.5 数据层 -->`。
5. 静态日期、明确的"输入中表单值"、演示常量（如分页大小 20）可保留但注明。
6. 空数据给 `暂无数据` 占位；不得出现 undefined/NaN 字样。
7. 人名一律来自 DB（employees/relations/companies），**不要**再写"张销售/李销售/王销售/陈销售/刘销售"这类占位名。
8. 顶栏登录人已由 app.js 统一渲染为 赵总·总经理，**不要**手动再改顶栏。

## 验收
- file:// 打开无 console 报错（自行用 node 做语法/最小 DOM 桩运行验证）
- 渲染出的公司名/人名/部门/产品线与其它页面同源一致
- 汇报时逐页说明：改了哪些区块、用了哪些字段、哪些静态内容刻意保留及原因
