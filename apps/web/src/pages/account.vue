<script setup lang="tsx">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { NButton, NCard, NForm, NFormItem, NInput } from 'naive-ui';
import { changePasswordApi } from '../api';
import { useAuthStore } from '../stores/auth';
import { useConfigStore } from '../stores/config';
import { useFeedback } from '../composables/use-feedback';
const auth = useAuthStore();
const config = useConfigStore();
const router = useRouter();
const feedback = useFeedback();
const form = ref({ old: '', password: '', confirm: '' });
const busy = ref(false);
/**
 * 校验确认密码后修改本人密码，撤销全部旧会话。
 */
async function save(): Promise<void> {
  if (form.value.password.length < 12) {
    feedback.failure(new Error('新密码至少12位'));
    return;
  }
  if (form.value.password !== form.value.confirm) {
    feedback.failure(new Error('两次新密码不一致'));
    return;
  }
  busy.value = true;
  try {
    await changePasswordApi(form.value.old, form.value.password);
    auth.apply(null);
    config.reset();
    feedback.success('密码已修改，请重新登录');
    await router.replace('/login');
  } catch (error) {
    feedback.failure(error);
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <div class="page-heading">
    <div>
      <h1>账号安全</h1>
      <p>修改密码后，当前账号的所有会话将退出。</p>
    </div>
  </div>
  <NCard title="修改登录密码" class="narrow-card"
    ><NForm @submit.prevent="save"
      ><NFormItem label="原密码"
        ><NInput v-model:value="form.old" type="password" autocomplete="current-password" /></NFormItem
      ><NFormItem label="新密码（至少12位）"
        ><NInput v-model:value="form.password" type="password" autocomplete="new-password" /></NFormItem
      ><NFormItem label="再次输入新密码"
        ><NInput v-model:value="form.confirm" type="password" autocomplete="new-password" /></NFormItem
      ><NButton type="primary" attr-type="submit" :loading="busy">修改密码</NButton></NForm
    ></NCard
  >
</template>
