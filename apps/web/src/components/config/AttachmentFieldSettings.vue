<script setup lang="tsx">
  import { NFormItem, NInputNumber, NSelect, NAlert } from 'naive-ui'
  import { ATTACHMENT_EXTENSIONS } from '@workflow/domain'
  import type { AttachmentOptions } from '@workflow/domain'
  const model = defineModel<AttachmentOptions>({ required: true })
  const extensions = ATTACHMENT_EXTENSIONS.map(extensionOption)
  /** 将受支持文件格式转换为多选项。
   * @param extension 文件扩展名
   * @returns 显示选项
   */
  function extensionOption(extension: string): { label: string; value: string } {
    return { label: extension.toUpperCase(), value: extension }
  }
  /** 更新字段上传规则，父级保存时同时执行服务端配置校验。
   * @param key 上传配置属性
   * @param value 新配置值
   */
  function update<K extends keyof AttachmentOptions>(key: K, value: AttachmentOptions[K]): void {
    model.value = { ...model.value, [key]: value }
  }
</script>
<template>
  <NFormItem label="最多上传数量" required>
    <NInputNumber :value="model.maxCount" :min="1" :max="10" :precision="0" @update:value="update('maxCount', $event || 1)" />
  </NFormItem>
  <NFormItem label="单个文件大小上限（MB）" required>
    <NInputNumber :value="model.maxSizeMB" :min="1" :max="20" :precision="0" @update:value="update('maxSizeMB', $event || 1)" />
  </NFormItem>
  <NFormItem label="允许文件格式" required>
    <NSelect :value="model.extensions" :options="extensions" multiple @update:value="update('extensions', $event)" />
  </NFormItem>
  <NAlert type="info" :bordered="false" class="mb">附件继承本字段的查看与填写权限。每个附件字段独立计数；附件不支持默认值。</NAlert>
</template>
