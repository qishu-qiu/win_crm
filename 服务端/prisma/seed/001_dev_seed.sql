-- =============================================================================
-- 开发验证种子（DEV SEED）—— 仅供开发/联调阶段使用，**不是**正式业务数据
--
-- 建立：2026-09-14（M1 阶段）  库：win_crm（MySQL 8.0.12）
-- 执行：见文末「执行方式」。本文件**幂等**（先清后插，可反复跑）。
--
-- ★ 口径来源与「已确认 / 未确认」分级（这是本文件最重要的部分，改数据前先读）：
--   ┌────────────────────────┬──────────────────────────────────────────────┐
--   │ 数据                   │ 依据                                          │
--   ├────────────────────────┼──────────────────────────────────────────────┤
--   │ role 6 条 code         │ 数据架构 A4「内置 6 条」＋代码                 │
--   │                        │ `domain/data-scope.ts` BUILTIN_ROLE_CODES     │
--   │                        │ ✅ 已确认（两处严格一致，见文末自检 Q2）       │
--   ├────────────────────────┼──────────────────────────────────────────────┤
--   │ password_hash 格式     │ `domain/password.ts`                          │
--   │                        │ `scrypt$N$r$p$<saltB64>$<hashB64>`            │
--   │                        │ ✅ 已确认（由该模块同参数算法生成，非手写）    │
--   ├────────────────────────┼──────────────────────────────────────────────┤
--   │ department / employee  │ 无规格约束，DEV 自造（仅求自洽）               │
--   │ employee.username      │ ✅ 2026-09-14 七叔拍板：员工自定、可空、唯一    │
--   │                        │ （列由 migration `0003` 新增；本文件给 6 人补号）│
--   │ product_line           │ ⚠ 名称清单七叔已给，**本批未替换**（见文末 ★）  │
--   │                        │ ⚠ 且 `product_line` 表**没有 `color_key` 列**， │
--   │                        │   而接口 §5.3 / §5 实体引用却要求返回它        │
--   ├────────────────────────┼──────────────────────────────────────────────┤
--   │ permission_matrix      │ ✅ 2026-09-14 七叔拍板，**不再是占位**（见文末 ★）│
--   │ （3 key × 6 角色）     │   · contact_phone     全部 visible             │
--   │                        │   · relation_timeline 仅 admin/gm visible      │
--   │                        │   · contract_amount   仅 gm visible，其余 masked│
--   └────────────────────────┴──────────────────────────────────────────────┘
--
-- ★ 2026-09-14 口径变更（七叔拍板 · 本文件已按此更新）：
--   ① `employee.username`（migration `0003` 新增）：**员工自定、可空、唯一** →
--      下表 6 个账号已补账号名；登录＝**手机号 或 账号名 二选一 ＋ 密码**（共用同一 `password_hash`）。
--   ② `permission_matrix` 由「一律 denied 占位」升级为**正式口径**（3 key × 6 角色 ＝ 18 行）：
--        · `contact_phone`     → **全部 visible**（联系方式默认全可见；「锁」由
--          `contact.phone_locked_at / phone_locked_by` 单独管，**不进矩阵**）
--        · `relation_timeline` → 仅 `admin` / `gm` 为 visible，其余 denied（跨部门跟单全文互不可见）
--        · `contract_amount`   → 仅 `gm` 为 visible，其余 masked（跨部门金额脱敏）
--      旧 key `cross_dept_private`（看他人私海）/ `phone_unlock`（手机号解锁）**已废止**，不再写入。
--      ⚠ 矩阵是**角色级兜底档**：「经理**管辖内**可见」由**数据范围**承担，不走本表。
--   ③ `product_line` ✅ **2026-09-15 补 `color_key`**（migration `0004`）：需求 §13.3「产品线＝
--      全系统固定配色（7 条线各一色）」＋ 接口 §4.1 / §5.3 / §5.6 一直要求该字段，而本表原**漏落**
--      该列 ⇒ 数据架构 A7 同步补（升 V1.31）。**3 条占位线给了过渡色键**
--      （website=blue / miniapp=green / operation=orange）；⚠ 七叔的 **7 条正式线名称清单**
--      （法务 / 财税 / 招聘 / 房产 / 网站建设 / 短视频 / GEO推广）仍待拍板，
--      届时连同 7 个色键一并替换（**键名是色板槽位语义，换线不必然换键**）。
--   ④ `permission_matrix` 的**行数基线仍是 18**（3 key × 6 角色）—— 旧 key 换新 key，行数不变。
--
-- ⚠ 字段陷阱（真库实测，改本文件时必看）：
--   ① `updated_at` 是 `datetime NOT NULL` **且无默认值**（Prisma 的 @updatedAt 只
--      在 ORM 里生效）→ 裸 SQL 插入**必须显式给值**，否则严格模式下直接报错；
--   ② `employee_role.role_code` / `permission_matrix.role_code` 是**外键指向
--      `role.code`**（不是 id）→ role 必须先插入，且 code 必须与 A4 完全一致；
--   ③ `department.parent_id` 是 `bigint NOT NULL DEFAULT 0`（**无外键**）
--      → 顶级部门写 0，不要写 NULL；
--   ④ `operation_log` 是**按月分区**表（实测分区覆盖 p202609~p202712 + pmax），
--      当前月份有分区，审计写入不会失败 —— 本文件**不碰**该表。
--   ⑤ `employee.username` 是 **migration `0003`（2026-09-14）新增**列，**可空 + 唯一**：
--      库若仍停在 0002，本文件会报 `Unknown column 'username'` → 先 `npx prisma migrate deploy`。
-- =============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------------
-- 0) 清理（只清本文件会重建的 A 域表；按「子表 → 父表」顺序）
--    ⚠ 不要加 operation_log：它是只 INSERT/SELECT 的审计表（A10），且业务上禁止删。
-- ---------------------------------------------------------------------------
DELETE FROM permission_matrix;
DELETE FROM dept_manager;
DELETE FROM employee_role;
DELETE FROM employee;
DELETE FROM product_line;
DELETE FROM department;
DELETE FROM role;

