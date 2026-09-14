<script setup lang="ts">
import { computed } from 'vue'

import type { UserVo } from '../api/auth'
import { homeNameOf } from '../home'

/**
 * 首屏空壳（M1-18）—— 登录成功后的落点（**只渲染正文**，顶栏 / 导航 / 退出在外壳 `App.vue`）。
 *
 * ★ 这个页面**故意不填任何数据**（→ 设计规范 §3.2 第 11 条「禁假数据撑页面」，
 *   §5.1 空态）：M1 只验证「真账号能登进来、能拿到我是谁」。
 *   页面标题取 `homeNameOf(role)`，即规格里那名角色的**真实首屏名**
 *   （销售→工作台 / 经理→数据看板 / 管理员→组织架构），不写「欢迎使用」。
 * ★ M2-17 起：真正的建档动作在**建档页**（外壳导航第二项），本页仍是空壳，
 *   等 M4 的工作台接口落地后再填真实动线（不提前造）。
 */
const props = defineProps<{ user: UserVo }>()

const homeName = computed(() => homeNameOf(props.user.role))
</script>

<template>
  <section class="workbench">
    <h2 class="workbench-title">{{ homeName }}</h2>
    <a-empty
      description="登录链路已打通；本角色首屏将在后续里程碑接入（建档页已可用 → 顶栏「建档」）"
    />
  </section>
</template>

<style scoped>
.workbench-title {
  margin: 0 0 var(--crm-space-lg);
  font-size: var(--crm-font-size-2xl);
  font-weight: var(--crm-font-weight-strong);
  color: var(--crm-color-text);
}
</style>
