<script setup lang="ts">
import { computed } from 'vue'

import type { UserVo } from '../api/auth'
import { homeNameOf, roleNameOf } from '../home'

/**
 * 首屏空壳（M1-18）—— 登录成功后的落点。
 *
 * ★ 这个页面**故意不填任何数据**（→ 设计规范 §3.2 第 11 条「禁假数据撑页面」，
 *   §5.1 空态）：M1 只验证「真账号能登进来、能拿到我是谁」。
 *   页面标题取 `homeNameOf(role)`，即规格里那名角色的**真实首屏名**
 *   （销售→工作台 / 经理→数据看板 / 管理员→组织架构），不写「欢迎使用」。
 */
const props = defineProps<{ user: UserVo }>()
const emit = defineEmits<{ logout: [] }>()

const homeName = computed(() => homeNameOf(props.user.role))
const roleName = computed(() => roleNameOf(props.user.role))
const deptName = computed(() => props.user.dept?.name ?? '未分配部门')
</script>

<template>
  <div class="shell">
    <header class="shell-header">
      <div class="shell-identity">
        <span class="shell-name">{{ user.name }}</span>
        <span class="shell-role">{{ roleName }}</span>
        <span class="shell-dept">{{ deptName }}</span>
      </div>
      <a-button type="text" @click="emit('logout')">退出登录</a-button>
    </header>

    <main class="shell-body">
      <h1 class="shell-title">{{ homeName }}</h1>
      <a-empty description="登录链路已打通；本角色首屏将在后续里程碑接入（M2 起：建档 → 建关系 → 写跟单）" />
    </main>
  </div>
</template>

<style scoped>
.shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--crm-color-bg-layout);
}

.shell-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 56px;
  padding: 0 var(--crm-space-lg);
  background: var(--crm-color-bg-container);
  border-bottom: var(--crm-border-width) solid var(--crm-color-border-secondary);
}

.shell-identity {
  display: flex;
  align-items: center;
  gap: var(--crm-space-sm);
}

.shell-name {
  font-size: var(--crm-font-size-lg);
  font-weight: var(--crm-font-weight-strong);
  color: var(--crm-color-text);
}

/** 角色 / 部门用中性小标（§4.4「状态统一用圆点+文字」；此处是身份标，不占语义色） */
.shell-role,
.shell-dept {
  padding: 0 var(--crm-space-xs);
  font-size: var(--crm-font-size-xs);
  line-height: 20px;
  color: var(--crm-color-text-secondary);
  background: var(--crm-color-fill-alter);
  border: var(--crm-border-width) solid var(--crm-color-border-secondary);
  border-radius: var(--crm-radius-sm);
}

.shell-body {
  flex: 1;
  padding: var(--crm-space-xl) var(--crm-space-lg);
}

.shell-title {
  margin: 0 0 var(--crm-space-lg);
  font-size: var(--crm-font-size-2xl);
  font-weight: var(--crm-font-weight-strong);
  color: var(--crm-color-text);
}
</style>
