<script setup lang="tsx">
import { computed, ref, watch } from 'vue';
import { NDrawer, NDrawerContent, NEmpty, NSelect, NTag } from 'naive-ui';
import type { TemplateRelease } from '@workflow/domain';
import type { TemplateHistoryProps } from './types';
import { templateGraph } from '@/components/graph/models';
import BusinessGraph from '@/components/graph/BusinessGraph.vue';
import { formatTime } from '@/composables/format';
const props = defineProps<TemplateHistoryProps>();
const emit = defineEmits<{ 'update:show': [value: boolean] }>();
const version = ref<number | null>(null);
const options = computed(() => props.versions.map(option));
const selected = computed(() => props.versions.find(matches) || props.versions[0]);
const model = computed(() =>
  selected.value
    ? templateGraph({
        ...props.config,
        form: selected.value.form,
        workflow: { name: selected.value.definition.name, nodes: selected.value.definition.nodes },
      })
    : null,
);
/**
 * 显示发布版本和时间。
 * @param value 发布快照
 * @returns 版本选项
 */
function option(value: TemplateRelease) {
  return { label: `V${value.version} · ${formatTime(value.publishedAt)}`, value: value.version };
}
/**
 * 匹配当前查看版本。
 * @param value 发布快照
 * @returns 是否选中
 */
function matches(value: TemplateRelease): boolean {
  return value.version === version.value;
}
/** 切换模板历史列表时重置到最新发布版本。 */
function initialize(): void {
  version.value = props.versions[0]?.version || null;
}
watch(() => props.versions, initialize);
</script>
<template>
  <NDrawer :show="show" :width="'min(960px,100vw)'" @update:show="emit('update:show', $event)"
    ><NDrawerContent title="模板发布历史" closable
      ><template v-if="selected"
        ><NSelect v-model:value="version" :options="options" class="mb" />
        <div class="gap mb">
          <NTag type="info">{{ selected.definition.name }} · V{{ selected.version }}</NTag
          ><span class="help-text">{{ selected.form.fields.length }}个冻结字段 · 只读历史</span>
        </div>
        <BusinessGraph v-if="model" :model="model" :height="560" label="模板历史版本" /></template
      ><NEmpty v-else description="尚未发布任何版本" /></NDrawerContent
  ></NDrawer>
</template>
