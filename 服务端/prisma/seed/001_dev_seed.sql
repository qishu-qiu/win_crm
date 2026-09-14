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
--   │ product_line           │ ⚠ 规格只说「7 条线各一色」，**未给名称清单**  │
--   │                        │ ⚠ DEV 占位，业务确认后必须替换                │
--   ├────────────────────────┼──────────────────────────────────────────────┤
--   │ permission_matrix      │ ⚠⚠ 规格**只给了 3 个 perm_key 举例**         │
--   │ （level 取值）         │ （cross_dept_private/contract_amount/         │
--   │                        │   phone_unlock），**未给出 level 矩阵**        │
--   │                        │ ⚠⚠ 本文件 level **一律取最保守的 denied**，   │
--   │                        │    只为让接口有数据可返回（验证 JSON/合并逻辑）│
--   │                        │    **绝不代表最终口径** —— M5 脱敏实现前       │
--   │                        │    必须由七叔按需求 §4.3 定这张表。            │
--   └────────────────────────┴──────────────────────────────────────────────┘
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
INSERT INTO product_line (id, name, code, dept_ids, service_cycle_days, status, created_at, updated_at) VALUES
  (1, '网站建设',   'website',  '[2,3]', 30, 'active', NOW(), NOW()),
  (2, '小程序开发', 'miniapp',  '[2,3]', 45, 'active', NOW(), NOW()),
  (3, '代运营',     'operation','[3]',   90, 'active', NOW(), NOW());

-- ---------------------------------------------------------------------------
-- 4) employee：6 个验证账号
--    初始密码统一 `Dev@123456`（由 `domain/password.ts` 同参数算法生成，非手写）
--    status='active' / deleted_at=NULL → 才能通过 `requireActiveEmployee`
-- ---------------------------------------------------------------------------
INSERT INTO employee (
  id, work_no, name, phone, password_hash, primary_dept_id,
  extra_dept_ids, product_line_ids, direct_manager_id, status, created_at, updated_at
) VALUES
  (1, 'E001', '陈志远', '13800000001',
   'scrypt$16384$8$1$caPOsotz7YAhGQKZSRpc8w==$7bjHg30nAnppdhkJ2C6tDBTNZXVXXVMLbOr7ngZN2I3MKkp2x4B397nPbgQXlZNvrWbZInNHj+0RPUbi5bRAYQ==',
   1, NULL,  '[1,2,3]', NULL, 'active', NOW(), NOW()),
  (2, 'E002', '刘敏',   '13800000002',
   'scrypt$16384$8$1$xygeVrVqtScTvKsAOIjNMw==$4rFVhqfzskxqyHhkCAbiK6f/GQmK8HT0AUQbW8KCRjCF2hwc42DotBggLc48xp5jjRcX03mVQP5Q9LIZ6LnKVw==',
   2, '[3]',  '[1,2]',   1,    'active', NOW(), NOW()),
  (3, 'E003', '王海涛', '13800000003',
   'scrypt$16384$8$1$QHHQu2tV/x0589MoMR39jw==$FyppTDelr5FBxceQP9z9GpqLiFY3Nyqb/xcy2Z4OSJBqSVRtwINSeoTPrvtBH60LjuhL9Icwgxk1eeieSYXXGg==',
   2, NULL,  '[1,2]',   2,    'active', NOW(), NOW()),
  (4, 'E004', '赵晓雯', '13800000004',
   'scrypt$16384$8$1$uUrMzZZCpiL4e3mNfp5mDA==$nvl1sYqQU4leqy3CScXdptw09w2I8HlK/zG07ktNNC8ma4un4RVE7Fb9OLbriPcpa9ar0nD1tQb2R/BKM/m4Rw==',
   4, NULL,  '[1]',     1,    'active', NOW(), NOW()),
  (5, 'E005', '孙立国', '13800000005',
   'scrypt$16384$8$1$VAIBMGVBBXhAiTSWzkjpRw==$U/Ss7FV1Mk3feUw8+IyuNAptPJUz16qy1XJMYeSZuui/eCFDmfDSCGeleO7uGDruhj/gDdFEeVk7JZk1ajIZNw==',
   5, NULL,  '[3]',     1,    'active', NOW(), NOW()),
  (6, 'E006', '周静',   '13800000006',
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
-- 7) permission_matrix：⚠⚠ level 一律 denied（保守占位，非最终口径，见文件头）
--    perm_key 只用规格**明确举例**的 3 个，不自造新的。
-- ---------------------------------------------------------------------------
INSERT INTO permission_matrix (perm_key, role_code, level, created_at, updated_at) VALUES
  ('contract_amount',      'sale',         'denied', NOW(), NOW()),
  ('contract_amount',      'service',      'denied', NOW(), NOW()),
  ('contract_amount',      'delivery',     'denied', NOW(), NOW()),
  ('contract_amount',      'admin',        'denied', NOW(), NOW()),
  ('contract_amount',      'dept_manager', 'denied', NOW(), NOW()),
  ('contract_amount',      'gm',           'denied', NOW(), NOW()),
  ('cross_dept_private',   'sale',         'denied', NOW(), NOW()),
  ('cross_dept_private',   'service',      'denied', NOW(), NOW()),
  ('cross_dept_private',   'delivery',     'denied', NOW(), NOW()),
  ('cross_dept_private',   'admin',        'denied', NOW(), NOW()),
  ('cross_dept_private',   'dept_manager', 'denied', NOW(), NOW()),
  ('cross_dept_private',   'gm',           'denied', NOW(), NOW()),
  ('phone_unlock',         'sale',         'denied', NOW(), NOW()),
  ('phone_unlock',         'service',      'denied', NOW(), NOW()),
  ('phone_unlock',         'delivery',     'denied', NOW(), NOW()),
  ('phone_unlock',         'admin',        'denied', NOW(), NOW()),
  ('phone_unlock',         'dept_manager', 'denied', NOW(), NOW()),
  ('phone_unlock',         'gm',           'denied', NOW(), NOW());

