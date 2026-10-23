<script setup lang="tsx">
import { RouterLink } from 'vue-router';
import { NButton, NCard } from 'naive-ui';
import { APP_PATHS } from '@/navigation';
</script>
<template>
  <NCard title="配置中心">
    <p>动态表单、节点、组织、权限与菜单统一以草案方式编辑，校验后发布。</p>
    <RouterLink :to="APP_PATHS.settings"><NButton type="primary">进入配置中心</NButton></RouterLink>
  </NCard>
</template>
