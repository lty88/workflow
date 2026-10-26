import { afterEach, expect, test, vi } from 'vitest'
import { effectScope, nextTick, onScopeDispose, ref } from 'vue'
import type { EffectScope } from 'vue'
import { useNotificationAudio } from '../src/components/notifications/use-notification-audio'
import { deliveredNotifications, readAudioPreferences } from '../src/components/notifications/notification-audio-storage'

const harness = vi.hoisted(
  /**
   * 记录真实声音钩子注册的事件，避免创建浏览器或渲染页面。
   * @returns 按事件名分组的监听器集合
   */
  () => ({ listeners: new Map<string, Array<(event: Event) => void>>() })
)
vi.mock(
  '@vueuse/core',
  /**
   * 将DOM事件监听替换为可触发的记录，其余业务与Vue响应式仍真实执行。
   * @returns 事件监听替身
   */
  () => ({
    /**
     * 登记页面交互和前后台事件。
     * @param _target 事件目标
     * @param name 事件名
     * @param callback 事件回调
     */
    useEventListener(_target: unknown, name: string, callback: (event: Event) => void): void {
      harness.listeners.set(name, [...(harness.listeners.get(name) || []), callback])
      onScopeDispose(
        /** 移除已卸载会话的监听器，保持真实页面事件清理行为。 */
        () => {
          const listeners = harness.listeners.get(name) || []
          const index = listeners.indexOf(callback)
          if (index >= 0) listeners.splice(index, 1)
        }
      )
    },
  })
)
const scopes: EffectScope[] = []

/** 清理响应式作用域、声音等待及全部浏览器替身，不留下重试定时器。 */
function cleanup(): void {
  for (const scope of scopes.splice(0)) scope.stop()
  harness.listeners.clear()
  vi.unstubAllGlobals()
}
afterEach(cleanup)

/**
 * 构造浏览器音频与语音接口替身，实际运行声音钩子而不访问浏览器或播放扬声器。
 * @param settings 是否缺少音频接口、浏览器锁或当前页面焦点
 * @returns 声音故障开关、播报记录、点击触发和音频实例
 */
function browser(settings: { noAudio?: boolean; noLocks?: boolean; focused?: boolean } = {}) {
  harness.listeners.clear()
  const stored = new Map<string, string>()
  const texts: string[] = []
  const state = { failVoice: false, blockAudio: false, holdVoice: false, cancelled: 0 }
  const contexts: FakeContext[] = []
  class FakeUtterance {
    lang = ''
    rate = 1
    onend: (() => void) | null = null
    onerror: ((event: { error: string }) => void) | null = null
    /**
     * 保存待播报的短文本。
     * @param text 开启提示或新消息数量
     */
    constructor(public text: string) {}
  }
  class FakeContext {
    state = 'suspended'
    currentTime = 0
    destination = {}
    /** 将音频实例加入检查列表。 */
    constructor() {
      contexts.push(this)
    }
    /**
     * 根据测试开关模拟浏览器是否允许恢复声音。
     * @returns 恢复完成信号
     */
    async resume(): Promise<void> {
      if (!state.blockAudio) this.state = 'running'
    }
    /**
     * 关闭当前账号使用的音频资源。
     * @returns 关闭完成信号
     */
    async close(): Promise<void> {
      this.state = 'closed'
    }
    /**
     * 提供提示音振荡器替身。
     * @returns 可启动、停止及断开连接的音频节点
     */
    createOscillator() {
      return { connect: vi.fn(), disconnect: vi.fn(), frequency: { setValueAtTime: vi.fn() }, start: vi.fn(), stop: vi.fn(), onended: null }
    }
    /**
     * 提供音量曲线节点替身。
     * @returns 可连接的音量节点
     */
    createGain() {
      return {
        connect: vi.fn(),
        disconnect: vi.fn(),
        gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      }
    }
  }
  const speech = {
    paused: false,
    resume: vi.fn(),
    /**
     * 记录播报并模拟语音完成、拒播或尚未完成。
     * @param utterance 当前语音对象
     */
    speak(utterance: FakeUtterance): void {
      texts.push(utterance.text)
      if (state.holdVoice) return
      queueMicrotask(
        /** 执行浏览器异步语音完成或错误回调。 */
        () => (state.failVoice ? utterance.onerror?.({ error: 'not-allowed' }) : utterance.onend?.())
      )
    },
    /** 标记当前语音已被账号切换或静音取消。 */
    cancel(): void {
      state.cancelled++
    },
  }
  const store = {
    /**
     * 读取当前源的测试存储。
     * @param key 存储键
     * @returns 已保存文本或空值
     */
    getItem(key: string): string | null {
      return stored.get(key) ?? null
    },
    /**
     * 写入当前源的测试存储。
     * @param key 存储键
     * @param value JSON文本
     */
    setItem(key: string, value: string): void {
      stored.set(key, value)
    },
    /**
     * 删除释放的跨页面租约。
     * @param key 租约存储键
     */
    removeItem(key: string): void {
      stored.delete(key)
    },
  }
  let tail = Promise.resolve()
  const locks = {
    /**
     * 串行模拟浏览器跨页面锁，确保同一通知只由一个页面实际播放。
     * @param _name 锁名称
     * @param play 互斥区业务
     * @returns 本次互斥区完成信号
     */
    request(_name: string, play: () => Promise<void>): Promise<void> {
      const current = tail.then(play)
      tail = current
      return current
    },
  }
  vi.stubGlobal('localStorage', store)
  vi.stubGlobal('Element', class {})
  vi.stubGlobal('window', { speechSynthesis: speech, SpeechSynthesisUtterance: FakeUtterance, ...(settings.noAudio ? {} : { AudioContext: FakeContext }) })
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)
  if (!settings.noAudio) vi.stubGlobal('AudioContext', FakeContext)
  vi.stubGlobal('navigator', { userActivation: { hasBeenActive: false }, ...(settings.noLocks ? {} : { locks }) })
  vi.stubGlobal('document', {
    hidden: settings.focused === false,
    /**
     * 返回当前测试页的焦点状态。
     * @returns 是否拥有焦点
     */
    hasFocus(): boolean {
      return settings.focused !== false
    },
  })
  /**
   * 触发钩子实际注册的可信或合成交互。
   * @param trusted 是否模拟用户的真实点击
   */
  function click(trusted = true): void {
    for (const callback of harness.listeners.get('click') || []) callback({ isTrusted: trusted, target: null } as Event)
  }
  return { texts, state, contexts, click }
}

