<script setup lang="tsx">
import ConfigLayout from '../../components/config/ConfigLayout.vue';
import MenusPanel from '../../components/config/MenusPanel.vue';
</script>
<template>
  <ConfigLayout v-slot="{ config, update }"
    ><MenusPanel :model-value="config" @update:model-value="update"
  /></ConfigLayout>
</template>
