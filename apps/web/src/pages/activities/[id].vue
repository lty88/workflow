<script setup lang="tsx">
import { useRoute } from 'vue-router';
import ActivityDetailPage from '@/views/activities/ActivityDetailPage.vue';

const route = useRoute('/activities/[id]');
</script>
<template><ActivityDetailPage :activity-id="route.params.id" /></template>
