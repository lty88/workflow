import { onBeforeUnmount, ref, watch } from 'vue';
import type { NotificationAudioOptions } from './types';

/**
 * 通过用户点击解锁本页提示音与中文语音，按批次播报数量；不上传文本或读取内部意见。
 * @param options 当前账号引用，用于切换账号时停止旧播报
 * @returns 声音开关、语音开关、开启状态、错误及试听和新消息提醒能力
 */
export function useNotificationAudio(options: NotificationAudioOptions) {
  const enabled = ref(false);
  const sound = ref(true);
  const voice = ref(true);
  const error = ref('');
  let context: AudioContext | null = null;
  let speaking: SpeechSynthesisUtterance | null = null;
  /** 停止本组件的语音和音频，退出登录或关闭提醒时释放资源。 */
  function stop(): void {
    if (speaking) window.speechSynthesis?.cancel();
    speaking = null;
    if (context) void context.close().catch(ignoreAudioFailure);
    context = null;
    enabled.value = false;
  }
  /** 关闭音频资源失败时保持静默，页面退出无需额外错误提示。 */
  function ignoreAudioFailure(): void {}
  /** 播放短双音提示，释放振荡器连接。 */
  function chime(): void {
    if (!context || context.state !== 'running') return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const start = context.currentTime;
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.frequency.setValueAtTime(660, start);
    oscillator.frequency.setValueAtTime(880, start + 0.12);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.12, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.35);
    oscillator.start(start);
    oscillator.stop(start + 0.36);
    /** 音调结束后移除音频节点连接。 */
    function disconnect(): void {
      oscillator.disconnect();
      gain.disconnect();
    }
    oscillator.onended = disconnect;
  }
  /**
   * 使用浏览器中文语音播报短提示，取消旧队列并显示不支持或播放失败的原因。
   * @param text 播报短文本
   */
  function speak(text: string): void {
    if (!('speechSynthesis' in window)) {
      error.value = '当前浏览器不支持语音播报，可使用提示音。';
      return;
    }
    if (speaking) window.speechSynthesis.cancel();
    speaking = new SpeechSynthesisUtterance(text);
    speaking.lang = 'zh-CN';
    speaking.rate = 1;
    /**
     * 语音被浏览器拒绝时提供重试提示，主动取消不显示失败。
     * @param event 浏览器语音错误
     */
    function speechFailed(event: SpeechSynthesisErrorEvent): void {
      if (event.error === 'canceled' || event.error === 'interrupted') return;
      error.value = '语音未能播放，请点击试听重新启用；提示音仍可单独使用。';
    }
    speaking.onerror = speechFailed;
    window.speechSynthesis.speak(speaking);
  }
  /**
   * 在同源标签页间登记通知标识，不保存消息正文，避免多个已开启声音的标签重复播报。
   * @param ids 本批通知标识
   * @returns 尚未由其他标签提醒的数量
   */
  function claim(ids: string[]): number {
    const key = 'workflow:notification-sound:' + options.actor.value;
    try {
      const raw: unknown = JSON.parse(localStorage.getItem(key) || '[]');
      const known = new Set<string>(
        Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : [],
      );
      const fresh = ids.filter((id) => !known.has(id));
      localStorage.setItem(key, JSON.stringify([...known, ...fresh].slice(-2000)));
      return fresh.length;
    } catch {
      return document.hasFocus() ? ids.length : 0;
    }
  }
  /**
   * 聚合播报本批新通知；支持时通过浏览器锁串行去重，未支持时仅前台焦点页提醒。
   * @param count 本批通知数
   * @param ids 本批通知标识
   */
  function announce(count: number, ids: string[]): void {
    if (!enabled.value || !count || (!sound.value && !voice.value)) return;
    const actor = options.actor.value;
    /** 在跨标签去重后播放，离开原账号或关闭声音时放弃旧请求。 */
    function play(): void {
      if (!enabled.value || actor !== options.actor.value) return;
      const fresh = claim(ids);
      if (!fresh) return;
      if (sound.value) chime();
      if (voice.value) speak(`您有${fresh}条新的站内消息，请查看消息中心。`);
    }
    if (navigator.locks)
      void navigator.locks.request('workflow-notification-sound', play).catch(ignoreAudioFailure);
    else if (document.hasFocus()) play();
  }
  /** 用户点击后解锁音频并试听，失败时保留明确的重试提示。 */
  async function enable(): Promise<void> {
    error.value = '';
    try {
      if (!context) context = new AudioContext();
      const ownContext = context;
      const actor = options.actor.value;
      await ownContext.resume();
      if (context !== ownContext || actor !== options.actor.value) return;
      if (context.state !== 'running') throw new Error('请再次点击开启声音，或检查浏览器站点声音设置。');
      enabled.value = true;
      if (sound.value) chime();
      if (voice.value) speak('站内消息声音提醒已开启。');
    } catch {
      error.value = '声音未能开启，请检查浏览器声音权限后重试。';
      enabled.value = false;
    }
  }
  /** 关闭语音开关时立即停止尚未结束的本页播报。 */
  function silenceVoice(): void {
    if (!voice.value && speaking) {
      window.speechSynthesis.cancel();
      speaking = null;
    }
  }
  watch(voice, silenceVoice);
  watch(options.actor, stop);
  onBeforeUnmount(stop);
  return { enabled, sound, voice, error, enable, stop, announce };
}
