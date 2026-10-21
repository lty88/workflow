<script setup lang="tsx">
import ConfigLayout from '../../components/config/ConfigLayout.vue';
import WorkflowPanel from '../../components/config/WorkflowPanel.vue';
</script>
<template>
  <ConfigLayout v-slot="{ config, update }"
    ><WorkflowPanel :model-value="config" @update:model-value="update"
  /></ConfigLayout>
</template>
