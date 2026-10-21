<script setup lang="tsx">
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { NEmpty } from 'naive-ui';
import { useAuthStore } from '../stores/auth';
const auth = useAuthStore();
const router = useRouter();
/**
 * 根据服务端授权的菜单进入默认页面。
 */
function enterWorkspace(): void {
  const first = auth.profile?.menus[0];
  if (first) void router.replace('/workspace/' + first.id);
  else if (auth.can('config:manage')) void router.replace('/settings');
}
onMounted(enterWorkspace);
</script>
<template><NEmpty description="当前账号暂无可访问菜单，请联系管理员分配角色与页面权限。" /></template>
