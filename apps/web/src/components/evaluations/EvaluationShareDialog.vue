<script setup lang="tsx">
import { computed, ref } from 'vue';
import { NAlert, NButton, NInput, NModal, NQrCode, NSpace } from 'naive-ui';
import { useFeedback } from '@/composables/use-feedback';
const props = defineProps<{
  show: boolean;
  url: string;
  activityName: string;
}>();
const emit = defineEmits<{ 'update:show': [value: boolean] }>();
const feedback = useFeedback();
const qrContainer = ref<HTMLElement | null>(null);
const localOnly = computed(() => {
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(props.url).hostname);
  } catch {
    return false;
  }
});

/** 复制当前分享链接，浏览器不支持剪贴板时引导用户从输入框复制。 */
async function copy(): Promise<void> {
  try {
    if (!navigator.clipboard) throw new Error('请选中下方链接手动复制');
    await navigator.clipboard.writeText(props.url);
    feedback.success('评价链接已复制');
  } catch (error) {
    feedback.failure(error);
  }
}

/** 从本地生成的二维码画布下载PNG图片，供会场展示或发送。 */
function download(): void {
  const canvas = qrContainer.value?.querySelector('canvas');
  if (!canvas) {
    feedback.failure(new Error('二维码尚未生成，请稍后重试'));
    return;
  }
  const link = document.createElement('a');
  link.href = canvas.toDataURL('image/png');
  link.download = '活动评价二维码.png';
  link.click();
}
</script>
<template>
  <NModal
    :show="show"
    preset="card"
    title="分享活动评价"
    :style="{ width: '460px', maxWidth: 'calc(100vw - 32px)' }"
    @update:show="emit('update:show', $event)"
  >
    <div class="share-poster">
      <span>扫码说说你的活动体验</span>
      <h2>{{ activityName }}</h2>
      <div ref="qrContainer">
        <NQrCode :value="url" :size="240" :padding="20" error-correction-level="M" />
      </div>
      <p>匿名填写 · 无需登录 · 约 1 分钟</p>
    </div>
    <NAlert v-if="localOnly" type="warning" :bordered="false" class="share-warning"
      >当前链接使用本机地址。手机扫码前，请将分享地址配置为手机可访问的公司域名或局域网地址。</NAlert
    >
    <NInput :value="url" readonly aria-label="评价分享链接" />
    <NSpace justify="center" class="share-actions"
      ><NButton type="primary" @click="copy">复制链接</NButton><NButton @click="download">下载二维码</NButton
      ><a :href="url" target="_blank" rel="noopener noreferrer"><NButton>预览填写页</NButton></a></NSpace
    >
  </NModal>
</template>
<style scoped>
.share-poster {
  text-align: center;
  padding: 4px 0 20px;
}
.share-poster > span {
  color: #697991;
  font-size: 13px;
}
.share-poster h2 {
  font-size: 20px;
  line-height: 1.6;
  margin: 10px 0 16px;
}
.share-poster p {
  font-size: 13px;
  color: #697991;
  margin: 12px 0 0;
}
.share-warning {
  margin-bottom: 16px;
}
.share-actions {
  margin-top: 20px;
}
</style>
