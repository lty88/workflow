<script setup lang="tsx">
import { computed, ref } from 'vue';
import { useMediaQuery } from '@vueuse/core';
import { NButton, NTag, NEmpty, NAlert, NCheckbox, NModal } from 'naive-ui';
import { topological } from '@workflow/domain';
import type { WorkflowNode, WorkflowTask } from '@workflow/domain';
import { NODE_STATUSES, TASK_STATUSES } from './types';
import type { WorkflowViewDetail } from './types';
import { useAuthStore } from '@/stores/auth';
import { formatTime } from '@/composables/format';
import BusinessGraph from '@/components/graph/BusinessGraph.vue';
import { runtimeGraph } from '@/components/graph/models';
const props = defineProps<{ detail: WorkflowViewDetail }>();
const emit = defineEmits<{ decide: [task: WorkflowTask]; transfer: [task: WorkflowTask] }>();
const auth = useAuthStore();
const mobile = useMediaQuery('(max-width: 850px)');
const showHistory = ref(false);
const graphOpen = ref(false);
const model = computed(() => runtimeGraph(props.detail, showHistory.value));
const nodes = computed(() => topological(props.detail.activity.nodes.filter(inCurrentRevision)).order);
/**
 * 按历史开关选择本次申请的节点，防止旧轮次和当前审批混杂。
 * @param node 实例节点
 * @returns 是否展示
 */
function inCurrentRevision(node: WorkflowNode): boolean {
  return showHistory.value || (node.applicationRevision || 1) === (props.detail.activity.revision || 1);
}
/**
 * 查找参与人显示名。
 * @param id 人员标识
 * @returns 名称
 */
function nameFor(id: string): string {
  return (
    props.detail.participants.find(
      /**
       * 按当前目标标识查找配置项或参与人。
       * @param person 当前集合项
       * @returns 是否符合筛选条件
       */ function match(person) {
        return person.id === id;
      },
    )?.name || id
  );
}
/**
 * 获取节点保留的所有个人意见。
 * @param id 节点标识
 * @returns 节点任务
 */
function tasksFor(id: string): WorkflowTask[] {
  return props.detail.activity.tasks.filter(
    /**
     * 按当前目标标识查找配置项或参与人。
     * @param task 当前集合项
     * @returns 是否符合筛选条件
     */ function match(task) {
      return task.nodeId === id;
    },
  );
}
/**
 * 判定个人当前任务是否可办理，提交时服务端再次授权。
 * @param task 个人任务
 * @returns 是否可办理
 */
function canDecide(task: WorkflowTask): boolean {
  const activity = props.detail.activity;
  const node = activity.nodes.find(
    /**
     * 按当前目标标识查找配置项或参与人。
     * @param item 当前集合项
     * @returns 是否符合筛选条件
     */ function match(item) {
      return item.id === task.nodeId;
    },
  );
  return (
    activity.status === 'approving' &&
    task.status === 'pending' &&
    task.assignee === auth.profile?.user.id &&
    task.generation === node?.generation &&
    node?.status === 'active' &&
    (task.delegated ||
      node.assigneeRule.type !== 'role' ||
      !!auth.profile?.user.roles.includes(node.assigneeRule.value)) &&
    auth.can(node.kind === 'approval' ? 'approval:decide' : 'task:complete')
  );
}
/**
 * 获取节点名称。
 * @param id 节点标识
 * @returns 名称
 */
function nodeName(id: string): string {
  return (
    props.detail.activity.nodes.find(
      /**
       * 匹配节点标识。
       * @param node 节点
       * @returns 是否匹配
       */ function match(node) {
        return node.id === id;
      },
    )?.label || id
  );
}
/**
 * 判断待办是否允许流程负责人转交。
 * @param task 个人待办
 * @returns 是否可转交
 */
