/**
 * 通知类别 (under 我的; Design 第三十四批 O-06): one switch per category, which is the desk's 「站内」 column of
 * 个人中心 · 通知 (same `auth/profile/preferences/`, same `profile.notifications.*` words, same order). The 「邮件」
 * column is set on the web only. A tap saves at once; if the server says no the switch snaps back and a toast says so.
 * 「必收」 rows are not switches (the server refuses to turn them off too).
 */
import { authApi, NOTIFICATION_LOCKED, type NotificationCategory } from "@soulledger/core/api/auth";
import { useCallback, useState } from "react";
import { View } from "react-native";

import { Row } from "../kit";
import { visibleNotificationCategories } from "../rules";
import { useSession } from "../session";
import { Notice, SmallButton, Txt, space, useI18n, useRemote, useToast } from "../shared";
import { AccountFrame } from "./account";

/** 这几行带一句说明,同网页。 */
const WITH_NOTE: readonly NotificationCategory[] = ["account_security", "approval", "approval_timeout", "password_help", "dispatch"];

export function NotifyScreen({ onBack }: { onBack: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const { state } = useSession();
  const role = state.status === "signedIn" ? state.user.role : undefined;
  const load = useCallback(() => authApi.preferences().then((r) => r.data), []);
  const { data, error, reload } = useRemote(load);
  // 点下去先翻过来(乐观),服务端拒绝再翻回;一类一次只存一个。
  const [local, setLocal] = useState<Partial<Record<NotificationCategory, boolean>>>({});
  const [saving, setSaving] = useState<NotificationCategory | null>(null);
  const on = (c: NotificationCategory) => local[c] ?? data?.notifications?.[c]?.site === true;

  const toggle = (c: NotificationCategory) => {
    if (saving) return;
    const next = !on(c);
    setSaving(c);
    setLocal((prev) => ({ ...prev, [c]: next }));
    authApi
      .updatePreferences({ notifications: { [c]: { site: next } } })
      .then(() => reload())
      .catch(() => {
        setLocal((prev) => ({ ...prev, [c]: !next }));
        toast(t("officer_app.notify.save_failed"), "failure");
      })
      .finally(() => setSaving(null));
  };

  return (
    <AccountFrame testID="notify-screen" onBack={onBack}>
      <Txt variant="title">{t("officer_app.me.notify_categories")}</Txt>
      <Txt variant="body" tone="muted">
        {t("officer_app.notify.intro")}
      </Txt>
      {error && !data ? (
        <View style={{ gap: space[3] }}>
          <Notice tone="neg">{t("officer_app.state.error_title")}</Notice>
          <SmallButton testID="notify-retry" title={t("common.retry")} onPress={() => void reload()} />
        </View>
      ) : null}
      {data
        ? visibleNotificationCategories(role).map((c) => {
            const locked = NOTIFICATION_LOCKED[c]?.includes("site") === true;
            return (
              <Row
                key={c}
                testID={`notify-${c}`}
                minHeight={64}
                title={t(`profile.notifications.categories.${c}`)}
                lines={WITH_NOTE.includes(c) ? [t(`profile.notifications.notes.${c}`)] : []}
                onPress={locked ? undefined : () => toggle(c)}
                right={
                  <Txt variant="nav" accessibilityRole={locked ? undefined : "switch"} accessibilityState={locked ? undefined : { checked: on(c) }}>
                    {locked ? t("profile.notifications.locked") : on(c) ? "✓" : "○"}
                  </Txt>
                }
              />
            );
          })
        : null}
      <Txt variant="caption" tone="muted">
        {t("profile.notifications.footnote")}
      </Txt>
    </AccountFrame>
  );
}
