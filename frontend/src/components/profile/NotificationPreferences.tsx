"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authApi, notificationsApi } from "@soulledger/core/api";
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_LOCKED,
  type NotificationCategory,
  type NotificationChannel,
} from "@soulledger/core/api/auth";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { showToast } from "@/src/components/ui/Toast";
import { Skeleton } from "@/components/ui/skeleton";

export const NOTIFICATION_PREFS_ANCHOR = "notifications";

/** 这几行带一句说明(Batch28Small W3);其余只有名字。 */
const WITH_NOTE: readonly NotificationCategory[] = [
  "account_security",
  "approval",
  "approval_timeout",
  "password_help",
  "dispatch",
  "city_god",
];

const GRID = "grid grid-cols-[minmax(0,1fr)_80px_80px] items-center gap-3";

/**
 * 个人中心「通知」(Design 第二十八批 W3):类别 × 站内 / 邮件。取代原来的「邮件通知」总开关。
 * 开关的皮与 SchedulerJobRow 同一张(44 的点击区里画 32 × 18 的轨道);「必收」的格不是开关,
 * 是一枚禁用的 switch 上写着字 —— 服务端同样拒绝关掉它们(`apps/notifications/categories.py`)。
 * 密码求助只有管理员收,所以只给管理员看这一行。
 * 旁边保留上次邮件发送失败(`/notifications/email-status/`)与「账号没有邮箱」的说明。
 */
export function NotificationPreferences({ hasAddress }: { hasAddress: boolean }) {
  const { t, locale, formatDateTime } = useI18n();
  const { user } = useTenant();
  const queryClient = useQueryClient();
  const prefs = useQuery({ queryKey: ["profile", "preferences"], queryFn: () => authApi.preferences().then((r) => r.data) });
  const status = useQuery({
    queryKey: ["profile", "email-status"],
    queryFn: () => notificationsApi.emailStatus().then((r) => r.data),
  });
  const toggle = useMutation({
    mutationFn: (v: { category: NotificationCategory; channel: NotificationChannel; on: boolean }) =>
      authApi
        .updatePreferences({
          notifications: { [v.category]: { [v.channel]: v.on } },
          // 邮件只有 zh-Hans / en(egy 界面落到 en);开邮件的那一刻记下当时的界面语言。
          ...(v.channel === "mail" && v.on ? { email_locale: locale === "zh-Hans" ? ("zh-Hans" as const) : ("en" as const) } : {}),
        })
        .then((r) => r.data),
    onSuccess: (data) => queryClient.setQueryData(["profile", "preferences"], data),
    onError: () => showToast(t("profile.profile_update_failed"), "error"),
  });
  const failure = status.data?.last_failure ?? null;
  const categories = NOTIFICATION_CATEGORIES.filter((c) => c !== "password_help" || user?.role === "ADMIN");

  return (
    <div
      data-testid="notification-prefs"
      className="mt-3 flex max-w-[720px] flex-col gap-4 border border-[oklch(var(--color-line))] bg-[oklch(var(--color-surface-1))] p-4"
    >
      <div role="table" aria-label={t("profile.notifications.title")}>
        <div role="row" className={`${GRID} h-10 font-semibold text-[oklch(var(--color-ink-muted))]`}>
          <span role="columnheader">{t("profile.notifications.category_header")}</span>
          <span role="columnheader" className="text-center">{t("profile.notifications.site")}</span>
          <span role="columnheader" className="text-center">{t("profile.notifications.mail")}</span>
        </div>
        {prefs.isLoading ? (
          <Skeleton className="h-14 w-full" />
        ) : (
          categories.map((category) => (
            <div key={category} role="row" className={`${GRID} min-h-14 border-t border-[oklch(var(--color-line))]`}>
              <span role="rowheader" className="flex flex-col">
                <span className="font-medium">{t(`profile.notifications.categories.${category}`)}</span>
                {WITH_NOTE.includes(category) ? (
                  <span className="text-xs text-[oklch(var(--color-ink-muted))]">
                    {t(`profile.notifications.notes.${category}`)}
                  </span>
                ) : null}
              </span>
              {(["site", "mail"] as const).map((channel) => (
                <span key={channel} role="cell" className="flex justify-center">
                  <Cell
                    category={category}
                    channel={channel}
                    on={prefs.data?.notifications?.[category]?.[channel] === true}
                    disabled={!prefs.data || toggle.isPending}
                    onToggle={(on) => toggle.mutate({ category, channel, on })}
                  />
                </span>
              ))}
            </div>
          ))
        )}
      </div>
      <p className="text-xs text-[oklch(var(--color-ink-muted))]">{t("profile.notifications.footnote")}</p>
      {!hasAddress ? (
        <p className="text-sm text-[oklch(var(--color-ink-subtle))]">{t("profile.email_notifications_no_address")}</p>
      ) : null}
      {failure ? (
        <p role="status" className="text-sm text-[oklch(var(--color-danger))]">
          <span aria-hidden="true">✕ </span>
          {t("profile.email_last_failure", { error: failure.error, at: formatDateTime(failure.at) })}
        </p>
      ) : null}
    </div>
  );
}

function Cell({
  category,
  channel,
  on,
  disabled,
  onToggle,
}: {
  category: NotificationCategory;
  channel: NotificationChannel;
  on: boolean;
  disabled: boolean;
  onToggle: (_on: boolean) => void;
}) {
  const { t } = useI18n();
  const name = `${t(`profile.notifications.categories.${category}`)} · ${t(`profile.notifications.${channel}`)}`;
  if (NOTIFICATION_LOCKED[category]?.includes(channel)) {
    return (
      <button
        type="button"
        role="switch"
        aria-checked
        disabled
        aria-label={`${name} · ${t("profile.notifications.locked")}`}
        className="text-sm text-[oklch(var(--color-ink-muted))] disabled:cursor-not-allowed"
      >
        {t("profile.notifications.locked")}
      </button>
    );
  }
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={name}
      disabled={disabled}
      onClick={() => onToggle(!on)}
      // 与 SchedulerJobRow 的开关同一张皮:44 的点击区里画 32 × 18 的轨道。
      className="group inline-flex size-(--control-h-sm) shrink-0 items-center justify-center disabled:cursor-not-allowed"
    >
      <span
        aria-hidden="true"
        className={`relative inline-flex h-[18px] w-8 items-center border-[1.5px] p-0.5 transition-colors duration-instant group-disabled:border-[oklch(var(--color-line))] group-disabled:bg-[oklch(var(--color-disabled-surface))] ${
          on
            ? "justify-end bg-[oklch(var(--color-ink))] border-[oklch(var(--color-ink))]"
            : "justify-start bg-transparent border-[oklch(var(--color-line-strong))]"
        }`}
      >
        <span className={`block size-[11px] ${on ? "bg-[oklch(var(--color-canvas))]" : "bg-[oklch(var(--color-line-strong))]"}`} />
      </span>
    </button>
  );
}
