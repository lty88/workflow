<script setup lang="tsx">
  import { computed, ref, watch } from 'vue'
  import { NCard, NSelect, NSwitch, NTag } from 'naive-ui'
  import { activeMember, findById } from '@workflow/domain'
  import type { Member } from '@workflow/domain'
  import type { GraphSelection, OrganizationChartProps } from './types'
  import { organizationGraph } from './models'
  import BusinessGraph from './BusinessGraph.vue'
  const props = defineProps<OrganizationChartProps>()
  const emit = defineEmits<{ select: [value: GraphSelection]; clear: [] }>()
  const depth = ref(2)
  const showMembers = ref(false)
  const model = computed(() =>
    organizationGraph(showMembers.value ? { ...props.config, users: props.config.users.filter(enabledMember) } : props.config, showMembers.value, depth.value)
  )
  const activeCount = computed(() => props.config.users.filter(enabledMember).length)
  const levelOptions = [
    { label: '公司与二级组织', value: 2 },
    { label: '显示到三级部门', value: 3 },
    { label: '全部层级', value: 0 },
  ]
  /** 按真实部门及上级状态统计有效人员。
   * @param member 人员
   * @returns 是否为有效在职成员
   */
  function enabledMember(member: Member): boolean {
    return activeMember(props.config, member.id)
  }
  /** 外部树选中深层部门时自动展开层级，确保可定位。
   * @param id 选中的部门标识
   */
  function revealSelected(id: string): void {
    if (!id || !depth.value) return
    let department = findById(props.config.departments, id)
    let level = 1
    const visited = new Set<string>()
    while (department?.parent && !visited.has(department.id)) {
      visited.add(department.id)
      department = findById(props.config.departments, department.parent)
      level++
    }
    if (level > depth.value) depth.value = 0
  }
  /** 切换层级时取消当前筛选，避免已选节点被层级过滤隐藏。
   * @param value 最大部门层级
   */
  function changeDepth(value: number): void {
    emit('clear')
    depth.value = value
  }
  /** 显式展示成员时展开所有部门，确保成员归属清楚。
   * @param value 是否显示在职成员
   */
  function changeMembers(value: boolean): void {
    showMembers.value = value
    if (value) depth.value = 0
  }
  watch(() => props.selected, revealSelected)
</script>
<template>
  <NCard class="organization-chart mb" :bordered="false">
    <div class="organization-summary">
      <div>
        <span class="organization-eyebrow">ORGANIZATION</span>
        <h2>组织全景</h2>
        <p>先看公司与二级组织，切换层级查看下属部门；点击卡片联动下方成员列表。</p>
      </div>
      <div class="organization-stats">
        <div>
          <strong>{{ config.departments.length }}</strong>
          <span>组织节点</span>
        </div>
        <div>
          <strong>{{ activeCount }}</strong>
          <span>在职成员</span>
        </div>
      </div>
    </div>
    <div class="organization-filters">
      <div class="organization-filter">
        <span>展示层级</span>
        <NSelect :value="depth" :options="levelOptions" style="width: 190px" @update:value="changeDepth" />
      </div>
      <div class="organization-filter">
        <span>显示在职成员</span>
        <NSwitch :value="showMembers" @update:value="changeMembers" />
      </div>
      <NTag :bordered="false" type="info">{{ depth ? '当前展示到第 ' + depth + ' 级' : '当前展示全部层级' }}</NTag>
    </div>
    <BusinessGraph
      :model="model"
      appearance="organization"
      :selected-key="selected ? 'dept:' + selected : ''"
      :focus-on-select="true"
      :height="600"
      :fit="selected ? 'focus' : 'overview'"
      direction="TB"
      :node-width="280"
      label="部门层级与负责人"
      @select="emit('select', $event)"
      @clear="emit('clear')"
    />
  </NCard>
</template>
<style scoped>
  .organization-chart {
    background: #fff;
    border: 1px solid #e3eaf4;
    border-radius: 16px;
  }
  .organization-summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    margin-bottom: 22px;
  }
  .organization-eyebrow {
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 2px;
    color: #6e89b1;
  }
  h2 {
    font-size: 24px;
    line-height: 1.4;
    margin: 7px 0;
    color: #1e304b;
  }
  p {
    font-size: 14px;
    line-height: 1.8;
    color: #71809a;
    margin: 0;
  }
  .organization-stats {
    display: flex;
    gap: 32px;
    flex-shrink: 0;
    padding-left: 28px;
    border-left: 1px solid #e6edf6;
  }
  .organization-stats div {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .organization-stats strong {
    font-size: 28px;
    line-height: 1.3;
    font-variant-numeric: tabular-nums;
    color: #274971;
  }
  .organization-stats span,
  .organization-filter {
    font-size: 13px;
    color: #6a7c95;
  }
  .organization-filters {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 16px 28px;
    margin-bottom: 16px;
    padding: 14px 16px;
    background: #f5f8fc;
    border: 1px solid #e9eef5;
    border-radius: 10px;
  }
  .organization-filter {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  @media (max-width: 850px) {
    .organization-summary {
      align-items: flex-start;
      flex-direction: column;
      gap: 16px;
    }
    .organization-stats {
      border: 0;
      padding: 0;
    }
    h2 {
      font-size: 21px;
    }
    .organization-filters {
      gap: 14px;
    }
  }
</style>
