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
}

export const notificationsApi = {
  list: (params?: Record<string, string>) => api.get<PaginatedResponse<Notification>>("/notifications/", { params }),
  markRead: (id: string | number) => api.post<Notification>(`/notifications/${id}/mark_read/`),
  markAllRead: () => api.post<{ marked_read: number }>("/notifications/mark_all_read/"),
};