/**
 * 在独立响应式作用域建立账号声音钩子，便于精确模拟刷新和退出。
 * @param user 当前账号标识
 * @returns 账号引用、声音能力和释放作用域
 */
function audioSession(user = 'actor-a') {
  const actor = ref(user)
  const scope = effectScope()
  scopes.push(scope)
  const audio = scope.run(
    /**
     * 初始化真实声音钩子。
     * @returns 声音与待播控制能力
     */
    () => useNotificationAudio({ actor })
  )!
  return { actor, audio, scope }
}

/**
 * 等待声音队列及响应式偏好保存完成，不启动服务器或浏览器。
 * @returns 当前微任务链完成信号
 */
async function drain(): Promise<void> {
  for (let index = 0; index < 30; index++) await Promise.resolve()
  await nextTick()
}

/** 核对默认无需进入抽屉手动启用，首次可信点击后会补播未激活期间的新消息。 */
async function autoActivationCase(): Promise<void> {
  const page = browser()
  const { audio } = audioSession()
  audio.announce(2, ['n1', 'n2'])
  expect(audio.pendingCount.value).toBe(2)
  expect(page.texts).toEqual([])
  page.click(false)
  await drain()
  expect(page.texts).toEqual([])
  page.click()
  await drain()
  expect(page.texts).toContain('您有2条新的站内消息，请查看消息中心。')
  expect(audio.pendingCount.value).toBe(0)
  expect(deliveredNotifications('actor-a')).toEqual(new Set(['n1', 'n2']))
}
test('首次可信交互自动开启声音，待激活期间新消息合并补播', autoActivationCase)

/** 核对语音播放失败不会预先去重，重试启用后仍能播报同一条新消息。 */
async function failedSpeechCase(): Promise<void> {
  const page = browser()
  const { audio } = audioSession()
  await audio.enable(false)
  page.state.failVoice = true
  audio.announce(1, ['retry-message'])
  await drain()
  expect(audio.pendingCount.value).toBe(1)
  expect(deliveredNotifications('actor-a').size).toBe(0)
  expect(audio.needsActivation.value).toBe(true)
  page.state.failVoice = false
  page.click()
  await drain()
  expect(audio.pendingCount.value).toBe(0)
  expect(deliveredNotifications('actor-a').has('retry-message')).toBe(true)
}
test('语音失败保留待播，重新启用后成功提醒而非被去重吞掉', failedSpeechCase)

/** 核对刷新保留关闭语音及主动静音偏好，静音账号的普通点击不会重新发声。 */
async function persistedPreferencesCase(): Promise<void> {
  const page = browser()
  const first = audioSession()
  first.audio.voice.value = false
  await nextTick()
  first.audio.stop()
  first.scope.stop()
  const second = audioSession()
  expect(second.audio.muted.value).toBe(true)
  expect(second.audio.voice.value).toBe(false)
  page.click()
  second.audio.announce(1, ['muted-message'])
  await drain()
  expect(page.texts).toEqual([])
  expect(readAudioPreferences('actor-a')).toEqual({ muted: true, sound: true, voice: false })
}
test('刷新保留声音偏好并尊重主动静音，不因页面点击强制打开', persistedPreferencesCase)

