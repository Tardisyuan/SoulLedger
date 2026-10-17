/**
 * 登录设备 (under 我的): the devices signed in to this officer's account, this one first. Ending another one needs no
 * password and takes effect at once; this one has no button (the sign-out in 我的 is the way). 「退出其他全部」 asks first,
 * with the count. A row leaves the list when the server says yes -- nothing is removed on a guess. Same endpoints and
 * words as the desk's 个人中心 (`profile.devices.*`).
 */
import { sessionsApi, type SignInSession } from "@soulledger/core/api/auth";
import { useCallback, useRef, useState } from "react";
import { type ScrollView, View } from "react-native";

import { formatWhen } from "../format";
import { ActionButton, Row } from "../kit";
import { Notice, SmallButton, Txt, space, useI18n, useRemote, useToast } from "../shared";
import { AccountFrame } from "./account";

export function DevicesScreen({ onBack }: { onBack: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const load = useCallback(() => sessionsApi.list().then((r) => r.data), []);
  const { data, error, reload } = useRemote(load);
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const scroll = useRef<ScrollView>(null);
  const rows = (data ?? []).filter((s) => !gone.has(s.id));
  const others = rows.filter((s) => !s.current);

  const end = (run: () => Promise<unknown>, key: string, done: () => void) => {
    if (busy) return;
    setBusy(key);
    run()
      .then(done, () => toast(t("profile.devices.sign_out_failed"), "failure"))
      .finally(() => setBusy(null));
  };
  const signOut = (s: SignInSession) =>
    end(() => sessionsApi.revoke(s.id), s.id, () => {
      setGone((prev) => new Set(prev).add(s.id));
      toast(t("profile.devices.signed_out"), "success");
    });
  const signOutOthers = () =>
    end(() => sessionsApi.revokeOthers(), "others", () => {
      setAsking(false);
      setGone(new Set(others.map((s) => s.id)));
      toast(t("profile.devices.signed_out"), "success");
    });

  return (
    <AccountFrame testID="devices-screen" onBack={onBack} scrollRef={scroll}>
      <Txt variant="title">{t("profile.devices.title")}</Txt>
      <Txt variant="body" tone="muted">
        {t("profile.devices.intro")}
      </Txt>
      {error && !data ? (
        <View style={{ gap: space[3] }}>
          <Notice tone="neg">{t("profile.devices.load_failed")}</Notice>
          <SmallButton testID="devices-retry" title={t("common.retry")} onPress={() => void reload()} />
        </View>
      ) : null}
      {rows.map((s) => (
        <Row
          key={s.id}
          testID={`device-${s.id}`}
          minHeight={64}
          strong={s.current}
          title={s.current ? `${s.label} · ${t("profile.devices.this")}` : s.label}
          lines={[{ one: s.current ? t("profile.devices.in_use") : formatWhen(s.last_seen_at) }]}
          right={
            s.current ? undefined : (
              <SmallButton testID={`device-signout-${s.id}`} title={t("profile.devices.sign_out")} onPress={() => signOut(s)} />
            )
          }
        />
      ))}
      {others.length > 0 ? (
        asking ? (
          // The answers open at the foot of a long list, under the tab bar: bring them into view (as 我的 does).
          <View style={{ gap: space[3] }} onLayout={() => scroll.current?.scrollToEnd({ animated: true })}>
            <Notice tone="neutral">
              <Txt variant="caption">{t("profile.devices.confirm_title", { n: String(others.length) })}</Txt>
            </Notice>
            <Txt variant="body" tone="muted">
              {t("profile.devices.confirm_body")}
            </Txt>
            <View style={{ flexDirection: "row", gap: space[3] }}>
              <ActionButton testID="devices-others-cancel" kind="outline" title={t("soul_app.common.cancel")} onPress={() => setAsking(false)} />
              <ActionButton testID="devices-others-confirm" kind="ink" title={t("profile.devices.confirm_action", { n: String(others.length) })} busy={busy === "others"} onPress={signOutOthers} />
            </View>
          </View>
        ) : (
          <ActionButton testID="devices-others" kind="ink-outline" title={t("profile.devices.sign_out_others")} onPress={() => setAsking(true)} />
        )
      ) : null}
    </AccountFrame>
  );
}
