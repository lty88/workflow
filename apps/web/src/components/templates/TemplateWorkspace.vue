<script setup lang="tsx">
import { computed, onMounted, ref } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';
import { NAlert, NButton, NForm, NFormItem, NInput, NModal, NPopconfirm, NSpin } from 'naive-ui';
import type { TemplateCatalogue } from '@/typings/api/templates';
import type { TemplateDefinition, TemplateRelease, WorkflowTemplate } from '@workflow/domain';
import {
  createTemplateApi,
  deleteTemplateApi,
  publishTemplateApi,
  saveTemplateApi,
  templateActiveApi,
  templateCatalogueApi,
  templateVersionsApi,
  validateTemplateApi,
} from '@/api/templates';
import { clone } from '@/composables/format';
import { useFeedback } from '@/composables/use-feedback';
import { useAuthStore } from '@/stores/auth';
import { errorMessages } from '@/api/http';
import TemplateLibrary from './TemplateLibrary.vue';
import TemplateDesigner from './TemplateDesigner.vue';
import TemplateHistory from './TemplateHistory.vue';
const auth = useAuthStore();
const feedback = useFeedback();
const catalogue = ref<TemplateCatalogue | null>(null);
const selected = ref<WorkflowTemplate | null>(null);
const definition = ref<TemplateDefinition | null>(null);
const busy = ref(false);
const pending = ref(false);
const errorText = ref('');
const errors = ref<string[]>([]);
const createOpen = ref(false);
const code = ref('');
const sourceId = ref<string>();
const versions = ref<TemplateRelease[]>([]);
const historyOpen = ref(false);
const dirty = computed(
  () => !!selected.value && JSON.stringify(definition.value) !== JSON.stringify(selected.value.draft),
);
/** 读取最新模板目录与当前组织信息，不改变业务配置。 */
async function load(): Promise<void> {
  busy.value = true;
  try {
    catalogue.value = await templateCatalogueApi();
    errorText.value = '';
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : '模板目录加载失败';
  } finally {
    busy.value = false;
  }
}
/**
 * 用独立副本打开草稿，避免修改列表中的已发布内容。
 * @param template 选中模板
 */
function edit(template: WorkflowTemplate): void {
  selected.value = template;
  definition.value = clone(template.draft);
  errors.value = [];
}
/**
 * 应用服务器保存结果，并同步列表与草稿乐观锁版本。
 * @param template 最新模板
 */
function apply(template: WorkflowTemplate): void {
  if (catalogue.value) {
    let replaced = false;
    for (let i = 0; i < catalogue.value.items.length; i++)
      if (catalogue.value.items[i]!.id === template.id) {
        catalogue.value.items[i] = template;
        replaced = true;
      }
    if (!replaced) catalogue.value.items.unshift(template);
  }
  edit(template);
}
/**
 * 准备新建或复制模板弹窗，并给出可修改的唯一编码建议。
 * @param source 可选复制源
 */
function openCreate(source?: WorkflowTemplate): void {
  sourceId.value = source?.id;
  code.value = 'flow-' + crypto.randomUUID().slice(0, 8);
  createOpen.value = true;
}
/** 请求服务器创建独立草稿并进入设计器，不复制任何业务实例。 */
async function create(): Promise<void> {
  if (!auth.can('config:manage') || busy.value) return;
  if (!/^[a-z][a-z0-9_-]{2,59}$/.test(code.value)) {
    feedback.failure(new Error('编码为3～60位小写字母、数字、下划线或连字符，且以字母开头'));
    return;
  }
  busy.value = true;
  try {
    apply(await createTemplateApi(code.value, sourceId.value));
    createOpen.value = false;
    feedback.success('模板草稿已创建');
  } catch (error) {
    feedback.failure(error);
  } finally {
    busy.value = false;
  }
}
/** 保存当前模板草稿并更新本地版本；网络重试沿用原请求标识。 */
async function save(): Promise<void> {
  if (!auth.can('config:manage') || !selected.value || !definition.value || busy.value) return;
  busy.value = true;
  try {
    apply(await saveTemplateApi(selected.value.id, definition.value, selected.value.draftRevision));
    feedback.success('模板草稿已保存');
  } catch (error) {
    errors.value = errorMessages(error);
    feedback.failure(error);
  } finally {
    busy.value = false;
  }
}
/** 保存必要的本地修改后发布模板新版本，旧活动保持原快照。 */
async function publish(): Promise<void> {
  if (!auth.can('config:manage') || !selected.value || !definition.value || busy.value) return;
  busy.value = true;
  try {
    if (dirty.value)
      apply(await saveTemplateApi(selected.value.id, definition.value, selected.value.draftRevision));
    apply(await publishTemplateApi(selected.value!.id, selected.value!.draftRevision));
    feedback.success('流程模板新版本已发布');
  } catch (error) {
    errors.value = errorMessages(error);
    feedback.failure(error);
  } finally {
    busy.value = false;
  }
}
/** 由服务端检查设计草稿的结构、条件和各申请人的受理资格。 */
async function validate(): Promise<void> {
  if (!selected.value || !definition.value || busy.value) return;
  busy.value = true;
  try {
    errors.value = (await validateTemplateApi(selected.value.id, definition.value)).errors;
    if (!errors.value.length) feedback.success('模板结构与受理规则校验通过');
  } catch (error) {
    errors.value = errorMessages(error);
    feedback.failure(error);
  } finally {
    busy.value = false;
  }
}
/**
 * 请求服务器启停模板，保留历史发布版本与在途活动。
 * @param template 目标模板
 */