/** 核对刷新保留开启意愿，重新点击后自动恢复新消息播报。 */
async function refreshEnabledCase(): Promise<void> {
  const page = browser()
  const first = audioSession()
  await first.audio.enable(false)
  first.scope.stop()
  const second = audioSession()
  expect(second.audio.muted.value).toBe(false)
  second.audio.announce(1, ['after-refresh'])
  page.click()
  await drain()
  expect(deliveredNotifications('actor-a').has('after-refresh')).toBe(true)
}
test('刷新保留开启意愿，首次点击后自动恢复而非要求到消息抽屉设置', refreshEnabledCase)

/** 核对缺少音频上下文时语音仍独立工作，不被提示音接口缺失阻断。 */
async function voiceOnlyCase(): Promise<void> {
  const page = browser({ noAudio: true })
  const { audio } = audioSession()
  await audio.enable(false)
  audio.announce(1, ['voice-only'])
  await drain()
  expect(page.texts).toContain('您有1条新的站内消息，请查看消息中心。')
  expect(audio.pendingCount.value).toBe(0)
}
test('提示音API不可用时语音仍可自动播报', voiceOnlyCase)

/** 核对HTTP环境缺少浏览器锁且页面没有焦点时，短租约仍允许后台页面提醒。 */
async function httpBackgroundCase(): Promise<void> {
  const page = browser({ noLocks: true, focused: false })
  const { audio } = audioSession()
  await audio.enable(false)
  audio.announce(1, ['http-background'])
  await new Promise<void>(
    /**
     * 等待跨页面短租约确认窗口。
     * @param resolve 完成回调
     */
    (resolve) => {
      setTimeout(resolve, 80)
    }
  )
  await drain()
  expect(page.texts).toContain('您有1条新的站内消息，请查看消息中心。')
  expect(audio.pendingCount.value).toBe(0)
}
test('局域网HTTP和后台页不再因无焦点直接丢弃声音提醒', httpBackgroundCase)

/** 核对同账号多标签同时收到同一通知时，只登记和播报一次。 */
async function crossTabCase(): Promise<void> {
  const page = browser()
  const first = audioSession()
  const second = audioSession()
  await first.audio.enable(false)
  await second.audio.enable(false)
  first.audio.announce(1, ['same-message'])
  second.audio.announce(1, ['same-message'])
  await drain()
  expect(page.texts).toEqual(['您有1条新的站内消息，请查看消息中心。'])
  expect(first.audio.pendingCount.value).toBe(0)
  expect(second.audio.pendingCount.value).toBe(0)
}
test('多标签页在成功播放后去重，不重复播报同一新通知', crossTabCase)

/** 核对切换账号会立即取消旧语音、清空旧待播并使用新账号独立设置。 */
async function accountIsolationCase(): Promise<void> {
  const page = browser()
  const { audio, actor } = audioSession()
  await audio.enable(false)
  page.state.holdVoice = true
  audio.announce(1, ['old-account-message'])
  await drain()
  expect(audio.pendingCount.value).toBe(1)
  actor.value = 'actor-b'
  await drain()
  expect(page.state.cancelled).toBeGreaterThan(0)
  expect(audio.pendingCount.value).toBe(0)
  expect(deliveredNotifications('actor-a').size).toBe(0)
  page.state.holdVoice = false
  audio.announce(1, ['new-account-message'])
  page.click()
  await drain()
  expect(deliveredNotifications('actor-b')).toEqual(new Set(['new-account-message']))
}
test('切换账号取消旧语音并隔离待播和送达记录', accountIsolationCase)

/** 核对已读通知在尚未激活声音时可以清除，稍后点击不会再播报该条。 */
async function dismissCase(): Promise<void> {
  const page = browser()
  const { audio } = audioSession()
  audio.announce(1, ['already-read'])
  audio.dismiss('already-read')
  page.click()
  await drain()
  expect(audio.pendingCount.value).toBe(0)
  expect(page.texts).not.toContain('您有1条新的站内消息，请查看消息中心。')
}
test('用户先阅读的待播通知不会在开启声音后再次提醒', dismissCase)

/** 核对试听期间退出或切换账号，旧试听结果不会把错误写入新账号。 */
async function previewAccountSwitchCase(): Promise<void> {
  const page = browser()
  const { audio, actor } = audioSession()
  page.state.holdVoice = true
  const enabling = audio.enable()
  await drain()
  actor.value = 'actor-b'
  await enabling
  await drain()
  expect(page.state.cancelled).toBeGreaterThan(0)
  expect(audio.error.value).toBe('')
  expect(audio.pendingCount.value).toBe(0)
  expect(audio.needsActivation.value).toBe(true)
}
test('试听期间切换账号立即取消，旧回调不污染新账号状态', previewAccountSwitchCase)
