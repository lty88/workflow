<script setup lang="tsx">
  import { computed, ref } from 'vue'
  import { useRouter } from 'vue-router'
  import { useMediaQuery } from '@vueuse/core'
  import { NAlert, NBadge, NButton, NDrawer, NDrawerContent, NEmpty, NSpin, NSwitch } from 'naive-ui'
  import type { Notification } from '@/typings/api'
  import { useAuthStore } from '@/stores/auth'
  import { activityDestination } from '@/navigation'
  import { formatTime } from '@/composables/format'
  import { useFeedback } from '@/composables/use-feedback'
  import { useNotificationAudio } from './use-notification-audio'
  import { useNotificationPolling } from './use-notification-polling'
  const auth = useAuthStore()
  const router = useRouter()
  const feedback = useFeedback()
  const actor = computed(() => auth.profile?.user.id || '')
  const mobile = useMediaQuery('(max-width: 850px)')
  const open = ref(false)
  const audio = useNotificationAudio({ actor })
  const { enabled, muted, sound, voice, pendingCount, needsActivation, error: audioError } = audio
  const { messages, unread, loading, error, refresh, markRead } = useNotificationPolling(actor, audio.announce)
  /** 打开消息面板并刷新当前账号最近消息，后台轮询持续运行。 */
  function show(): void {
    open.value = true
    void refresh()
  }
  /**
   * 标记消息已读、移出待播并打开活动，失败时显示统一业务提示。
   * @param item 选中的通知
   */
  async function visit(item: Notification): Promise<void> {
    try {
      await markRead(item.id)
      audio.dismiss(item.id)
      open.value = false
      await router.push(activityDestination(item.activityId))
    } catch (failure) {
      feedback.failure(failure)
    }
  }
</script>
<template>
  <div class="notification-trigger">
    <NBadge :value="unread" :max="99"><NButton quaternary @click="show">消息</NButton></NBadge>
    <NButton
      v-if="muted || needsActivation || audioError"
      data-notification-audio-control
      size="small"
      secondary
      :type="audioError ? 'warning' : 'primary'"
      :title="audioError || '点击后自动播报新消息'"
      @click="audio.enable()"
    >
      {{ audioError ? '声音异常 · 重试' : '启用声音' }}
    </NButton>
    <span v-else class="audio-status" :class="{ muted: !sound && !voice }">{{ sound || voice ? '声音已开' : '声音已关' }}</span>
  </div>
  <NDrawer v-model:show="open" :width="mobile ? '100%' : 440">
    <NDrawerContent title="站内消息" closable>
      <section class="notification-settings" data-notification-audio-control>
        <div class="spread">
          <strong>新消息声音提醒</strong>
          <NButton size="small" :type="enabled ? 'default' : 'primary'" @click="enabled ? audio.stop() : audio.enable()">
            {{ enabled ? '关闭声音' : '开启声音并试听' }}
          </NButton>
        </div>
        <div class="audio-options">
          <label>
            提示音
            <NSwitch v-model:value="sound" />
          </label>
          <label>
            语音播报
            <NSwitch v-model:value="voice" />
          </label>
        </div>
        <p>声音设置会保留；首次进入页面点击或操作一次即可启用。新消息合并提醒，暂未播放的消息会自动补播。</p>
        <p v-if="pendingCount">有 {{ pendingCount }} 条新消息等待声音提醒。</p>
        <NAlert v-if="audioError" type="warning">{{ audioError }}</NAlert>
      </section>
      <div class="spread message-status">
        <span>{{ error || '自动更新 · 展示最近100条消息' }}</span>
        <NButton text :loading="loading" @click="refresh">刷新</NButton>
      </div>
      <NSpin :show="loading && !messages.length">
        <NEmpty v-if="!messages.length && !loading" description="暂无消息" />
        <button v-for="item in messages" :key="item.id" class="notification" @click="visit(item)">
          <NBadge :dot="!item.readAt" />
          <strong>{{ item.title }}</strong>
          <small>{{ formatTime(item.createdAt) }}</small>
        </button>
      </NSpin>
    </NDrawerContent>
  </NDrawer>
</template>
<style scoped>
  .notification-trigger {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .audio-status {
    font-size: 12px;
    color: #2b8766;
    white-space: nowrap;
  }
  .audio-status.muted {
    color: #8793a6;
  }
  .notification-settings {
    padding: 14px;
    background: #f3f7ff;
    border-radius: 10px;
    margin-bottom: 16px;
  }
  .notification-settings p,
  .message-status {
    font-size: 12px;
    color: #6b7a91;
    line-height: 1.7;
  }
  .audio-options {
    display: flex;
    gap: 24px;
    flex-wrap: wrap;
    margin-top: 14px;
  }
  .audio-options label {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
  }
  .message-status {
    margin-bottom: 12px;
  }
</style>