async function toggle(template: WorkflowTemplate): Promise<void> {
  if (!auth.can('config:manage') || busy.value) return;
  busy.value = true;
  try {
    await templateActiveApi(template, !template.active);
    catalogue.value = await templateCatalogueApi();
    feedback.success(template.active ? '模板已停用' : '模板已启用');
  } catch (error) {
    feedback.failure(error);
  } finally {
    busy.value = false;
  }
}
/**
 * 删除服务器允许清理的未发布草稿，并刷新模板目录。
 * @param template 待删除草稿
 */
async function remove(template: WorkflowTemplate): Promise<void> {
  if (!auth.can('config:manage') || busy.value) return;
  busy.value = true;
  try {
    await deleteTemplateApi(template);
    catalogue.value = await templateCatalogueApi();
    feedback.success('未发布草稿已删除');
  } catch (error) {
    feedback.failure(error);
  } finally {
    busy.value = false;
  }
}
/**
 * 查看服务器保存的不可变发布历史。
 * @param template 目标模板
 */
async function history(template: WorkflowTemplate): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try {
    versions.value = await templateVersionsApi(template.id);
    historyOpen.value = true;
  } catch (error) {
    feedback.failure(error);
  } finally {
    busy.value = false;
  }
}
/** 清除本地编辑状态，返回模板库，服务器已保存草稿保持不变。 */
function back(): void {
  pending.value = false;
  selected.value = null;
  definition.value = null;
  errors.value = [];
}
/** 明确丢弃本地修改后刷新目录，解决多人编辑导致的草稿版本冲突。 */
async function reload(): Promise<void> {
  if (busy.value) return;
  await load();
  if (!errorText.value) back();
}
/**
 * 页面离开前保护未保存的模板草稿，使用浏览器明确确认丢弃。
 * @returns 是否允许离开页面
 */
function canLeave(): boolean {
  return (!dirty.value && !pending.value) || window.confirm('模板还有未保存修改，确认离开并丢弃？');
}
onBeforeRouteLeave(canLeave);
onMounted(load);
</script>
<template>
  <div v-if="!selected" class="spread mb">
    <span class="help-text">模板独立管理，保存草稿后发布生效。</span
    ><NPopconfirm @positive-click="reload"
      ><template #trigger><NButton :disabled="busy">重新读取目录</NButton></template
      >重新读取将丢弃尚未保存的模板修改，返回最新模板库。</NPopconfirm
    >
  </div>
  <NSpin :show="busy"
    ><NAlert v-if="errorText" type="error" class="mb"
      >{{ errorText }} <NButton text @click="load">重新读取</NButton></NAlert
    ><NAlert v-if="errors.length && !selected" type="warning" title="模板校验结果" class="mb"
      ><div v-for="error in errors" :key="error">{{ error }}</div></NAlert
    ><template v-if="catalogue"
      ><TemplateDesigner
        v-if="selected && definition"
        :key="selected.id"
        v-model="definition"
        :template="selected"
        :config="catalogue.config"
        :types="catalogue.types"
        :busy="busy"
        :dirty="dirty"
        :errors="errors"
        @pending="pending = $event"
        @save="save"
        @publish="publish"
        @validate="validate"
        @back="back"
        @discard="back" /><TemplateLibrary
        v-else
        :items="catalogue.items"
        :types="catalogue.types"
        :config="catalogue.config"
        :busy="busy"
        @edit="edit"
        @copy="openCreate"
        @active="toggle"
        @history="history"
        @remove="remove"
        @create="openCreate()" /><TemplateHistory
        v-model:show="historyOpen"
        :versions="versions"
        :config="catalogue.config" /></template
  ></NSpin>
  <NModal
    v-model:show="createOpen"
    preset="card"
    :title="sourceId ? '复制流程模板' : '新建流程模板'"
    style="width: min(520px, 95vw)"
    :mask-closable="!busy"
    ><NForm label-placement="top" :disabled="busy"
      ><NFormItem label="唯一模板编码" required><NInput v-model:value="code" :maxlength="60" /></NFormItem>
      <p class="help-text">发布后编码固定；名称、适用类型和受理规则在设计器中配置。</p>
      <NButton type="primary" :loading="busy" @click="create">创建草稿并设计</NButton></NForm
    ></NModal
  >
</template>
