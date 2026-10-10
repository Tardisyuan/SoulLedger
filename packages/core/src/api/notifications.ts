import { api } from "./client";
import type { PaginatedResponse } from "./users";

/** UserNotificationListSerializer (backend/apps/notifications/serializers.py:26). */
export interface Notification {
  id: number;
  title: string;
  message: string;
  notification_type?: string;
  is_read: boolean;
  related_resource?: string | null;
  related_id?: string | null;
  created_at: string;
  /** Only the detail/mark_read serializer carries this. */
  user?: number;
  /**
   * A password-help request (`PASSWORD_HELP_REQUESTED`): the requesting account's
   * hall (in the reader's language), role code, and this request's place among
   * that account's requests in the last 24 hours, and its username (「去用户页」 opens
   * `/users?username=…`). Null on every other notification.
   */
  request_context?: { hall: string | null; role: string; count_24h: number; username: string } | null;
}

/** `GET /notifications/email-status/`: the caller's last failed email, or null. */
export interface NotificationEmailStatus {
  last_failure: { error: string; at: string } | null;
}

export const notificationsApi = {
  emailStatus: () => api.get<NotificationEmailStatus>("/notifications/email-status/"),
  list: (params?: Record<string, string>) => api.get<PaginatedResponse<Notification>>("/notifications/", { params }),
  markRead: (id: string | number) => api.post<Notification>(`/notifications/${id}/mark_read/`),
  markAllRead: () => api.post<{ marked_read: number }>("/notifications/mark_all_read/"),
  /** 批量条:至多 100 个;别人的 / 不存在的 id 不报错也不被动到,`marked_read` 只数真正由未读变已读的。 */
  batchRead: (ids: Array<string | number>) =>
    api.post<{ marked_read: number }>("/notifications/batch-read/", { ids: ids.map(Number) }),
  /** 同上的范围;软删,与单条 DELETE 一致。`deleted` 是真正删掉的条数。 */
  batchDelete: (ids: Array<string | number>) =>
    api.post<{ deleted: number }>("/notifications/batch-delete/", { ids: ids.map(Number) }),
};