SET FOREIGN_KEY_CHECKS = 1;

-- ---------------------------------------------------------------------------
-- 8) 一致性自检（执行后**逐条看结果**，任何一条异常都必须停下来排查）
--    Q1 行数基线：role=6 department=5 product_line=3 employee=6
--                employee_role=7 dept_manager=2 permission_matrix=18
--    Q2 role.code 与 `BUILTIN_ROLE_CODES` 是否同一个集合
--    Q3 悬空引用：employee_role / permission_matrix / dept_manager / 部门 / 上级
--    Q4 登录可用性：6 人均为 active、未删、都有角色、哈希格式正确
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

SELECT 'Q4 可登录账号' AS chk, e.work_no, e.name, e.phone, e.status,
       COUNT(er.role_code) AS role_cnt,
       (e.password_hash LIKE 'scrypt$16384$8$1$%' AND LENGTH(e.password_hash) > 100) AS hash_ok
  FROM employee e LEFT JOIN employee_role er ON er.employee_id = e.id
 WHERE e.deleted_at IS NULL
 GROUP BY e.id, e.work_no, e.name, e.phone, e.status, e.password_hash
 ORDER BY e.id;

-- =============================================================================
-- 执行方式（在 `服务端/` 目录下）：
--   & 'D:\ITtool\phpstudy_pro\Extensions\MySQL8.0.12\bin\mysql.exe' -uroot -p123456 --default-character-set=utf8mb4 win_crm < prisma\seed\001_dev_seed.sql
-- ⚠ 带 `--default-character-set=utf8mb4` 是为**避免中文乱码**（'销售一部' 等）；
--    本机客户端默认字符集未核实，故显式指定最稳。
-- ⚠ 本文件是**多语句**脚本。是否已验证 `prisma db execute` 能跑它 —— **未验证**；
--    若要改用该命令，请先自行试跑并核对文末自检输出，别默认它等价。
-- =============================================================================
