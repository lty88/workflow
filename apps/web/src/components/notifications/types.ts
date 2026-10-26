import type { Ref } from 'vue'
export interface NotificationAudioOptions {
  actor: Ref<string>
}

export interface NotificationAudioPreferences {
  muted: boolean
  sound: boolean
  voice: boolean
}
export interface NotificationAudioLease {
  token: string
  expires: number
}
