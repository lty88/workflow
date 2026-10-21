<script setup lang="tsx">
import {
  zhCN,
  dateZhCN,
  NConfigProvider,
  NMessageProvider,
  NDialogProvider,
  NLoadingBarProvider,
} from 'naive-ui';
import type { GlobalThemeOverrides } from 'naive-ui';
import AppLayout from './components/layout/AppLayout.vue';
const theme: GlobalThemeOverrides = {
  common: {
    primaryColor: '#235de9',
    primaryColorHover: '#4279ee',
    primaryColorPressed: '#194bc5',
    borderRadius: '8px',
    fontFamily: 'Inter, PingFang SC, Microsoft YaHei, system-ui, sans-serif',
    fontSize: '14px',
    fontSizeMini: '12px',
    fontSizeTiny: '13px',
    fontSizeSmall: '14px',
    fontSizeMedium: '14px',
  },
  Card: { borderRadius: '12px' },
  Button: { fontWeight: '500' },
};
</script>
<template>
  <NConfigProvider :locale="zhCN" :date-locale="dateZhCN" :theme-overrides="theme">
    <NLoadingBarProvider
      ><NMessageProvider>
        <NDialogProvider><AppLayout /></NDialogProvider></NMessageProvider></NLoadingBarProvider
  ></NConfigProvider>
</template>
