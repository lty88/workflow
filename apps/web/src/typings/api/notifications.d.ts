import type { Notification } from './index';
export interface NotificationFeed {
  items: Notification[];
  cursor: string;
  hasMore: boolean;
}
