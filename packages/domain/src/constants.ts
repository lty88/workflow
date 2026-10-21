import type { ActivityStatus, PageComponent, Permission, Scope } from './types';
export const PERMISSIONS: Record<Permission, string> = {
  'activity:read': '查看活动',
  'activity:create': '新建活动',
  'activity:submit': '提交申请',
  'activity:export': '导出活动',
  'approval:decide': '审核活动',
  'task:complete': '办理流程任务',
  'workflow:adjust': '调整流程',
  'activity:assign': '指派执行人',
  'execution:report': '执行与汇报',
  'archive:review': '审核档案',
  'config:manage': '维护系统配置',
};
export const PAGE_COMPONENTS: Record<PageComponent, { label: string; permission: Permission }> = {
  summary: { label: '工作台', permission: 'activity:read' },
  activity_list: { label: '活动列表', permission: 'activity:read' },
  activity_form: { label: '申请表单', permission: 'activity:create' },
  task_list: { label: '任务列表', permission: 'activity:read' },
  archive_list: { label: '档案列表', permission: 'activity:read' },
  config_overview: { label: '配置中心', permission: 'config:manage' },
};
export const SCOPES: Record<Scope, string> = {
  self: '本人',
  department: '本部门',
  department_tree: '本部门及下级',
  tasks: '参与活动和任务',
  all: '全公司',
};
export const STATUSES: Record<ActivityStatus, string> = {
  draft: '草稿',
  approving: '审批中',
  needs_info: '待补充',
  withdrawn: '已撤回',
  rejected: '已拒绝',
  ready_assign: '待指派',
  ready_execute: '待执行',
  executing: '执行中',
  archive_draft: '待提交档案',
  archive_review: '待归档审核',
  archived: '已归档',
  cancel_review: '取消审批中',
  cancelled: '已取消',
};
