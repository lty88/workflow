<script setup lang="tsx">
import { onMounted, ref } from 'vue';
import { useRoute, RouterLink } from 'vue-router';
import { NAlert, NButton, NCard, NSpin } from 'naive-ui';
import type { PageDefinition } from '@workflow/domain';
import { pageApi } from '@/api';
import Dashboard from '@/components/workspace/Dashboard.vue';
import LeadershipDashboard from '@/components/leadership/LeadershipDashboard.vue';
import ActivityList from '@/components/workspace/ActivityList.vue';
import ActivityEditor from '@/components/activity/ActivityEditor.vue';
const route = useRoute('/workspace/[pageKey]');
const page = ref<PageDefinition | null>(null);
const busy = ref(true);
const errorText = ref('');
/**
 * 由服务端校验动态页面权限，再选择内置安全页面模板。
 */
async function load(): Promise<void> {
  busy.value = true;
  try {
    page.value = await pageApi(String(route.params.pageKey));
    errorText.value = '';
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : '页面加载失败';
  } finally {
    busy.value = false;
  }
}
onMounted(load);
</script>
<template>
  <NSpin :show="busy"
    ><NAlert v-if="errorText" type="error" :title="errorText"
      ><NButton text @click="load">重新加载</NButton></NAlert
    ><template v-else-if="page"
      ><LeadershipDashboard v-if="page.component === 'leadership_dashboard'" /><Dashboard
        v-else-if="page.component === 'summary'"
      /><ActivityList v-else-if="page.component === 'activity_list'" :title="page.name" /><ActivityList
        v-else-if="page.component === 'task_list'"
        :title="page.name"
        scope="tasks"
      /><ActivityList
        v-else-if="page.component === 'archive_list'"
        :title="page.name"
        scope="archives"
      /><ActivityEditor v-else-if="page.component === 'activity_form'" /><NCard
        v-else-if="page.component === 'config_overview'"
        title="配置中心"
        ><p>动态表单、节点、组织、权限与菜单统一以草案方式编辑，校验后发布。</p>
        <RouterLink to="/settings"><NButton type="primary">进入配置中心</NButton></RouterLink></NCard
      ></template
    ></NSpin
  >
</template>
