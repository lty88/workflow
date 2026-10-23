<script setup lang="tsx">
import { RouterLink } from 'vue-router';
import { NCard } from 'naive-ui';
import ConfigLayout from '@/components/config/ConfigLayout.vue';
import { SETTINGS_SECTIONS } from '@/navigation';
const modules = SETTINGS_SECTIONS;
</script>
<template>
  <ConfigLayout v-slot="{ config }"
    ><div class="metric-grid">
      <div
        v-for="(value, index) in [
          config.form.fields.length,
          '独立发布',
          config.users.length,
          config.pages.length,
        ]"
        :key="index"
        class="metric-card"
      >
        <div class="metric-label">
          {{ ['表单字段', '流程模板', '公司成员', '动态页面'][index] }}
        </div>
        <div class="metric-value">{{ value }}</div>
        <div class="metric-note">{{ index === 1 ? '进入流程模板管理' : '当前编辑草案' }}</div>
      </div>
    </div>
    <NCard title="配置业务能力"
      ><div class="config-list">
        <RouterLink v-for="module in modules" :key="module.path" :to="module.path" class="config-item"
          ><div>
            <strong>{{ module.name }}</strong
            ><small>{{ module.description }}</small>
          </div>
          <span>进入配置 →</span></RouterLink
        >
      </div></NCard
    ></ConfigLayout
  >
</template>
