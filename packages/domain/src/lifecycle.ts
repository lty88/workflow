import type { Activity, FormDefinition, LifecycleDefinition } from './types';

/** 读取冻结生命周期；未配置的旧模板和活动继续采用原活动闭环。
 * @param source 模板、引擎或申请快照
 * @returns 已注册且可执行的生命周期配置
 */
export function lifecycleOf(source: { lifecycle?: LifecycleDefinition }): LifecycleDefinition {
  return source.lifecycle || { businessType: 'activity', afterApproval: 'activity_standard', version: 1 };
}
/** 创建普通申请的独立表单，标题始终可见，附件沿用统一上传及授权。
 * @returns 不依赖活动时间、人数、预算的表单
 */
export function defaultRequestForm(): FormDefinition {
  return {
    id: 'general-request',
    name: '通用申请表',
    businessType: 'general',
    fields: [
      {
        id: 'request-title',
        key: 'request_title',
        label: '申请标题',
        type: 'text',
        required: true,
        default: '',
        options: [],
        system: true,
      },
      {
        id: 'request-reason',
        key: 'request_reason',
        label: '申请内容与事由',
        type: 'textarea',
        required: true,
        default: '',
        options: [],
      },
      {
        id: 'request-files',
        key: 'request_files',
        label: '申请附件',
        type: 'attachment',
        required: false,
        default: '',
        options: [],
      },
    ],
  };
}
/** 计算申请整体状态、审批结果和当前业务阶段，避免把审批通过误作活动办结。
 * @param activity 申请运行数据
 * @returns 可持久化和展示的生命周期摘要
 */
export function requestLifecycleState(activity: Activity) {
  const state = activity.status;
  const terminal = ['archived', 'completed'].includes(state);
  return {
    status: terminal
      ? 'completed'
      : state === 'draft'
        ? 'draft'
        : state === 'rejected'
          ? 'terminated'
          : state === 'cancelled'
            ? 'cancelled'
            : 'running',
    approvalResult:
      state === 'rejected'
        ? 'rejected'
        : ['draft', 'approving', 'needs_info', 'withdrawn'].includes(state)
          ? 'pending'
          : 'approved',
    currentStage: terminal
      ? null
      : ['draft', 'approving', 'needs_info', 'withdrawn', 'rejected'].includes(state)
        ? 'approval'
        : state,
  };
}

/** 计算标准活动子流程当前步骤位置，供运行同步与画布共用。
 * @param status 当前或取消前的业务状态
 * @returns 0至3为在办步骤、4为全部完成，负一表示尚未进入
 */
export function activitySubprocessPosition(status?: Activity['status']): number {
  return status === 'ready_assign'
    ? 0
    : status === 'ready_execute' || status === 'executing'
      ? 1
      : status === 'archive_draft'
        ? 2
        : status === 'archive_review'
          ? 3
          : status === 'archived'
            ? 4
            : -1;
}
