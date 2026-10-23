<script setup lang="tsx">
  import { computed, ref } from 'vue'
  import { NAlert, NButton, NCheckbox, NModal, NTag } from 'naive-ui'
  import { COMMON_DEPARTMENTS, supplementCommonOrganization } from '@workflow/domain'
  import type { CompanyConfig } from '@workflow/domain'
  import type { ConfigPanelProps, OrganizationPresetPreview } from './types'
  import { useAuthStore } from '@/stores/auth'
  import { useFeedback } from '@/composables/use-feedback'
  import { clone } from '@/composables/format'
  const props = defineProps<ConfigPanelProps>()
  const emit = defineEmits<{ 'update:modelValue': [value: CompanyConfig] }>()
  const auth = useAuthStore()
  const feedback = useFeedback()
  const open = ref(false)
  const includeMembers = ref(false)
  const preview = computed(previewOrganization)
  const changes = computed(() =>
    preview.value.result ? preview.value.result.addedDepartments.length + preview.value.result.addedMembers.length + preview.value.result.addedRoles.length : 0
  )
  /**
   * 生成只读补齐预览，统计新增对象，不改变用户当前草案。
   * @returns 可应用的独立配置或明确的校验错误
   */
  function previewOrganization(): OrganizationPresetPreview {
    try {
      return { result: supplementCommonOrganization(props.modelValue, includeMembers.value), error: '' }
    } catch (error) {
      return { result: null, error: error instanceof Error ? error.message : '常用部门预览失败' }
    }
  }
  /** 仅对有配置管理权的人员打开预览，默认只补齐部门和岗位角色。 */
  function show(): void {
    if (!auth.can('config:manage')) return
    includeMembers.value = false
    open.value = true
  }
  /** 将已预览的组织增量应用到本地草案，保存和发布继续使用配置中心原有版本校验。 */
  function apply(): void {
    if (!auth.can('config:manage')) return
    const result = preview.value.result
    if (!result || !changes.value) {
      if (preview.value.error) feedback.failure(new Error(preview.value.error))
      return
    }
    emit('update:modelValue', clone(result.config))
    feedback.success(
      `已补入草案：${result.addedDepartments.length}个部门、${result.addedRoles.length}个角色、${result.addedMembers.length}名示例成员，请点击页面保存组织与人员`
    )
    open.value = false
  }
</script>
<template>
  <NButton v-if="auth.can('config:manage')" size="small" secondary type="primary" @click="show">补齐常用部门</NButton>
  <NModal v-model:show="open" preset="card" title="补齐常用部门" style="width: min(660px, 95vw)">
    <NAlert type="info" :bordered="false" class="mb">
      补充缺少的部门和岗位角色，沿用已有部门名称、层级、成员及负责人。加入待保存修改后可继续调整，保存后立即生效。
    </NAlert>
    <div class="preset-departments">
      <NTag v-for="department in COMMON_DEPARTMENTS" :key="department.id" :bordered="false">{{ department.name }}</NTag>
    </div>
    <NCheckbox v-model:checked="includeMembers">同时补齐示例负责人和成员</NCheckbox>
    <p class="preset-help">
      勾选后，为缺少负责人的部门建立示例负责人，为没有其他在职成员的部门补充示例专员。新账号保存后默认密码123456，可在成员列表调整姓名、角色和密码。
    </p>
    <NAlert v-if="preview.error" type="error" class="mb">{{ preview.error }}</NAlert>
    <template v-else-if="preview.result">
      <div class="preset-summary">
        <span>
          新增部门
          <strong>{{ preview.result.addedDepartments.length }}</strong>
        </span>
        <span>
          新增角色
          <strong>{{ preview.result.addedRoles.length }}</strong>
        </span>
        <span>
          新增成员
          <strong>{{ preview.result.addedMembers.length }}</strong>
        </span>
      </div>
      <NAlert v-if="!changes" type="success" :bordered="false">当前选项对应的常用组织已完整，无需重复补充。</NAlert>
      <NAlert v-if="preview.result.skippedDepartments.length" type="warning" :bordered="false">
        以下部门或上级已停用，继续保留停用状态：{{ preview.result.skippedDepartments.join('、') }}
      </NAlert>
      <div v-if="preview.result.addedMembers.length" class="preset-accounts">
        <strong>本次新增示例账号</strong>
        <div v-for="member in preview.result.addedMembers" :key="member.id">
          <span>{{ member.name }}</span>
          <code>{{ member.username }}</code>
        </div>
      </div>
    </template>
    <template #footer>
      <div class="preset-footer">
        <span>应用后请保存组织与人员</span>
        <NButton @click="open = false">取消</NButton>
        <NButton type="primary" :disabled="!!preview.error || !changes" @click="apply">加入待保存修改</NButton>
      </div>
    </template>
  </NModal>
</template>
<style scoped>
  .preset-departments {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    margin: 16px 0 22px;
  }
  .preset-help {
    font-size: 13px;
    line-height: 1.8;
    color: #748198;
    margin: 12px 0 18px;
  }
  .preset-summary {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
    padding: 18px;
    background: #f5f8ff;
    border-radius: 10px;
    margin-bottom: 16px;
  }
  .preset-summary span {
    font-size: 13px;
    color: #62738d;
  }
  .preset-summary strong {
    display: block;
    font-size: 23px;
    color: #2d4c7e;
    margin-top: 6px;
  }
  .preset-accounts {
    max-height: 250px;
    overflow: auto;
    padding: 14px;
    border: 1px solid #e4eaf3;
    border-radius: 8px;
    margin-top: 16px;
  }
  .preset-accounts > strong {
    font-size: 14px;
  }
  .preset-accounts > div {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    font-size: 13px;
    padding-top: 10px;
  }
  .preset-accounts code {
    font-size: 13px;
    color: #46689e;
  }
  .preset-footer {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .preset-footer > span {
    flex: 1;
    font-size: 12px;
    color: #748198;
  }
  @media (max-width: 600px) {
    .preset-summary {
      padding: 12px;
      gap: 8px;
    }
    .preset-accounts > div {
      flex-wrap: wrap;
    }
  }
</style>
