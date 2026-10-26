import { computed, onScopeDispose, ref, watch } from 'vue'
import { useEventListener } from '@vueuse/core'
import type { NotificationAudioOptions } from './types'
import {
  deliveredNotifications,
  markNotificationsDelivered,
  readAudioPreferences,
  saveAudioPreferences,
  withNotificationAudioLock,
} from './notification-audio-storage'

/**
 * 记住账号声音偏好，在首次可信页面操作时自动解锁；新通知先入队，播放成功后才跨页面去重。
 * @param options 当前账号引用，切换时隔离声音、待播和设置
 * @returns 开启与静音状态、声音设置、错误、试听、待播提醒及已读清理能力
 */
export function useNotificationAudio(options: NotificationAudioOptions) {
  const enabled = ref(false)
  const muted = ref(false)
  const sound = ref(true)
  const voice = ref(true)
  const error = ref('')
  const pendingCount = ref(0)
  const needsActivation = computed(() => !!options.actor.value && !muted.value && !enabled.value && (sound.value || voice.value))
  let context: AudioContext | null = null
  let speaking: SpeechSynthesisUtterance | null = null
  let finishSpeech: ((success: boolean) => void) | null = null
  let generation = 0
  let playing = false
  let activating = false
  let voiceBlocked = false
  let retry: ReturnType<typeof setTimeout> | undefined
  const pending = new Set<string>()

  /** 停止本页播报并释放资源，不改写用户保存的声音偏好。 */
  function dispose(): void {
    generation++
    clearTimeout(retry)
    const hadSpeech = !!speaking
    finishSpeech?.(false)
    if (hadSpeech) window.speechSynthesis?.cancel()
    speaking = null
    if (context) void context.close().catch(ignoreAudioFailure)
    context = null
    enabled.value = false
    activating = false
    playing = false
    pending.clear()
    pendingCount.value = 0
  }
  /** 页面退出时音频资源关闭失败不显示业务错误。 */
  function ignoreAudioFailure(): void {}
  /** 保存当前账号的开关偏好，刷新页面不会恢复为关闭。 */
  function savePreferences(): void {
    saveAudioPreferences(options.actor.value, { muted: muted.value, sound: sound.value, voice: voice.value })
  }
  /**
   * 播放短双音提示，只有音频处于运行态且成功启动时才视为已提醒。
   * @returns 提示音是否实际启动
   */
  function chime(): boolean {
    if (!context || context.state !== 'running') return false
    try {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      const start = context.currentTime
      oscillator.connect(gain)
      gain.connect(context.destination)
      oscillator.frequency.setValueAtTime(660, start)
      oscillator.frequency.setValueAtTime(880, start + 0.12)
      gain.gain.setValueAtTime(0, start)
      gain.gain.linearRampToValueAtTime(0.12, start + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.35)
      oscillator.start(start)
      oscillator.stop(start + 0.36)
      /** 提示音结束后释放节点连接。 */
      function disconnect(): void {
        oscillator.disconnect()
        gain.disconnect()
      }
      oscillator.onended = disconnect
      return true
    } catch {
      return false
    }
  }
  /**
   * 播放中文短提示并等待结果；浏览器拒播时保留待播消息并提示重新激活。
   * @param text 不包含通知正文的播报文本
   * @returns 本次语音是否成功播放完毕
   */
  function speak(text: string): Promise<boolean> {
    if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) {
      error.value = '当前浏览器不支持语音播报，请使用提示音。'
      return Promise.resolve(false)
    }
    const ownGeneration = generation
    return new Promise<boolean>(
      /**
       * 绑定语音完成、错误和超时回调，保证取消或浏览器静默拒播时可释放队列。
       * @param resolve 播放结果回调
       */
      (resolve) => {
        const utterance = new SpeechSynthesisUtterance(text)
        speaking = utterance
        utterance.lang = 'zh-CN'
        utterance.rate = 1
        let settled = false
        const timeout = setTimeout(failed, 12000)
        /**
         * 结束当前语音等待，避免同一回调重复登记或影响其他账号。
         * @param success 是否完整播放
         */
        function finish(success: boolean): void {
          if (settled) return
          settled = true
          clearTimeout(timeout)
          if (speaking === utterance) {
            speaking = null
            finishSpeech = null
          }
          resolve(success && generation === ownGeneration)
        }
        /**
         * 浏览器拒播或超时时标记待激活状态，主动取消则静默释放等待。
         * @param event 浏览器语音错误，超时调用时为空
         */
        function failed(event?: SpeechSynthesisErrorEvent): void {
          if (event?.error === 'canceled' || event?.error === 'interrupted') {
            finish(false)
            return
          }
          if (generation === ownGeneration && !muted.value) {
            voiceBlocked = true
            error.value = '语音暂未播放，请点击顶部“启用声音”重试，并检查浏览器站点声音设置。'
            enabled.value = false
          }
          const wasSpeaking = speaking === utterance
          finish(false)
          if (wasSpeaking) window.speechSynthesis.cancel()
        }
        /** 语音完整播放后确认送达。 */
        function ended(): void {
          finish(true)
        }
        finishSpeech = finish
        utterance.onend = ended
        utterance.onerror = failed
        try {
          if (window.speechSynthesis.paused) window.speechSynthesis.resume()
          window.speechSynthesis.speak(utterance)
        } catch {
          failed()
        }
      }
    )
  }
  /**
   * 在声音准备好后串行播报待提醒通知，拿到跨页锁后再核对送达标识，成功才移出队列。
   * @returns 本次待播处理完成信号
   */
  async function flush(): Promise<void> {
    if (!enabled.value || muted.value || playing || activating || !pending.size || (!sound.value && !voice.value)) return
    playing = true
    const actor = options.actor.value
    const ownGeneration = generation
    try {
      await withNotificationAudioLock(
        actor,
        /** 互斥锁内再检查账号与开关，防止旧账号的排队请求发出声音。 */
        async function play(): Promise<void> {
          if (generation !== ownGeneration || !enabled.value || muted.value) return
          const known = deliveredNotifications(actor)
          for (const id of known) pending.delete(id)
          const ids = [...pending]
          pendingCount.value = pending.size
          if (!ids.length) return
          const sounded = sound.value && chime()
          const supported = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window
          const spoken = voice.value && (await speak(`您有${ids.length}条新的站内消息，请查看消息中心。`))
          if (generation !== ownGeneration || muted.value) return
          const delivered = voice.value && supported ? spoken : sounded
          if (delivered) {
            markNotificationsDelivered(actor, ids)
            for (const id of ids) pending.delete(id)
          } else if (!voice.value || !supported) {
            enabled.value = false
            error.value = '提示音尚未启用，请点击顶部“启用声音”后自动补播。'
          }
          pendingCount.value = pending.size
        }
      )
    } catch {
      if (generation === ownGeneration) error.value = '声音提醒暂时失败，消息已保留待播。'
    } finally {
      if (generation === ownGeneration) {
        playing = false
        if (pending.size && enabled.value && !muted.value) retry = setTimeout(flush, 2000)
      }
    }
  }
  /**
   * 接收本批新增未读通知，未激活时保留，主动静音时跳过声音提醒。
   * @param count 本批新消息数量
   * @param ids 本批新消息标识
   */
  function announce(count: number, ids: string[]): void {
    if (!options.actor.value || muted.value || !count || (!sound.value && !voice.value)) return
    const known = deliveredNotifications(options.actor.value)
    for (const id of ids) if (!known.has(id)) pending.add(id)
    pendingCount.value = pending.size
    void flush()
  }
  /**
   * 在可信操作中立即恢复音频，手动开启时同步发起试听，允许语音与提示音独立使用。
   * @param preview 是否播放开启提示，自动激活仅补播新消息
   * @returns 本次激活和可选试听完成信号
   */
  async function enable(preview = true): Promise<void> {
    if (!options.actor.value) return
    muted.value = false
    savePreferences()
    error.value = ''
    if (!sound.value && !voice.value) {
      error.value = '请先开启提示音或语音播报。'
      return
    }
    if (activating) {
      if (context?.state === 'suspended') void context.resume().catch(ignoreAudioFailure)
      return
    }
    activating = true
    voiceBlocked = false
    if (speaking) {
      finishSpeech?.(false)
      window.speechSynthesis.cancel()
    }
    const ownGeneration = generation
    const supported = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window
    try {
      if (sound.value && 'AudioContext' in window) {
        if (!context || context.state === 'closed') context = new AudioContext()
        const ownContext = context
        void ownContext.resume().then(
          /** 音频恢复成功后启用提示音并补播，旧账号或主动静音时忽略。 */
          function resumed(): void {
            if (generation !== ownGeneration || muted.value || context !== ownContext) return
            if (ownContext.state === 'running' && (!voice.value || !voiceBlocked)) {
              enabled.value = true
              if (error.value.startsWith('点击页面')) error.value = ''
              void flush()
            }
          },
          /** 音频恢复失败时语音仍可单独使用，纯提示音模式展示明确提示。 */
          function resumeFailed(): void {
            if (generation === ownGeneration && !voice.value) error.value = '声音被浏览器暂停，请再次点击“启用声音”。'
          }
        )
      }
      enabled.value = !!(voice.value && supported) || context?.state === 'running'
      if (preview) {
        if (sound.value) chime()
        if (voice.value) await speak('站内消息声音提醒已开启。')
      }
      if (generation !== ownGeneration) return
      if (!supported && voice.value) error.value = '当前浏览器不支持语音播报，可继续使用提示音。'
      if (!enabled.value && !error.value) error.value = '点击页面或“启用声音”后自动开启新消息提醒。'
    } catch {
      if (generation === ownGeneration) {
        enabled.value = false
        error.value = '声音未能开启，请检查浏览器站点声音设置后重试。'
      }
    } finally {
      if (generation === ownGeneration) {
        activating = false
        void flush()
      }
    }
  }
  /** 主动关闭声音并记住静音选择，清理当前待播但继续接收文字通知。 */
  function stop(): void {
    muted.value = true
    savePreferences()
    dispose()
    error.value = ''
  }
  /**
   * 已读消息从待播中移除，避免用户处理完成后再次听到提醒。
   * @param id 已读通知标识
   */
  function dismiss(id: string): void {
    pending.delete(id)
    pendingCount.value = pending.size
  }
  /** 账号切换后读取独立偏好，已交互的页面尝试恢复声音，冷启动等待首次可信操作。 */
  function initialize(): void {
    dispose()
    error.value = ''
    const preferences = readAudioPreferences(options.actor.value)
    muted.value = preferences.muted
    sound.value = preferences.sound
    voice.value = preferences.voice
    if (options.actor.value && !muted.value && navigator.userActivation?.hasBeenActive) void enable(false)
  }
  /**
   * 点击或键盘操作中恢复声音，主动静音时不自动打开，忽略脚本合成事件。
   * @param event 用户交互事件
   */
  function activate(event: Event): void {
    if (event.target instanceof Element && event.target.closest('[data-notification-audio-control]')) return
    if (event.isTrusted && !muted.value && (!enabled.value || context?.state === 'suspended')) void enable(true)
  }
  /** 设置修改后持久化并补播；关闭语音时取消当前语音，后续提醒按剩余通道播放。 */
  function updatePreferences(): void {
    savePreferences()
    if (!voice.value && speaking) {
      finishSpeech?.(false)
      window.speechSynthesis.cancel()
    }
    if (!muted.value && enabled.value) void flush()
  }
  /** 重新聚焦或前台恢复后处理未播放消息，保持轮询与声音队列相互独立。 */
  function resume(): void {
    if (!document.hidden) void flush()
  }
  watch(options.actor, initialize, { immediate: true, flush: 'sync' })
  watch([sound, voice], updatePreferences)
  useEventListener(window, 'click', activate, { capture: true })
  useEventListener(window, 'keydown', activate, { capture: true })
  useEventListener(window, 'focus', resume)
  useEventListener(document, 'visibilitychange', resume)
  onScopeDispose(dispose)
  return { enabled, muted, sound, voice, error, pendingCount, needsActivation, enable, stop, announce, dismiss }
}