-- ---------------------------------------------------------------------------
-- 1) role：内置 6 条（A4）。code 必须与 `domain/data-scope.ts` 逐字一致。
-- ---------------------------------------------------------------------------
INSERT INTO role (id, code, name, is_builtin, created_at, updated_at) VALUES
  (1, 'sale',         '销售',   1, NOW(), NOW()),
  (2, 'service',      '客服',   1, NOW(), NOW()),
  (3, 'delivery',     '交付',   1, NOW(), NOW()),
  (4, 'admin',        '管理员', 1, NOW(), NOW()),
  (5, 'dept_manager', '部门经理', 1, NOW(), NOW()),
  (6, 'gm',           '总经理', 1, NOW(), NOW());

-- ---------------------------------------------------------------------------
-- 2) department：parent_id=0 表示顶级（无外键，实测）。
-- ---------------------------------------------------------------------------
INSERT INTO department (id, name, parent_id, service_enabled, status, created_at, updated_at) VALUES
  (1, '总公司',   0, 1, 'active', NOW(), NOW()),
  (2, '销售一部', 1, 1, 'active', NOW(), NOW()),
  (3, '销售二部', 1, 1, 'active', NOW(), NOW()),
  (4, '客服部',   1, 1, 'active', NOW(), NOW()),
  (5, '交付部',   1, 1, 'active', NOW(), NOW());

-- ---------------------------------------------------------------------------
-- 3) product_line：⚠ DEV 占位（规格未给名称清单，只说「7 条线各一色」）
-- ---------------------------------------------------------------------------
INSERT INTO product_line (id, name, code, color_key, dept_ids, service_cycle_days, status, created_at, updated_at) VALUES
  (1, '网站建设',   'website',  'blue',   '[2,3]', 30, 'active', NOW(), NOW()),
  (2, '小程序开发', 'miniapp',  'green',  '[2,3]', 45, 'active', NOW(), NOW()),
  (3, '代运营',     'operation','orange', '[3]',   90, 'active', NOW(), NOW());

