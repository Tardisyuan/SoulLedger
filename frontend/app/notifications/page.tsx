"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Bell, FileText, Scale, AlertCircle, RefreshCw, TrendingUp, User,
  type LucideIcon
} from "lucide-react";
import { notificationsApi, type Notification } from "@/lib/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { PageSection } from "@/components/ui/page-section";
import { Skeleton } from "@/components/ui/skeleton";

type FilterType = "all" | "unread";

export default function NotificationsPage() {
  const { t } = useI18n();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<FilterType>("all");

  const { data: notifications = [], isLoading, error } = useQuery({
    queryKey: ["notifications", filter],
    queryFn: async () => {
      const params: Record<string, string> | undefined = filter === "unread" ? { is_read: "false" } : undefined;
      const res = await notificationsApi.list(params);
      return res.data as import("@/lib/api").Notification[];
    },
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const markReadMutation = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: () => showToast(t("notifications.mark_read_error") || "Failed to mark as read", "error"),
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: () => showToast(t("notifications.mark_all_error") || "Failed to mark all as read", "error"),
  });

  const handleMarkRead = (id: string | number) => {
    markReadMutation.mutate(String(id));
  };

  const handleMarkAllRead = () => {
    markAllReadMutation.mutate();
  };

  const getNotificationIcon = (type: string): LucideIcon => {
    switch (type) {
      case "WORKFLOW_ASSIGNED":
        return FileText;
      case "JUDGMENT_COMPLETED":
        return Scale;
      case "APPEAL_REQUIRED":
        return AlertCircle;
      case "REINCARNATION_COMPLETE":
        return RefreshCw;
      case "KARMIC_UPDATE":
        return TrendingUp;
      case "ROLE_ASSIGNED":
        return User;
      default:
        return Bell;
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
            <Bell className="w-6 h-6 text-[hsl(var(--color-accent))]" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 px-1.5 py-0.5 bg-[hsl(var(--color-accent))] text-black text-xs font-bold rounded-full min-w-[18px] text-center">
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
            className="px-4 py-2 bg-[hsl(var(--color-accent))] text-black rounded-lg text-sm font-medium hover:bg-[hsl(var(--color-accent))] transition-colors disabled:opacity-50"
          >
            {markAllReadMutation.isPending ? t("notifications.loading") : t("notifications.mark_all_read")}
          </button>
        )}
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2 mb-6 border-b border-[hsl(var(--color-hairline))]">
        <button
          onClick={() => setFilter("all")}
          className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
            filter === "all"
              ? "border-[hsl(var(--color-accent))] text-[hsl(var(--color-accent))]"
              : "border-transparent text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-ink))]"
          }`}
        >
          {t("notifications.all")}
        </button>
        <button
          onClick={() => setFilter("unread")}
          className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px flex items-center gap-2 ${
            filter === "unread"
              ? "border-[hsl(var(--color-accent))] text-[hsl(var(--color-accent))]"
              : "border-transparent text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-ink))]"
          }`}
        >
          {t("notifications.unread")}
          {unreadCount > 0 && (
            <span className="px-2 py-0.5 bg-[hsl(var(--color-accent))] text-black text-xs rounded-full">
              {unreadCount}
            </span>
          )}
        </button>
      </div>

      {/* Notification List Section */}
      <PageSection isLoading={isLoading}>
        {/* Skeleton items while loading */}
        {isLoading && (
          <>
            {[1, 2, 3].map((i) => (
              <div key={i} className="p-4 rounded-lg border border-[hsl(var(--color-hairline))] space-y-3">
                <div className="flex items-start gap-3">
                  <Skeleton className="h-8 w-8 rounded" />
                  <div className="flex-1 space-y-2">
                    <div className="flex justify-between">
                      <Skeleton className="h-4 w-1/3" />
                      <Skeleton className="h-4 w-20" />
                    </div>
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-2/3" />
                  </div>
                </div>
              </div>
            ))}
          </>
        )}

        {/* Empty State */}
        {!isLoading && notifications.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Bell className="w-12 h-12 text-[hsl(var(--color-ink-subtle))] mb-4" />
            <p className="text-[hsl(var(--color-ink-muted))]">{t("notifications.empty")}</p>
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
                  ? "bg-[hsl(var(--color-surface-1))] border-[hsl(var(--color-hairline))]"
                  : "bg-[hsl(var(--color-surface-1))] border-[hsl(var(--color-accent))]/30"
              }`}
            >
              <div className="flex items-start gap-3">
                {/* Icon */}
                {(() => {
                  const IconComponent = getNotificationIcon(notification.notification_type ?? "");
                  return (
                    <div className="w-10 h-10 rounded-lg bg-[hsl(var(--color-accent))]/10 flex items-center justify-center shrink-0">
                      <IconComponent className="w-5 h-5 text-[hsl(var(--color-accent))]" />
                    </div>
                  );
                })()}

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <h3
                      className={`font-medium ${
                        notification.is_read ? "text-[hsl(var(--color-ink-muted))]" : "text-[hsl(var(--color-ink))]"
                      }`}
                    >
                      {notification.title}
                    </h3>
                    <span className="text-xs text-[hsl(var(--color-ink-subtle))] shrink-0">
                      {formatDate(notification.created_at)}
                    </span>
                  </div>
                  <p
                    className={`mt-1 text-sm ${
                      notification.is_read ? "text-[hsl(var(--color-ink-subtle))]" : "text-[hsl(var(--color-ink-muted))]"
                    }`}
                  >
                    {notification.message}
                  </p>

                  {/* Actions */}
                  {!notification.is_read && (
                    <button
                      onClick={() => handleMarkRead(notification.id)}
                      disabled={markReadMutation.isPending}
                      className="mt-2 text-sm text-[hsl(var(--color-accent))] hover:text-[hsl(var(--color-accent))] transition-colors disabled:opacity-50"
                    >
                      {t("notifications.mark_read")}
                    </button>
                  )}
                </div>

                {/* Unread Indicator */}
                {!notification.is_read && (
                  <span className="w-2 h-2 bg-[hsl(var(--color-accent))] rounded-full shrink-0 mt-2" />
                )}
              </div>
            </div>
          ))}
        </div>
        )}
      </PageSection>
    </div>
  );
}
