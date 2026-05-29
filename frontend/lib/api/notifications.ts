import { api } from "./client";

export interface Notification {
  id: number;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
  tenant?: number;
}

export const notificationsApi = {
  list: (params?: Record<string, string>) => api.get("/notifications/", { params }),
  markRead: (id: string | number) => api.post(`/notifications/${id}/mark_read/`),
  markAllRead: () => api.post("/notifications/mark_all_read/"),
};
