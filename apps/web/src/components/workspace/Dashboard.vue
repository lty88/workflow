<script setup lang="tsx">
import { computed, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { activityDestination, menuDestination } from '@/navigation';
import { NAlert, NButton, NCard, NEmpty, NSpin, NTag } from 'naive-ui';
import CreateRequestMenu from '@/components/workspace/creation/CreateRequestMenu.vue';
import { STATUSES } from '@workflow/domain';
import type { ActivityListItem } from '@/typings/api';
import { activitiesApi } from '@/api/activities';
import { useAuthStore } from '@/stores/auth';
import { useFeedback } from '@/composables/use-feedback';
import { formatTime } from '@/composables/format';
const auth = useAuthStore();
const feedback = useFeedback();
const busy = ref(false);
const metrics = ref([0, 0, 0, 0]);
const recent = ref<ActivityListItem[]>([]);
const errorText = ref('');
const now = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });
const links = computed(() => auth.profile?.menus.filter(quickPage) || []);
/**
 * 选择适合作为快捷入口的授权菜单。
 * @param page 页面
 * @returns 是否快捷页
 */
function quickPage(page: { component: string }): boolean {
  return ['task_list', 'archive_list'].includes(page.component);
}
/**
 * 并发读取授权统计及近期工单，失败时保留明确错误状态。
 */
async function load(): Promise<void> {
  busy.value = true;
  try {
    const [all, tasks, mine, archives] = await Promise.all([
      activitiesApi({ pageSize: 5 }),
      activitiesApi({ scope: 'tasks', pageSize: 1 }),
      activitiesApi({ scope: 'mine', pageSize: 1 }),
      activitiesApi({ scope: 'archives', pageSize: 1 }),
    ]);
    metrics.value = [all.total, tasks.total, mine.total, archives.total];
    recent.value = all.items;
    errorText.value = '';
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : '读取失败';
    feedback.failure(error);
  } finally {
    busy.value = false;
  }
}
onMounted(load);
</script>
<template>
  <div>
    <div class="page-heading">
      <div>
        <span class="eyebrow">WORKSPACE OVERVIEW</span>
        <h1>{{ auth.profile?.user.name }}，欢迎回来</h1>
        <p>{{ now }} · 在这里了解活动进展与待办事项。</p>
      </div>
      <NButton :loading="busy" @click="load">刷新数据</NButton>
    </div>
    <NAlert v-if="errorText" type="error" class="mb">{{ errorText }}</NAlert
    ><NSpin :show="busy"
      ><div class="metric-grid">
        <div
          v-for="(label, index) in ['范围内活动', '待办活动', '我发起的', '已归档活动']"
          :key="label"
          class="metric-card"
        >
          <div class="metric-label">{{ label }}</div>
          <div class="metric-value">{{ metrics[index] }}</div>
          <div class="metric-note">当前账号的可见数据</div>
        </div>
      </div>
      <div class="dashboard-grid">
        <NCard title="近期活动"
          ><div v-if="recent.length" class="stack">
            <RouterLink
              v-for="item in recent"
              :key="item.id"
              :to="activityDestination(item.id)"
              class="config-item"
              ><div>
                <strong style="color: #35445e">{{ item.name || '未命名草稿' }}</strong
                ><small
                  >{{ item.code }} · 发起人 {{ item.applicantName }} · {{ formatTime(item.startAt) }}</small
                >
              </div>
              <NTag size="small" :bordered="false" type="info">{{ STATUSES[item.status] }}</NTag></RouterLink
            >
          </div>
          <NEmpty v-else description="暂无活动，发起第一份申请吧"
        /></NCard>
        <div class="stack">
          <NCard title="快捷入口"
            ><CreateRequestMenu appearance="shortcut" /><RouterLink v-for="link in links" :key="link.id" :to="menuDestination(link)" class="quick-link"
              ><span>{{
                link.component === 'task_list' ? '✓' : '▤'
              }}</span>
              <div>
                {{ link.name }}<small>进入{{ link.name }}</small>
              </div></RouterLink
            ><NEmpty v-if="!links.length && !(auth.can('activity:create') && auth.can('activity:read'))" size="small" description="暂无快捷入口" /></NCard
          ><NCard title="协作流程"
            ><div class="help-text">
              活动申请 → 部门初审<br />教研与营销并行确认<br />按预算触发负责人复核<br />指派 → 执行汇报 →
              审核归档
            </div></NCard
          >
        </div>
      </div></NSpin
    >
  </div>
</template>
