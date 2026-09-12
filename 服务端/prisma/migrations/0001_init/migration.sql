-- CreateTable
CREATE TABLE `department` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
    `name` VARCHAR(100) NOT NULL COMMENT '部门名称',
    `parent_id` BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '上级部门 id（0=根）',
    `service_enabled` BOOLEAN NOT NULL DEFAULT false COMMENT '客服开关',
    `status` VARCHAR(32) NOT NULL DEFAULT 'active' COMMENT '状态：active 启用 / disabled 停用',
    `created_by` BIGINT UNSIGNED NULL COMMENT '创建人 id',
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0) COMMENT '创建时间',
    `updated_by` BIGINT UNSIGNED NULL COMMENT '更新人 id',
    `updated_at` DATETIME(0) NOT NULL COMMENT '更新时间',
    `deleted_at` DATETIME(0) NULL COMMENT '逻辑删除时间（NULL=未删）',

    INDEX `idx_parent_id`(`parent_id`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT='部门（组织树，parent_id 自引用）';

-- CreateTable
CREATE TABLE `employee` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
    `work_no` VARCHAR(32) NOT NULL COMMENT '工号（全局唯一）',
    `name` VARCHAR(50) NOT NULL COMMENT '姓名',
    `phone` VARCHAR(32) NOT NULL COMMENT '手机号（登录账号，全局唯一）',
    `password_hash` VARCHAR(255) NOT NULL COMMENT '密码哈希',
    `primary_dept_id` BIGINT UNSIGNED NOT NULL COMMENT '主部门 id',
    `extra_dept_ids` JSON NULL COMMENT '兼管部门 id 列表（JSON 数组）',
    `product_line_ids` JSON NULL COMMENT '可负责产品线 id 列表（JSON 数组）',
    `direct_manager_id` BIGINT UNSIGNED NULL COMMENT '直属经理 id（审批链）',
    `status` VARCHAR(32) NOT NULL DEFAULT 'active' COMMENT '状态：active 在职 / resigned 离职 / disabled 停用',
    `created_by` BIGINT UNSIGNED NULL COMMENT '创建人 id',
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0) COMMENT '创建时间',
    `updated_by` BIGINT UNSIGNED NULL COMMENT '更新人 id',
    `updated_at` DATETIME(0) NOT NULL COMMENT '更新时间',
    `deleted_at` DATETIME(0) NULL COMMENT '逻辑删除时间（NULL=未删）',

    UNIQUE INDEX `uk_work_no`(`work_no`),
    UNIQUE INDEX `uk_phone`(`phone`),
    INDEX `idx_primary_dept_id`(`primary_dept_id`),
    INDEX `idx_direct_manager_id`(`direct_manager_id`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT='员工';

-- CreateTable
CREATE TABLE `dept_manager` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
    `dept_id` BIGINT UNSIGNED NOT NULL COMMENT '管辖部门 id',
    `employee_id` BIGINT UNSIGNED NOT NULL COMMENT '经理员工 id',
    `created_by` BIGINT UNSIGNED NULL COMMENT '创建人 id',
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0) COMMENT '创建时间',
    `updated_by` BIGINT UNSIGNED NULL COMMENT '更新人 id',
    `updated_at` DATETIME(0) NOT NULL COMMENT '更新时间',
    `deleted_at` DATETIME(0) NULL COMMENT '逻辑删除时间（NULL=未删）',

    INDEX `idx_employee_id`(`employee_id`),
    UNIQUE INDEX `uk_dept_emp`(`dept_id`, `employee_id`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT='管辖部门（经理查数范围＝本表集合）';

-- CreateTable
CREATE TABLE `role` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
    `code` VARCHAR(32) NOT NULL COMMENT '角色码：sale 销售 / service 客服 / delivery 交付 / admin 管理员 / dept_manager 部门经理 / gm 总经理',
    `name` VARCHAR(50) NOT NULL COMMENT '角色名称',
    `is_builtin` BOOLEAN NOT NULL DEFAULT true COMMENT '是否内置（内置不可删）',
    `created_by` BIGINT UNSIGNED NULL COMMENT '创建人 id',
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0) COMMENT '创建时间',
    `updated_by` BIGINT UNSIGNED NULL COMMENT '更新人 id',
    `updated_at` DATETIME(0) NOT NULL COMMENT '更新时间',
    `deleted_at` DATETIME(0) NULL COMMENT '逻辑删除时间（NULL=未删）',

    UNIQUE INDEX `uk_code`(`code`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT='角色（内置 6 条，builtin 不可删）';

-- CreateTable
CREATE TABLE `employee_role` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
    `employee_id` BIGINT UNSIGNED NOT NULL COMMENT '员工 id',
    `role_code` VARCHAR(32) NOT NULL COMMENT '角色码（→role.code）',
    `created_by` BIGINT UNSIGNED NULL COMMENT '创建人 id',
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0) COMMENT '创建时间',
    `updated_by` BIGINT UNSIGNED NULL COMMENT '更新人 id',
    `updated_at` DATETIME(0) NOT NULL COMMENT '更新时间',

    INDEX `idx_role_code`(`role_code`),
    UNIQUE INDEX `uk_emp_role`(`employee_id`, `role_code`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT='员工角色关联（一人多角色）';

-- CreateTable
CREATE TABLE `permission_matrix` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
    `perm_key` VARCHAR(64) NOT NULL COMMENT '权限键（如 cross_dept_private / contract_amount / phone_unlock）',
    `role_code` VARCHAR(32) NOT NULL COMMENT '角色码（→role.code）',
    `level` VARCHAR(32) NOT NULL COMMENT '权限级别：visible 可见 / masked 脱敏 / denied 拒绝',
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0) COMMENT '创建时间',
    `updated_at` DATETIME(0) NOT NULL COMMENT '更新时间',

    UNIQUE INDEX `uk_perm_role`(`perm_key`, `role_code`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT='权限矩阵（权限键 × 角色 → 级别）';

-- CreateTable
CREATE TABLE `product_line` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
    `name` VARCHAR(50) NOT NULL COMMENT '产品线名称（唯一）',
    `code` VARCHAR(32) NOT NULL COMMENT '产品线编码（唯一）',
    `dept_ids` JSON NULL COMMENT '承接部门 id 列表（JSON 数组）',
    `service_cycle_days` INTEGER NULL COMMENT '服务周期（天）',
    `status` VARCHAR(32) NOT NULL DEFAULT 'active' COMMENT '状态：active 启用 / disabled 停用',
    `created_by` BIGINT UNSIGNED NULL COMMENT '创建人 id',
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0) COMMENT '创建时间',
    `updated_by` BIGINT UNSIGNED NULL COMMENT '更新人 id',
    `updated_at` DATETIME(0) NOT NULL COMMENT '更新时间',
    `deleted_at` DATETIME(0) NULL COMMENT '逻辑删除时间（NULL=未删）',

    UNIQUE INDEX `uk_product_line_name`(`name`),
    UNIQUE INDEX `uk_code`(`code`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT='产品线';

-- CreateTable
CREATE TABLE `dept_rule` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
    `dept_id` BIGINT UNSIGNED NOT NULL COMMENT '适用部门 id（唯一）',
    `level_tiers` JSON NULL COMMENT '客户等级金额档位 [{level:S/A/B/C/D, minAmount}]，每部门各自定义；回款到账事务内自动算等级',
    `gray_remind_days` INTEGER NULL COMMENT '灰度 N 天未定性 → 提醒下结论（灰度寿命只管提醒，到期照常掉公海）',
    `s_social_days` INTEGER NULL COMMENT 'S 级客户客情节奏默认间隔（建议 45 天）',
    `newbie_first_follow_hours` INTEGER NULL COMMENT '新联系人/新关系首次跟进窗口（建议 48h）',
    `ask_help_days` INTEGER NULL COMMENT '@求助临时协同默认有效期（建议 7 天）',
    `contact_trait_max` INTEGER NOT NULL DEFAULT 3 COMMENT '联系人谈判特质上限（默认 3，范围 1~5；调小后存量超限保留、仅对新写入生效）',
    `nearby_radius_km` INTEGER NULL COMMENT '预留：将来做附近客户的默认半径（V1 不用）',
    `created_by` BIGINT UNSIGNED NULL COMMENT '创建人 id',
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0) COMMENT '创建时间',
    `updated_by` BIGINT UNSIGNED NULL COMMENT '更新人 id',
    `updated_at` DATETIME(0) NOT NULL COMMENT '更新时间',

    UNIQUE INDEX `uk_dept_id`(`dept_id`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT='部门规则（经理可配，写入留痕）';

-- CreateTable
CREATE TABLE `notification` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
    `user_id` BIGINT UNSIGNED NOT NULL COMMENT '接收人（员工）id',
    `title` VARCHAR(120) NOT NULL COMMENT '标题',
    `content` VARCHAR(500) NULL COMMENT '正文',
    `biz_type` VARCHAR(32) NULL COMMENT '业务类型：commitment_due 承诺到期 / cadence 节奏 / drop_warn 掉海预警 / gray 灰度 / approval 审批 / stage_revert 阶段回退知会 …',
    `biz_id` BIGINT UNSIGNED NULL COMMENT '业务对象 id',
    `channel` VARCHAR(16) NOT NULL DEFAULT 'site' COMMENT '渠道：site 站内 / wechat 微信（预留）',
    `read_at` DATETIME(0) NULL COMMENT '已读时间（NULL=未读）',
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0) COMMENT '创建时间',
    `updated_at` DATETIME(0) NOT NULL COMMENT '更新时间',

    INDEX `idx_user_read`(`user_id`, `read_at`, `created_at`),
    INDEX `idx_biz`(`biz_type`, `biz_id`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT='站内通知';

-- CreateTable
CREATE TABLE `operation_log` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
    `occurred_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0) COMMENT '发生时间（分区键）',
    `req_id` VARCHAR(64) NULL COMMENT '请求链路 id（一次操作多行可关联；与系统运行日志 req_id 打通）',
    `operator_id` BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '操作人 id（系统动作=0）',
    `operator_name` VARCHAR(50) NULL COMMENT '操作人姓名快照（防离职/改名后查不到人）',
    `dept_id` BIGINT UNSIGNED NULL COMMENT '操作时所处部门上下文（供经理按部门查）',
    `product_line_id` BIGINT UNSIGNED NULL COMMENT '操作时所处产品线上下文',
    `action` VARCHAR(64) NOT NULL COMMENT '统一编码 模块.动词：approval.approve / phone.unlock.view / event.create / tag.update / sea.phone.view(公海看号) …',
    `target_type` VARCHAR(32) NULL COMMENT '操作对象类型（多态）',
    `target_id` BIGINT UNSIGNED NULL COMMENT '操作对象 id（多态）',
    `before` JSON NULL COMMENT '本次变更前快照（新增时为 null）',
    `after` JSON NULL COMMENT '本次变更后快照（删除时为 null）',
    `detail` JSON NULL COMMENT '补充说明',
    `ip` VARCHAR(64) NULL COMMENT '来源 IP（解锁看号 / 公海看号 / 导出类必记，防批量捞号）',
    `user_agent` VARCHAR(255) NULL COMMENT '来源 UA',

    INDEX `idx_operator`(`operator_id`, `occurred_at`),
    INDEX `idx_target`(`target_type`, `target_id`),
    INDEX `idx_action`(`action`, `occurred_at`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT='操作留痕（全局审计日志，按月分区，只 INSERT/SELECT 不可改删）';

-- CreateTable
CREATE TABLE `dict_type` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
    `code` VARCHAR(64) NOT NULL COMMENT '字典类型码（唯一）',
    `name` VARCHAR(80) NOT NULL COMMENT '类型名称',
    `created_by` BIGINT UNSIGNED NULL COMMENT '创建人 id',
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0) COMMENT '创建时间',
    `updated_by` BIGINT UNSIGNED NULL COMMENT '更新人 id',
    `updated_at` DATETIME(0) NOT NULL COMMENT '更新时间',
    `deleted_at` DATETIME(0) NULL COMMENT '逻辑删除时间（NULL=未删）',

    UNIQUE INDEX `uk_code`(`code`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT='字典类型（枚举展示文案唯一来源，不用 DB ENUM）';

-- CreateTable
CREATE TABLE `dict_item` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
    `type_id` BIGINT UNSIGNED NOT NULL COMMENT '字典类型 id（→dict_type.id）',
    `item_code` VARCHAR(64) NOT NULL COMMENT '项编码（英文码，落库值）',
    `label` VARCHAR(80) NOT NULL COMMENT '显示文案',
    `sort` INTEGER NOT NULL DEFAULT 0 COMMENT '排序（越小越前）',
    `builtin` BOOLEAN NOT NULL DEFAULT false COMMENT '是否内置（内置不可删，可停用）',
    `status` VARCHAR(32) NOT NULL DEFAULT 'active' COMMENT '状态：active 启用 / disabled 停用',
    `created_by` BIGINT UNSIGNED NULL COMMENT '创建人 id',
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0) COMMENT '创建时间',
    `updated_by` BIGINT UNSIGNED NULL COMMENT '更新人 id',
    `updated_at` DATETIME(0) NOT NULL COMMENT '更新时间',
    `deleted_at` DATETIME(0) NULL COMMENT '逻辑删除时间（NULL=未删）',

    INDEX `idx_type_sort`(`type_id`, `status`, `sort`),
    UNIQUE INDEX `uk_type_item`(`type_id`, `item_code`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT='字典项（停用不删 T5；修改写 operation_log）';

-- CreateTable
CREATE TABLE `system_config` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
    `config_key` VARCHAR(64) NOT NULL COMMENT '配置键（唯一，如 ammo_scope＝赢单弹药库可见范围 dept/company）',
    `value` JSON NULL COMMENT '配置值（JSON）',
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0) COMMENT '创建时间',
    `updated_by` BIGINT UNSIGNED NULL COMMENT '最后修改人 id',
    `updated_at` DATETIME(0) NOT NULL COMMENT '更新时间',

    UNIQUE INDEX `uk_config_key`(`config_key`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT='系统级配置（gm 可改，留痕）';

-- CreateTable
CREATE TABLE `job_run_log` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
    `job_name` VARCHAR(64) NOT NULL COMMENT '任务名',
    `run_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0) COMMENT '执行时间（分区键）',
    `status` VARCHAR(16) NOT NULL COMMENT '状态：running 执行中 / success 成功 / failed 失败',
    `rows_affected` INTEGER NOT NULL DEFAULT 0 COMMENT '影响行数',
    `cost_ms` INTEGER NOT NULL DEFAULT 0 COMMENT '耗时（毫秒）',
    `watermark` VARCHAR(64) NULL COMMENT '处理水位线（增量依据）',
    `error` TEXT NULL COMMENT '错误信息',

    INDEX `idx_job_time`(`job_name`, `run_at`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT='定时任务执行日志（按月分区，保留 90 天）';

-- CreateTable
CREATE TABLE `target` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
    `period` VARCHAR(7) NOT NULL COMMENT '目标月份 YYYY-MM（如 2026-09）',
    `scope_type` VARCHAR(16) NOT NULL COMMENT '目标层级：company 公司 / dept 部门 / employee 个人',
    `scope_id` BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '对应对象 id（company 层填 0）',
    `amount` DECIMAL(12, 2) NOT NULL COMMENT '目标金额（回款额口径）',
    `remark` VARCHAR(255) NULL COMMENT '备注',
    `created_by` BIGINT UNSIGNED NULL COMMENT '创建人 id',
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0) COMMENT '创建时间',
    `updated_by` BIGINT UNSIGNED NULL COMMENT '更新人 id',
    `updated_at` DATETIME(0) NOT NULL COMMENT '更新时间',

    INDEX `idx_period`(`period`),
    UNIQUE INDEX `uk_target`(`period`, `scope_type`, `scope_id`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT='月目标（完成额实时聚合，不落表）';

-- CreateTable
CREATE TABLE `company` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
    `full_name` VARCHAR(200) NOT NULL COMMENT '公司全称（查重索引）',
    `name_core` VARCHAR(200) NULL COMMENT '全称标准化核心词（去地域/行业/公司类型词、去括号空格、全半角与英文大小写归一；查重第一段收缩候选集）',
    `credit_code` VARCHAR(32) NULL COMMENT '统一社会信用代码（唯一，可空；撞码强制使用已有档案）',
    `industry_l1` VARCHAR(64) NULL COMMENT '行业一级',
    `industry_l2` VARCHAR(64) NULL COMMENT '行业二级',
    `province` VARCHAR(32) NULL COMMENT '省',
    `city` VARCHAR(32) NULL COMMENT '市',
    `district` VARCHAR(32) NULL COMMENT '区县',
    `scale` VARCHAR(32) NULL COMMENT '企业规模',
    `completeness_1` INTEGER NOT NULL DEFAULT 0 COMMENT '档案完善度第一档 0-100（写入重算）',
    `completeness_2` INTEGER NOT NULL DEFAULT 0 COMMENT '档案完善度第二档 0-100（写入重算）',
    `completeness_3` INTEGER NOT NULL DEFAULT 0 COMMENT '档案完善度第三档 0-100（写入重算）',
    `website` VARCHAR(255) NULL COMMENT '官网',
    `address` VARCHAR(255) NULL COMMENT '地址（V1 单地址）',
    `bank_name` VARCHAR(120) NULL COMMENT '开户行（成交后强制补）',
    `invoice_title` VARCHAR(200) NULL COMMENT '发票抬头（成交后强制补）',
    `tax_no` VARCHAR(64) NULL COMMENT '税号（成交后强制补）',
    `longitude` DECIMAL(10, 6) NULL COMMENT '经度（GCJ-02，人工高德拾取，非必填）',
    `latitude` DECIMAL(9, 6) NULL COMMENT '纬度（GCJ-02，人工高德拾取，非必填）',
    `merged_into` BIGINT UNSIGNED NULL COMMENT '合并墓碑：自引用 FK(company.id)；非 NULL＝本档案已并入该公司，物理不删、永远可审计',
    `aliases` JSON NULL COMMENT '曾用名/别名 JSON 数组（合并时收进被并入方全称，供查重兜底与展示）',
    `created_by` BIGINT UNSIGNED NULL COMMENT '创建人 id',
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0) COMMENT '创建时间',
    `updated_by` BIGINT UNSIGNED NULL COMMENT '更新人 id',
    `updated_at` DATETIME(0) NOT NULL COMMENT '更新时间',
    `deleted_at` DATETIME(0) NULL COMMENT '逻辑删除时间（NULL=未删）',

    UNIQUE INDEX `uk_credit_code`(`credit_code`),
    INDEX `idx_full_name`(`full_name`),
    INDEX `idx_name_core`(`name_core`),
    INDEX `idx_geo`(`latitude`, `longitude`),
    INDEX `idx_merged`(`merged_into`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT='公司（唯一档案＝公司公海，全公司共享）';

-- CreateTable
CREATE TABLE `company_profile_tag` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
    `company_id` BIGINT UNSIGNED NOT NULL COMMENT '公司 id',
    `group_code` VARCHAR(32) NOT NULL COMMENT '标签分组：company_identity_tag 身份(多选) / company_policy_tag 制度(多选) / decision_chain 决策链(单选)',
    `tag_id` BIGINT UNSIGNED NOT NULL COMMENT '标签 id（→dict_item.id）',
    `tag_code` VARCHAR(64) NOT NULL COMMENT '标签编码冗余（防字典改名）',
    `marked_by` BIGINT UNSIGNED NOT NULL COMMENT '打标人 id',
    `marked_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0) COMMENT '打标时间',

    INDEX `idx_tag`(`tag_id`),
    UNIQUE INDEX `uk_cpt`(`company_id`, `group_code`, `tag_id`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT='公司档案标签（建档人工勾一次，全公司共享不随部门隔离）';

-- CreateTable
CREATE TABLE `contact` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
    `name` VARCHAR(50) NOT NULL COMMENT '姓名',
    `phone` VARCHAR(32) NOT NULL COMMENT '当前主号（撞单校验核心）',
    `phone_active` VARCHAR(32) NULL COMMENT '★ 生成列：未删行=phone，软删/换号自动释放；唯一性由 uk_phone_active 兜底（migration 手写）',
    `extra_phones` JSON NULL COMMENT '附加号 JSON [{type: mobile/tel/wechat, number, note}]；仅作联系参考、不参与撞单、无唯一约束',
    `wechat` VARCHAR(64) NULL COMMENT '微信',
    `email` VARCHAR(120) NULL COMMENT '邮箱',
    `gender` VARCHAR(8) NULL COMMENT '性别',
    `birthday` DATE NULL COMMENT '生日',
    `decision_role` VARCHAR(16) NULL COMMENT '决策角色：decision 决策 / influence 影响 / execute 执行',
    `tags` JSON NULL COMMENT '个人自由标签 JSON（爱喝茶/老板亲戚…），与谈判特质分栏并存',
    `trait_summary` JSON NULL COMMENT '谈判特质冗余（从 contact_trait 派生展示）',
    `status` VARCHAR(16) NOT NULL DEFAULT 'active' COMMENT '状态：active 在职 / left 离职 / freelance 自由职业',
    `merged_into` BIGINT UNSIGNED NULL COMMENT '联系人级合并墓碑：自引用 FK(contact.id)；非 NULL＝已并入该 winner，物理不删、traits 并集、子记录零改动',
    `phone_frozen_until` DATETIME(0) NULL COMMENT '手机号变更审核冻结期（通过后 24h 才生效）',
    `created_by` BIGINT UNSIGNED NULL COMMENT '创建人 id',
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0) COMMENT '创建时间',
    `updated_by` BIGINT UNSIGNED NULL COMMENT '更新人 id',
    `updated_at` DATETIME(0) NOT NULL COMMENT '更新时间',
    `deleted_at` DATETIME(0) NULL COMMENT '逻辑删除时间（NULL=未删）',

    INDEX `idx_name`(`name`),
    INDEX `idx_merged_contact`(`merged_into`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT='联系人';

-- CreateTable
CREATE TABLE `contact_trait` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
    `contact_id` BIGINT UNSIGNED NOT NULL COMMENT '联系人 id',
    `trait_id` BIGINT UNSIGNED NOT NULL COMMENT '特质 id（→dict_item.id）',
    `trait_code` VARCHAR(64) NOT NULL COMMENT '特质编码冗余（防字典改名）',
    `marked_by` BIGINT UNSIGNED NOT NULL COMMENT '打标人 id',
    `marked_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0) COMMENT '打标时间',

    INDEX `idx_trait`(`trait_id`),
    UNIQUE INDEX `uk_ct`(`contact_id`, `trait_id`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT='联系人谈判特质（上限＝所属部门 dept_rule.contact_trait_max，默认 3）';

-- CreateTable
CREATE TABLE `company_contact` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
    `company_id` BIGINT UNSIGNED NOT NULL COMMENT '公司 id',
    `contact_id` BIGINT UNSIGNED NOT NULL COMMENT '联系人 id',
    `is_current` BOOLEAN NOT NULL DEFAULT true COMMENT '是否当前就职（签约校验看是否存在 TRUE 记录）',
    `joined_at` DATETIME(0) NULL COMMENT '入职/开始时间',
    `left_at` DATETIME(0) NULL COMMENT '离职/结束时间',
    `position` VARCHAR(64) NULL COMMENT '职位',
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0) COMMENT '创建时间',
    `updated_at` DATETIME(0) NOT NULL COMMENT '更新时间',

    INDEX `idx_company_cur`(`company_id`, `is_current`),
    INDEX `idx_contact_cur`(`contact_id`, `is_current`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT='就职关系（N:M 含历史，一人多段全留痕）';

-- CreateTable
CREATE TABLE `contact_change_log` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
    `contact_id` BIGINT UNSIGNED NOT NULL COMMENT '联系人 id',
    `field` VARCHAR(32) NOT NULL COMMENT '变更字段名',
    `old_value` VARCHAR(255) NULL COMMENT '变更前值（旧号写入即成为历史号，撞单检测时回查提示"该号曾属于 XX"）',
    `new_value` VARCHAR(255) NULL COMMENT '变更后值',
    `approval_id` BIGINT UNSIGNED NULL COMMENT '关联审批单 id（手机号变更必须关联）',
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0) COMMENT '创建时间',

    INDEX `idx_contact_time`(`contact_id`, `created_at`),
    INDEX `idx_approval`(`approval_id`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT='联系人变更留痕';

-- CreateTable
CREATE TABLE `file_asset` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
    `biz_type` VARCHAR(32) NOT NULL COMMENT '多态归属类型：contract 合同附件 / payment 回款凭证 / workorder 工单附件 / company 公司资料 / review 复盘附件 等',
    `biz_id` BIGINT UNSIGNED NOT NULL COMMENT '业务对象 id',
    `file_name` VARCHAR(255) NOT NULL COMMENT '原始文件名（展示 / 下载用）',
    `file_key` VARCHAR(500) NOT NULL COMMENT '对象存储 key 或相对路径（不存全 URL，便于换存储/换域名不改数据）',
    `file_size` INTEGER NULL COMMENT '文件大小（字节）',
    `mime_type` VARCHAR(120) NULL COMMENT 'MIME 类型（前端预览用）',
    `uploaded_by` BIGINT UNSIGNED NOT NULL COMMENT '上传人 id',
    `uploaded_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0) COMMENT '上传时间',
    `status` VARCHAR(16) NOT NULL DEFAULT 'active' COMMENT '状态：active 启用 / deleted 已删（停用不删 T5）',

    INDEX `idx_biz`(`biz_type`, `biz_id`, `status`),
    INDEX `idx_uploader`(`uploaded_by`, `uploaded_at`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT='文件资产（合同附件/回款凭证，多态 biz_type + biz_id）';

-- CreateTable
CREATE TABLE `business_relation` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
    `company_id` BIGINT UNSIGNED NOT NULL COMMENT '公司档案 id（全公司唯一）',
    `dept_id` BIGINT UNSIGNED NOT NULL COMMENT '部门 id（★ 恒定不可变：掉公海只换负责人、不换部门）',
    `product_line_id` BIGINT UNSIGNED NOT NULL COMMENT '产品线 id',
    `stage_id` INTEGER NOT NULL DEFAULT 1 COMMENT '当前阶段 id（1~6，共 6 阶段）',
    `urgency` VARCHAR(16) NOT NULL DEFAULT 'gray' COMMENT '紧急度：gray 灰度（未定性）/ 其余见字典',
    `value_tier` VARCHAR(16) NULL COMMENT '价值档位（由 dept_rule.level_tiers 档位计算）',
    `customer_level` VARCHAR(4) NULL COMMENT '客户等级 S/A/B/C/D（★ 按部门维度：同一公司对不同部门可不同级）',
    `competition` VARCHAR(16) NULL COMMENT '竞争态势：是否有竞品/竞单',
    `competitor_id` BIGINT UNSIGNED NULL COMMENT '竞争对手 id（→competitor.id）',
    `sea_status` VARCHAR(16) NOT NULL DEFAULT 'private' COMMENT '公海状态：private 私海 / public 公海',
    `last_event_at` DATETIME(0) NULL COMMENT '最后有效跟进时间（★ 掉海判定基准）',
    `next_action_hint` VARCHAR(255) NULL COMMENT '下一步动作提示',
    `merged_into` BIGINT UNSIGNED NULL COMMENT '合并墓碑：自引用 FK(business_relation.id)；非 NULL＝本关系已并入目标关系',
    `active_key` VARCHAR(128) NULL COMMENT '★ 生成列：防重复建关系（公司+部门+产品线）；软删/合并自动释放（表达式见文末 ③ 生成列段）',
    `created_by` BIGINT UNSIGNED NULL COMMENT '创建人 id',
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0) COMMENT '创建时间',
    `updated_by` BIGINT UNSIGNED NULL COMMENT '更新人 id',
    `updated_at` DATETIME(0) NOT NULL COMMENT '更新时间',
    `deleted_at` DATETIME(0) NULL COMMENT '逻辑删除时间（NULL=未删）',

    INDEX `idx_company`(`company_id`),
    INDEX `idx_sea_scan`(`last_event_at`, `sea_status`),
    INDEX `idx_dept_sea`(`dept_id`, `product_line_id`, `sea_status`),
    INDEX `idx_merged_rel`(`merged_into`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT='业务关系（部门×产品线×销售＝CRM 最小单元；掉公海＝没负责人但部门不变）';

-- CreateTable
CREATE TABLE `relation_member` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
    `relation_id` BIGINT UNSIGNED NOT NULL COMMENT '业务关系 id',
    `employee_id` BIGINT UNSIGNED NOT NULL COMMENT '员工 id',
    `member_type` VARCHAR(16) NOT NULL COMMENT '成员类型：owner 负责人 / collaborator 固定协同 / temp 临时协同(@求助)',
    `source` VARCHAR(16) NULL COMMENT '来源：manual 手动添加 / ask_help @求助产生',
    `valid_until` DATETIME(0) NULL COMMENT '有效期至（NULL=长期；临时协同到期自动失效）',
    `added_by` BIGINT UNSIGNED NULL COMMENT '添加人 id',
    `added_at` DATETIME(0) NULL COMMENT '添加时间',
    `revoked_by` BIGINT UNSIGNED NULL COMMENT '撤销人 id',
    `revoked_at` DATETIME(0) NULL COMMENT '撤销时间',
    `owner_flag` BIGINT UNSIGNED NULL COMMENT '★ 生成列：member_type=owner 时=relation_id，否则 NULL；唯一索引兜底"一个关系只有一个负责人"（表达式见文末 ③ 生成列段）',

    INDEX `idx_my`(`employee_id`, `member_type`, `valid_until`),
    INDEX `idx_relation`(`relation_id`),
    UNIQUE INDEX `uk_member`(`relation_id`, `employee_id`, `member_type`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT='关系成员（负责人 / 固定协同 / 临时协同；掉公海＝撤销 owner 成员）';

-- CreateTable
CREATE TABLE `relation_stage_log` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
    `relation_id` BIGINT UNSIGNED NOT NULL COMMENT '业务关系 id',
    `from_stage` INTEGER NULL COMMENT '变更前阶段 id（首次推进为 NULL）',
    `to_stage` INTEGER NOT NULL COMMENT '变更后阶段 id',
    `action` VARCHAR(16) NOT NULL COMMENT '动作：forward 推进 / revert 回退',
    `reason` VARCHAR(255) NULL COMMENT '变更原因 / 备注',
    `operator_id` BIGINT UNSIGNED NOT NULL COMMENT '操作人 id',
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0) COMMENT '创建时间',

    INDEX `idx_rel_time`(`relation_id`, `created_at`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT='阶段推进留痕（C3，另留有一句自由文字 reason）';

-- CreateTable
CREATE TABLE `relation_label` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
    `relation_id` BIGINT UNSIGNED NOT NULL COMMENT '业务关系 id',
    `group_code` VARCHAR(32) NOT NULL COMMENT '标签分组码（同分组内多选）',
    `label_id` BIGINT UNSIGNED NOT NULL COMMENT '标签 id（→dict_item.id）',
    `label_code` VARCHAR(64) NOT NULL COMMENT '标签编码冗余（防字典改名）',
    `marked_by` BIGINT UNSIGNED NOT NULL COMMENT '打标人 id',
    `marked_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0) COMMENT '打标时间',
    `remark` VARCHAR(255) NULL COMMENT '备注',

    INDEX `idx_label`(`label_id`),
    UNIQUE INDEX `uk_rel_label`(`relation_id`, `group_code`, `label_id`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT='关系标签（C4，按分组多选）';

-- CreateTable
CREATE TABLE `appointment` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
    `relation_id` BIGINT UNSIGNED NOT NULL COMMENT '业务关系 id',
    `contact_id` BIGINT UNSIGNED NULL COMMENT '联系人 id（可空）',
    `appointment_at` DATETIME(0) NOT NULL COMMENT '预约时间',
    `note` VARCHAR(255) NULL COMMENT '备注',
    `status` VARCHAR(24) NOT NULL DEFAULT 'pending' COMMENT '状态：pending 待赴约 / done 已赴约 / canceled 已取消 / rescheduled 已改期',
    `action_event_id` BIGINT UNSIGNED NULL COMMENT '生成的跟单动作 id（赴约后自动写一条 action_event）',
    `reschedule_log` JSON NULL COMMENT '改期记录 JSON 数组',
    `created_by` BIGINT UNSIGNED NULL COMMENT '创建人 id',
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0) COMMENT '创建时间',
    `updated_by` BIGINT UNSIGNED NULL COMMENT '更新人 id',
    `updated_at` DATETIME(0) NOT NULL COMMENT '更新时间',

    INDEX `idx_rel_time`(`relation_id`, `appointment_at`, `status`),
    INDEX `idx_contact`(`contact_id`),
    INDEX `idx_due`(`appointment_at`, `status`),
    INDEX `idx_event`(`action_event_id`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT='约会（D1）';

-- CreateTable
CREATE TABLE `visit_log` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
    `employee_id` BIGINT UNSIGNED NOT NULL COMMENT '员工 id',
    `depart_at` DATETIME(0) NOT NULL COMMENT '出发时间',
    `reason` VARCHAR(255) NOT NULL COMMENT '外出事由',
    `actual_return_at` DATETIME(0) NULL COMMENT '实际返回时间',
    `relation_ids` JSON NULL COMMENT '本次外出关联的业务关系 id 列表（JSON 数组）',
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0) COMMENT '创建时间',
    `updated_at` DATETIME(0) NOT NULL COMMENT '更新时间',

    INDEX `idx_emp_time`(`employee_id`, `depart_at`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT='外出报备（D2）';

-- CreateTable
CREATE TABLE `competitor` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
    `name` VARCHAR(100) NOT NULL COMMENT '竞品名称（同产品线内唯一）',
    `product_line_id` BIGINT UNSIGNED NOT NULL COMMENT '归属产品线 id',
    `positioning` VARCHAR(255) NULL COMMENT '定位 / 主打',
    `note` VARCHAR(255) NULL COMMENT '备注',
    `created_by` BIGINT UNSIGNED NULL COMMENT '创建人 id',
    `updated_by` BIGINT UNSIGNED NULL COMMENT '更新人 id',
    `status` VARCHAR(16) NOT NULL DEFAULT 'active' COMMENT '状态：active 启用 / disabled 停用',
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0) COMMENT '创建时间',
    `updated_at` DATETIME(0) NOT NULL COMMENT '更新时间',

    INDEX `idx_line_status`(`product_line_id`, `status`),
    UNIQUE INDEX `uk_name_line`(`name`, `product_line_id`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT='竞争对手库（D3）';

-- CreateTable
CREATE TABLE `commitment` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
    `relation_id` BIGINT UNSIGNED NOT NULL COMMENT '业务关系 id',
    `contact_id` BIGINT UNSIGNED NULL COMMENT '联系人 id（可空）',
    `owner_id` BIGINT UNSIGNED NOT NULL COMMENT '承诺责任人 id',
    `party` VARCHAR(16) NOT NULL COMMENT '承诺方：us 我方 / them 客户方',
    `ctype` VARCHAR(24) NOT NULL COMMENT '承诺类型（字典）',
    `content` VARCHAR(255) NOT NULL COMMENT '承诺内容',
    `due_at` DATETIME(0) NULL COMMENT '承诺到期时间',
    `remind_at` DATETIME(0) NULL COMMENT '提醒时间',
    `status` VARCHAR(16) NOT NULL DEFAULT 'open' COMMENT '状态：open 未完成 / done 已完成 / canceled 已取消',
    `done_at` DATETIME(0) NULL COMMENT '完成时间',
    `done_by` BIGINT UNSIGNED NULL COMMENT '完成人 id',
    `source_event_id` BIGINT UNSIGNED NULL COMMENT '来源动作 id（从哪条跟单产生）',
    `closed_event_id` BIGINT UNSIGNED NULL COMMENT '关闭动作 id（由哪条跟单兑现）',
    `created_by` BIGINT UNSIGNED NULL COMMENT '创建人 id',
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0) COMMENT '创建时间',
    `updated_by` BIGINT UNSIGNED NULL COMMENT '更新人 id',
    `updated_at` DATETIME(0) NOT NULL COMMENT '更新时间',

    INDEX `idx_owner_due`(`owner_id`, `status`, `due_at`),
    INDEX `idx_relation`(`relation_id`),
    INDEX `idx_due`(`status`, `due_at`),
    INDEX `idx_contact`(`contact_id`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT='双方承诺（D4，到期提醒 → 兑现闭环）';

-- CreateTable
CREATE TABLE `action_event` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
    `relation_id` BIGINT UNSIGNED NULL COMMENT '业务关系 id（与 contact_id 至少一个非空，见 chk_action_event_subject）',
    `contact_id` BIGINT UNSIGNED NULL COMMENT '联系人 id（纯联系人互动时用）',
    `actor_id` BIGINT UNSIGNED NOT NULL COMMENT '记录人 id',
    `owner_snapshot` BIGINT UNSIGNED NULL COMMENT '记录时的负责人快照（防掉海/换人后统计串号）',
    `action_type` VARCHAR(16) NOT NULL COMMENT '动作类型（字典：电话 / 拜访 / 微信 / 邮件 …）',
    `summary` VARCHAR(500) NULL COMMENT '跟单摘要',
    `outcome` VARCHAR(16) NULL COMMENT '结果：有效 / 无效',
    `stage_forward` INTEGER NULL COMMENT '本动作推进到的阶段 id（NULL=未推进）',
    `pain_point_id` BIGINT UNSIGNED NULL COMMENT '痛点 id（→dict_item.id）',
    `competition` VARCHAR(16) NULL COMMENT '竞争态势',
    `competitor_id` BIGINT UNSIGNED NULL COMMENT '竞争对手 id（→competitor.id）',
    `competition_note` VARCHAR(255) NULL COMMENT '竞争情况备注',
    `duration_min` INTEGER NULL COMMENT '时长（分钟）',
    `mentioned_user_ids` JSON NULL COMMENT '被 @ 的员工 id 列表（JSON 数组）',
    `source` VARCHAR(16) NOT NULL DEFAULT 'manual' COMMENT '来源：manual 手动 / auto 系统自动',
    `visit_log_id` BIGINT UNSIGNED NULL COMMENT '关联外出记录 id（→visit_log.id）',
    `appointment_id` BIGINT UNSIGNED NULL COMMENT '关联约会 id（→appointment.id）',
    `idempotency_key` VARCHAR(64) NULL COMMENT '幂等键（uk_idem 全局唯一，防重复提交）',
    `attachments` JSON NULL COMMENT '附件 JSON 数组',
    `event_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0) COMMENT '发生时间（工作台时间线排序基准）',
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0) COMMENT '创建时间',
    `updated_at` DATETIME(0) NOT NULL COMMENT '更新时间',

    INDEX `idx_rel_time`(`relation_id`, `event_at`),
    INDEX `idx_rel_owner`(`relation_id`, `owner_snapshot`, `event_at`),
    INDEX `idx_actor_time`(`actor_id`, `event_at`),
    INDEX `idx_pain`(`pain_point_id`),
    INDEX `idx_appointment`(`appointment_id`),
    INDEX `idx_contact`(`contact_id`, `event_at`),
    UNIQUE INDEX `uk_idem`(`idempotency_key`),
    CONSTRAINT `chk_action_event_subject` CHECK ((`relation_id` IS NOT NULL) OR (`contact_id` IS NOT NULL)),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT='跟单动作/互动事件（D5，工作台时间线主体；不分区，保外键）';

-- CreateTable
CREATE TABLE `cadence_rule` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
    `scope_dept_id` BIGINT UNSIGNED NULL COMMENT '适用部门 id（NULL=不限部门）',
    `scope_line_id` BIGINT UNSIGNED NULL COMMENT '适用产品线 id（NULL=不限产品线）',
    `trigger` JSON NOT NULL COMMENT '触发条件 JSON（如「N 天未跟进」「阶段停留过久」）',
    `suggest_action` JSON NULL COMMENT '建议动作 JSON',
    `soft` BOOLEAN NOT NULL DEFAULT true COMMENT '是否软规则（true=只提示不拦截）',
    `enabled` BOOLEAN NOT NULL DEFAULT true COMMENT '是否启用',
    `sort` INTEGER NOT NULL DEFAULT 0 COMMENT '排序（匹配优先级）',
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0) COMMENT '创建时间',
    `updated_at` DATETIME(0) NOT NULL COMMENT '更新时间',

    INDEX `idx_scope`(`scope_dept_id`, `scope_line_id`, `enabled`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT='跟单节奏规则（D6，软规则只提示不拦截）';

-- CreateTable
CREATE TABLE `daily_agenda` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
    `user_id` BIGINT UNSIGNED NOT NULL COMMENT '员工 id（日程属于谁）',
    `biz_date` DATE NOT NULL COMMENT '业务日期（按天分桶）',
    `ref_type` VARCHAR(16) NOT NULL COMMENT '引用类型：relation 关系 / commitment 承诺 / appointment 约会 等（多态）',
    `ref_id` BIGINT UNSIGNED NULL COMMENT '引用对象 id（多态）',
    `relation_id` BIGINT UNSIGNED NULL COMMENT '业务关系 id',
    `contact_id` BIGINT UNSIGNED NULL COMMENT '联系人 id',
    `reason` VARCHAR(255) NULL COMMENT '进入今日待办的原因',
    `priority` INTEGER NOT NULL DEFAULT 0 COMMENT '优先级（越大越靠前）',
    `action_hint` VARCHAR(255) NULL COMMENT '建议动作',
    `status` VARCHAR(16) NOT NULL DEFAULT 'open' COMMENT '状态：open 未处理 / done 已处理 / snoozed 已稍后 / dropped 已忽略',
    `action_reason` VARCHAR(255) NULL COMMENT '处理理由',
    `snooze_count` INTEGER NOT NULL DEFAULT 0 COMMENT '稍后次数',
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0) COMMENT '创建时间',
    `updated_at` DATETIME(0) NOT NULL COMMENT '更新时间',

    INDEX `idx_user_day`(`user_id`, `biz_date`, `status`),
    INDEX `idx_ref`(`ref_type`, `ref_id`),
    INDEX `idx_relation`(`relation_id`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT='今日待办/日程（D7；不分区，保外键）';

-- CreateTable
CREATE TABLE `review` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
    `relation_id` BIGINT UNSIGNED NOT NULL COMMENT '业务关系 id',
    `review_type` VARCHAR(8) NOT NULL COMMENT '复盘类型：win 赢单 / lose 丢单 / pending 悬而未决',
    `why_code` VARCHAR(64) NULL COMMENT '原因码（→dict_item.id）',
    `competitor_id` BIGINT UNSIGNED NULL COMMENT '竞争对手 id（丢单归因用）',
    `detail` VARCHAR(500) NULL COMMENT '复盘正文（50 字以上）',
    `manager_note` VARCHAR(500) NULL COMMENT '经理点评',
    `status` VARCHAR(16) NOT NULL COMMENT '状态：待写 / 已提交 / 经理已点评',
    `created_by` BIGINT UNSIGNED NULL COMMENT '提交人 id',
    `manager_id` BIGINT UNSIGNED NULL COMMENT '点评经理 id',
    `manager_done_at` DATETIME(0) NULL COMMENT '经理点评时间',
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0) COMMENT '创建时间',
    `updated_at` DATETIME(0) NOT NULL COMMENT '更新时间',

    INDEX `idx_status_time`(`status`, `created_at`),
    INDEX `idx_relation`(`relation_id`),
    INDEX `idx_type_status`(`review_type`, `status`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT='复盘（赢单/丢单/悬而未决，经理点评闭环）';

-- CreateTable
CREATE TABLE `stat_daily` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
    `biz_date` DATE NOT NULL COMMENT '业务日期（分区键）',
    `dept_id` BIGINT UNSIGNED NOT NULL COMMENT '部门 id',
    `product_line_id` BIGINT UNSIGNED NOT NULL COMMENT '产品线 id',
    `owner_id` BIGINT UNSIGNED NOT NULL COMMENT '负责人 id',
    `action_type` VARCHAR(16) NOT NULL COMMENT '动作类型（与 action_event.action_type 同口径）',
    `cnt` INTEGER NOT NULL DEFAULT 0 COMMENT '数量',
    `first_at` DATETIME(0) NULL COMMENT '当天首次发生时间',
    `last_at` DATETIME(0) NULL COMMENT '当天最后发生时间',

    INDEX `idx_owner_day`(`owner_id`, `biz_date`),
    UNIQUE INDEX `uk_stat`(`biz_date`, `dept_id`, `product_line_id`, `owner_id`, `action_type`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT='跟单统计日报（预聚合，按 biz_date 月分区；唯一键已含分区键）';

-- CreateTable
CREATE TABLE `contract` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
    `contract_no` VARCHAR(64) NOT NULL COMMENT '合同编号（唯一）',
    `relation_id` BIGINT UNSIGNED NOT NULL COMMENT '业务关系 id',
    `company_id` BIGINT UNSIGNED NOT NULL COMMENT '公司档案 id（冗余，便于报表）',
    `product_line_id` BIGINT UNSIGNED NOT NULL COMMENT '产品线 id（冗余，便于报表）',
    `contact_id` BIGINT UNSIGNED NULL COMMENT '联系人 id',
    `signer_id` BIGINT UNSIGNED NOT NULL COMMENT '签约销售 id',
    `amount` DECIMAL(12, 2) NOT NULL COMMENT '合同金额',
    `paid_amount` DECIMAL(12, 2) NOT NULL DEFAULT 0 COMMENT '已回款金额（回款写入事务内同步）',
    `pay_type` VARCHAR(32) NULL COMMENT '付款方式',
    `sign_date` DATE NULL COMMENT '签约日期',
    `service_start` DATE NULL COMMENT '服务开始日期',
    `service_end` DATE NULL COMMENT '服务结束日期（到期提醒基准）',
    `auto_renew` BOOLEAN NOT NULL DEFAULT false COMMENT '是否自动续约',
    `remind_days` JSON NULL COMMENT '到期提醒天数（JSON 数组，如 [30,7,1]）',
    `attachments` JSON NULL COMMENT '附件 JSON 数组',
    `status` VARCHAR(16) NOT NULL DEFAULT 'unpaid' COMMENT '状态：unpaid 未回款 / partial 部分回款 / paid 已回款 / finished 已完成 等（见字典）',
    `created_by` BIGINT UNSIGNED NULL COMMENT '创建人 id',
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0) COMMENT '创建时间',
    `updated_by` BIGINT UNSIGNED NULL COMMENT '更新人 id',
    `updated_at` DATETIME(0) NOT NULL COMMENT '更新时间',
    `deleted_at` DATETIME(0) NULL COMMENT '逻辑删除时间（NULL=未删）',

    UNIQUE INDEX `uk_contract_no`(`contract_no`),
    INDEX `idx_relation`(`relation_id`),
    INDEX `idx_company`(`company_id`),
    INDEX `idx_signer`(`signer_id`),
    INDEX `idx_expire`(`service_end`, `status`),
    INDEX `idx_line_status`(`product_line_id`, `status`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT='合同（E1）';

-- CreateTable
CREATE TABLE `payment_record` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
    `contract_id` BIGINT UNSIGNED NOT NULL COMMENT '合同 id',
    `amount` DECIMAL(12, 2) NOT NULL COMMENT '回款金额',
    `paid_at` DATETIME(0) NOT NULL COMMENT '回款时间（业绩归期基准）',
    `method` VARCHAR(32) NULL COMMENT '回款方式',
    `voucher_file_id` BIGINT UNSIGNED NULL COMMENT '回款凭证文件 id（→file_asset.id）',
    `created_by` BIGINT UNSIGNED NULL COMMENT '创建人 id',
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0) COMMENT '创建时间',
    `updated_at` DATETIME(0) NOT NULL COMMENT '更新时间',

    INDEX `idx_contract`(`contract_id`),
    INDEX `idx_paid_at`(`paid_at`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT='回款记录（E2，落表后自动算客户等级）';

-- CreateTable
CREATE TABLE `workorder` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
    `order_no` VARCHAR(64) NOT NULL COMMENT '工单编号（唯一）',
    `type` VARCHAR(16) NOT NULL COMMENT '工单类型：delivery 交付 / after_sale 售后 / complaint 投诉 等（见字典）',
    `relation_id` BIGINT UNSIGNED NULL COMMENT '业务关系 id（可空）',
    `title` VARCHAR(200) NOT NULL COMMENT '标题',
    `content` TEXT NULL COMMENT '内容',
    `source` VARCHAR(32) NULL COMMENT '来源',
    `priority` VARCHAR(8) NULL COMMENT '优先级',
    `assignee_id` BIGINT UNSIGNED NULL COMMENT '处理人 id',
    `sla_deadline` DATETIME(0) NULL COMMENT 'SLA 截止时间（超期预警基准）',
    `est_effort_min` INTEGER NULL COMMENT '预估工时（分钟）',
    `status` VARCHAR(16) NOT NULL DEFAULT 'created' COMMENT '状态（见字典）：created 已创建 / …',
    `upgraded_from_id` BIGINT UNSIGNED NULL COMMENT '升级来源工单 id（自引用，售后升级链路）',
    `created_by` BIGINT UNSIGNED NULL COMMENT '创建人 id',
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0) COMMENT '创建时间',
    `updated_by` BIGINT UNSIGNED NULL COMMENT '更新人 id',
    `updated_at` DATETIME(0) NOT NULL COMMENT '更新时间',
    `deleted_at` DATETIME(0) NULL COMMENT '逻辑删除时间（NULL=未删）',

    UNIQUE INDEX `uk_order_no`(`order_no`),
    INDEX `idx_relation`(`relation_id`),
    INDEX `idx_assignee`(`assignee_id`, `status`, `sla_deadline`),
    INDEX `idx_sla`(`status`, `sla_deadline`),
    INDEX `idx_upgraded`(`upgraded_from_id`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT='工单（E3）';

-- CreateTable
CREATE TABLE `workorder_log` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
    `workorder_id` BIGINT UNSIGNED NOT NULL COMMENT '工单 id',
    `action` VARCHAR(32) NOT NULL COMMENT '动作（见字典）',
    `from_status` VARCHAR(16) NULL COMMENT '变更前状态（新建时为 NULL）',
    `to_status` VARCHAR(16) NULL COMMENT '变更后状态',
    `reason` VARCHAR(255) NULL COMMENT '原因 / 备注',
    `operator_id` BIGINT UNSIGNED NOT NULL COMMENT '操作人 id',
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0) COMMENT '创建时间',

    INDEX `idx_wo_time`(`workorder_id`, `created_at`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT='工单流转留痕';

-- CreateTable
CREATE TABLE `ledger` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
    `contract_id` BIGINT UNSIGNED NOT NULL COMMENT '合同 id',
    `company_id` BIGINT UNSIGNED NOT NULL COMMENT '公司档案 id',
    `product_line_id` BIGINT UNSIGNED NOT NULL COMMENT '产品线 id',
    `customer_level` VARCHAR(4) NULL COMMENT '客户等级',
    `sign_date` DATE NULL COMMENT '签约日期',
    `expire_date` DATE NULL COMMENT '到期日期（续费提醒基准）',
    `contact_id` BIGINT UNSIGNED NULL COMMENT '联系人 id',
    `sales_id` BIGINT UNSIGNED NULL COMMENT '销售 id',
    `delivery_id` BIGINT UNSIGNED NULL COMMENT '交付 id',
    `remark` VARCHAR(500) NULL COMMENT '备注',
    `extra_fields` JSON NULL COMMENT '自定义扩展字段 JSON（结构由 field_template 定义）',
    `created_by` BIGINT UNSIGNED NULL COMMENT '创建人 id',
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0) COMMENT '创建时间',
    `updated_by` BIGINT UNSIGNED NULL COMMENT '更新人 id',
    `updated_at` DATETIME(0) NOT NULL COMMENT '更新时间',

    INDEX `idx_line_expire`(`product_line_id`, `expire_date`),
    INDEX `idx_contract`(`contract_id`),
    INDEX `idx_company`(`company_id`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT='交付台账（E4，自定义字段存 extra_fields）';

-- CreateTable
CREATE TABLE `field_template` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
    `product_line_id` BIGINT UNSIGNED NOT NULL COMMENT '产品线 id',
    `field_key` VARCHAR(64) NOT NULL COMMENT '字段编码（同产品线内唯一）',
    `label` VARCHAR(80) NOT NULL COMMENT '字段显示名',
    `control_type` VARCHAR(16) NOT NULL COMMENT '控件类型：text / number / date / select …',
    `required` BOOLEAN NOT NULL DEFAULT false COMMENT '是否必填',
    `sort` INTEGER NOT NULL DEFAULT 0 COMMENT '排序',
    `show_in_list` BOOLEAN NOT NULL DEFAULT false COMMENT '是否在列表展示',
    `options` JSON NULL COMMENT '选项 JSON（select 类控件）',
    `status` VARCHAR(16) NOT NULL DEFAULT 'active' COMMENT '状态：active 启用 / disabled 停用',
    `created_by` BIGINT UNSIGNED NULL COMMENT '创建人 id',
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0) COMMENT '创建时间',
    `updated_by` BIGINT UNSIGNED NULL COMMENT '更新人 id',
    `updated_at` DATETIME(0) NOT NULL COMMENT '更新时间',
    `deleted_at` DATETIME(0) NULL COMMENT '逻辑删除时间（NULL=未删）',

    INDEX `idx_line_sort`(`product_line_id`, `status`, `sort`),
    UNIQUE INDEX `uk_line_key`(`product_line_id`, `field_key`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT='交付台账自定义字段模板（按产品线定义）';

-- CreateTable
CREATE TABLE `contract_split` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
    `contract_id` BIGINT UNSIGNED NOT NULL COMMENT '合同 id',
    `employee_id` BIGINT UNSIGNED NOT NULL COMMENT '员工 id',
    `percent` DECIMAL(5, 2) NOT NULL COMMENT '分成比例（%）',
    `created_by` BIGINT UNSIGNED NULL COMMENT '创建人 id',
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0) COMMENT '创建时间',

    INDEX `idx_employee`(`employee_id`),
    UNIQUE INDEX `uk_split`(`contract_id`, `employee_id`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT='合同分成（多人分单）';

CREATE TABLE `sign_checklist` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
    `product_line_id` BIGINT UNSIGNED NOT NULL COMMENT '产品线 id',
    `scope` VARCHAR(16) NOT NULL COMMENT '适用范围（签约前/交付前等核对场景码）',
    `field_key` VARCHAR(64) NOT NULL COMMENT '字段编码',
    `label` VARCHAR(128) NOT NULL COMMENT '字段显示名',
    `required` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否必填（1=必填）',
    `sort` INT NOT NULL DEFAULT 0 COMMENT '排序',
    `status` VARCHAR(16) NOT NULL DEFAULT 'active' COMMENT '状态：active 启用 / disabled 停用',
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0) COMMENT '创建时间',

    INDEX `idx_line_status`(`product_line_id`, `status`, `sort`),
    UNIQUE INDEX `uk_line_scope_field`(`product_line_id`, `scope`, `field_key`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT='签约核对清单（按产品线 × 范围定义）';

-- CreateTable
CREATE TABLE `sea_rule` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
    `level` TINYINT NOT NULL COMMENT '优先级层级（数值越小越优先匹配）',
    `dept_id` BIGINT UNSIGNED NULL COMMENT '适用部门 id（NULL=不限部门）',
    `product_line_id` BIGINT UNSIGNED NULL COMMENT '适用产品线 id（NULL=不限产品线）',
    `follow_freq_days` INTEGER NULL COMMENT '跟进频率（天）：超过 N 天未跟进即预警',
    `deal_cycle_days` INTEGER NULL COMMENT '成交周期（天）',
    `stay_days` INTEGER NULL COMMENT '停留天数阈值（在某阶段停留过久预警）',
    `no_progress_max` INTEGER NULL COMMENT '无进展最大次数',
    `effective_from` DATETIME(0) NOT NULL COMMENT '生效时间（规则版本化，历史可追溯）',
    `status` VARCHAR(16) NOT NULL DEFAULT 'active' COMMENT '状态：active 启用 / disabled 停用',
    `created_by` BIGINT UNSIGNED NULL COMMENT '创建人 id',
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0) COMMENT '创建时间',
    `updated_by` BIGINT UNSIGNED NULL COMMENT '更新人 id',
    `updated_at` DATETIME(0) NOT NULL COMMENT '更新时间',

    INDEX `idx_level`(`level`, `dept_id`, `product_line_id`, `status`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT='公海掉落规则（F1，按 等级×部门×产品线 配置，版本化生效）';

-- CreateTable
CREATE TABLE `sea_record` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
    `relation_id` BIGINT UNSIGNED NOT NULL COMMENT '业务关系 id',
    `owner_id` BIGINT UNSIGNED NOT NULL COMMENT '掉海前的负责人 id',
    `from_sea` VARCHAR(16) NOT NULL COMMENT '变更前状态：private 私海 / public 公海',
    `to_sea` VARCHAR(16) NOT NULL COMMENT '变更后状态：private 私海 / public 公海',
    `reason` VARCHAR(32) NOT NULL COMMENT '原因码（无跟进 N 天 / 手动释放 / 人员离职 …）',
    `dropped_at` DATETIME(0) NOT NULL COMMENT '掉海时间',
    `claimed_by` BIGINT UNSIGNED NULL COMMENT '认领人 id（被捞回时填）',
    `claimed_at` DATETIME(0) NULL COMMENT '认领时间',

    INDEX `idx_rel_time`(`relation_id`, `dropped_at`),
    INDEX `idx_owner`(`owner_id`, `dropped_at`),
    INDEX `idx_claimer`(`claimed_by`, `claimed_at`),
    INDEX `idx_drop`(`dropped_at`, `to_sea`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT='掉海/认领流水（F2）';

-- CreateTable
CREATE TABLE `approval` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
    `type` VARCHAR(24) NOT NULL COMMENT '审批类型：contact_phone_change 手机号变更 / 合同 / 线索 等',
    `applicant_id` BIGINT UNSIGNED NOT NULL COMMENT '申请人 id',
    `approver_id` BIGINT UNSIGNED NOT NULL COMMENT '审批人 id（CHECK 约束：不得等于申请人）',
    `target_type` VARCHAR(32) NULL COMMENT '审批对象类型（多态）',
    `target_id` BIGINT UNSIGNED NULL COMMENT '审批对象 id（多态）',
    `payload` JSON NULL COMMENT '审批载荷 JSON（变更前后值、附件等）',
    `status` VARCHAR(16) NOT NULL DEFAULT 'pending' COMMENT '状态：pending 待审批 / approved 通过 / rejected 驳回 / canceled 撤销',
    `comment` VARCHAR(500) NULL COMMENT '审批意见（手机号变更驳回必填）',
    `handled_at` DATETIME(0) NULL COMMENT '处理时间',
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0) COMMENT '创建时间',
    `updated_at` DATETIME(0) NOT NULL COMMENT '更新时间',

    INDEX `idx_approver`(`approver_id`, `status`, `created_at`),
    INDEX `idx_applicant`(`applicant_id`, `created_at`),
    INDEX `idx_target`(`target_type`, `target_id`),
    INDEX `idx_type_status`(`type`, `status`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT='审批单（G，通用审批）';

-- AddForeignKey
ALTER TABLE `dept_manager` ADD CONSTRAINT `dept_manager_dept_id_fkey` FOREIGN KEY (`dept_id`) REFERENCES `department`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dept_manager` ADD CONSTRAINT `dept_manager_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employee_role` ADD CONSTRAINT `employee_role_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employee_role` ADD CONSTRAINT `employee_role_role_code_fkey` FOREIGN KEY (`role_code`) REFERENCES `role`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `permission_matrix` ADD CONSTRAINT `permission_matrix_role_code_fkey` FOREIGN KEY (`role_code`) REFERENCES `role`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dept_rule` ADD CONSTRAINT `dept_rule_dept_id_fkey` FOREIGN KEY (`dept_id`) REFERENCES `department`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notification` ADD CONSTRAINT `notification_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dict_item` ADD CONSTRAINT `dict_item_type_id_fkey` FOREIGN KEY (`type_id`) REFERENCES `dict_type`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `company_profile_tag` ADD CONSTRAINT `company_profile_tag_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `contact_trait` ADD CONSTRAINT `contact_trait_contact_id_fkey` FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `company_contact` ADD CONSTRAINT `company_contact_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `company_contact` ADD CONSTRAINT `company_contact_contact_id_fkey` FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `contact_change_log` ADD CONSTRAINT `contact_change_log_contact_id_fkey` FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `business_relation` ADD CONSTRAINT `business_relation_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `business_relation` ADD CONSTRAINT `business_relation_dept_id_fkey` FOREIGN KEY (`dept_id`) REFERENCES `department`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `business_relation` ADD CONSTRAINT `business_relation_product_line_id_fkey` FOREIGN KEY (`product_line_id`) REFERENCES `product_line`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `relation_member` ADD CONSTRAINT `relation_member_relation_id_fkey` FOREIGN KEY (`relation_id`) REFERENCES `business_relation`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `relation_stage_log` ADD CONSTRAINT `relation_stage_log_relation_id_fkey` FOREIGN KEY (`relation_id`) REFERENCES `business_relation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `relation_label` ADD CONSTRAINT `relation_label_relation_id_fkey` FOREIGN KEY (`relation_id`) REFERENCES `business_relation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `appointment` ADD CONSTRAINT `appointment_relation_id_fkey` FOREIGN KEY (`relation_id`) REFERENCES `business_relation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `competitor` ADD CONSTRAINT `competitor_product_line_id_fkey` FOREIGN KEY (`product_line_id`) REFERENCES `product_line`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `commitment` ADD CONSTRAINT `commitment_relation_id_fkey` FOREIGN KEY (`relation_id`) REFERENCES `business_relation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `action_event` ADD CONSTRAINT `action_event_relation_id_fkey` FOREIGN KEY (`relation_id`) REFERENCES `business_relation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cadence_rule` ADD CONSTRAINT `cadence_rule_scope_dept_id_fkey` FOREIGN KEY (`scope_dept_id`) REFERENCES `department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cadence_rule` ADD CONSTRAINT `cadence_rule_scope_line_id_fkey` FOREIGN KEY (`scope_line_id`) REFERENCES `product_line`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `daily_agenda` ADD CONSTRAINT `daily_agenda_relation_id_fkey` FOREIGN KEY (`relation_id`) REFERENCES `business_relation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `review` ADD CONSTRAINT `review_relation_id_fkey` FOREIGN KEY (`relation_id`) REFERENCES `business_relation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `contract` ADD CONSTRAINT `contract_relation_id_fkey` FOREIGN KEY (`relation_id`) REFERENCES `business_relation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `contract` ADD CONSTRAINT `contract_product_line_id_fkey` FOREIGN KEY (`product_line_id`) REFERENCES `product_line`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_record` ADD CONSTRAINT `payment_record_contract_id_fkey` FOREIGN KEY (`contract_id`) REFERENCES `contract`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workorder` ADD CONSTRAINT `workorder_relation_id_fkey` FOREIGN KEY (`relation_id`) REFERENCES `business_relation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `workorder_log` ADD CONSTRAINT `workorder_log_workorder_id_fkey` FOREIGN KEY (`workorder_id`) REFERENCES `workorder`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ledger` ADD CONSTRAINT `ledger_contract_id_fkey` FOREIGN KEY (`contract_id`) REFERENCES `contract`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ledger` ADD CONSTRAINT `ledger_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ledger` ADD CONSTRAINT `ledger_product_line_id_fkey` FOREIGN KEY (`product_line_id`) REFERENCES `product_line`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `field_template` ADD CONSTRAINT `field_template_product_line_id_fkey` FOREIGN KEY (`product_line_id`) REFERENCES `product_line`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `contract_split` ADD CONSTRAINT `contract_split_contract_id_fkey` FOREIGN KEY (`contract_id`) REFERENCES `contract`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `sign_checklist` ADD CONSTRAINT `sign_checklist_product_line_id_fkey` FOREIGN KEY (`product_line_id`) REFERENCES `product_line`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sea_rule` ADD CONSTRAINT `sea_rule_dept_id_fkey` FOREIGN KEY (`dept_id`) REFERENCES `department`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sea_rule` ADD CONSTRAINT `sea_rule_product_line_id_fkey` FOREIGN KEY (`product_line_id`) REFERENCES `product_line`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sea_record` ADD CONSTRAINT `sea_record_relation_id_fkey` FOREIGN KEY (`relation_id`) REFERENCES `business_relation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- =============================================================================
-- 手工补充段（2026-09-11）— Prisma 无法表达，必须手写
-- 依据：数据架构 §十五.5（生成列 / 分区表）、§10.2；接口 API 文档 §5
-- 顺序：本段须在 baseline 之后、业务写入之前执行。
-- =============================================================================

-- ---------- ① 生成列改造 ----------------------------------------------------
-- 说明：schema.prisma 中这三个字段标了 @ignore，但 Prisma 仍会建成「普通列」；
--       此处 DROP 后重建为 GENERATED 列，并补唯一索引（应用层不读不写，靠 DB 兜底）。

-- 1) contact.phone_active：未删行占号，软删/换号自动释放
ALTER TABLE `contact`
  DROP COLUMN `phone_active`,
  ADD COLUMN `phone_active` VARCHAR(32)
    GENERATED ALWAYS AS (IF(`deleted_at` IS NULL, `phone`, NULL)) STORED
    COMMENT '生成列：未删行占号，软删/换号自动释放';
CREATE UNIQUE INDEX `uk_phone_active` ON `contact` (`phone_active`);

-- 2) business_relation.active_key：仅「私海且未并」占活跃位（同 公司×部门×产品线 仅一条活跃）
ALTER TABLE `business_relation`
  DROP COLUMN `active_key`,
  ADD COLUMN `active_key` VARCHAR(128)
    GENERATED ALWAYS AS (
      IF(`sea_status` = 'private' AND `merged_into` IS NULL,
         CONCAT_WS('-', `company_id`, `dept_id`, `product_line_id`),
         NULL)
    ) STORED
    COMMENT '生成列：仅私海且未合并才占活跃位（公司-部门-产品线 唯一）';
CREATE UNIQUE INDEX `uk_active_rel` ON `business_relation` (`active_key`);

-- 3) relation_member.owner_flag：一关系仅一 owner
ALTER TABLE `relation_member`
  DROP COLUMN `owner_flag`,
  ADD COLUMN `owner_flag` BIGINT UNSIGNED
    GENERATED ALWAYS AS (IF(`member_type` = 'owner', `relation_id`, NULL)) STORED
    COMMENT '生成列：仅 owner 成员占位，保证一个关系只有一个负责人';
CREATE UNIQUE INDEX `uk_owner` ON `relation_member` (`owner_flag`);

-- ---------- ② 3 张分区表改造（按月 RANGE 分区）-----------------------------
-- ⚠ MySQL 规则：每个唯一键（含主键）都必须包含分区列，否则报 ERROR 1503。
--    故先扩主键含分区列 → 再 PARTITION BY RANGE。分区按月滚动维护（定时任务补新分区、归档旧分区）。
-- ★ 2026-09-12 实测收缩：原定 5 张 → 实做 3 张。
--    action_event / daily_agenda 因「保外键」策略不分区（MySQL 分区表不能参与外键，ERROR 1506；
--    且生成列不得引用 ON UPDATE CASCADE 的 FK 列，ERROR 1215），二者主键保持建表原样 (id)。
--    保留分区的 3 张（stat_daily / operation_log / job_run_log）均无外键，实测可正常分区。

-- stat_daily（分区键 biz_date）
ALTER TABLE `stat_daily`
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (`id`, `biz_date`)
  PARTITION BY RANGE (YEAR(`biz_date`) * 100 + MONTH(`biz_date`)) (
    PARTITION p202609 VALUES LESS THAN (202610),
    PARTITION p202610 VALUES LESS THAN (202611),
    PARTITION p202611 VALUES LESS THAN (202612),
    PARTITION p202612 VALUES LESS THAN (202701),
    PARTITION p202701 VALUES LESS THAN (202702),
    PARTITION p202702 VALUES LESS THAN (202703),
    PARTITION p202703 VALUES LESS THAN (202704),
    PARTITION p202704 VALUES LESS THAN (202705),
    PARTITION p202705 VALUES LESS THAN (202706),
    PARTITION p202706 VALUES LESS THAN (202707),
    PARTITION p202707 VALUES LESS THAN (202708),
    PARTITION p202708 VALUES LESS THAN (202709),
    PARTITION p202709 VALUES LESS THAN (202710),
    PARTITION p202710 VALUES LESS THAN (202711),
    PARTITION p202711 VALUES LESS THAN (202712),
    PARTITION p202712 VALUES LESS THAN (202801),
    PARTITION pmax    VALUES LESS THAN MAXVALUE
  );

-- operation_log（分区键 occurred_at）
ALTER TABLE `operation_log`
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (`id`, `occurred_at`)
  PARTITION BY RANGE (YEAR(`occurred_at`) * 100 + MONTH(`occurred_at`)) (
    PARTITION p202609 VALUES LESS THAN (202610),
    PARTITION p202610 VALUES LESS THAN (202611),
    PARTITION p202611 VALUES LESS THAN (202612),
    PARTITION p202612 VALUES LESS THAN (202701),
    PARTITION p202701 VALUES LESS THAN (202702),
    PARTITION p202702 VALUES LESS THAN (202703),
    PARTITION p202703 VALUES LESS THAN (202704),
    PARTITION p202704 VALUES LESS THAN (202705),
    PARTITION p202705 VALUES LESS THAN (202706),
    PARTITION p202706 VALUES LESS THAN (202707),
    PARTITION p202707 VALUES LESS THAN (202708),
    PARTITION p202708 VALUES LESS THAN (202709),
    PARTITION p202709 VALUES LESS THAN (202710),
    PARTITION p202710 VALUES LESS THAN (202711),
    PARTITION p202711 VALUES LESS THAN (202712),
    PARTITION p202712 VALUES LESS THAN (202801),
    PARTITION pmax    VALUES LESS THAN MAXVALUE
  );

-- job_run_log（分区键 run_at）
ALTER TABLE `job_run_log`
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (`id`, `run_at`)
  PARTITION BY RANGE (YEAR(`run_at`) * 100 + MONTH(`run_at`)) (
    PARTITION p202609 VALUES LESS THAN (202610),
    PARTITION p202610 VALUES LESS THAN (202611),
    PARTITION p202611 VALUES LESS THAN (202612),
    PARTITION p202612 VALUES LESS THAN (202701),
    PARTITION p202701 VALUES LESS THAN (202702),
    PARTITION p202702 VALUES LESS THAN (202703),
    PARTITION p202703 VALUES LESS THAN (202704),
    PARTITION p202704 VALUES LESS THAN (202705),
    PARTITION p202705 VALUES LESS THAN (202706),
    PARTITION p202706 VALUES LESS THAN (202707),
    PARTITION p202707 VALUES LESS THAN (202708),
    PARTITION p202708 VALUES LESS THAN (202709),
    PARTITION p202709 VALUES LESS THAN (202710),
    PARTITION p202710 VALUES LESS THAN (202711),
    PARTITION p202711 VALUES LESS THAN (202712),
    PARTITION p202712 VALUES LESS THAN (202801),
    PARTITION pmax    VALUES LESS THAN MAXVALUE
  );

-- ---------- ③ 视图 v_contract_performance（业绩统计统一口径）----------------
-- 无分配记录 → 100% 归 signer；有分配 → 按 percent 摊。业绩统计一律读本视图。
-- ⚠ 实测 ERROR 1064：MySQL 8 的 `CREATE VIEW` 语法**不支持 COMMENT 子句**（视图本身无法带注释，
--   information_schema.VIEWS.TABLE_COMMENT 恒为空）。故视图口径只由上面这行 SQL 注释承载。
CREATE OR REPLACE VIEW `v_contract_performance` AS
SELECT
  c.`id`              AS contract_id,
  c.`company_id`      AS company_id,
  c.`relation_id`     AS relation_id,
  c.`product_line_id` AS product_line_id,
  c.`signer_id`       AS signer_id,
  COALESCE(s.`employee_id`, c.`signer_id`) AS employee_id,
  COALESCE(s.`percent`, 100.00)            AS percent,
  ROUND(c.`amount` * COALESCE(s.`percent`, 100.00) / 100, 2) AS performance_amount,
  c.`status`          AS status,
  c.`sign_date`       AS sign_date
FROM `contract` c
LEFT JOIN `contract_split` s ON s.`contract_id` = c.`id`;

-- ---------- ④ CHECK 约束 ----------------------------------------------------
-- 审批：申请人 ≠ 审批人（DB 级兜底，应用层再拦一次）
ALTER TABLE `approval`
  ADD CONSTRAINT `chk_approval_not_self` CHECK (`applicant_id` <> `approver_id`);


