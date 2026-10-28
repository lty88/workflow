<script setup lang="tsx">
  import { computed, ref } from 'vue'
  import { NAlert, NTag, NCheckbox } from 'naive-ui'
  import type { ActivityDetail, WorkflowNode } from '@workflow/domain'
  import AttachmentList from './AttachmentList.vue'
  const props = defineProps<{ detail: ActivityDetail; readOnly?: boolean }>()
  const emit = defineEmits<{ uploaded: [] }>()
  const history = ref(false)
  const nodes = computed(() => props.detail.activity.nodes.filter(current))
  /**
   * 根据历史开关显示申请节点，历史资料仍由服务端按原归属隔离。
   * @param node 实例节点
   * @returns 是否属于当前显示范围
   */
  function current(node: WorkflowNode): boolean {
    return !node.businessStage && (history.value || ((node.applicationRevision || 1) === (props.detail.activity.revision || 1) && !['skipped', 'invalidated'].includes(node.status)))
  }
  /**
   * 根据服务端投影能力判断当前节点内部材料可见性。
   * @param id 节点标识
   * @returns 是否有内容阅读授权
   */
  function readable(id: string): boolean {
    return props.detail.access?.readableNodeIds.includes(id) || false
  }
  /**
   * 检查服务端已过滤的节点附件，单独分享的文件按自身授权展示。
   * @param id 节点标识
   * @returns 是否存在当前用户有权查看的节点附件
   */
  function hasFiles(id: string): boolean {
    return props.detail.files.some((file) => file.stage === 'node' && file.nodeId === id && !file.fieldKey)
  }
  /**
   * 历史申请视图只读，其余情况使用服务端当前任务能力显示上传入口。
   * @param id 节点标识
   * @returns 是否允许本节点上传
   */
  function uploadable(id: string): boolean {
    return !props.readOnly && (props.detail.access?.uploadNodeIds.includes(id) || false)
  }
</script>
<template>
  <section v-if="detail.activity.nodes.length" class="node-materials">
    <div class="spread">
      <h2>节点资料</h2>
      <NCheckbox v-model:checked="history">显示历史节点资料</NCheckbox>
    </div>
    <p class="materials-hint">审批意见面向活动相关人员。附件默认继承节点，单独选择“活动内共享”或“指定授权”后按该文件规则开放。</p>
    <article v-for="node in nodes" :key="node.id" class="material-node">
      <header>
        <strong>{{ node.label }}</strong>
        <NTag size="small" :type="readable(node.id) || hasFiles(node.id) ? 'info' : 'default'" :bordered="false">
          {{ readable(node.id) ? '可查看节点附件' : hasFiles(node.id) ? '可查看已分享附件' : '仅查看公开进度' }}
        </NTag>
      </header>
      <NAlert v-if="!readable(node.id)" type="default" :bordered="false" class="material-access-note">
        节点附件按授权范围开放；{{ hasFiles(node.id) ? '下方展示已向你授权的附件。' : '当前没有向你开放的附件。' }}
      </NAlert>
      <AttachmentList
        v-if="readable(node.id) || hasFiles(node.id)"
        :activity-id="detail.activity.id"
        :files="detail.files"
        :activity-version="detail.activity.version"
        stage="node"
        include-contexts
        :node-id="node.id"
        :can-upload="uploadable(node.id)"
        @uploaded="emit('uploaded')"
      />
    </article>
  </section>
</template>
<style scoped>
  .node-materials {
    margin-top: 24px;
    padding-top: 24px;
    border-top: 1px solid #e9edf4;
  }
  .node-materials h2 {
    font-size: 16px;
    margin: 0 0 10px;
  }
  .materials-hint {
    font-size: 13px;
    color: #748198;
    line-height: 1.7;
    margin: 0 0 16px;
  }
  .material-node {
    padding: 16px;
    margin-top: 12px;
    border: 1px solid #e5eaf2;
    border-radius: 10px;
    background: #fcfdff;
  }
  .material-node > header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 14px;
  }
  .material-access-note {
    margin-bottom: 14px;
  }
  .material-node strong {
    font-size: 14px;
  }
</style>
