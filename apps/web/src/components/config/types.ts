import type { CompanyConfig, Condition, FormField, AssigneeRule } from '@workflow/domain';
export interface ConfigPanelProps {
  modelValue: CompanyConfig;
}
export interface ConditionProps {
  modelValue?: Condition;
  fields: FormField[];
  excluded?: string;
  label?: string;
}
export interface AssigneeProps {
  modelValue: AssigneeRule;
  config: CompanyConfig;
}
export interface ConfigSlot {
  config: CompanyConfig;
  update: (value: CompanyConfig) => void;
}
export const FIELD_TYPES: Record<FormField['type'], string> = {
  text: '单行文本',
  textarea: '多行文本',
  number: '数字',
  select: '单选下拉',
  datetime: '日期时间',
  checkboxes: '多选',
};
