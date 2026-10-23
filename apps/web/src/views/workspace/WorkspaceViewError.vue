<script setup lang="tsx">
import { NAlert, NButton } from 'naive-ui';

/** 重新加载页面以获取最新版本的业务组件，触发浏览器刷新。 */
function reload(): void {
  window.location.reload();
}
</script>
<template>
  <NAlert type="error" title="页面组件加载失败">
    请检查网络后重新加载。
    <NButton text @click="reload">重新加载页面</NButton>
  </NAlert>
</template>
