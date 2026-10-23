<script setup lang="tsx">
import { useRoute } from 'vue-router';
import WorkspacePage from '@/views/workspace/WorkspacePage.vue';

const route = useRoute('/workspace/[pageKey]');
</script>
<template><WorkspacePage :page-key="route.params.pageKey" /></template>
