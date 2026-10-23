<script setup lang="tsx">
import { RouterLink } from 'vue-router';
import { NButton, NResult } from 'naive-ui';
import { APP_PATHS } from '@/navigation';
</script>
<template>
  <NResult status="404" title="页面不存在" description="菜单可能已停用，或链接地址有误。"
    ><template #footer
      ><RouterLink :to="APP_PATHS.home"><NButton type="primary">返回工作台</NButton></RouterLink></template
    ></NResult
  >
</template>
