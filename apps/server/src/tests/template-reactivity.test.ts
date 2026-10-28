import { createRequire } from 'node:module';
import { expect, test } from 'vitest';
import { defaultRequestForm, seedConfig, templateContext } from '@workflow/domain';
import { initialTemplates } from '../db/template-migration';
import { templateEditorGraph } from '../../../web/src/components/templates/editor-model';

const webRequire = createRequire(new URL('../../../web/package.json', import.meta.url));
// Vue 是前端依赖，通过前端包加载真实运行时；这里只描述局部测试使用的公开能力。
type VueReactivityRuntime = {
  ref: <T>(value: T) => { value: T };
  readonly: <T>(value: T) => T;
  computed: <T>(getter: () => T) => { readonly value: T };
  isProxy: (value: unknown) => boolean;
};
const { ref, readonly, computed, isProxy } = webRequire('vue') as VueReactivityRuntime;

/** 使用真实 Vue 代理重现设计器渲染，核对两类模板和嵌套发布表单均能生成独立上下文。 */
function proxyContextCase(): void {
  for (const mode of ['activity', 'general-definition', 'general-frozen'] as const) {
    const config = readonly(ref(seedConfig()).value);
    const value = initialTemplates(seedConfig())[0]!.definition;
    value.lifecycle = {
      businessType: mode === 'activity' ? 'activity' : 'general',
      afterApproval: mode === 'activity' ? 'activity_standard' : 'complete',
      version: 1,
    };
    if (mode !== 'activity') value.form = defaultRequestForm();
    const definition = readonly(ref(value).value);
    const form = mode === 'general-frozen' ? readonly(ref(defaultRequestForm()).value) : config.form;
    const before = JSON.stringify(definition);
    expect(isProxy(definition.nodes)).toBe(true);
    expect(isProxy(definition.nodes[0]!.assignee)).toBe(true);
    const context = computed(() => templateContext(config, definition, form));
    expect(context.value.workflow.nodes).toEqual(definition.nodes);
    expect(isProxy(context.value.workflow.nodes)).toBe(false);
    expect(isProxy(context.value.workflow.lifecycle)).toBe(false);
    expect(templateEditorGraph(context.value).data.nodes!.length).toBeGreaterThan(value.nodes.length);
    context.value.workflow.nodes[0]!.assignee.value = 'edited-assignee';
    context.value.workflow.nodes[0]!.deps.push('edited-dependency');
    context.value.workflow.lifecycle!.afterApproval = 'complete';
    if (mode !== 'activity') {
      expect(isProxy(context.value.form.fields)).toBe(false);
      context.value.form.fields[0]!.label = '编辑后的标题';
      expect(form.fields[0]!.label).not.toBe('编辑后的标题');
    }
    expect(JSON.stringify(definition)).toBe(before);
  }
}
test('设计器上下文兼容真实 Vue 只读与嵌套代理，图模型生成成功且不改原模板', proxyContextCase);
