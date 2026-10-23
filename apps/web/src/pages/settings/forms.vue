<script setup lang="tsx">
  import ConfigLayout from '@/components/config/ConfigLayout.vue'
  import FormsPanel from '@/components/config/FormsPanel.vue'
</script>
<template>
  <ConfigLayout v-slot="{ config, update, persist, saving }">
    <FormsPanel :model-value="config" :persist="persist" :saving="saving" @update:model-value="update" />
  </ConfigLayout>
</template>
