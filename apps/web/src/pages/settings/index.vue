<script setup lang="tsx">
import { RouterLink } from 'vue-router';
import { NCard } from 'naive-ui';
import ConfigLayout from '@/components/config/ConfigLayout.vue';
const modules = [
  {
    path: 'forms',
    name: '动态表单',
    description: '字段、选项、必填、默认值与条件显隐',
  },
  {
    path: 'workflow',
    name: '流程模板',
    description: '多模板、活动类型、拖拽编排、版本发布与授权',
  },
  {
    path: 'organization',
    name: '组织架构',
    description: '部门、负责人、成员账号和启停状态',
  },
  {
    path: 'permissions',
    name: '角色权限',
    description: '操作权限、页面授权与数据范围',
  },
  {
    path: 'menus',
    name: '菜单页面',
    description: '分组、内置模板、排序与角色关联',
  },
];
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
        <RouterLink
          v-for="module in modules"
          :key="module.path"
          :to="'/settings/' + module.path"
          class="config-item"
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
