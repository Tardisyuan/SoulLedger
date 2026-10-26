/** 我的: profile (the name opens its edit screen), two-step verification (opens its screen), change password, language, theme, push, about, sign out. */
import { authApi, mfaApi } from "@soulledger/core/api/auth";
import { officerAppApi } from "@soulledger/core/api/officer-app";
import { SUPPORTED_LOCALES } from "@soulledger/core/config/locale";
import Constants from "expo-constants";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { type ScrollView, View } from "react-native";

import { canCheck, confirmWished, setConfirmWished, useBioWord } from "../deviceCheck";
import { ActionButton, Row, Segmented } from "../kit";
import { type ThemeChoice, usePrefs } from "../prefs";
import { permission, registerDevice, requestPermission, unregisterDevice, hasRegisteredDevice, type Permission } from "../push";
import { hallLabel, mutedCount } from "../rules";
import { needsMfaSetup, useSession } from "../session";
import { Notice, OneLine, Screen, SectionLabel, SmallButton, Txt, space, translate, useI18n, useRemote, useToast } from "../shared";

export type AccountScreen = "password" | "mfa" | "devices" | "notify" | "name" | "stats";

export function MeTab({ onOpen }: { onOpen: (screen: AccountScreen) => void }) {
  const { t, locale, setLocale, enumLabel } = useI18n();
  const { state, signOut } = useSession();
  const { themeChoice, setThemeChoice } = usePrefs();
  const [asking, setAsking] = useState(false);
  const scroll = useRef<ScrollView>(null);
  const user = state.status === "signedIn" ? state.user : null;
  const role = enumLabel("users.roles", user?.role);
  const load = useCallback(() => mfaApi.status().then((r) => r.data), []);
  const mfa = useRemote(load);
  const loadProfile = useCallback(() => authApi.profile().then((r) => r.data), []);
  const profile = useRemote(loadProfile);
  const loadPrefs = useCallback(() => authApi.preferences().then((r) => r.data), []);
  const prefs = useRemote(loadPrefs);
  if (!user) return null;
  const muted = mutedCount(prefs.data?.notifications, user.role);

  const mfaLine = mfa.data?.enabled
    ? t("officer_app.me.mfa_on")
    : needsMfaSetup(user)
      ? t("officer_app.me.mfa_required_off")
      : mfa.error
        ? t("officer_app.state.error_title")
        : t("officer_app.me.mfa_off");
  const version = Constants.expoConfig?.version ?? "";

  return (
    <Screen testID="tab-me-screen" edges={["left", "right"]} scrollRef={scroll}>
      <View style={{ padding: space[5], gap: space[5] }}>
        <StatsCard onOpen={() => onOpen("stats")} />

        <Block label={t("officer_app.me.profile")}>
          <Row
            testID="me-name"
            minHeight={56}
            title={t("officer_app.me.name")}
            onPress={() => onOpen("name")}
            right={
              // A long name is cut to one line and never takes more than 60 % of the row, so 「姓名」 stays.
              <View style={{ flexDirection: "row", alignItems: "center", flexShrink: 1, maxWidth: "60%" }}>
                {/* S4: one line, long-press for the whole name; the row's press rides on it (a long press takes the touch). */}
                <OneLine testID="me-name-value" variant="bodyLg" style={{ flexShrink: 1 }} onPress={() => onOpen("name")}>
                  {user.display_name || user.username}
                </OneLine>
                <Txt variant="bodyLg">{"  ›"}</Txt>
              </View>
            }
          />
          <Fact label={t("officer_app.me.role")} value={role.state === "known" ? role.label : user.role} />
          <Fact label={t("officer_app.me.hall")} value={hallLabel(t, user.tenant) ?? ""} />
          {profile.data?.email ? (
            <EmailFact email={profile.data.email} verified={!!profile.data.email_verified} />
          ) : profile.data ? (
            // No address at all is the case that most needs saying: the reset mail has nowhere to go.
            <View testID="me-email-none" style={{ gap: space[2] }}>
              <Fact label={t("officer_app.me.email")} value="—" />
              <Txt variant="caption" tone="muted">
                {t("officer_app.me.email_none")}
              </Txt>
            </View>
          ) : null}
        </Block>

        <Block label={t("officer_app.me.mfa")}>
          <Row testID="me-mfa" minHeight={56} title={mfaLine} onPress={() => onOpen("mfa")} right={<Txt variant="nav">›</Txt>} />
        </Block>

        <Block label={t("profile.change_password")}>
          <Row testID="me-password" minHeight={56} title={t("profile.change_password")} onPress={() => onOpen("password")} right={<Txt variant="nav">›</Txt>} />
        </Block>

        <Block label={t("profile.devices.title")}>
          <Row testID="me-devices" minHeight={56} title={t("profile.devices.title")} onPress={() => onOpen("devices")} right={<Txt variant="nav">›</Txt>} />
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

        <Block label={t("officer_app.me.notify_categories")}>
          <Row
            testID="me-notify"
            minHeight={56}
            title={t("officer_app.me.notify_categories")}
            onPress={() => onOpen("notify")}
            value={prefs.data ? (muted > 0 ? t("officer_app.me.muted_count", { n: String(muted) }) : t("officer_app.me.muted_none")) : undefined}
            right={<Txt variant="nav">›</Txt>}
          />
        </Block>

        <ConfirmBlock />

        <Block label={t("officer_app.me.about")}>
          <Txt variant="bodyLg">{`${t("officer_app.name")} · ${t("officer_app.me.version", { version })}`}</Txt>
        </Block>

        {asking ? (
          // Replaces the button it was asked from. The question is taller than that button, so the page follows it down:
          // on an iPhone 17 the two answers opened under the tab bar and had to be scrolled to (2026-10-11).
          <View style={{ gap: space[3] }} onLayout={() => scroll.current?.scrollToEnd({ animated: true })}>
            <Notice tone="neutral">
              <Txt variant="caption">{t("officer_app.me.logout_title")}</Txt>
            </Notice>
            <View style={{ flexDirection: "row", gap: space[3] }}>
              <ActionButton testID="me-logout-cancel" kind="outline" title={t("soul_app.common.cancel")} onPress={() => setAsking(false)} />
              <ActionButton testID="me-logout-confirm" kind="ink" title={t("officer_app.me.logout_ok")} onPress={signOut} />
            </View>
          </View>
        ) : (
          <ActionButton testID="me-logout" kind="ink-outline" title={t("officer_app.me.logout")} onPress={() => setAsking(true)} />
        )}
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

/** 邮箱 and whether it is verified; unverified gets 「发送验证邮件」 (5 an hour) and the one line why it matters. */
function EmailFact({ email, verified }: { email: string; verified: boolean }) {
  const { t } = useI18n();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const send = () => {
    setBusy(true);
    authApi
      .sendEmailVerification()
      .then(
        () => toast(t("profile.email_verification_sent"), "success"),
        (e: unknown) => toast(t((e as { response?: { status?: number } })?.response?.status === 429 ? "auth.rate_limited" : "profile.email_verification_failed"), "failure")
      )
      .finally(() => setBusy(false));
  };
  return (
    <View testID="me-email" style={{ gap: space[2] }}>
      <Fact label={t("officer_app.me.email")} value={`${email} · ${verified ? `✓ ${t("profile.email_verified")}` : `○ ${t("profile.email_unverified")}`}`} />
      {verified ? null : (
        <>
          <Txt variant="caption" tone="muted">
            {t("profile.email_verification_hint")}
          </Txt>
          <SmallButton testID="me-email-send" title={t("profile.email_send_verification")} onPress={() => { if (!busy) send(); }} />
        </>
      )}
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

/** 批准、驳回前认面容: a switch, on by default; greyed, with the way out, when the phone has no screen lock. */
function ConfirmBlock() {
  const { t } = useI18n();
  const bio = useBioWord();
  const [possible, setPossible] = useState<boolean | null>(null);
  const [on, setOn] = useState(confirmWished);

  useEffect(() => {
    let alive = true;
    void canCheck().then((ok) => alive && setPossible(ok));
    return () => {
      alive = false;
    };
  }, []);
  if (possible === null) return null;

  const toggle = () => {
    setConfirmWished(!on);
    setOn(!on);
  };
  return (
    <Block label={t("officer_app.biometric.setting", { bio: bio.inside })}>
      <View style={{ opacity: possible ? 1 : 0.45 }}>
        <Row
          testID="me-confirm-bio"
          minHeight={56}
          title={t("officer_app.biometric.setting", { bio: bio.inside })}
          lines={[possible ? t("officer_app.biometric.hint") : t("officer_app.biometric.unavailable")]}
          onPress={possible ? toggle : undefined}
          right={<Txt variant="nav">{possible && on ? "✓" : "○"}</Txt>}
        />
      </View>
    </Block>
  );
}

/** 我的数(S-1): the three numbers in motion; the whole card opens the stats screen. Loading shows a dash-free placeholder, an error says so (never zeros). */
function StatsCard({ onOpen }: { onOpen: () => void }) {
  const { t } = useI18n();
  const load = useCallback(() => officerAppApi.stats().then((r) => r.data), []);
  const { data, error } = useRemote(load);
  const cell = (testID: string, label: string, n: number | undefined) => (
    <View key={testID} style={{ alignItems: "center", minWidth: 56 }}>
      <Txt testID={testID} variant="title">{n === undefined ? "…" : String(n)}</Txt>
      <Txt variant="caption" tone="muted">{label}</Txt>
    </View>
  );
  const failed = !data && !!error;
  return (
    <Row
      testID="me-stats"
      minHeight={88}
      title={t("officer_app.stats.title")}
      lines={[{ one: failed ? t("officer_app.stats.load_failed") : t("officer_app.stats.scope") }]}
      onPress={onOpen}
      right={
        failed ? (
          <Txt variant="nav">›</Txt>
        ) : (
          <View style={{ flexDirection: "row", gap: space[3] }}>
            {cell("me-stat-month", t("officer_app.stats.concluded_this_month"), data?.concluded_this_month)}
            {cell("me-stat-open", t("officer_app.stats.open_claims"), data?.open_claims)}
            {cell("me-stat-review", t("officer_app.stats.appeals_in_review"), data?.appeals_in_review)}
          </View>
        )
      }
    />
  );
}
