import { createUuid } from '@workflow/domain'
import type { NotificationAudioLease, NotificationAudioPreferences } from './types'

/**
 * 读取当前账号的声音偏好，首次默认开启提示音和语音，存储受限时仍可在当前页面使用。
 * @param actor 当前账号标识
 * @returns 声音、语音及主动静音偏好
 */
export function readAudioPreferences(actor: string): NotificationAudioPreferences {
  try {
    const value = JSON.parse(localStorage.getItem('workflow:notification-audio:' + actor) || '{}')
    return { muted: value?.muted === true, sound: value?.sound !== false, voice: value?.voice !== false }
  } catch {
    return { muted: false, sound: true, voice: true }
  }
}

/**
 * 按账号保存声音偏好，不保存通知正文，存储失败不影响当前页面设置。
 * @param actor 当前账号标识
 * @param preferences 三项声音偏好
 */
export function saveAudioPreferences(actor: string, preferences: NotificationAudioPreferences): void {
  if (!actor) return
  try {
    localStorage.setItem('workflow:notification-audio:' + actor, JSON.stringify(preferences))
  } catch {
    /* 当前会话继续使用内存偏好。 */
  }
}

/**
 * 读取已实际提醒的通知标识，失败播放不会被登记，供多个页面去重。
 * @param actor 当前账号标识
 * @returns 已完成提醒的标识集合
 */
export function deliveredNotifications(actor: string): Set<string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem('workflow:notification-delivered:' + actor) || '[]')
    const result = new Set<string>()
    if (Array.isArray(value)) for (const id of value) if (typeof id === 'string') result.add(id)
    return result
  } catch {
    return new Set()
  }
}

/**
 * 仅在声音或语音实际播放成功后登记通知，最多保留两千条且不保存正文。
 * @param actor 当前账号标识
 * @param ids 已播放成功的通知标识
 */
export function markNotificationsDelivered(actor: string, ids: string[]): void {
  const known = deliveredNotifications(actor)
  for (const id of ids) known.add(id)
  try {
    localStorage.setItem('workflow:notification-delivered:' + actor, JSON.stringify([...known].slice(-2000)))
  } catch {
    /* 无持久存储时当前页面仍由待播集合去重。 */
  }
}

/**
 * 串行执行跨页播报；不支持浏览器锁的局域网HTTP页面使用短租约，后台页也可参与提醒。
 * @param actor 当前账号标识
 * @param play 在互斥区内执行的实际播报
 * @returns 本页面是否取得执行机会
 */
export async function withNotificationAudioLock(actor: string, play: () => Promise<void>): Promise<boolean> {
  if (navigator.locks) {
    await navigator.locks.request('workflow-notification-sound:' + actor, play)
    return true
  }
  const key = 'workflow:notification-audio-lease:' + actor
  const token = createUuid()
  /**
   * 读取当前跨页面租约，损坏记录视为未占用。
   * @returns 有效租约或空值
   */
  function lease(): NotificationAudioLease | null {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null')
      return value && typeof value.token === 'string' && typeof value.expires === 'number' ? value : null
    } catch {
      return null
    }
  }
  try {
    const previous = lease()
    if (previous && previous.expires > Date.now()) return false
    localStorage.setItem(key, JSON.stringify({ token, expires: Date.now() + 15000 }))
    await new Promise<void>(
      /**
       * 短暂让出执行权后确认租约归属，减少不同标签同时提醒。
       * @param resolve 延时完成回调
       */
      (resolve) => {
        setTimeout(resolve, 40)
      }
    )
    if (lease()?.token !== token) return false
  } catch {
    // 禁用存储时只允许焦点页播放，其余页面保留待播，回到页面后继续。
    if (!document.hasFocus()) return false
  }
  try {
    await play()
    return true
  } finally {
    try {
      if (lease()?.token === token) localStorage.removeItem(key)
    } catch {
      /* 租约到期自动释放。 */
    }
  }
}
