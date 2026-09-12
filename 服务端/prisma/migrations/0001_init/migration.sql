-- CreateTable
CREATE TABLE `department` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `parent_id` BIGINT UNSIGNED NOT NULL DEFAULT 0,
    `service_enabled` BOOLEAN NOT NULL DEFAULT false,
    `status` VARCHAR(32) NOT NULL DEFAULT 'active',
    `created_by` BIGINT UNSIGNED NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_by` BIGINT UNSIGNED NULL,
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    INDEX `idx_parent_id`(`parent_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employee` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `work_no` VARCHAR(32) NOT NULL,
    `name` VARCHAR(50) NOT NULL,
    `phone` VARCHAR(32) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `primary_dept_id` BIGINT UNSIGNED NOT NULL,
    `extra_dept_ids` JSON NULL,
    `product_line_ids` JSON NULL,
    `direct_manager_id` BIGINT UNSIGNED NULL,
    `status` VARCHAR(32) NOT NULL DEFAULT 'active',
    `created_by` BIGINT UNSIGNED NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_by` BIGINT UNSIGNED NULL,
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    UNIQUE INDEX `uk_work_no`(`work_no`),
    UNIQUE INDEX `uk_phone`(`phone`),
    INDEX `idx_primary_dept_id`(`primary_dept_id`),
    INDEX `idx_direct_manager_id`(`direct_manager_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dept_manager` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `dept_id` BIGINT UNSIGNED NOT NULL,
    `employee_id` BIGINT UNSIGNED NOT NULL,
    `created_by` BIGINT UNSIGNED NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_by` BIGINT UNSIGNED NULL,
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    INDEX `idx_employee_id`(`employee_id`),
    UNIQUE INDEX `uk_dept_emp`(`dept_id`, `employee_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `role` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(32) NOT NULL,
    `name` VARCHAR(50) NOT NULL,
    `is_builtin` BOOLEAN NOT NULL DEFAULT true,
    `created_by` BIGINT UNSIGNED NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_by` BIGINT UNSIGNED NULL,
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    UNIQUE INDEX `uk_code`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employee_role` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `employee_id` BIGINT UNSIGNED NOT NULL,
    `role_code` VARCHAR(32) NOT NULL,
    `created_by` BIGINT UNSIGNED NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_by` BIGINT UNSIGNED NULL,
    `updated_at` DATETIME(0) NOT NULL,

    INDEX `idx_role_code`(`role_code`),
    UNIQUE INDEX `uk_emp_role`(`employee_id`, `role_code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `permission_matrix` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `perm_key` VARCHAR(64) NOT NULL,
    `role_code` VARCHAR(32) NOT NULL,
    `level` VARCHAR(32) NOT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    UNIQUE INDEX `uk_perm_role`(`perm_key`, `role_code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product_line` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(50) NOT NULL,
    `code` VARCHAR(32) NOT NULL,
    `dept_ids` JSON NULL,
    `service_cycle_days` INTEGER NULL,
    `status` VARCHAR(32) NOT NULL DEFAULT 'active',
    `created_by` BIGINT UNSIGNED NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_by` BIGINT UNSIGNED NULL,
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    UNIQUE INDEX `uk_product_line_name`(`name`),
    UNIQUE INDEX `uk_code`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dept_rule` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `dept_id` BIGINT UNSIGNED NOT NULL,
    `level_tiers` JSON NULL,
    `gray_remind_days` INTEGER NULL,
    `s_social_days` INTEGER NULL,
    `newbie_first_follow_hours` INTEGER NULL,
    `ask_help_days` INTEGER NULL,
    `contact_trait_max` INTEGER NOT NULL DEFAULT 3,
    `nearby_radius_km` INTEGER NULL,
    `created_by` BIGINT UNSIGNED NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_by` BIGINT UNSIGNED NULL,
    `updated_at` DATETIME(0) NOT NULL,

    UNIQUE INDEX `uk_dept_id`(`dept_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `title` VARCHAR(120) NOT NULL,
    `content` VARCHAR(500) NULL,
    `biz_type` VARCHAR(32) NULL,
    `biz_id` BIGINT UNSIGNED NULL,
    `channel` VARCHAR(16) NOT NULL DEFAULT 'site',
    `read_at` DATETIME(0) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    INDEX `idx_user_read`(`user_id`, `read_at`, `created_at`),
    INDEX `idx_biz`(`biz_type`, `biz_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `operation_log` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `occurred_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `req_id` VARCHAR(64) NULL,
    `operator_id` BIGINT UNSIGNED NOT NULL DEFAULT 0,
    `operator_name` VARCHAR(50) NULL,
    `dept_id` BIGINT UNSIGNED NULL,
    `product_line_id` BIGINT UNSIGNED NULL,
    `action` VARCHAR(64) NOT NULL,
    `target_type` VARCHAR(32) NULL,
    `target_id` BIGINT UNSIGNED NULL,
    `before` JSON NULL,
    `after` JSON NULL,
    `detail` JSON NULL,
    `ip` VARCHAR(64) NULL,
    `user_agent` VARCHAR(255) NULL,

    INDEX `idx_operator`(`operator_id`, `occurred_at`),
    INDEX `idx_target`(`target_type`, `target_id`),
    INDEX `idx_action`(`action`, `occurred_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dict_type` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(64) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `created_by` BIGINT UNSIGNED NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_by` BIGINT UNSIGNED NULL,
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    UNIQUE INDEX `uk_code`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dict_item` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `type_id` BIGINT UNSIGNED NOT NULL,
    `item_code` VARCHAR(64) NOT NULL,
    `label` VARCHAR(80) NOT NULL,
    `sort` INTEGER NOT NULL DEFAULT 0,
    `builtin` BOOLEAN NOT NULL DEFAULT false,
    `status` VARCHAR(32) NOT NULL DEFAULT 'active',
    `created_by` BIGINT UNSIGNED NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_by` BIGINT UNSIGNED NULL,
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    INDEX `idx_type_sort`(`type_id`, `status`, `sort`),
    UNIQUE INDEX `uk_type_item`(`type_id`, `item_code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `system_config` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `config_key` VARCHAR(64) NOT NULL,
    `value` JSON NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_by` BIGINT UNSIGNED NULL,
    `updated_at` DATETIME(0) NOT NULL,

    UNIQUE INDEX `uk_config_key`(`config_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `job_run_log` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `job_name` VARCHAR(64) NOT NULL,
    `run_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `status` VARCHAR(16) NOT NULL,
    `rows_affected` INTEGER NOT NULL DEFAULT 0,
    `cost_ms` INTEGER NOT NULL DEFAULT 0,
    `watermark` VARCHAR(64) NULL,
    `error` TEXT NULL,

    INDEX `idx_job_time`(`job_name`, `run_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `target` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `period` VARCHAR(7) NOT NULL,
    `scope_type` VARCHAR(16) NOT NULL,
    `scope_id` BIGINT UNSIGNED NOT NULL DEFAULT 0,
    `amount` DECIMAL(12, 2) NOT NULL,
    `remark` VARCHAR(255) NULL,
    `created_by` BIGINT UNSIGNED NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_by` BIGINT UNSIGNED NULL,
    `updated_at` DATETIME(0) NOT NULL,

    INDEX `idx_period`(`period`),
    UNIQUE INDEX `uk_target`(`period`, `scope_type`, `scope_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `company` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `full_name` VARCHAR(200) NOT NULL,
    `name_core` VARCHAR(200) NULL,
    `credit_code` VARCHAR(32) NULL,
    `industry_l1` VARCHAR(64) NULL,
    `industry_l2` VARCHAR(64) NULL,
    `province` VARCHAR(32) NULL,
    `city` VARCHAR(32) NULL,
    `district` VARCHAR(32) NULL,
    `scale` VARCHAR(32) NULL,
    `completeness_1` INTEGER NOT NULL DEFAULT 0,
    `completeness_2` INTEGER NOT NULL DEFAULT 0,
    `completeness_3` INTEGER NOT NULL DEFAULT 0,
    `website` VARCHAR(255) NULL,
    `address` VARCHAR(255) NULL,
    `bank_name` VARCHAR(120) NULL,
    `invoice_title` VARCHAR(200) NULL,
    `tax_no` VARCHAR(64) NULL,
    `longitude` DECIMAL(10, 6) NULL,
    `latitude` DECIMAL(9, 6) NULL,
    `merged_into` BIGINT UNSIGNED NULL,
    `aliases` JSON NULL,
    `created_by` BIGINT UNSIGNED NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_by` BIGINT UNSIGNED NULL,
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    UNIQUE INDEX `uk_credit_code`(`credit_code`),
    INDEX `idx_full_name`(`full_name`),
    INDEX `idx_name_core`(`name_core`),
    INDEX `idx_geo`(`latitude`, `longitude`),
    INDEX `idx_merged`(`merged_into`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `company_profile_tag` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `company_id` BIGINT UNSIGNED NOT NULL,
    `group_code` VARCHAR(32) NOT NULL,
    `tag_id` BIGINT UNSIGNED NOT NULL,
    `tag_code` VARCHAR(64) NOT NULL,
    `marked_by` BIGINT UNSIGNED NOT NULL,
    `marked_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_tag`(`tag_id`),
    UNIQUE INDEX `uk_cpt`(`company_id`, `group_code`, `tag_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `contact` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(50) NOT NULL,
    `phone` VARCHAR(32) NOT NULL,
    `phone_active` VARCHAR(32) NULL,
    `extra_phones` JSON NULL,
    `wechat` VARCHAR(64) NULL,
    `email` VARCHAR(120) NULL,
    `gender` VARCHAR(8) NULL,
    `birthday` DATE NULL,
    `decision_role` VARCHAR(16) NULL,
    `tags` JSON NULL,
    `trait_summary` JSON NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'active',
    `merged_into` BIGINT UNSIGNED NULL,
    `phone_frozen_until` DATETIME(0) NULL,
    `created_by` BIGINT UNSIGNED NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_by` BIGINT UNSIGNED NULL,
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    INDEX `idx_name`(`name`),
    INDEX `idx_merged_contact`(`merged_into`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `contact_trait` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `contact_id` BIGINT UNSIGNED NOT NULL,
    `trait_id` BIGINT UNSIGNED NOT NULL,
    `trait_code` VARCHAR(64) NOT NULL,
    `marked_by` BIGINT UNSIGNED NOT NULL,
    `marked_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_trait`(`trait_id`),
    UNIQUE INDEX `uk_ct`(`contact_id`, `trait_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `company_contact` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `company_id` BIGINT UNSIGNED NOT NULL,
    `contact_id` BIGINT UNSIGNED NOT NULL,
    `is_current` BOOLEAN NOT NULL DEFAULT true,
    `joined_at` DATETIME(0) NULL,
    `left_at` DATETIME(0) NULL,
    `position` VARCHAR(64) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    INDEX `idx_company_cur`(`company_id`, `is_current`),
    INDEX `idx_contact_cur`(`contact_id`, `is_current`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `contact_change_log` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `contact_id` BIGINT UNSIGNED NOT NULL,
    `field` VARCHAR(32) NOT NULL,
    `old_value` VARCHAR(255) NULL,
    `new_value` VARCHAR(255) NULL,
    `approval_id` BIGINT UNSIGNED NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_contact_time`(`contact_id`, `created_at`),
    INDEX `idx_approval`(`approval_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `file_asset` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `biz_type` VARCHAR(32) NOT NULL,
    `biz_id` BIGINT UNSIGNED NOT NULL,
    `file_name` VARCHAR(255) NOT NULL,
    `file_key` VARCHAR(500) NOT NULL,
    `file_size` INTEGER NULL,
    `mime_type` VARCHAR(120) NULL,
    `uploaded_by` BIGINT UNSIGNED NOT NULL,
    `uploaded_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `status` VARCHAR(16) NOT NULL DEFAULT 'active',

    INDEX `idx_biz`(`biz_type`, `biz_id`, `status`),
    INDEX `idx_uploader`(`uploaded_by`, `uploaded_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `business_relation` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `company_id` BIGINT UNSIGNED NOT NULL,
    `dept_id` BIGINT UNSIGNED NOT NULL,
    `product_line_id` BIGINT UNSIGNED NOT NULL,
    `stage_id` INTEGER NOT NULL DEFAULT 1,
    `urgency` VARCHAR(16) NOT NULL DEFAULT 'gray',
    `value_tier` VARCHAR(16) NULL,
    `customer_level` VARCHAR(4) NULL,
    `competition` VARCHAR(16) NULL,
    `competitor_id` BIGINT UNSIGNED NULL,
    `sea_status` VARCHAR(16) NOT NULL DEFAULT 'private',
    `last_event_at` DATETIME(0) NULL,
    `next_action_hint` VARCHAR(255) NULL,
    `merged_into` BIGINT UNSIGNED NULL,
    `active_key` VARCHAR(128) NULL,
    `created_by` BIGINT UNSIGNED NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_by` BIGINT UNSIGNED NULL,
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    INDEX `idx_company`(`company_id`),
    INDEX `idx_sea_scan`(`last_event_at`, `sea_status`),
    INDEX `idx_dept_sea`(`dept_id`, `product_line_id`, `sea_status`),
    INDEX `idx_merged_rel`(`merged_into`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `relation_member` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `relation_id` BIGINT UNSIGNED NOT NULL,
    `employee_id` BIGINT UNSIGNED NOT NULL,
    `member_type` VARCHAR(16) NOT NULL,
    `source` VARCHAR(16) NULL,
    `valid_until` DATETIME(0) NULL,
    `added_by` BIGINT UNSIGNED NULL,
    `added_at` DATETIME(0) NULL,
    `revoked_by` BIGINT UNSIGNED NULL,
    `revoked_at` DATETIME(0) NULL,
    `owner_flag` BIGINT UNSIGNED NULL,

    INDEX `idx_my`(`employee_id`, `member_type`, `valid_until`),
    INDEX `idx_relation`(`relation_id`),
    UNIQUE INDEX `uk_member`(`relation_id`, `employee_id`, `member_type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `relation_stage_log` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `relation_id` BIGINT UNSIGNED NOT NULL,
    `from_stage` INTEGER NULL,
    `to_stage` INTEGER NOT NULL,
    `action` VARCHAR(16) NOT NULL,
    `reason` VARCHAR(255) NULL,
    `operator_id` BIGINT UNSIGNED NOT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_rel_time`(`relation_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `relation_label` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `relation_id` BIGINT UNSIGNED NOT NULL,
    `group_code` VARCHAR(32) NOT NULL,
    `label_id` BIGINT UNSIGNED NOT NULL,
    `label_code` VARCHAR(64) NOT NULL,
    `marked_by` BIGINT UNSIGNED NOT NULL,
    `marked_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `remark` VARCHAR(255) NULL,

    INDEX `idx_label`(`label_id`),
    UNIQUE INDEX `uk_rel_label`(`relation_id`, `group_code`, `label_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `appointment` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `relation_id` BIGINT UNSIGNED NOT NULL,
    `contact_id` BIGINT UNSIGNED NULL,
    `appointment_at` DATETIME(0) NOT NULL,
    `note` VARCHAR(255) NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'pending',
    `action_event_id` BIGINT UNSIGNED NULL,
    `reschedule_log` JSON NULL,
    `created_by` BIGINT UNSIGNED NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_by` BIGINT UNSIGNED NULL,
    `updated_at` DATETIME(0) NOT NULL,

    INDEX `idx_rel_time`(`relation_id`, `appointment_at`, `status`),
    INDEX `idx_contact`(`contact_id`),
    INDEX `idx_due`(`appointment_at`, `status`),
    INDEX `idx_event`(`action_event_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `visit_log` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `employee_id` BIGINT UNSIGNED NOT NULL,
    `depart_at` DATETIME(0) NOT NULL,
    `reason` VARCHAR(255) NOT NULL,
    `actual_return_at` DATETIME(0) NULL,
    `relation_ids` JSON NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    INDEX `idx_emp_time`(`employee_id`, `depart_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `competitor` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `product_line_id` BIGINT UNSIGNED NOT NULL,
    `positioning` VARCHAR(255) NULL,
    `note` VARCHAR(255) NULL,
    `created_by` BIGINT UNSIGNED NULL,
    `updated_by` BIGINT UNSIGNED NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'active',
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    INDEX `idx_line_status`(`product_line_id`, `status`),
    UNIQUE INDEX `uk_name_line`(`name`, `product_line_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `commitment` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `relation_id` BIGINT UNSIGNED NOT NULL,
    `contact_id` BIGINT UNSIGNED NULL,
    `owner_id` BIGINT UNSIGNED NOT NULL,
    `party` VARCHAR(16) NOT NULL,
    `ctype` VARCHAR(24) NOT NULL,
    `content` VARCHAR(255) NOT NULL,
    `due_at` DATETIME(0) NULL,
    `remind_at` DATETIME(0) NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'open',
    `done_at` DATETIME(0) NULL,
    `done_by` BIGINT UNSIGNED NULL,
    `source_event_id` BIGINT UNSIGNED NULL,
    `closed_event_id` BIGINT UNSIGNED NULL,
    `created_by` BIGINT UNSIGNED NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_by` BIGINT UNSIGNED NULL,
    `updated_at` DATETIME(0) NOT NULL,

    INDEX `idx_owner_due`(`owner_id`, `status`, `due_at`),
    INDEX `idx_relation`(`relation_id`),
    INDEX `idx_due`(`status`, `due_at`),
    INDEX `idx_contact`(`contact_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `action_event` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `relation_id` BIGINT UNSIGNED NULL,
    `contact_id` BIGINT UNSIGNED NULL,
    `actor_id` BIGINT UNSIGNED NOT NULL,
    `owner_snapshot` BIGINT UNSIGNED NULL,
    `action_type` VARCHAR(16) NOT NULL,
    `summary` VARCHAR(500) NULL,
    `outcome` VARCHAR(16) NULL,
    `stage_forward` INTEGER NULL,
    `pain_point_id` BIGINT UNSIGNED NULL,
    `competition` VARCHAR(16) NULL,
    `competitor_id` BIGINT UNSIGNED NULL,
    `competition_note` VARCHAR(255) NULL,
    `duration_min` INTEGER NULL,
    `mentioned_user_ids` JSON NULL,
    `source` VARCHAR(16) NOT NULL DEFAULT 'manual',
    `visit_log_id` BIGINT UNSIGNED NULL,
    `appointment_id` BIGINT UNSIGNED NULL,
    `idempotency_key` VARCHAR(64) NULL,
    `attachments` JSON NULL,
    `event_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    INDEX `idx_rel_time`(`relation_id`, `event_at`),
    INDEX `idx_rel_owner`(`relation_id`, `owner_snapshot`, `event_at`),
    INDEX `idx_actor_time`(`actor_id`, `event_at`),
    INDEX `idx_pain`(`pain_point_id`),
    INDEX `idx_appointment`(`appointment_id`),
    INDEX `idx_contact`(`contact_id`, `event_at`),
    UNIQUE INDEX `uk_idem`(`idempotency_key`, `event_at`),
    CONSTRAINT `chk_action_event_subject` CHECK ((`relation_id` IS NOT NULL) OR (`contact_id` IS NOT NULL)),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cadence_rule` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `scope_dept_id` BIGINT UNSIGNED NULL,
    `scope_line_id` BIGINT UNSIGNED NULL,
    `trigger` JSON NOT NULL,
    `suggest_action` JSON NULL,
    `soft` BOOLEAN NOT NULL DEFAULT true,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `sort` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    INDEX `idx_scope`(`scope_dept_id`, `scope_line_id`, `enabled`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `daily_agenda` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `biz_date` DATE NOT NULL,
    `ref_type` VARCHAR(16) NOT NULL,
    `ref_id` BIGINT UNSIGNED NULL,
    `relation_id` BIGINT UNSIGNED NULL,
    `contact_id` BIGINT UNSIGNED NULL,
    `reason` VARCHAR(255) NULL,
    `priority` INTEGER NOT NULL DEFAULT 0,
    `action_hint` VARCHAR(255) NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'open',
    `action_reason` VARCHAR(255) NULL,
    `snooze_count` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    INDEX `idx_user_day`(`user_id`, `biz_date`, `status`),
    INDEX `idx_ref`(`ref_type`, `ref_id`),
    INDEX `idx_relation`(`relation_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `review` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `relation_id` BIGINT UNSIGNED NOT NULL,
    `review_type` VARCHAR(8) NOT NULL,
    `why_code` VARCHAR(64) NULL,
    `competitor_id` BIGINT UNSIGNED NULL,
    `detail` VARCHAR(500) NULL,
    `manager_note` VARCHAR(500) NULL,
    `status` VARCHAR(16) NOT NULL,
    `created_by` BIGINT UNSIGNED NULL,
    `manager_id` BIGINT UNSIGNED NULL,
    `manager_done_at` DATETIME(0) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    INDEX `idx_status_time`(`status`, `created_at`),
    INDEX `idx_relation`(`relation_id`),
    INDEX `idx_type_status`(`review_type`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `stat_daily` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `biz_date` DATE NOT NULL,
    `dept_id` BIGINT UNSIGNED NOT NULL,
    `product_line_id` BIGINT UNSIGNED NOT NULL,
    `owner_id` BIGINT UNSIGNED NOT NULL,
    `action_type` VARCHAR(16) NOT NULL,
    `cnt` INTEGER NOT NULL DEFAULT 0,
    `first_at` DATETIME(0) NULL,
    `last_at` DATETIME(0) NULL,

    INDEX `idx_owner_day`(`owner_id`, `biz_date`),
    UNIQUE INDEX `uk_stat`(`biz_date`, `dept_id`, `product_line_id`, `owner_id`, `action_type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `contract` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `contract_no` VARCHAR(64) NOT NULL,
    `relation_id` BIGINT UNSIGNED NOT NULL,
    `company_id` BIGINT UNSIGNED NOT NULL,
    `product_line_id` BIGINT UNSIGNED NOT NULL,
    `contact_id` BIGINT UNSIGNED NULL,
    `signer_id` BIGINT UNSIGNED NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `paid_amount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `pay_type` VARCHAR(32) NULL,
    `sign_date` DATE NULL,
    `service_start` DATE NULL,
    `service_end` DATE NULL,
    `auto_renew` BOOLEAN NOT NULL DEFAULT false,
    `remind_days` JSON NULL,
    `attachments` JSON NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'unpaid',
    `created_by` BIGINT UNSIGNED NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_by` BIGINT UNSIGNED NULL,
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    UNIQUE INDEX `uk_contract_no`(`contract_no`),
    INDEX `idx_relation`(`relation_id`),
    INDEX `idx_company`(`company_id`),
    INDEX `idx_signer`(`signer_id`),
    INDEX `idx_expire`(`service_end`, `status`),
    INDEX `idx_line_status`(`product_line_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payment_record` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `contract_id` BIGINT UNSIGNED NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `paid_at` DATETIME(0) NOT NULL,
    `method` VARCHAR(32) NULL,
    `voucher_file_id` BIGINT UNSIGNED NULL,
    `created_by` BIGINT UNSIGNED NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    INDEX `idx_contract`(`contract_id`),
    INDEX `idx_paid_at`(`paid_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `workorder` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `order_no` VARCHAR(64) NOT NULL,
    `type` VARCHAR(16) NOT NULL,
    `relation_id` BIGINT UNSIGNED NULL,
    `title` VARCHAR(200) NOT NULL,
    `content` TEXT NULL,
    `source` VARCHAR(32) NULL,
    `priority` VARCHAR(8) NULL,
    `assignee_id` BIGINT UNSIGNED NULL,
    `sla_deadline` DATETIME(0) NULL,
    `est_effort_min` INTEGER NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'created',
    `upgraded_from_id` BIGINT UNSIGNED NULL,
    `created_by` BIGINT UNSIGNED NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_by` BIGINT UNSIGNED NULL,
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    UNIQUE INDEX `uk_order_no`(`order_no`),
    INDEX `idx_relation`(`relation_id`),
    INDEX `idx_assignee`(`assignee_id`, `status`, `sla_deadline`),
    INDEX `idx_sla`(`status`, `sla_deadline`),
    INDEX `idx_upgraded`(`upgraded_from_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `workorder_log` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `workorder_id` BIGINT UNSIGNED NOT NULL,
    `action` VARCHAR(32) NOT NULL,
    `from_status` VARCHAR(16) NULL,
    `to_status` VARCHAR(16) NULL,
    `reason` VARCHAR(255) NULL,
    `operator_id` BIGINT UNSIGNED NOT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_wo_time`(`workorder_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ledger` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `contract_id` BIGINT UNSIGNED NOT NULL,
    `company_id` BIGINT UNSIGNED NOT NULL,
    `product_line_id` BIGINT UNSIGNED NOT NULL,
    `customer_level` VARCHAR(4) NULL,
    `sign_date` DATE NULL,
    `expire_date` DATE NULL,
    `contact_id` BIGINT UNSIGNED NULL,
    `sales_id` BIGINT UNSIGNED NULL,
    `delivery_id` BIGINT UNSIGNED NULL,
    `remark` VARCHAR(500) NULL,
    `extra_fields` JSON NULL,
    `created_by` BIGINT UNSIGNED NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_by` BIGINT UNSIGNED NULL,
    `updated_at` DATETIME(0) NOT NULL,

    INDEX `idx_line_expire`(`product_line_id`, `expire_date`),
    INDEX `idx_contract`(`contract_id`),
    INDEX `idx_company`(`company_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `field_template` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `product_line_id` BIGINT UNSIGNED NOT NULL,
    `field_key` VARCHAR(64) NOT NULL,
    `label` VARCHAR(80) NOT NULL,
    `control_type` VARCHAR(16) NOT NULL,
    `required` BOOLEAN NOT NULL DEFAULT false,
    `sort` INTEGER NOT NULL DEFAULT 0,
    `show_in_list` BOOLEAN NOT NULL DEFAULT false,
    `options` JSON NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'active',
    `created_by` BIGINT UNSIGNED NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_by` BIGINT UNSIGNED NULL,
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    INDEX `idx_line_sort`(`product_line_id`, `status`, `sort`),
    UNIQUE INDEX `uk_line_key`(`product_line_id`, `field_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `contract_split` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `contract_id` BIGINT UNSIGNED NOT NULL,
    `employee_id` BIGINT UNSIGNED NOT NULL,
    `percent` DECIMAL(5, 2) NOT NULL,
    `created_by` BIGINT UNSIGNED NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_employee`(`employee_id`),
    UNIQUE INDEX `uk_split`(`contract_id`, `employee_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `sign_checklist` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `product_line_id` BIGINT UNSIGNED NOT NULL,
    `scope` VARCHAR(16) NOT NULL,
    `field_key` VARCHAR(64) NOT NULL,
    `label` VARCHAR(128) NOT NULL,
    `required` TINYINT(1) NOT NULL DEFAULT 1,
    `sort` INT NOT NULL DEFAULT 0,
    `status` VARCHAR(16) NOT NULL DEFAULT 'active',
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_line_status`(`product_line_id`, `status`, `sort`),
    UNIQUE INDEX `uk_line_scope_field`(`product_line_id`, `scope`, `field_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sea_rule` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `level` TINYINT NOT NULL,
    `dept_id` BIGINT UNSIGNED NULL,
    `product_line_id` BIGINT UNSIGNED NULL,
    `follow_freq_days` INTEGER NULL,
    `deal_cycle_days` INTEGER NULL,
    `stay_days` INTEGER NULL,
    `no_progress_max` INTEGER NULL,
    `effective_from` DATETIME(0) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'active',
    `created_by` BIGINT UNSIGNED NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_by` BIGINT UNSIGNED NULL,
    `updated_at` DATETIME(0) NOT NULL,

    INDEX `idx_level`(`level`, `dept_id`, `product_line_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sea_record` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `relation_id` BIGINT UNSIGNED NOT NULL,
    `owner_id` BIGINT UNSIGNED NOT NULL,
    `from_sea` VARCHAR(16) NOT NULL,
    `to_sea` VARCHAR(16) NOT NULL,
    `reason` VARCHAR(32) NOT NULL,
    `dropped_at` DATETIME(0) NOT NULL,
    `claimed_by` BIGINT UNSIGNED NULL,
    `claimed_at` DATETIME(0) NULL,

    INDEX `idx_rel_time`(`relation_id`, `dropped_at`),
    INDEX `idx_owner`(`owner_id`, `dropped_at`),
    INDEX `idx_claimer`(`claimed_by`, `claimed_at`),
    INDEX `idx_drop`(`dropped_at`, `to_sea`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `approval` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `type` VARCHAR(24) NOT NULL,
    `applicant_id` BIGINT UNSIGNED NOT NULL,
    `approver_id` BIGINT UNSIGNED NOT NULL,
    `target_type` VARCHAR(32) NULL,
    `target_id` BIGINT UNSIGNED NULL,
    `payload` JSON NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'pending',
    `comment` VARCHAR(500) NULL,
    `handled_at` DATETIME(0) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    INDEX `idx_approver`(`approver_id`, `status`, `created_at`),
    INDEX `idx_applicant`(`applicant_id`, `created_at`),
    INDEX `idx_target`(`target_type`, `target_id`),
    INDEX `idx_type_status`(`type`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

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
ALTER TABLE `business_relation` ADD CONSTRAINT `business_relation_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `business_relation` ADD CONSTRAINT `business_relation_dept_id_fkey` FOREIGN KEY (`dept_id`) REFERENCES `department`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `business_relation` ADD CONSTRAINT `business_relation_product_line_id_fkey` FOREIGN KEY (`product_line_id`) REFERENCES `product_line`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `relation_member` ADD CONSTRAINT `relation_member_relation_id_fkey` FOREIGN KEY (`relation_id`) REFERENCES `business_relation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

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
    GENERATED ALWAYS AS (IF(`deleted_at` IS NULL, `phone`, NULL)) STORED;
CREATE UNIQUE INDEX `uk_phone_active` ON `contact` (`phone_active`);

-- 2) business_relation.active_key：仅「私海且未并」占活跃位（同 公司×部门×产品线 仅一条活跃）
ALTER TABLE `business_relation`
  DROP COLUMN `active_key`,
  ADD COLUMN `active_key` VARCHAR(128)
    GENERATED ALWAYS AS (
      IF(`sea_status` = 'private' AND `merged_into` IS NULL,
         CONCAT_WS('-', `company_id`, `dept_id`, `product_line_id`),
         NULL)
    ) STORED;
CREATE UNIQUE INDEX `uk_active_rel` ON `business_relation` (`active_key`);

-- 3) relation_member.owner_flag：一关系仅一 owner
ALTER TABLE `relation_member`
  DROP COLUMN `owner_flag`,
  ADD COLUMN `owner_flag` BIGINT UNSIGNED
    GENERATED ALWAYS AS (IF(`member_type` = 'owner', `relation_id`, NULL)) STORED;
CREATE UNIQUE INDEX `uk_owner` ON `relation_member` (`owner_flag`);

-- ---------- ② 5 张分区表改造（按 月 RANGE 分区）-----------------------------
-- ⚠ MySQL 规则：每个唯一键（含主键）都必须包含分区列，否则报 ERROR 1503。
--    故先扩主键含分区列 → 再 PARTITION BY RANGE。分区按月滚动维护（定时任务补新分区、归档旧分区）。

-- action_event（分区键 event_at）
ALTER TABLE `action_event`
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (`id`, `event_at`),
  PARTITION BY RANGE (YEAR(`event_at`) * 100 + MONTH(`event_at`)) (
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

-- daily_agenda（分区键 biz_date）
ALTER TABLE `daily_agenda`
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (`id`, `biz_date`),
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

-- stat_daily（分区键 biz_date）
ALTER TABLE `stat_daily`
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (`id`, `biz_date`),
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
  ADD PRIMARY KEY (`id`, `occurred_at`),
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
  ADD PRIMARY KEY (`id`, `run_at`),
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


