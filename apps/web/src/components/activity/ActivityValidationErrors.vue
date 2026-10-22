<script setup lang="tsx">
import { NAlert, NButton } from 'naive-ui';
defineProps<{ errors: string[]; disabled?: boolean }>();
const emit = defineEmits<{ locate: [message: string] }>();
</script>
<template>
  <NAlert v-if="errors.length" type="error" title="请完善以下信息" class="mb"
    ><div v-for="error in errors" :key="error" role="alert">
      <NButton text type="error" :disabled="disabled" @click="emit('locate', error)">{{ error }}</NButton>
    </div></NAlert
  >
</template>
