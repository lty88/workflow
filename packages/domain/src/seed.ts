import { supplementCommonOrganization } from './organization';
import type { CompanyConfig, FormField, Member, Permission, Role } from './types';

/**
 * 创建活动表单字段。
 * @param key 稳定字段键
 * @param label 字段名称
 * @param type 控件类型
 * @param required 是否必填
 * @param initial 默认输入
 * @returns 字段配置
 */
function field(
  key: string,
  label: string,
  type: FormField['type'] = 'text',
  required = true,
  initial = '',
): FormField {
  return { id: `f-${key}`, key, label, type, required, default: initial, options: [] };
}

/**
 * 创建角色定义。
 * @param id 角色标识
 * @param name 角色名
 * @param permissions 动作权限
 * @param scope 数据范围
 * @param pages 页面授权
 * @returns 角色
 */
function role(
  id: string,
  name: string,
  permissions: Permission[],
  scope: Role['scope'],
  pages = ['p-home', 'p-list', 'p-tasks'],
): Role {
  return { id, name, permissions, scope, pages };
}

/**
 * 创建演示组织成员，不包含密码或会话信息。
 * @param id 成员键
 * @param name 姓名
 * @param username 登录账号
 * @param department 主部门
 * @param roles 角色集合
 * @returns 成员
 */
function user(id: string, name: string, username: string, department: string, roles: string[]): Member {
  return { id, name, username, department, roles, active: true };
}

/**
 * 生成包含常用部门与示例人员的首版配置，用于显式数据库初始化。
 * @returns 组织、权限、菜单、表单与流程初始版本
 */
