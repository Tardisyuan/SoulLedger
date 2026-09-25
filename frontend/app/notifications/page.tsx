"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Bell, FileText, Scale, AlertCircle, RefreshCw, TrendingUp, User,
  type LucideIcon
} from "lucide-react";
import { notificationKeys } from "@soulledger/core/query_keys";
import { notificationsApi, type Notification, type PaginatedResponse } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { Skeleton } from "@/components/ui/skeleton";
import { PageShell } from "@/src/components/ui/PageShell";
import { Badge } from "@/src/components/ui/Badge";
import { Button, buttonVariants } from "@/src/components/ui/Button";
import { DomainEnum } from "@/src/components/ui/DomainValue";
import { usePermissions } from "@/src/hooks/usePermissions";
import Link from "next/link";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { QueryError } from "@/src/components/ui/PageError";
import { TAB_BASE, TAB_ON, TAB_OFF } from "@/src/lib/tabClasses";
import { cn } from "@/lib/utils";

type FilterType = "all" | "unread";

/**
 * Notifications under their local calendar day, days in first-seen order (the
 * API returns newest first, so that is newest day first). A Map rather than
 * "start a new group when the day changes": an out-of-order row joins its day
 * instead of opening a second header for the same date. Only `created_at` is
 * read — no field the notifications API does not already send.
 */
