"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Bell, FileText, Scale, AlertCircle, RefreshCw, TrendingUp, User,
  type LucideIcon
} from "lucide-react";
import { notificationsApi, type Notification, type PaginatedResponse } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { Skeleton } from "@/components/ui/skeleton";
import { PageShell } from "@/src/components/ui/PageShell";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { QueryError } from "@/src/components/ui/PageError";
import { TAB_BASE, TAB_ON, TAB_OFF } from "@/src/lib/tabClasses";

type FilterType = "all" | "unread";

/*
 * The three tab constants used to be declared here, and this page was the only
 * one of six strips that had named them at all — which is how the drift was
 * found: it also reordered the active/inactive strings while naming them
 * (`border-… text-…` against the five inline copies' `text-… border-…`). They
 * now live in `src/lib/tabClasses.ts`, together with the reading of `Button`
 * that kept these hand-rolled `<button>`s hand-rolled.
 *
 * What stays a fact about THIS page: PageShell owns where the strip sits
 * (`tabs` slot: below the header, above the filters, deliberately not sticky);
 * the page owns only which of the two states each button is in.
 */

export default function NotificationsPage() {
  const { t, formatDateTime } = useI18n();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<FilterType>("all");

  const { data: notifications = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["notifications", filter],
    queryFn: async () => {
      const params: Record<string, string> | undefined = filter === "unread" ? { is_read: "false" } : undefined;
      const res = await notificationsApi.list(params);
      return res.data.results;
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

  const formatDate = (dateString: string) => formatDateTime(dateString);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return (
    <PageShell
      variant="prose"
      title={
        <span className="inline-flex items-center gap-3">
          <span className="relative inline-flex shrink-0">
            <Bell aria-hidden="true" className="w-6 h-6 text-[hsl(var(--color-accent-ink))]" />
            {unreadCount > 0 && (
              <Badge
                tone="accent"
                shape="pill"
                className="absolute -top-1 -right-1 justify-center min-w-[18px]"
              >
                {unreadCount > 99 ? "99+" : unreadCount}
              </Badge>
            )}
          </span>
          {t("notifications.title")}
        </span>
      }
      actions={
        unreadCount > 0 ? (
          <Button
            type="button"
            variant="primary"
            loading={markAllReadMutation.isPending}
            onClick={handleMarkAllRead}
          >
            {markAllReadMutation.isPending ? t("notifications.loading") : t("notifications.mark_all_read")}
          </Button>
        ) : undefined
      }
      tabs={
        <>
          <button
            type="button"
            onClick={() => setFilter("all")}
            className={`${TAB_BASE} ${filter === "all" ? TAB_ON : TAB_OFF}`}
          >
            {t("notifications.all")}
          </button>
          <button
            type="button"
            onClick={() => setFilter("unread")}
            className={`${TAB_BASE} flex items-center gap-2 ${filter === "unread" ? TAB_ON : TAB_OFF}`}
          >
            {t("notifications.unread")}
            {unreadCount > 0 && (
              <Badge tone="accent" shape="pill">
                {unreadCount}
              </Badge>
            )}
          </button>
        </>
      }
      isLoading={isLoading}
      skeleton={
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="p-4 border border-[hsl(var(--color-hairline))] space-y-3">
              <div className="flex items-start gap-3">
                <Skeleton className="h-8 w-8" />
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
        </div>
      }
      // A failed request used to fall through to the empty state. This page
      // even destructured `error` from useQuery and never read it.
      isEmpty={isError || notifications.length === 0}
      empty={
        /* The only complete empty state in the repo before this pass — a 48px
           Bell over a centred reason. It is not being downgraded to a bare
           `<p>`: the icon's job (say "this region is deliberately empty, not
           broken") passes to EmptyState's 24×2 `--civ-mark` rule, the reason
           keeps its own line at text-04, and the third element the old one
           never had — a way out — goes in the `action` slot. An empty UNREAD
           list is the case where a way out exists and means something, so the
           action is offered there and withheld on `all`, where "show
           everything" is already what you are looking at. */
        isError ? (
          <QueryError onRetry={() => refetch()} />
        ) : (
          <EmptyState
            title={t("notifications.title")}
            reason={t("notifications.empty")}
            action={
              filter === "unread" ? (
                <Button type="button" variant="secondary" size="sm" onClick={() => setFilter("all")}>
                  {t("notifications.all")}
                </Button>
              ) : undefined
            }
          />
        )
      }
    >
      <div className="space-y-3">
        {notifications.map((notification) => (
          <div
            key={notification.id}
            className={`p-4 border transition-colors ${
              notification.is_read
                ? "bg-[hsl(var(--color-surface-1))] border-[hsl(var(--color-hairline))]"
                : "bg-[hsl(var(--color-surface-1))] border-[hsl(var(--color-accent)/0.3)]"
            }`}
          >
            <div className="flex items-start gap-3">
              {/* Icon */}
              {(() => {
                const IconComponent = getNotificationIcon(notification.notification_type ?? "");
                return (
                  <div className="w-10 h-10 bg-[hsl(var(--color-accent)/0.1)] flex items-center justify-center shrink-0">
                    <IconComponent aria-hidden="true" className="w-5 h-5 text-[hsl(var(--color-accent-ink))]" />
                  </div>
                );
              })()}

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <h2
                    className={`text-03 font-medium ${
                      notification.is_read ? "text-[hsl(var(--color-ink-muted))]" : "text-[hsl(var(--color-ink))]"
                    }`}
                  >
                    {notification.title}
                  </h2>
                  <span className="text-02 font-mono text-[hsl(var(--color-ink-subtle))] shrink-0">
                    {formatDate(notification.created_at)}
                  </span>
                </div>
                <p
                  className={`mt-1 text-03 ${
                    notification.is_read ? "text-[hsl(var(--color-ink-subtle))]" : "text-[hsl(var(--color-ink-muted))]"
                  }`}
                >
                  {notification.message}
                </p>

                {/* Actions */}
                {!notification.is_read && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="mt-2 text-[hsl(var(--color-accent-ink))]"
                    loading={markReadMutation.isPending}
                    onClick={() => handleMarkRead(notification.id)}
                  >
                    {t("notifications.mark_read")}
                  </Button>
                )}
              </div>

              {/* Unread Indicator */}
              {!notification.is_read && (
                <span aria-hidden="true" className="w-2 h-2 bg-[hsl(var(--color-accent))] rounded-full shrink-0 mt-2" />
              )}
            </div>
          </div>
        ))}
      </div>
    </PageShell>
  );
}
