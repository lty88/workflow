<script setup lang="tsx">
  import { computed, ref, watch } from 'vue'
  import { NAlert, NButton, NCard, NEmpty, NPagination, NPopconfirm, NProgress, NRate, NSelect, NSpin, NTag } from 'naive-ui'
  import type { Activity } from '@workflow/domain'
  import type { ActivityEvaluations, SurveyCommand } from '@/typings/api/insights'
  import { activityEvaluationsApi, manageSurveyApi } from '@/api/insights'
  import { useFeedback } from '@/composables/use-feedback'
  import { formatTime } from '@/composables/format'
  import EvaluationShareDialog from './EvaluationShareDialog.vue'
  const props = defineProps<{ activity: Activity }>()
  const feedback = useFeedback()
  const data = ref<ActivityEvaluations | null>(null)
  const loading = ref(false)
  const busy = ref(false)
  const errorText = ref('')
  const page = ref(1)
  const days = ref(30)
  const shareOpen = ref(false)
  const dayOptions = [
    { label: '开放7天', value: 7 },
    { label: '开放30天', value: 30 },
    { label: '开放90天', value: 90 },
  ]
  const shareUrl = computed(() => (data.value?.survey?.sharePath ? new URL(data.value.survey.sharePath, window.location.origin).href : ''))
  const accepting = computed(() => !!data.value?.survey?.active && Date.parse(data.value.survey.expiresAt) > Date.now() && data.value.eligible)

  /** 读取当前活动全部评价汇总及当前页匿名反馈，错误保留重试入口。 */
  async function load(): Promise<void> {
    loading.value = true
    errorText.value = ''
    try {
      data.value = await activityEvaluationsApi(props.activity.id, page.value)
    } catch (error) {
      errorText.value = error instanceof Error ? error.message : '评价读取失败'
    } finally {
      loading.value = false
    }
  }

  /**
   * 重新核对当前管理权限并提交链接操作，成功后刷新统计和版本。
   * @param action 开启、关闭或换码
   */
  async function changeSurvey(action: SurveyCommand['action']): Promise<void> {
    if (!data.value?.canManage || busy.value) return
    busy.value = true
    try {
      await manageSurveyApi(props.activity.id, {
        action,
        days: days.value,
        expectedVersion: data.value.survey?.version || 0,
      })
      await load()
      feedback.success(action === 'close' ? '已停止收集评价' : action === 'rotate' ? '已生成新链接，原链接和二维码已失效' : '已开启活动评价')
      if (action !== 'close') shareOpen.value = true
    } catch (error) {
      feedback.failure(error)
    } finally {
      busy.value = false
    }
  }

  /**
   * 切换匿名反馈分页并重新查询，统计始终基于全部样本。
   * @param value 目标页码
   */
  async function changePage(value: number): Promise<void> {
    page.value = value
    await load()
  }

  /** 活动状态或版本更新后从第一页刷新评价收集资格与反馈。 */
  async function activityChanged(): Promise<void> {
    page.value = 1
    await load()
  }
  watch(() => props.activity.id + ':' + props.activity.version, activityChanged, {
    immediate: true,
  })
