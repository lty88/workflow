<script setup lang="tsx">
import { NConfigProvider, zhCN } from 'naive-ui';
import PublicEvaluation from './PublicEvaluation.vue';
</script>
<template>
  <NConfigProvider
    :locale="zhCN"
    :theme-overrides="{
      common: {
        primaryColor: '#235de9',
        borderRadius: '8px',
        fontSize: '14px',
        fontSizeMini: '12px',
        fontSizeTiny: '13px',
      },
    }"
    ><PublicEvaluation
  /></NConfigProvider>
</template>
<style>
body {
  margin: 0;
  background: linear-gradient(160deg, #edf3ff 0%, #f7f9fc 45%, #f4f8fb 100%);
  min-height: 100vh;
  font-family:
    Inter,
    PingFang SC,
    Microsoft YaHei,
    system-ui,
    sans-serif;
}
* {
  box-sizing: border-box;
}
</style>
