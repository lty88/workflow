import { computed, onScopeDispose, ref, watch } from 'vue'
import type { ComputedRef } from 'vue'
import { useRouter } from 'vue-router'
import type { FileRecord, WorkflowTask } from '@workflow/domain'
import type { ActivityDetail } from '@/typings/api'
import { activityApi } from '@/api/activities'
import { useAuthStore } from '@/stores/auth'
import { useFeedback } from '@/composables/use-feedback'
import { APP_PATHS, activityListDestination } from '@/navigation'
import { canDecideWorkflowTask, canTransferWorkflowTask } from '@/components/activity/workflow-task-access'

/**
 * 编排活动详情的读取、快照选择、办理抽屉和编辑导航，过期请求不会覆盖当前活动。
 * @param activityId 当前路由传入的活动标识
 * @returns 活动详情、页面状态、附件上传资格及刷新和办理能力
 */
export function useActivityDetail(activityId: ComputedRef<string>) {
  const router = useRouter()
  const auth = useAuthStore()
  const feedback = useFeedback()
  const detail = ref<ActivityDetail | null>(null)
  const loading = ref(false)
  const errorText = ref('')
  const revision = ref('current')
  const edit = ref(false)
  const task = ref<WorkflowTask>()
  const action = ref('')
  const actionOpen = ref(false)
  const adjustmentOpen = ref(false)
  const transferOpen = ref(false)
  let requestId = 0
  const actions = computed(() => (detail.value?.actions || []).filter((value) => value !== 'export' && value !== 'delete'))
  const isOld = computed(() => revision.value !== 'current')
  const listDestination = computed(() => activityListDestination(auth.profile?.menus || []))
  const applicationUpload = computed(() => uploadAllowed('application') && !isOld.value)
  const executionUpload = computed(() => uploadAllowed('execution') && !isOld.value)
  const archiveUpload = computed(() => uploadAllowed('archive') && !isOld.value)

  /**
   * 按服务端动作能力控制附件上传，归档材料由执行人提交，历史申请仍只读。
   * @param stage 附件所属阶段
   * @returns 是否展示上传入口
   */
  function uploadAllowed(stage: FileRecord['stage']): boolean {
    const activity = detail.value?.activity
    if (!activity) return false
    if (stage === 'application') return !!detail.value?.actions.includes('edit')
    if (stage === 'execution') return activity.executor === auth.profile?.user.id && activity.status === 'executing' && auth.can('execution:report')
    return stage === 'archive' && !!detail.value?.actions.includes('archive-submit')
  }

  /** 读取活动与最新操作能力，仅接受最后一次请求，失效快照回退到当前版本。 */
  async function load(): Promise<void> {
    const current = ++requestId
    loading.value = true
    errorText.value = ''
    try {
      const result = await activityApi(activityId.value)
      if (current !== requestId) return
      detail.value = result
      if (revision.value !== 'current' && !result.activity.snapshots.some((item) => String(item.revision) === revision.value)) revision.value = 'current'
    } catch (error) {
      if (current === requestId) errorText.value = error instanceof Error ? error.message : '读取失败'
    } finally {
      if (current === requestId) loading.value = false
    }
  }

  /** 活动删除成功后返回当前账号有权访问的活动工单页。 */
  async function afterDelete(): Promise<void> {
    await router.replace(listDestination.value)
  }

  /**
   * 核对当前视图与个人任务资格后打开办理抽屉。
   * @param value 当前个人任务
   */
  function decide(value: WorkflowTask): void {
    if (loading.value || isOld.value || !detail.value || !canDecideWorkflowTask(detail.value, value, auth.profile)) return
    task.value = value
    action.value = ''
    actionOpen.value = true
  }

  /**
   * 按服务端授权动作打开编辑器或办理抽屉，复制时进入新申请页。
   * @param value 服务端授予的业务动作码
   */
  async function handleAction(value: string): Promise<void> {
    if (loading.value || isOld.value || !detail.value?.actions.includes(value)) return
    if (value === 'copy') {
      await router.push({ path: APP_PATHS.activityCreate, query: { copyId: detail.value.activity.id } })
      return
    }
    if (value === 'edit' || value === 'submit') {
      edit.value = true
      if (value === 'submit') feedback.success('请核对流程模板并计算实际路线后提交')
      return
    }
    if (value === 'adjust') {
      adjustmentOpen.value = true
      return
    }
    task.value = undefined
    action.value = value
    actionOpen.value = true
  }

  /** 退出编辑并重新读取活动，保留有效的历史快照选择。 */
  async function closeEdit(): Promise<void> {
    edit.value = false
    await load()
  }

  /**
   * 核对当前视图与服务端授予的流程调整能力后打开待办转交抽屉。
   * @param value 当前个人任务
   */
  function transfer(value: WorkflowTask): void {
    if (loading.value || isOld.value || !detail.value || !canTransferWorkflowTask(detail.value, value)) return
    task.value = value
    transferOpen.value = true
  }

  /** 切换活动时清除旧活动资料和办理状态，再请求新活动。 */
  function resetDetail(): void {
    detail.value = null
    revision.value = 'current'
    edit.value = false
    action.value = ''
    task.value = undefined
    actionOpen.value = false
    adjustmentOpen.value = false
    transferOpen.value = false
    void load()
  }

  /** 页面离开后让尚未返回的详情请求失效。 */
  function invalidateRequests(): void {
    requestId += 1
  }

  watch(activityId, resetDetail, { immediate: true })
  onScopeDispose(invalidateRequests)
  return {
    auth,
    detail,
    loading,
    errorText,
    revision,
    edit,
    task,
    action,
    actionOpen,
    adjustmentOpen,
    transferOpen,
    actions,
    isOld,
    listDestination,
    applicationUpload,
    executionUpload,
    archiveUpload,
    load,
    afterDelete,
    decide,
    handleAction,
    closeEdit,
    transfer,
  }
}
