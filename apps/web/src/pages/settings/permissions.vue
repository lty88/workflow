<script setup lang="tsx">
import ConfigLayout from '@/components/config/ConfigLayout.vue';
import PermissionsPanel from '@/components/config/PermissionsPanel.vue';
</script>
<template>
  <ConfigLayout v-slot="{ config, update }"
    ><PermissionsPanel :model-value="config" @update:model-value="update"
  /></ConfigLayout>
</template>
