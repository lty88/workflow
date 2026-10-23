<script setup lang="tsx">
  import ConfigLayout from '@/components/config/ConfigLayout.vue'
  import MenusPanel from '@/components/config/MenusPanel.vue'
</script>
<template>
  <ConfigLayout v-slot="{ config, update, persist, saving }">
    <MenusPanel :model-value="config" :persist="persist" :saving="saving" @update:model-value="update" />
  </ConfigLayout>
</template>
