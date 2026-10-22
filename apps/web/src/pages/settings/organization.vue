<script setup lang="tsx">
import ConfigLayout from '@/components/config/ConfigLayout.vue';
import OrganizationPanel from '@/components/config/OrganizationPanel.vue';
</script>
<template>
  <ConfigLayout v-slot="{ config, update }"
    ><OrganizationPanel :model-value="config" @update:model-value="update"
  /></ConfigLayout>
</template>
