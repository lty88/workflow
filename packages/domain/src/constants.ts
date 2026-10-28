import type { ActivityStatus, PageComponent, Permission, Scope } from './types';
export const DEFAULT_PASSWORD = '123456';
export const PASSWORD_MIN_LENGTH = 6;
export const PERMISSIONS: Record<Permission, string> = {
  'activity:read': '查看申请与活动',
  'activity:delete': '删除本人非办理中申请',
  'activity:delete:any': '删除授权范围内任意申请',
  'activity:create': '发起申请与活动',
  'activity:submit': '提交申请',
  'activity:sensitive:read': '查看授权申请内全部敏感内容',
  'activity:sensitive:export': '敏感导出与跨节点下载',
  'file:download': '下载申请附件',
  'activity:export': '导出申请',
  'approval:decide': '审核申请',
  'task:complete': '办理流程任务',
  'workflow:adjust': '调整流程',
  'activity:assign': '指派执行人',
  'execution:report': '执行与汇报',
  'archive:review': '审核档案',
  'config:manage': '维护系统配置',
  'evaluation:read': '查看活动评价',
  'evaluation:manage': '管理活动评价链接',
  'dashboard:read': '查看领导数据看板',
};
export const PAGE_COMPONENTS: Record<PageComponent, { label: string; permission: Permission }> = {
  leadership_dashboard: { label: '领导看板', permission: 'dashboard:read' },
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
  approving: '流程办理中',
  needs_info: '待补充',
  withdrawn: '已撤回',
  rejected: '申请已终止',
  ready_assign: '待指派',
  ready_execute: '待执行',
  executing: '执行中',
  archive_draft: '待提交档案',
  archive_review: '待归档审核',
  archived: '已归档',
  completed: '已办结',
  cancel_review: '取消审批中',
  cancelled: '已取消',
};
