<script setup lang="tsx">
  import { ref } from 'vue'
  import { useFormValidation } from '@/composables/use-form-validation'
  import { requiredRule } from '@/composables/form-validation'
  import { useRoute, useRouter } from 'vue-router'
  import { NAlert, NButton, NForm, NFormItem, NInput } from 'naive-ui'
  import { useAuthStore } from '@/stores/auth'
  import { useFeedback } from '@/composables/use-feedback'
  import { APP_PATHS } from '@/navigation'
  const auth = useAuthStore()
  const router = useRouter()
  const route = useRoute()
  const feedback = useFeedback()
  const form = ref({ username: '', password: '' })
  const busy = ref(false)
  const { formRef, validate: validateBeforeSubmit } = useFormValidation()
  const formRules = { username: requiredRule('账号'), password: requiredRule('密码') }
  /**
   * 提交账号密码，成功后前往原目标或默认菜单。
   */
  async function signIn(): Promise<void> {
    if (busy.value || !(await validateBeforeSubmit())) return
    busy.value = true
    try {
      await auth.signIn(form.value.username.trim(), form.value.password)
      const redirect = String(route.query.redirect || APP_PATHS.home)
      await router.replace(redirect.startsWith('/') && !redirect.startsWith('//') && !redirect.startsWith(APP_PATHS.login) ? redirect : APP_PATHS.home)
    } catch (error) {
      feedback.failure(error)
    } finally {
      busy.value = false
      form.value.password = ''
    }
  }
</script>
<template>
  <div class="login-page">
    <section class="login-story">
      <div class="brand">
        <span class="brand-symbol">流</span>
        <span>活动流程</span>
      </div>
      <div>
        <span class="eyebrow">ACTIVITY WORKFLOW</span>
        <h1>
          从一个想法，
          <br />
          到一次有序的活动。
        </h1>
        <p>
          申请、审批、执行、归档
          <br />
          让信息与每个参与者顺畅连接。
        </p>
        <div class="login-flow">
          <span>发起申请</span>
          <i>→</i>
          <span>协同审批</span>
          <i>→</i>
          <span>执行归档</span>
        </div>
      </div>
      <small>公司内部活动协同平台</small>
    </section>
    <section class="login-panel">
      <div class="login-form">
        <span class="eyebrow">WELCOME BACK</span>
        <h2>登录工作空间</h2>
        <p class="muted">使用管理员分配的公司账号</p>
        <NAlert v-if="auth.startupError" type="warning" class="mb">{{ auth.startupError }}</NAlert>
        <NForm ref="formRef" :rules="formRules" :model="form" @submit.prevent="signIn">
          <NFormItem label="账号" path="username" required>
            <NInput v-model:value="form.username" autocomplete="username" placeholder="请输入账号" size="large" />
          </NFormItem>
          <NFormItem label="密码" path="password" required>
            <NInput
              v-model:value="form.password"
              type="password"
              show-password-on="click"
              autocomplete="current-password"
              placeholder="请输入密码"
              size="large"
            />
          </NFormItem>
          <NButton attr-type="submit" type="primary" block size="large" :loading="busy" :disabled="busy">登录</NButton>
        </NForm>
        <p class="login-note">首次使用请联系管理员设置密码。</p>
      </div>
    </section>
  </div>
</template>
