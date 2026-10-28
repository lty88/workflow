<script setup lang="tsx">
  import { computed } from 'vue'
  import { useRoute } from 'vue-router'
  import ActivityDetailPage from '@/views/activities/ActivityDetailPage.vue'
  const route = useRoute()
  const id = computed(() => String('id' in route.params ? route.params.id : ''))
</script>
<template><ActivityDetailPage :activity-id="id" /></template>
