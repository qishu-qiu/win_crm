<script setup lang="ts">
import { reactive, ref } from 'vue'

import { login, type UserVo } from '../api/auth'
import { setTokens } from '../api/request'

/**
 * 登录页（→《销售CRM前端页面与交互文档》V1.16 §六「1 登录 /login」）：
 *   · **一个输入框（手机号 或 登录账号名）＋ 密码** —— 走哪条通道由**服务端判别**；
 *     **不做「选通道」下拉**（用户不必知道自己是账号名还是手机号）。
 *   · 亮色简洁（B2）、错误态红（B5）、登录后按角色进首屏（§4.1）。
 *   · 校验按 §4.6：blur 即时 ＋ 提交汇总；错误文案红 12px 置于控件下。
 *
 * ★ 为什么错误只做**内联**、不弹全局提示（与其它接口不同）：
 *   登录失败（401 / 20002）是**用户自己的输入问题**，要指到字段上；弹个飘走的气泡没人看得清。
 *   `api/request.ts` 已对 `/account/login` 跳过全局提示，两边口径一致。
 */
const emit = defineEmits<{ 'logged-in': [user: UserVo] }>()

const form = reactive({ account: '', password: '' })
const submitting = ref(false)
const errorText = ref('')

/** 必填＋长度与后端 DTO 同口径（`LoginDto`：account 1~64、password 6~64，→ §2.4 坏入参 400 / 20001） */
const accountRules = [{ required: true, message: '请输入手机号 或 登录账号名' }]
const passwordRules = [
  { required: true, message: '请输入密码' },
  { min: 6, max: 64, message: '密码长度需为 6~64 位' },
]

async function submit(): Promise<void> {
  errorText.value = ''
  submitting.value = true
  try {
    const result = await login({ account: form.account, password: form.password })
    setTokens(result.access_token, result.refresh_token)
    emit('logged-in', result.user)
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : '登录失败，请稍后重试'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <section class="login-panel">
      <h1 class="login-title">销售 CRM</h1>
      <p class="login-subtitle">请使用公司账号登录</p>

      <a-form :model="form" layout="vertical" @finish="submit">
        <a-form-item label="手机号 / 登录账号名" name="account" :rules="accountRules">
          <a-input
            v-model:value="form.account"
            size="large"
            placeholder="手机号 或 登录账号名"
            autocomplete="username"
            :disabled="submitting"
          />
        </a-form-item>

        <a-form-item label="密码" name="password" :rules="passwordRules">
          <a-input-password
            v-model:value="form.password"
            size="large"
            placeholder="请输入密码"
            autocomplete="current-password"
            :disabled="submitting"
          />
        </a-form-item>

        <p v-if="errorText" class="login-error">{{ errorText }}</p>

        <a-button type="primary" size="large" block html-type="submit" :loading="submitting">
          登录
        </a-button>
      </a-form>
    </section>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--crm-space-xl);
  background: var(--crm-color-bg-layout);
}

.login-panel {
  width: 100%;
  max-width: 380px;
  padding: var(--crm-space-xl);
  background: var(--crm-color-bg-container);
  border: var(--crm-border-width) solid var(--crm-color-border-secondary);
  border-radius: var(--crm-radius-lg);
  box-shadow: var(--crm-shadow-1);
}

.login-title {
  margin: 0;
  font-size: var(--crm-font-size-2xl);
  font-weight: var(--crm-font-weight-strong);
  color: var(--crm-color-text);
}

.login-subtitle {
  margin: var(--crm-space-xs) 0 var(--crm-space-lg);
  font-size: var(--crm-font-size-base);
  color: var(--crm-color-text-tertiary);
}

/** 错误态：§4.6「错误文案红色 12px 置于控件下」 */
.login-error {
  margin: 0 0 var(--crm-space-sm);
  font-size: var(--crm-font-size-xs);
  color: var(--crm-color-error);
}
</style>