</script>
<template>
  <NCard title="活动评价" class="evaluation-panel">
    <template #header-extra><NButton text :loading="loading" @click="load">刷新</NButton></template>
    <NSpin :show="loading">
      <NAlert v-if="errorText" type="error">{{ errorText }}</NAlert>
      <template v-else-if="data">
        <div class="collection-status">
          <div>
            <NTag :type="accepting ? 'success' : 'default'" :bordered="false">{{ accepting ? '正在收集' : data.survey ? '已停止或已到期' : '尚未开启' }}</NTag>
            <p>
              {{ data.eligible ? '活动执行已完成，可邀请参与者匿名打分。' : '手动完成活动执行后，可以开启评价收集。' }}
            </p>
            <span v-if="data.survey">有效期至 {{ formatTime(data.survey.expiresAt) }}</span>
          </div>
          <div v-if="data.canManage" class="collection-actions">
            <NSelect v-if="!accepting" v-model:value="days" :options="dayOptions" style="width: 125px" />
            <NButton v-if="!accepting" type="primary" :loading="busy" :disabled="!data.eligible" @click="changeSurvey('open')">
              {{ data.survey ? '重新开启' : '开启活动评价' }}
            </NButton>
            <NButton v-if="accepting" type="primary" @click="shareOpen = true">二维码 / 链接</NButton>
            <NPopconfirm v-if="accepting" @positive-click="changeSurvey('close')">
              <template #trigger><NButton :loading="busy">停止收集</NButton></template>
              停止后链接将无法填写，已有评价会保留。
            </NPopconfirm>
            <NPopconfirm v-if="accepting" @positive-click="changeSurvey('rotate')">
              <template #trigger><NButton :loading="busy" quaternary>更换链接</NButton></template>
              将生成新的链接和二维码，原链接立即失效，已有评价保留。
            </NPopconfirm>
          </div>
        </div>
        <div class="evaluation-kpis">
          <div>
            <span>收到评价</span>
            <strong>
              {{ data.summary.count }}
              <small>份</small>
            </strong>
          </div>
          <div>
            <span>整体平均分</span>
            <strong>
              {{ data.summary.average ?? '—' }}
              <small>/ 5</small>
            </strong>
          </div>
          <div>
            <span>满意率 · 4至5星</span>
            <strong>{{ data.summary.satisfaction === null ? '—' : data.summary.satisfaction + '%' }}</strong>
          </div>
          <div>
            <span>低分反馈 · 1至2星</span>
            <strong>
              {{ data.summary.lowCount }}
              <small>份</small>
            </strong>
          </div>
        </div>
        <template v-if="data.summary.count">
          <div class="evaluation-analysis">
            <div>
              <h3>各项体验</h3>
              <div v-for="dimension in data.summary.dimensions" :key="dimension.key" class="dimension-row">
                <span>{{ dimension.label }}</span>
                <NRate readonly :value="dimension.average || 0" :allow-half="true" :size="18" />
                <strong>{{ dimension.average }}</strong>
              </div>
            </div>
            <div>
              <h3>整体评分分布</h3>
              <div v-for="bucket in data.summary.distribution" :key="bucket.score" class="distribution-row">
                <span>{{ bucket.score }} 星</span>
                <NProgress type="line" :percentage="Math.round((bucket.count / data.summary.count) * 100)" :show-indicator="false" :height="8" />
                <span>{{ bucket.count }} 份</span>
              </div>
            </div>
          </div>
          <h3>
            匿名反馈
            <small>仅授权岗位可见</small>
          </h3>
          <article v-for="response in data.responses" :key="response.id" class="response-item">
            <div>
              <NRate readonly :value="response.overall" :size="16" />
              <NTag v-if="response.overall <= 2" type="warning" size="small" :bordered="false">需关注</NTag>
              <time>{{ formatTime(response.createdAt) }}</time>
            </div>
            <p>{{ response.comment || '参与者仅提交了评分' }}</p>
          </article>
          <NPagination v-if="data.total > 10" :page="page" :item-count="data.total" :page-size="10" @update:page="changePage" />
        </template>
        <NEmpty v-else description="暂无评价，开启后把二维码或链接分享给参与者" size="small" />
      </template>
    </NSpin>
    <EvaluationShareDialog v-if="shareUrl" v-model:show="shareOpen" :url="shareUrl" :activity-name="activity.name" />
  </NCard>
</template>
<style scoped>
  .evaluation-panel {
    margin-top: 20px;
  }
  .collection-status {
    display: flex;
    justify-content: space-between;
    gap: 20px;
    flex-wrap: wrap;
  }
  .collection-status p {
    margin: 10px 0 6px;
    color: #62718a;
  }
  .collection-status > div > span {
    font-size: 12px;
    color: #7e8da4;
  }
  .collection-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .evaluation-kpis {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
    background: #f5f8fe;
    padding: 18px;
    border-radius: 12px;
    margin: 22px 0;
  }
  .evaluation-kpis span {
    color: #697991;
    font-size: 13px;
  }
  .evaluation-kpis strong {
    display: block;
    font-size: 26px;
    font-weight: 650;
    margin-top: 8px;
  }
  .evaluation-kpis small {
    font-size: 13px;
    font-weight: 400;
    color: #7e8da4;
  }
  .evaluation-analysis {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 30px;
    margin: 20px 0 28px;
  }
  h3 {
    font-size: 15px;
    margin: 0 0 16px;
  }
  h3 small {
    font-size: 12px;
    font-weight: 400;
    color: #7e8da4;
    margin-left: 8px;
  }
  .dimension-row {
    display: flex;
    gap: 12px;
    align-items: center;
    margin: 14px 0;
    font-size: 13px;
  }
  .dimension-row > span {
    flex: 1;
  }
  .dimension-row > strong {
    min-width: 32px;
  }
  .distribution-row {
    display: grid;
    grid-template-columns: 32px 1fr 44px;
    gap: 12px;
    align-items: center;
    margin: 15px 0;
    font-size: 13px;
    color: #697991;
  }
  .response-item {
    padding: 16px 0;
    border-top: 1px solid #edf0f5;
  }
  .response-item > div {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .response-item time {
    margin-left: auto;
    font-size: 12px;
    color: #7e8da4;
  }
  .response-item p {
    white-space: pre-wrap;
    word-break: break-word;
    line-height: 1.8;
    margin-bottom: 0;
  }
  @media (max-width: 700px) {
    .evaluation-kpis {
      grid-template-columns: 1fr 1fr;
    }
    .evaluation-analysis {
      grid-template-columns: 1fr;
      gap: 15px;
    }
  }
</style>