function groupByDay(items: Notification[], formatDay: (_iso: string) => string) {
  const days = new Map<string, { key: string; label: string; items: Notification[] }>();
  for (const item of items) {
    const d = new Date(item.created_at);
    const key = Number.isNaN(d.getTime())
      ? "unknown"
      : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const day = days.get(key) ?? { key, label: formatDay(item.created_at), items: [] };
    day.items.push(item);
    days.set(key, day);
  }
  return [...days.values()];
}

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
  const { t, formatDateTime, formatDate: formatDay } = useI18n();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  // User management is ADMIN only (`user.manage`); a realm lead's notice says to ask one instead.
  const canManageUsers = hasPermission("user.manage");
  const [filter, setFilter] = useState<FilterType>("all");

  const { data: notifications = [], isLoading, isError, refetch } = useQuery({
    // `notificationKeys.list(...)`, not a hand-written `["notifications", filter]`.
    // The literal happened to prefix-match what eventHandlers.ts invalidates
    // (`notificationKeys.all` === `["notifications"]`), so pushes did reach this
    // page — by coincidence of a string, not because the two agreed on a key.
    // Meanwhile eventInvalidationReachesCache.test.ts asserted that
    // `notificationKeys.list()` gets invalidated, and nothing read that entry:
    // the row was green and vacuous, the same shape the `soul detail` row had
    // before 5593e90.
    queryKey: notificationKeys.list(filter === "unread" ? { is_read: "false" } : undefined),
    queryFn: async () => {
      const params: Record<string, string> | undefined = filter === "unread" ? { is_read: "false" } : undefined;
      const res = await notificationsApi.list(params);
      return res.data.results;
    },
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Both mutations below invalidate `unreadCount` explicitly, and that is not a
  // redundant line: `unreadCount` sits OUTSIDE `notificationKeys.all` on purpose
  // (see query_keys.ts — so an ordinary list refetch does not also refetch the
  // badge), which means `all` does not prefix-match it. These two writes are the
  // exception the split was not designed for: they are precisely the writes that
  // change the unread total.
  //
  // Nothing else would have refetched it. The badge sets `staleTime: 30_000`
  // with no `refetchInterval`, `refetchOnWindowFocus` is off globally
  // (QueryProvider), and the backend's `mark_read` / `mark_all_read` publish no
  // event — so the WS path in eventHandlers.ts, the only other place that
  // invalidates this key, never fires for them. The masthead count simply stayed
  // wrong.
  const invalidateNotifications = () => {
    queryClient.invalidateQueries({ queryKey: notificationKeys.all });
    queryClient.invalidateQueries({ queryKey: notificationKeys.unreadCount });
  };

  const markReadMutation = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSuccess: () => {
      invalidateNotifications();
    },
    onError: () => showToast(t("notifications.mark_read_error") || "Failed to mark as read", "error"),
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    // The count comes from the response, not from `unreadCount` below.
    //
    // `unreadCount` is computed from the rows this page happens to be holding,
    // so under the `all` filter it counts only the unread ones in the current
    // page of results while the request marks every unread notification the
    // user has. Reporting the client-side number would be a sentence about the
    // screen dressed up as a sentence about what happened. The server returns
    // `{ marked_read: N }` for exactly this.
    onSuccess: (res) => {
      invalidateNotifications();
      showToast(
        t("notifications.mark_all_success", { count: String(res.data.marked_read) }),
        "success"
      );
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
            <Bell aria-hidden="true" className="w-6 h-6 text-[oklch(var(--color-accent-ink))]" />
            {unreadCount > 0 && (
              <Badge
                tone="accent"
               
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
            // `aria-pressed`, not `role="tab"`. These are not a real tablist —
            // they do not own a `tabpanel`, arrow keys do not move between them,
            // and claiming the role without that contract is the defect this
            // repo already has three instances of. What they ARE is a set of
            // toggles where exactly one is on, and `aria-pressed` says that
            // truthfully. Before this the selected one differed only by border
            // and text COLOUR, so a screen-reader user heard two identical
            // buttons and could not tell which view was showing.
            // `components/ui/data-grid/FilterBar.tsx:181` already does this.
            aria-pressed={filter === "all"}
            onClick={() => setFilter("all")}
            className={`${TAB_BASE} ${filter === "all" ? TAB_ON : TAB_OFF}`}
          >
            {t("notifications.all")}
          </button>
          <button
            type="button"
            aria-pressed={filter === "unread"}
            onClick={() => setFilter("unread")}
            className={`${TAB_BASE} flex items-center gap-2 ${filter === "unread" ? TAB_ON : TAB_OFF}`}
          >
            {t("notifications.unread")}
            {unreadCount > 0 && (
              <Badge tone="accent">
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
            <div key={i} className="px-3 py-3 border-b border-[oklch(var(--color-rule))] space-y-3">
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
           keeps its own line at text-sm, and the third element the old one
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
      {/* 账页(规范 v1 §2):不装框、不铺底,条与条之间是行线;按天分组,
          组头是一行 32 px 的等宽日期,下接区块边界线(第三类 A 审判队列的组头)。
          未读 = 行首 6 px 强调色方块 + 标题 600(第三类 C 收件箱的 `dot` / `nst`),
          不再是一圈淡蓝边框 —— 方块之外还有字重,不只靠颜色。 */}
      {groupByDay(notifications, formatDay).map((day) => (
        <section key={day.key} aria-label={day.label} data-notification-day={day.key} className="mt-3 first:mt-0">
          <div
            aria-hidden="true"
            className="flex h-8 items-center justify-between border-b border-[oklch(var(--color-block))] px-3 font-mono text-xs"
          >
            <span className="font-semibold text-[oklch(var(--color-ink))]">
              {day.label}{" "}
              <span className="font-normal text-[oklch(var(--color-ink-subtle))]">· {day.items.length}</span>
            </span>
          </div>
          {day.items.map((notification) => (
          <div
            key={notification.id}
            data-unread={notification.is_read ? undefined : ""}
            className="px-3 py-3 border-b border-[oklch(var(--color-rule))] transition-colors hover:bg-[oklch(var(--color-surface-2))]"
          >
            <div className="flex items-start gap-3">
              {/* Unread mark: a 6 px square, not a dot. Drawn on every row
                  (transparent when read) so read and unread titles line up. */}
              <span
                aria-hidden="true"
                data-unread-mark={notification.is_read ? undefined : ""}
                className={cn(
                  "mt-[7px] h-1.5 w-1.5 shrink-0",
                  notification.is_read ? "bg-transparent" : "bg-[oklch(var(--color-accent))]"
                )}
              />
              {/* Icon */}
              {(() => {
                const IconComponent = getNotificationIcon(notification.notification_type ?? "");
                return (
                  <div className="w-10 h-10 flex items-center justify-center shrink-0">
                    <IconComponent aria-hidden="true" className="w-5 h-5 text-[oklch(var(--color-ink-muted))]" />
                  </div>
                );
              })()}

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <h2
                    className={cn(
                      "text-sm font-medium",
                      notification.is_read
                        ? "text-[oklch(var(--color-ink-muted))]"
                        : "font-semibold text-[oklch(var(--color-ink))]"
                    )}
                  >
                    {notification.title}
                  </h2>
                  <span className="text-xs font-mono text-[oklch(var(--color-ink-subtle))] shrink-0">
                    {formatDate(notification.created_at)}
                  </span>
                </div>
                <p
                  className={`mt-1 text-sm ${
                    notification.is_read ? "text-[oklch(var(--color-ink-subtle))]" : "text-[oklch(var(--color-ink-muted))]"
                  }`}
                >
                  {notification.message}
                </p>

                {/* 重设密码求助(第三类 F 组 2.6):等宽一行「殿 · 角色 · 近 24 小时第 N 次」,
                    然后「去用户页」(只给能管用户的人)与「不是本人 · 忽略」(= 标为已读)。 */}
                {notification.request_context && (
                  <>
                    <p data-testid="request-context" className="mt-1 font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">
                      {notification.request_context.hall ? `${notification.request_context.hall} · ` : ""}
                      <DomainEnum namespace="users.roles" value={notification.request_context.role} />
                      {" · "}
                      {t("notifications.help_count_24h", { n: String(notification.request_context.count_24h) })}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {canManageUsers && (
                        <Link href="/users" className={buttonVariants({ variant: "secondary", size: "sm" })}>
                          {t("notifications.help_open_users")}
                        </Link>
                      )}
                      {!notification.is_read && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          loading={markReadMutation.isPending && markReadMutation.variables === String(notification.id)}
                          onClick={() => handleMarkRead(notification.id)}
                        >
                          {t("notifications.help_ignore")}
                        </Button>
                      )}
                    </div>
                  </>
                )}

                {/* Actions */}
                {!notification.is_read && !notification.request_context && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="mt-2 text-[oklch(var(--color-accent-ink))]"
                    /* This row's own pending state, not the mutation's.
                       `markReadMutation` is one object shared by every row, so
                       a bare `isPending` put a spinner on EVERY unread
                       notification's button the moment any one of them was
                       clicked — which reads as the page-header "mark all read"
                       having fired, and that one is not reversible. */
                    loading={
                      markReadMutation.isPending &&
                      markReadMutation.variables === String(notification.id)
                    }
                    onClick={() => handleMarkRead(notification.id)}
                  >
                    {t("notifications.mark_read")}
                  </Button>
                )}
              </div>
            </div>
          </div>
          ))}
        </section>
      ))}
    </PageShell>
  );
}