-- ---------------------------------------------------------------------------
-- 4) employee：6 个验证账号
--    初始密码统一 `Dev@123456`（由 `domain/password.ts` 同参数算法生成，非手写）
--    status='active' / deleted_at=NULL → 才能通过 `requireActiveEmployee`
--    `username`：2026-09-14 新增（migration `0003`）—— 员工自定、可空、唯一；
--               本表按姓名拼音起（**DEV 占位，可改**）；两种登录通道共用同一密码。
-- ---------------------------------------------------------------------------
INSERT INTO employee (
  id, work_no, name, phone, username, password_hash, primary_dept_id,
  extra_dept_ids, product_line_ids, direct_manager_id, status, created_at, updated_at
) VALUES
  (1, 'E001', '陈志远', '13800000001', 'chenzhiyuan',
   'scrypt$16384$8$1$caPOsotz7YAhGQKZSRpc8w==$7bjHg30nAnppdhkJ2C6tDBTNZXVXXVMLbOr7ngZN2I3MKkp2x4B397nPbgQXlZNvrWbZInNHj+0RPUbi5bRAYQ==',
   1, NULL,  '[1,2,3]', NULL, 'active', NOW(), NOW()),
  (2, 'E002', '刘敏',   '13800000002', 'liumin',
   'scrypt$16384$8$1$xygeVrVqtScTvKsAOIjNMw==$4rFVhqfzskxqyHhkCAbiK6f/GQmK8HT0AUQbW8KCRjCF2hwc42DotBggLc48xp5jjRcX03mVQP5Q9LIZ6LnKVw==',
   2, '[3]',  '[1,2]',   1,    'active', NOW(), NOW()),
  (3, 'E003', '王海涛', '13800000003', 'wanghaitao',
   'scrypt$16384$8$1$QHHQu2tV/x0589MoMR39jw==$FyppTDelr5FBxceQP9z9GpqLiFY3Nyqb/xcy2Z4OSJBqSVRtwINSeoTPrvtBH60LjuhL9Icwgxk1eeieSYXXGg==',
   2, NULL,  '[1,2]',   2,    'active', NOW(), NOW()),
  (4, 'E004', '赵晓雯', '13800000004', 'zhaoxiaowen',
   'scrypt$16384$8$1$uUrMzZZCpiL4e3mNfp5mDA==$nvl1sYqQU4leqy3CScXdptw09w2I8HlK/zG07ktNNC8ma4un4RVE7Fb9OLbriPcpa9ar0nD1tQb2R/BKM/m4Rw==',
   4, NULL,  '[1]',     1,    'active', NOW(), NOW()),
  (5, 'E005', '孙立国', '13800000005', 'sunliguo',
   'scrypt$16384$8$1$VAIBMGVBBXhAiTSWzkjpRw==$U/Ss7FV1Mk3feUw8+IyuNAptPJUz16qy1XJMYeSZuui/eCFDmfDSCGeleO7uGDruhj/gDdFEeVk7JZk1ajIZNw==',
   5, NULL,  '[3]',     1,    'active', NOW(), NOW()),
  (6, 'E006', '周静',   '13800000006', 'zhoujing',
   'scrypt$16384$8$1$Cv7GK4i8ZqJbGX98HZo1Eg==$9D0hhxTzQ7dukVIjpyiYrgz4ANYJwGUqp5o0V/HPFAW0oPVL+IdHE+9rWAnHXwvcN1ystU7t+wuajPy+jmR0Ag==',
   1, NULL,  NULL,      1,    'active', NOW(), NOW());

-- ---------------------------------------------------------------------------
-- 5) employee_role：role_code 是外键 → role.code
--    ★ 员工 3（王海涛）刻意给 **两个角色**（sale + delivery）：
--      用来真实验证 `mergePermissionLevels` 的多角色合并与 `resolvePrimaryRole`
--      （sale 优先级高于 delivery → 主角色应是 sale，数据范围应是 self）。
--      单测只覆盖纯函数，这里是**真库路径**的验证点。
-- ---------------------------------------------------------------------------
INSERT INTO employee_role (employee_id, role_code, created_at, updated_at) VALUES
  (1, 'gm',           NOW(), NOW()),
  (2, 'dept_manager', NOW(), NOW()),
  (3, 'sale',         NOW(), NOW()),
  (3, 'delivery',     NOW(), NOW()),
  (4, 'service',      NOW(), NOW()),
  (5, 'delivery',     NOW(), NOW()),
  (6, 'admin',        NOW(), NOW());