export function seedConfig(): CompanyConfig {
  const fields = [
    field('activity_name', '活动名称'),
    field('delivery_mode', '举办方式', 'select', true, '线下'),
    field('start_at', '开始时间', 'datetime'),
    field('end_at', '结束时间', 'datetime'),
    field('location', '活动地点／学校'),
    field('meeting_url', '线上会议链接'),
    field('nature', '业务性质', 'select', true, '校园立体阅读课程项目'),
    field('service_type', '服务类型', 'select', true, '免费课题服务'),
    field('background', '活动背景与诉求', 'textarea'),
    field('agenda', '活动议程及内容', 'textarea'),
    field('content_forms', '内容形式', 'checkboxes', true, '专题讲座'),
    field('forum', '是否附带三峡大讲坛', 'select', true, '否'),
    field('people', '预计参会人数', 'number'),
    field('composition', '人员构成', 'checkboxes', true, '一线教师'),
    field('training', '培训内容、形式与时长', 'textarea'),
    field('personnel', '专家与人员要求', 'textarea', false),
    field('contact', '活动联系人'),
    field('contact_info', '联系人方式'),
    field('arranger', '活动安排人'),
    field('arranger_info', '安排人方式'),
    field('receiver', '活动接收人'),
    field('receiver_info', '接收人方式'),
    field('expert_fee', '专家费（元）', 'number', true, '0'),
    field('conference_fee', '会务费（元）', 'number', true, '0'),
    field('travel_fee', '差旅费（元）', 'number', true, '0'),
    field('budget', '预算总额（自动合计）', 'number', true, '0'),
  ];
  for (const item of fields) {
    if (
      [
        'activity_name',
        'start_at',
        'end_at',
        'budget',
        'expert_fee',
        'conference_fee',
        'travel_fee',
      ].includes(item.key)
    )
      item.system = true;
    if (item.key === 'delivery_mode') item.options = ['线下', '线上', '混合'];
    if (item.key === 'location') item.visible = { field: 'delivery_mode', operator: 'neq', value: '线上' };
    if (item.key === 'meeting_url') item.visible = { field: 'delivery_mode', operator: 'neq', value: '线下' };
    if (item.key === 'nature')
      item.options = ['实验区', '实验校', '校园立体阅读课程项目', '整本书项目', '其他'];
    if (item.key === 'service_type') item.options = ['免费课题服务', '收费课题培训', '其他'];
    if (item.key === 'content_forms')
      item.options = ['专题讲座', '课例示范', '课例研磨', '教学视导', '课题指导', '其他'];
    if (item.key === 'forum') item.options = ['否', '是'];
    if (item.key === 'composition')
      item.options = ['教育局领导', '教科研领导', '学校管理人员', '教研员', '一线教师', '其他'];
    if (item.key === 'training')
      item.visible = { field: 'service_type', operator: 'eq', value: '收费课题培训' };
  }
  const config: CompanyConfig = {
    version: 1,
    departments: [
      { id: 'company', name: '树人教育', parent: '', manager: 'u-liu', active: true },
      { id: 'research', name: '教育研究院', parent: 'company', manager: 'u-zhou', active: true },
      { id: 'd1', name: '教研一部', parent: 'research', manager: 'u-chen', active: true },
      { id: 'd2', name: '教研二部', parent: 'research', manager: 'u-du', active: true },
      { id: 'market', name: '营销中心', parent: 'company', manager: 'u-zhao', active: true },
    ],
    users: [
      user('u-admin', '许言', 'admin', 'company', ['admin']),
      user('u-lin', '林晓', 'linxiao', 'd1', ['applicant']),
      user('u-chen', '陈宁', 'chenning', 'd1', ['department']),
      user('u-zhou', '周岚', 'zhoulan', 'research', ['academic']),
      user('u-zhao', '赵明', 'zhaoming', 'market', ['marketing']),
      user('u-liu', '刘文', 'liuwen', 'company', ['director']),
      user('u-wang', '王舟', 'wangzhou', 'research', ['coordinator']),
      user('u-su', '苏禾', 'suhe', 'd1', ['executor']),
      user('u-he', '何青', 'heqing', 'research', ['archivist']),
      user('u-qiao', '乔安', 'qiaoan', 'd2', ['applicant']),
      user('u-du', '杜云', 'duyun', 'd2', ['department']),
    ],
    roles: [
      role('admin', '配置管理员', ['config:manage'], 'self', ['p-config']),
      role(
        'applicant',
        '申请人',
        ['activity:read', 'activity:create', 'activity:submit', 'activity:export'],
        'self',
        ['p-home', 'p-list', 'p-new'],
      ),
      role('department', '部门审核人', ['activity:read', 'approval:decide'], 'department'),
      role('academic', '教研审核人', ['activity:read', 'approval:decide'], 'tasks'),
      role('marketing', '营销审核人', ['activity:read', 'approval:decide'], 'tasks'),
      role('director', '院负责人', ['activity:read', 'approval:decide'], 'tasks'),
      role(
        'coordinator',
        '流程负责人',
        ['activity:read', 'activity:assign', 'workflow:adjust', 'task:complete', 'activity:export'],
        'department_tree',
      ),
      role('executor', '执行人', ['activity:read', 'execution:report', 'task:complete'], 'tasks'),
      role(
        'archivist',
        '归档审核人',
        ['activity:read', 'archive:review', 'activity:export'],
        'department_tree',
        ['p-home', 'p-list', 'p-tasks', 'p-archive'],
      ),
    ],
    groups: [
      { id: 'business', name: '活动协作', active: true },
      { id: 'system', name: '系统管理', active: true },
    ],
    pages: [
      { id: 'p-home', name: '工作台', group: 'business', component: 'summary', active: true },
      { id: 'p-list', name: '活动工单', group: 'business', component: 'activity_list', active: true },
      {
        id: 'p-new',
        name: '发起活动',
        group: 'business',
        component: 'activity_form',
        formId: 'activity',
        active: true,
      },
      { id: 'p-tasks', name: '我的待办', group: 'business', component: 'task_list', active: true },
      { id: 'p-archive', name: '活动档案', group: 'business', component: 'archive_list', active: true },
      { id: 'p-config', name: '配置中心', group: 'system', component: 'config_overview', active: true },
    ],
    form: { id: 'activity', name: '活动申请表', fields },
    workflow: {
      name: '教研活动流程',
      nodes: [
        {
          id: 'n-department',
          label: '部门初审',
          kind: 'approval',
          deps: [],
          assignee: { type: 'manager', value: '' },
          protected: true,
        },
        {
          id: 'n-academic',
          label: '教研方案审核',
          kind: 'approval',
          deps: ['n-department'],
          assignee: { type: 'role', value: 'academic' },
        },
        {
          id: 'n-marketing',
          label: '营销与校方确认',
          kind: 'approval',
          deps: ['n-department'],
          assignee: { type: 'role', value: 'marketing' },
        },
        {
          id: 'n-director',
          label: '院负责人复核',
          kind: 'approval',
          deps: ['n-academic', 'n-marketing'],
          assignee: { type: 'role', value: 'director' },
          condition: { field: 'budget', operator: 'gte', value: '10000' },
        },
      ],
    },
  };
  return supplementCommonOrganization(config, true).config;
}
