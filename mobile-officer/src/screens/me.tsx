/** 我的: profile, two-step verification status, language, theme, push, about, sign out. */
import { mfaApi } from "@soulledger/core/api/auth";
import { SUPPORTED_LOCALES } from "@soulledger/core/config/locale";
import Constants from "expo-constants";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { View } from "react-native";

import { ActionButton, Row, Segmented } from "../kit";
import { type ThemeChoice, usePrefs } from "../prefs";
import { permission, registerDevice, requestPermission, unregisterDevice, hasRegisteredDevice, type Permission } from "../push";
import { hallLabel } from "../rules";
import { needsMfaSetup, useSession } from "../session";
import { Notice, Screen, SectionLabel, Txt, space, translate, useI18n, useRemote } from "../shared";

export function MeTab() {
  const { t, locale, setLocale, enumLabel } = useI18n();
  const { state, signOut } = useSession();
  const { themeChoice, setThemeChoice } = usePrefs();
  const [asking, setAsking] = useState(false);
  const user = state.status === "signedIn" ? state.user : null;
  const role = enumLabel("users.roles", user?.role);
  const load = useCallback(() => mfaApi.status().then((r) => r.data), []);
  const mfa = useRemote(load);
  if (!user) return null;

  const mfaLine = mfa.data?.enabled
    ? t("officer_app.me.mfa_on")
    : needsMfaSetup(user)
      ? t("officer_app.me.mfa_required_off")
      : mfa.error
        ? t("officer_app.state.error_title")
        : t("officer_app.me.mfa_off");
  const version = Constants.expoConfig?.version ?? "";

  return (
    <Screen testID="tab-me-screen" edges={["left", "right"]}>
      <View style={{ padding: space[5], gap: space[5] }}>
        <Block label={t("officer_app.me.profile")}>
          <Fact label={t("officer_app.me.name")} value={user.display_name || user.username} />
          <Fact label={t("officer_app.me.role")} value={role.state === "known" ? role.label : user.role} />
          <Fact label={t("officer_app.me.hall")} value={hallLabel(t, user.tenant) ?? ""} />
        </Block>

        <Block label={t("officer_app.me.mfa")}>
          <Txt testID="me-mfa" variant="bodyLg">{mfaLine}</Txt>
          <Txt variant="caption" tone="muted">
            {t("officer_app.me.mfa_note")}
          </Txt>
        </Block>

        <Block label={t("officer_app.me.language")}>
          <Segmented
            testID="me-language"
            value={locale}
            onChange={setLocale}
            options={SUPPORTED_LOCALES.map((key) => ({ key, label: translate(key, "soul_app.settings.language_name") }))}
          />
        </Block>

        <Block label={t("officer_app.me.theme")}>
          <Segmented<ThemeChoice>
            testID="me-theme"
            value={themeChoice}
            onChange={setThemeChoice}
            options={[
              { key: "system", label: t("officer_app.me.theme_system") },
              { key: "light", label: t("officer_app.me.theme_light") },
              { key: "dark", label: t("officer_app.me.theme_dark") },
            ]}
          />
        </Block>

        <PushBlock />

        <Block label={t("officer_app.me.about")}>
          <Txt variant="bodyLg">{`${t("officer_app.name")} · ${t("officer_app.me.version", { version })}`}</Txt>
        </Block>

        <ActionButton testID="me-logout" kind="ink-outline" title={t("officer_app.me.logout")} onPress={() => setAsking(true)} />
        {asking ? (
          <Notice tone="neutral">
            <Txt variant="caption">{t("officer_app.me.logout_title")}</Txt>
          </Notice>
        ) : null}
        {asking ? (
          <View style={{ flexDirection: "row", gap: space[3] }}>
            <ActionButton testID="me-logout-cancel" kind="outline" title={t("soul_app.common.cancel")} onPress={() => setAsking(false)} />
            <ActionButton testID="me-logout-confirm" kind="ink" title={t("officer_app.me.logout_ok")} onPress={signOut} />
          </View>
        ) : null}
      </View>
    </Screen>
  );
}

function Block({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ gap: space[3] }}>
      <SectionLabel>{label}</SectionLabel>
      {children}
    </View>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ gap: space[1] }}>
      <Txt variant="caption" tone="muted">
        {label}
      </Txt>
      <Txt variant="bodyLg">{value}</Txt>
    </View>
  );
}

/** The push switch: on means this device is registered for this officer's count pushes. */
function PushBlock() {
  const { t } = useI18n();
  const [perm, setPerm] = useState<Permission | null>(null);
  const [on, setOn] = useState(hasRegisteredDevice());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void permission().then((p) => alive && setPerm(p));
    return () => {
      alive = false;
    };
  }, []);

  const turnOn = async () => {
    setBusy(true);
    setNote(null);
    const granted = perm === "granted" ? perm : await requestPermission();
    setPerm(granted);
    if (granted !== "granted") setNote(t("officer_app.me.push_denied"));
    else {
      const result = await registerDevice();
      if (result.ok) setOn(true);
      else setNote(result.reason === "no_project_id" ? t("officer_app.me.push_unavailable") : t("officer_app.me.push_failed"));
    }
    setBusy(false);
  };
  const turnOff = async () => {
    setBusy(true);
    await unregisterDevice();
    setOn(false);
    setBusy(false);
  };

  return (
    <Block label={t("officer_app.me.push")}>
      <Row
        testID="me-push"
        minHeight={56}
        title={on ? t("officer_app.me.push_on") : t("officer_app.me.push_off")}
        lines={[t("officer_app.me.push_note")]}
        onPress={busy ? undefined : on ? turnOff : turnOn}
        right={<Txt variant="nav">{on ? "✓" : "○"}</Txt>}
      />
      {note ? <Notice tone="neutral">{note}</Notice> : null}
    </Block>
  );
}
