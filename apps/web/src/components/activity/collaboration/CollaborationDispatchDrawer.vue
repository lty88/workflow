<script setup lang="tsx">
  import { computed, ref, watch } from 'vue'
  import { useMediaQuery } from '@vueuse/core'
  import { NDrawer, NDrawerContent, NButton, NForm, NFormItem, NInput, NSelect, NCheckbox, NDatePicker, NAlert } from 'naive-ui'
  import { createUuid } from '@workflow/domain'
  import type { Directory } from '@/typings/api'
  import { directoryApi } from '@/api/workspace'
  import { dispatchCollaborationApi } from '@/api/workflow'
  import { useAuthStore } from '@/stores/auth'
  import { useFeedback } from '@/composables/use-feedback'
  import type { CollaborationDispatchProps, CollaborationDraft } from './types'
  const props = defineProps<CollaborationDispatchProps>()
  const emit = defineEmits<{ 'update:show': [value: boolean]; done: [] }>()
  const auth = useAuthStore()
  const feedback = useFeedback()
  const mobile = useMediaQuery('(max-width: 850px)')
  const busy = ref(false)
  const loading = ref(false)
  const error = ref('')
  const directory = ref<Directory>()
  const mode = ref<'parallel' | 'serial'>('parallel')
  const tasks = ref<CollaborationDraft[]>([])
  const policy = computed(() => props.detail.activity.nodes.find((node) => node.id === props.task?.nodeId)?.approvalPolicy?.collaboration)
  const users = computed(() => (directory.value?.users || []).filter(allowedUser).map(userOption))
  /** 创建独立的任务输入行。
   * @returns 人员、截止时间及成果要求的空行
   */
  function emptyTask(): CollaborationDraft {
    return { key: createUuid(), label: '', assignee: null, instructions: '', dueAt: null, attachmentRequired: true }
  }
  /** 根据模板部门范围和任务权限筛选可指派人员。
   * @param user 组织目录成员
   * @returns 是否允许选择
   */
  function allowedUser(user: Directory['users'][number]): boolean {
    if (!user.canCollaborate || user.id === auth.profile?.user.id) return false
    if (policy.value?.scope === 'all') return true
    const seen = new Set<string>()
    let id = user.department
    while (id && !seen.has(id)) {
      if (id === auth.profile?.user.department) return true
      seen.add(id)
      id = directory.value?.departments.find((department) => department.id === id)?.parent || ''
    }
    return false
  }
  /** 转换人员下拉项，显示部门方便同名人员识别。
   * @param user 组织成员
   * @returns 可选名称和账号标识
   */
  function userOption(user: Directory['users'][number]) {
    return {
      label: `${user.name} · ${directory.value?.departments.find((department) => department.id === user.department)?.name || user.department}`,
      value: user.id,
    }
  }
  /** 打开抽屉时重建输入并读取可派发人员。
   * @param show 是否打开
   */
  async function initialize(show: boolean): Promise<void> {
    if (!show) return
    tasks.value = [emptyTask()]
    error.value = ''
    mode.value = 'parallel'
    loading.value = true
    try {
      directory.value = await directoryApi()
    } catch (cause) {
      feedback.failure(cause)
    } finally {
      loading.value = false
    }
  }
  /** 校验每项必填及当前派发资格后创建协作并通知父页面刷新。 */
  async function submit(): Promise<void> {
    if (busy.value || !props.task || !props.detail.collaborationCapabilities?.dispatchTaskIds.includes(props.task.id)) return
    error.value = ''
    for (const item of tasks.value) {
      if (!item.label.trim() || !item.assignee || !item.instructions.trim()) {
        error.value = '请补全每项任务名称、办理人和工作要求'
        return
      }
      if (item.dueAt && item.dueAt <= Date.now()) {
        error.value = '截止时间应晚于当前时间'
        return
      }
    }
    busy.value = true
    try {
      await dispatchCollaborationApi(props.task.id, {
        expectedTaskVersion: props.task.version,
        mode: mode.value,
        tasks: tasks.value.map(
          /** 移除界面键并转换截止时间，服务端再次校验人员范围。
           * @param item 表单行
           * @returns API任务输入
           */ function command(item) {
            return {
              label: item.label.trim(),
              assignee: item.assignee!,
              instructions: item.instructions.trim(),
              dueAt: item.dueAt ? new Date(item.dueAt).toISOString() : undefined,
              attachmentRequired: item.attachmentRequired,
            }
          }
        ),
      })
      feedback.success('任务已派发，成果验收后可继续审批')
      emit('update:show', false)
      emit('done')
    } catch (cause) {
      feedback.failure(cause)
    } finally {
      busy.value = false
    }
  }
  watch(() => props.show, initialize)
</script>
<template>
  <NDrawer :show="show" :width="mobile ? '100%' : 620" :mask-closable="!busy" :close-on-esc="!busy" @update:show="emit('update:show', $event)">
    <NDrawerContent title="派发协作任务" :closable="!busy">
      <NAlert type="info" :bordered="false" class="mb">由你验收成果，全部必办任务验收后继续当前审批。其他会签人可正常办理。</NAlert>
      <NAlert v-if="error" type="error" class="mb">{{ error }}</NAlert>
      <NForm :disabled="busy || loading" label-placement="top">
        <NFormItem label="办理顺序">
          <NSelect
            v-model:value="mode"
            :options="[
              { label: '并行办理', value: 'parallel' },
              { label: '按下方顺序办理，前一项验收后开启下一项', value: 'serial' },
            ]"
          />
        </NFormItem>
        <section v-for="(item, index) in tasks" :key="item.key" class="dispatch-task">
          <header>
            <strong>任务 {{ index + 1 }}</strong>
            <NButton v-if="tasks.length > 1" text type="error" :disabled="busy" @click="tasks.splice(index, 1)">移除</NButton>
          </header>
          <NFormItem label="任务名称" required><NInput v-model:value="item.label" placeholder="例如补充活动视觉方案" maxlength="80" /></NFormItem>
          <NFormItem label="办理人" required>
            <NSelect v-model:value="item.assignee" :options="users" filterable :loading="loading" placeholder="选择具备节点任务办理权限的人员" />
          </NFormItem>
          <NFormItem label="工作要求" required>
            <NInput v-model:value="item.instructions" type="textarea" :autosize="{ minRows: 3 }" placeholder="说明需要完成的工作和交付材料" maxlength="4000" />
          </NFormItem>
          <NFormItem label="截止时间（选填）"><NDatePicker v-model:value="item.dueAt" type="datetime" clearable /></NFormItem>
          <NCheckbox v-model:checked="item.attachmentRequired">提交成果时必须上传附件</NCheckbox>
        </section>
        <NButton dashed block :disabled="busy || tasks.length >= 20" @click="tasks.push(emptyTask())">＋ 添加任务</NButton>
      </NForm>
      <template #footer>
        <NButton :disabled="busy" @click="emit('update:show', false)">取消</NButton>
        <NButton type="primary" :loading="busy" :disabled="loading" @click="submit">确认派发</NButton>
      </template>
    </NDrawerContent>
  </NDrawer>
</template>
<style scoped>
  .dispatch-task {
    padding: 16px;
    margin-bottom: 16px;
    border: 1px solid #e1e8f4;
    border-radius: 10px;
  }
  header {
    display: flex;
    justify-content: space-between;
    margin-bottom: 14px;
  }
</style>