-- ---------------------------------------------------------------------------
-- 6) dept_manager：刘敏(E002) 管辖 销售一部(2) 与 销售二部(3)
--    → 其 deptIds = 所属{2} ∪ 管辖{2,3} = {2,3}（M1-10 `toRequestContext` 口径）
-- ---------------------------------------------------------------------------
INSERT INTO dept_manager (dept_id, employee_id, created_at, updated_at) VALUES
  (2, 2, NOW(), NOW()),
  (3, 2, NOW(), NOW());

-- ---------------------------------------------------------------------------
-- 7) permission_matrix：**2026-09-14 正式口径**（3 key × 6 角色 ＝ 18 行）
--    ⚠ 矩阵是「**越出本分范围**时的兜底档」（level：visible 原文 / masked 打码 / denied 不返回）；
--      「经理**管辖内**可见」「销售看**自己**的」都由**数据范围**承担，**不走本表**。
--    ⚠ 联系方式「锁」**不进矩阵** —— 它由 `contact.phone_locked_at / phone_locked_by` 单独管。
-- ---------------------------------------------------------------------------
INSERT INTO permission_matrix (perm_key, role_code, level, created_at, updated_at) VALUES
  -- ① 联系方式（详情）：**全部 visible** —— 2026-09-14 起号码默认全可见
  ('contact_phone',     'sale',         'visible', NOW(), NOW()),
  ('contact_phone',     'service',      'visible', NOW(), NOW()),
  ('contact_phone',     'delivery',     'visible', NOW(), NOW()),
  ('contact_phone',     'admin',        'visible', NOW(), NOW()),
  ('contact_phone',     'dept_manager', 'visible', NOW(), NOW()),
  ('contact_phone',     'gm',           'visible', NOW(), NOW()),
  -- ② 跨部门跟单全文：**仅 admin / gm visible**（销售/客服/交付/经理跨管辖 → 不可见）
  ('relation_timeline', 'sale',         'denied',  NOW(), NOW()),
  ('relation_timeline', 'service',      'denied',  NOW(), NOW()),
  ('relation_timeline', 'delivery',     'denied',  NOW(), NOW()),
  ('relation_timeline', 'admin',        'visible', NOW(), NOW()),
  ('relation_timeline', 'dept_manager', 'denied',  NOW(), NOW()),
  ('relation_timeline', 'gm',           'visible', NOW(), NOW()),
  -- ③ 跨部门合同金额：**仅 gm visible**，其余 masked（amount 置 null + amount_masked）
  ('contract_amount',   'sale',         'masked',  NOW(), NOW()),
  ('contract_amount',   'service',      'masked',  NOW(), NOW()),
  ('contract_amount',   'delivery',     'masked',  NOW(), NOW()),
  ('contract_amount',   'admin',        'masked',  NOW(), NOW()),
  ('contract_amount',   'dept_manager', 'masked',  NOW(), NOW()),
  ('contract_amount',   'gm',           'visible', NOW(), NOW());

SET FOREIGN_KEY_CHECKS = 1;

