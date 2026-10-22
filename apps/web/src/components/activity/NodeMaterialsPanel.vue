<script setup lang="tsx">
import { computed, ref } from 'vue';
import { NAlert, NTag, NCheckbox } from 'naive-ui';
import type { ActivityDetail, WorkflowNode } from '@workflow/domain';
import AttachmentList from './AttachmentList.vue';
const props = defineProps<{ detail: ActivityDetail }>();
const emit = defineEmits<{ uploaded: [] }>();
const history = ref(false);
const nodes = computed(() => props.detail.activity.nodes.filter(current));
/**
 * 根据历史开关显示申请节点，历史资料仍由服务端按原归属隔离。
 * @param node 实例节点
 * @returns 是否属于当前显示范围
 */
function current(node: WorkflowNode): boolean {
  return (
    history.value ||
    ((node.applicationRevision || 1) === (props.detail.activity.revision || 1) &&
      !['skipped', 'invalidated'].includes(node.status))
  );
}
/**
 * 根据服务端投影能力判断当前节点内部材料可见性。
 * @param id 节点标识
 * @returns 是否有内容阅读授权
 */
function readable(id: string): boolean {
  return props.detail.access?.readableNodeIds.includes(id) || false;
}
/**
 * 使用服务端当前任务能力显示上传入口，实际上传会再次校验。
 * @param id 节点标识
 * @returns 是否允许本节点上传
 */
function uploadable(id: string): boolean {
  return props.detail.access?.uploadNodeIds.includes(id) || false;
}
</script>
<template>
  <section v-if="detail.activity.nodes.length" class="node-materials">
    <div class="spread">
      <h2>节点资料</h2>
      <NCheckbox v-model:checked="history">显示历史节点资料</NCheckbox>
    </div>
    <p class="materials-hint">流程进度和公开结论共享，内部说明与资料按各节点授权范围开放。</p>
    <article v-for="node in nodes" :key="node.id" class="material-node">
      <header>
        <strong>{{ node.label }}</strong
        ><NTag size="small" :type="readable(node.id) ? 'info' : 'default'" :bordered="false">{{
          readable(node.id) ? '可查看内部资料' : '仅查看公开进度'
        }}</NTag>
      </header>
      <AttachmentList
        v-if="readable(node.id)"
        :activity-id="detail.activity.id"
        :files="detail.files"
        :activity-version="detail.activity.version"
        stage="node"
        :node-id="node.id"
        :can-upload="uploadable(node.id)"
        @uploaded="emit('uploaded')"
      /><NAlert v-else type="default" :bordered="false">此节点的内部说明和附件仅向授权人员开放。</NAlert>
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
.material-node strong {
  font-size: 14px;
}
</style>
