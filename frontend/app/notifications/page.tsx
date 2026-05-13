"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { notificationsApi, type Notification } from "@/lib/api";
import { useI18n } from "@/src/contexts/I18nContext";

type FilterType = "all" | "unread";

export default function NotificationsPage() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<FilterType>("all");

  const { data: notifications = [], isLoading } = useQuery({
    queryKey: ["notifications", filter],
    queryFn: async () => {
      const params: Record<string, string> | undefined = filter === "unread" ? { is_read: "false" } : undefined;
      const res = await notificationsApi.list(params);
      return res.data;
    },
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const markReadMutation = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  const handleMarkRead = (id: string) => {
    markReadMutation.mutate(id);
  };

  const handleMarkAllRead = () => {
    markAllReadMutation.mutate();
  };

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case "WORKFLOW_ASSIGNED":
        return "📋";
      case "JUDGMENT_COMPLETED":
        return "⚖️";
      case "APPEAL_REQUIRED":
        return "🆘";
      case "REINCARNATION_COMPLETE":
        return "🔄";
      case "KARMIC_UPDATE":
        return "📊";
      case "ROLE_ASSIGNED":
        return "👤";
      default:
        return "🔔";
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return (
    <div className="max-w-3xl mx-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="relative">
            <span className="text-2xl">🔔</span>
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 px-1.5 py-0.5 bg-amber-500 text-black text-xs font-bold rounded-full min-w-[18px] text-center">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </div>
          <h1 className="text-2xl font-bold">{t("notifications.title")}</h1>
        </div>
        {unreadCount > 0 && (
          <button
            onClick={handleMarkAllRead}
            disabled={markAllReadMutation.isPending}
            className="px-4 py-2 bg-amber-500 text-black rounded-lg text-sm font-medium hover:bg-amber-400 transition-colors disabled:opacity-50"
          >
            {markAllReadMutation.isPending ? t("notifications.loading") : t("notifications.mark_all_read")}
          </button>
        )}
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2 mb-6 border-b border-hairline">
        <button
          onClick={() => setFilter("all")}
          className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
            filter === "all"
              ? "border-amber-500 text-amber-500"
              : "border-transparent text-ink-muted hover:text-ink"
          }`}
        >
          {t("notifications.all")}
        </button>
        <button
          onClick={() => setFilter("unread")}
          className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px flex items-center gap-2 ${
            filter === "unread"
              ? "border-amber-500 text-amber-500"
              : "border-transparent text-ink-muted hover:text-ink"
          }`}
        >
          {t("notifications.unread")}
          {unreadCount > 0 && (
            <span className="px-2 py-0.5 bg-amber-500 text-black text-xs rounded-full">
              {unreadCount}
            </span>
          )}
        </button>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <span className="text-ink-muted">{t("notifications.loading")}</span>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && notifications.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <span className="text-4xl mb-4">🔔</span>
          <p className="text-ink-muted">{t("notifications.empty")}</p>
        </div>
      )}

      {/* Notification List */}
      {!isLoading && notifications.length > 0 && (
        <div className="space-y-3">
          {notifications.map((notification) => (
            <div
              key={notification.id}
              className={`p-4 rounded-lg border transition-colors ${
                notification.is_read
                  ? "bg-surface-1 border-hairline"
                  : "bg-surface-1 border-amber-500/30"
              }`}
            >
              <div className="flex items-start gap-3">
                {/* Icon */}
                <span className="text-2xl shrink-0">
                  {getNotificationIcon(notification.notification_type)}
                </span>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <h3
                      className={`font-medium ${
                        notification.is_read ? "text-ink-muted" : "text-ink"
                      }`}
                    >
                      {notification.title}
                    </h3>
                    <span className="text-xs text-ink-subtle shrink-0">
                      {formatDate(notification.created_at)}
                    </span>
                  </div>
                  <p
                    className={`mt-1 text-sm ${
                      notification.is_read ? "text-ink-subtle" : "text-ink-muted"
                    }`}
                  >
                    {notification.message}
                  </p>

                  {/* Actions */}
                  {!notification.is_read && (
                    <button
                      onClick={() => handleMarkRead(notification.id)}
                      disabled={markReadMutation.isPending}
                      className="mt-2 text-sm text-amber-500 hover:text-amber-400 transition-colors disabled:opacity-50"
                    >
                      {t("notifications.mark_read")}
                    </button>
                  )}
                </div>

                {/* Unread Indicator */}
                {!notification.is_read && (
                  <span className="w-2 h-2 bg-amber-500 rounded-full shrink-0 mt-2" />
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