-- ---------------------------------------------------------------------------
-- 8) 一致性自检（执行后**逐条看结果**，任何一条异常都必须停下来排查）
--    Q1 行数基线：role=6 department=5 product_line=3 employee=6
--                employee_role=7 dept_manager=2 permission_matrix=18
--    Q2 role.code 与 `BUILTIN_ROLE_CODES` 是否同一个集合
--    Q3 悬空引用：employee_role / permission_matrix / dept_manager / 部门 / 上级
--    Q4 登录可用性：6 人均为 active、未删、都有角色、哈希格式正确、账号名齐备
--    Q5 矩阵：key 集合恰为 contact_phone / relation_timeline / contract_amount，每 key 6 行
-- ---------------------------------------------------------------------------
SELECT 'Q1 行数' AS chk, 'role' AS t, COUNT(*) AS n FROM role
UNION ALL SELECT 'Q1 行数', 'department', COUNT(*) FROM department
UNION ALL SELECT 'Q1 行数', 'product_line', COUNT(*) FROM product_line
UNION ALL SELECT 'Q1 行数', 'employee', COUNT(*) FROM employee
UNION ALL SELECT 'Q1 行数', 'employee_role', COUNT(*) FROM employee_role
UNION ALL SELECT 'Q1 行数', 'dept_manager', COUNT(*) FROM dept_manager
UNION ALL SELECT 'Q1 行数', 'permission_matrix', COUNT(*) FROM permission_matrix;

SELECT 'Q2 role码集合' AS chk, GROUP_CONCAT(code ORDER BY code) AS codes FROM role;

SELECT 'Q3-1 悬空role_code' AS chk, COUNT(*) AS n FROM employee_role er
  LEFT JOIN role r ON r.code = er.role_code WHERE r.id IS NULL
UNION ALL SELECT 'Q3-2 悬空perm_role', COUNT(*) FROM permission_matrix pm
  LEFT JOIN role r ON r.code = pm.role_code WHERE r.id IS NULL
UNION ALL SELECT 'Q3-3 悬空primary_dept', COUNT(*) FROM employee e
  LEFT JOIN department d ON d.id = e.primary_dept_id WHERE d.id IS NULL
UNION ALL SELECT 'Q3-4 悬空direct_manager', COUNT(*) FROM employee e
  LEFT JOIN department m ON m.id = e.direct_manager_id
  WHERE e.direct_manager_id IS NOT NULL AND m.id IS NULL
UNION ALL SELECT 'Q3-5 悬空dept_manager', COUNT(*) FROM dept_manager dm
  LEFT JOIN department d ON d.id = dm.dept_id
  LEFT JOIN employee e ON e.id = dm.employee_id
  WHERE d.id IS NULL OR e.id IS NULL
UNION ALL SELECT 'Q3-6 无角色员工', COUNT(*) FROM employee e
  WHERE NOT EXISTS (SELECT 1 FROM employee_role er WHERE er.employee_id = e.id);

SELECT 'Q4 可登录账号' AS chk, e.work_no, e.name, e.phone, e.username, e.status,
       COUNT(er.role_code) AS role_cnt,
       (e.password_hash LIKE 'scrypt$16384$8$1$%' AND LENGTH(e.password_hash) > 100) AS hash_ok
  FROM employee e LEFT JOIN employee_role er ON er.employee_id = e.id
 WHERE e.deleted_at IS NULL
 GROUP BY e.id, e.work_no, e.name, e.phone, e.username, e.status, e.password_hash
 ORDER BY e.id;

-- Q5 矩阵：key 集合与每 key 的取值分布（期望 3 个 key × 6 角色 ＝ 18 行）
SELECT 'Q5 矩阵key集合' AS chk, GROUP_CONCAT(DISTINCT perm_key ORDER BY perm_key) AS key_list
  FROM permission_matrix;
SELECT 'Q5 矩阵取值分布' AS chk, perm_key, level, COUNT(*) AS n
  FROM permission_matrix GROUP BY perm_key, level ORDER BY perm_key, level;

-- =============================================================================
-- 执行方式（在 `服务端/` 目录下）：
--   & 'D:\ITtool\phpstudy_pro\Extensions\MySQL8.0.12\bin\mysql.exe' -uroot -p123456 --default-character-set=utf8mb4 win_crm < prisma\seed\001_dev_seed.sql
-- ⚠ 带 `--default-character-set=utf8mb4` 是为**避免中文乱码**（'销售一部' 等）；
--    本机客户端默认字符集未核实，故显式指定最稳。
-- ⚠ 本文件是**多语句**脚本。是否已验证 `prisma db execute` 能跑它 —— **未验证**；
--    若要改用该命令，请先自行试跑并核对文末自检输出，别默认它等价。
-- =============================================================================