function canTransfer(task: WorkflowTask): boolean {
  const node = props.detail.activity.nodes.find(
    /**
     * 匹配任务节点。
     * @param item 节点
     * @returns 是否匹配
     */ function match(item) {
      return item.id === task.nodeId;
    },
  );
  return (
    !!props.detail.actions?.includes('adjust') &&
    task.status === 'pending' &&
    node?.status === 'active' &&
    node.generation === task.generation
  );
}
/**
 * 查询当前任务的受理异常说明。
 * @param id 任务标识
 * @returns 异常信息
 */
function taskWarning(id: string): string {
  return (
    props.detail.taskWarnings?.find(
      /**
       * 匹配当前个人任务的异常。
       * @param item 异常记录
       * @returns 是否匹配
       */ function warning(item) {
        return item.taskId === id;
      },
    )?.message || ''
  );
}
/**
 * 按节点状态返回标签色调，与步骤条圆点保持一致。
 * @param status 节点状态
 * @returns 标签类型
 */
function tagType(status: WorkflowNode['status']): 'info' | 'success' | 'default' {
  if (status === 'active') return 'info';
  if (status === 'completed') return 'success';
  return 'default';
}
</script>
<template>
  <div>
    <NEmpty v-if="!nodes.length" description="提交申请后生成流程" size="small" />
    <template v-else
      ><div class="spread mb">
        <NCheckbox v-model:checked="showHistory">显示历史申请节点</NCheckbox
        ><NButton size="small" secondary type="primary" @click="graphOpen = true">完整流程图</NButton>
      </div>
      <div class="flow-timeline">
        <div v-for="node in nodes" :key="node.id" class="flow-step" :class="node.status">
          <div class="flow-rail"><i class="flow-dot" /><span class="flow-line" /></div>
          <div class="flow-body">
            <div class="spread">
              <strong>{{ node.label }}</strong
              ><NTag size="small" :type="tagType(node.status)" :bordered="false">{{
                NODE_STATUSES[node.status]
              }}</NTag>
            </div>
            <div class="node-meta">
              {{
                { approval: '审批 · 全员通过', task: '任务 · 全员完成', notice: '知会 · 不阻断流转' }[
                  node.kind
                ]
              }}
              · V{{ node.applicationRevision || detail.activity.revision || 1 }} · 第{{ node.generation }}轮
            </div>
            <div class="help-text">
              受理人：<span v-for="(person, index) in node.assignees" :key="person"
                >{{ index ? '、' : '' }}{{ nameFor(person) }}</span
              >
            </div>
            <div v-if="node.deps.length" class="help-text">
              前置：<template v-for="(dep, index) in node.deps" :key="dep"
                >{{ index ? '、' : '' }}{{ nodeName(dep) }}</template
              >
            </div>
            <div v-for="task in tasksFor(node.id)" :key="task.id" class="task-line">
              <div class="spread">
                <span
                  >{{ nameFor(task.assignee) }} · {{ TASK_STATUSES[task.status]
                  }}<span v-if="task.generation !== node.generation">（历史轮次）</span></span
                ><NButton v-if="canTransfer(task)" size="tiny" @click="emit('transfer', task)">转交</NButton
                ><NButton v-if="canDecide(task)" type="primary" size="tiny" @click="emit('decide', task)"
                  >办理</NButton
                >
              </div>
              <NAlert v-if="taskWarning(task.id)" type="warning" :bordered="false" style="margin: 10px 0">{{
                taskWarning(task.id)
              }}</NAlert>
              <div v-if="task.publicComment" class="task-comment">公开结论：{{ task.publicComment }}</div>
              <div v-if="task.comment" class="task-comment">内部说明：{{ task.comment }}</div>
              <small v-if="task.actedAt" class="muted">{{ formatTime(task.actedAt) }}</small>
            </div>
          </div>
        </div>
      </div>
      <NModal
        v-model:show="graphOpen"
        preset="card"
        title="完整流程图"
        style="width: min(980px, 96vw)"
        :z-index="1100"
        ><p class="help-text mb">展示本次申请的实际节点、状态与后续业务阶段，可拖动、缩放或全屏查看。</p>
        <BusinessGraph :model="model" :height="mobile ? 420 : 620" label="实际审批节点、状态和后续业务阶段"
      /></NModal>
    </template>
  </div>
</template>
