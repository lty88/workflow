<script setup lang="tsx">
  import ConfigLayout from '@/components/config/ConfigLayout.vue'
  import OrganizationPanel from '@/components/config/OrganizationPanel.vue'
</script>
<template>
  <ConfigLayout v-slot="{ config, update, persist, saving, removeMember, batchMembers }">
    <OrganizationPanel
      :model-value="config"
      :persist="persist"
      :saving="saving"
      :remove-member="removeMember"
      :batch-members="batchMembers"
      @update:model-value="update"
    />
  </ConfigLayout>
</template>
