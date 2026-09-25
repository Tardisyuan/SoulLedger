/**
 * Round 4 (handoff 4b): one page for "this account" — who, language,
 * notifications, sign out — reached from the header's person icon on all three
 * tabs. Round 3c's notification settings and permission primer live here too.
 *
 * Language, three rules (handoff 4a):
 *   一 it takes effect at once — no restart, no trip back to login, the stack stays;
 *   二 only the interface changes — statements, reasons and names stay as written
 *      (`Quote` labels them "原文");
 *   三 it has nothing to do with civilization — skin and lexicon do not move.
 * It is stored twice: on the device at once (the i18n provider), then on the
 * account (`/me/notification-settings/` `locale` — the only per-account language
 * the API has, which is also what the lock screen is written in). A failed
 * account save never takes the interface back; it says so and offers both ways.
 */
import { soulApi, type NotificationSettings } from "@soulledger/core/api/soul";
import { LOCALE_LABELS, SUPPORTED_LOCALES, type Locale } from "@soulledger/core/config/locale";
import { platform } from "@soulledger/core/platform";
import { useFocusEffect, useNavigation, type NavigationProp } from "@react-navigation/native";
import Constants from "expo-constants";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Linking, Pressable, StyleSheet, View } from "react-native";

import { Emblem, Icon, type IconName } from "../emblems";
import { useAskLogout, useToast } from "../feedback";
import { translate, useI18n } from "../i18n";
import { PRIMER_SEEN_KEY, easProjectId, permission, registerDevice, requestPermission, type Permission } from "../push";
import { useSession } from "../session";
import {
  Block,
  Button,
  EmblemDivider,
  EnumValue,
  GUTTER,
  Hairline,
  Notice,
  Screen,
  SectionError,
  Skeleton,
  Txt,
  useLayout,
  useRemote,
  useTheme,
} from "../ui";
import type { AppStackParams } from "./applications";

type Save =
  | { state: "idle" }
  | { state: "saving" | "saved" | "failed"; to: Locale; from: Locale };

/**
 * A locale's own name, in that language — a row must be findable by someone who cannot read the current one.
 * Same source as the login screen's language buttons, so one language is not "Kemet" there and "Egyptian" here.
 */
const selfName = (l: Locale) => LOCALE_LABELS[l];

function Heading({ children }: { children: string }) {
  return (
    <Txt variant="section" tone="accent" style={styles.heading}>
      {children}
    </Txt>
  );
}

function LanguageRow({ l, selected, busy, onPick }: { l: Locale; selected: boolean; busy: boolean; onPick: () => void }) {
  const theme = useTheme();
  const { t } = useI18n();
  const { gutter } = useLayout();
  return (
    <Pressable
      testID={`language-${l}`}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPick}
      style={({ pressed }) => [
        styles.row,
        { paddingHorizontal: gutter, borderBottomColor: theme.hair, borderLeftColor: selected ? theme.mark : "transparent" },
        pressed && styles.pressed,
      ]}
    >
      {/* 单选(第三类 F 组):方框,选中时放墨色小方块 —— 墨色,不是强调色。 */}
      <View style={[styles.radio, { borderColor: selected ? theme.ink : theme.hair2 }]}>
        {selected ? <View style={[styles.radioDot, { backgroundColor: theme.ink }]} /> : null}
      </View>
      <View style={styles.fill}>
        <Txt variant="bodyLg">{selfName(l)}</Txt>
        <Txt variant="caption" tone="subtle">
          {translate(l, "soul_app.settings.language_note")}
        </Txt>
      </View>
      {busy ? <ActivityIndicator testID="language-saving" size="small" color={theme.inkSubtle} /> : null}
      {selected && !busy ? (
        <View style={[styles.current, { borderColor: theme.accent }]}>
          <Txt variant="label" tone="accent" style={styles.currentText}>
            {t("soul_app.settings.current")}
          </Txt>
        </View>
      ) : null}
    </Pressable>
  );
}

function SaveStatus({ save, onRetry, onRevert }: { save: Save; onRetry: () => void; onRevert: () => void }) {
  const theme = useTheme();
  const { t } = useI18n();
  const { gutter } = useLayout();
  if (save.state === "idle") return null;
  if (save.state === "failed") {
    return (
      <View style={[styles.saveFailed, { marginHorizontal: gutter, borderColor: theme.negStrong, backgroundColor: theme.negBg }]}>
        <View style={styles.saveRow}>
          <Icon name="alert" size={15} color={theme.neg} />
          <Txt testID="language-save-failed" variant="caption" tone="negInk" style={styles.fill}>
            {t("soul_app.settings.save_failed", { current: selfName(save.to), previous: selfName(save.from) })}
          </Txt>
        </View>
        <View style={styles.saveActions}>
          <Button testID="language-retry" kind="secondary" title={t("soul_app.common.retry")} onPress={onRetry} />
          <Button testID="language-revert" kind="secondary" title={t("soul_app.settings.revert", { previous: selfName(save.from) })} onPress={onRevert} />
        </View>
      </View>
    );
  }
  return (
    <View testID={`language-${save.state}`} style={[styles.saveLine, { marginHorizontal: gutter, borderColor: theme.hair2 }]}>
      {save.state === "saved" ? <Icon name="check" size={14} color={theme.pos} strokeWidth={1.5} /> : null}
      <Txt variant="caption" tone="muted">
        {t(save.state === "saved" ? "soul_app.settings.saved" : "soul_app.settings.saving")}
      </Txt>
    </View>
  );
}

function Language({ accountLocale, onSaved }: { accountLocale: Locale | null; onSaved: (l: Locale) => void }) {
  const { locale, setLocale } = useI18n();
  const [save, setSave] = useState<Save>({ state: "idle" });
  const fade = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (fade.current) clearTimeout(fade.current);
  }, []);

  const store = (to: Locale, from: Locale) => {
    if (fade.current) clearTimeout(fade.current);
    setSave({ state: "saving", to, from });
    soulApi.updateNotificationSettings({ locale: to }).then(
      (saved) => {
        onSaved(saved.locale ?? to);
        setSave({ state: "saved", to, from });
        fade.current = setTimeout(() => setSave({ state: "idle" }), 1600);
      },
      () => setSave({ state: "failed", to, from })
    );
  };

  const pick = (to: Locale) => {
    if (to === locale) return;
    setLocale(to); // rule 一: the interface changes now, whatever the account save does
    store(to, accountLocale ?? locale);
  };

  return (
    <>
      <View accessibilityRole="radiogroup">
        {SUPPORTED_LOCALES.map((l) => (
          <LanguageRow key={l} l={l} selected={l === locale} busy={save.state === "saving" && save.to === l} onPick={() => pick(l)} />
        ))}
      </View>
      <SaveStatus
        save={save}
        onRetry={() => save.state === "failed" && store(save.to, save.from)}
        onRevert={() => {
          if (save.state !== "failed") return;
          setLocale(save.from);
          // The account already holds `from` when it was read from there; otherwise say so to it too.
          if (accountLocale === save.from) setSave({ state: "idle" });
          else store(save.from, save.from);
        }}
      />
    </>
  );
}

function Toggle({
  testID,
  title,
  note,
  value,
  onChange,
}: {
  testID: string;
  title: string;
  note: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  const theme = useTheme();
  const { gutter, stack } = useLayout();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="switch"
      accessibilityLabel={title}
      accessibilityState={{ checked: value }}
      onPress={() => onChange(!value)}
      style={({ pressed }) => [
        stack ? styles.toggleStacked : styles.row,
        { paddingHorizontal: gutter, borderBottomColor: theme.hair, borderLeftColor: "transparent" },
        pressed && styles.pressed,
      ]}
    >
      <View style={stack ? undefined : styles.fill}>
        <Txt variant="bodyLg">{title}</Txt>
        <Txt variant="caption" tone="subtle">
          {note}
        </Txt>
      </View>
      {/* Handoff 3c: square, like everything else — the knob's side and the accent fill say "on". */}
      <View
        style={[
          stack ? styles.trackLarge : styles.track,
          { borderColor: value ? theme.accent : theme.hair2, backgroundColor: value ? theme.accent : theme.s2 },
          value ? styles.trackOn : null,
        ]}
      >
        <View style={[stack ? styles.knobLarge : styles.knob, { backgroundColor: value ? theme.s0 : theme.inkSubtle }]} />
      </View>
    </Pressable>
  );
}

type Category = "rebirth" | "judgment" | "residence" | "chat";
const CATEGORIES: { key: Category; icon: IconName }[] = [
  { key: "rebirth", icon: "cycle" },
  { key: "judgment", icon: "ledger" },
  { key: "residence", icon: "info" },
  // New letters: a soul's message, a reply from the hall (`chat_message`, lands on the Conversation).
  { key: "chat", icon: "letter" },
];

/** The system permission, re-read whenever this page is shown or the app comes back from the system settings. */
function usePermission(): Permission | null {
  const [value, setValue] = useState<Permission | null>(null);
  const read = useCallback(() => {
    void permission().then(setValue);
  }, []);
  useFocusEffect(read);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => s === "active" && read());
    return () => sub.remove();
  }, [read]);
  return value;
}

function Notifications({ settings, onChange }: { settings: NotificationSettings; onChange: (patch: Partial<Record<Category, boolean>>) => void }) {
  const theme = useTheme();
  const { t } = useI18n();
  const { gutter } = useLayout();
  const navigation = useNavigation<NavigationProp<AppStackParams>>();
  const perm = usePermission();
  const available = easProjectId() !== null;
  return (
    <>
      {!available ? (
        <View style={[styles.notice, { paddingHorizontal: gutter }]}>
          <Notice tone="neutral" testID="push-unavailable">
            {t("soul_app.settings.push_unavailable")}
          </Notice>
        </View>
      ) : null}
      {perm === "denied" ? (
        <View testID="push-denied" style={[styles.notice, { paddingHorizontal: gutter }]}>
          <View style={[styles.denied, { borderColor: theme.hair2, borderLeftColor: theme.hair2, backgroundColor: theme.s1 }]}>
            <Txt variant="caption" tone="muted">
              {t("soul_app.settings.push_denied")}
            </Txt>
            <Button testID="open-system-settings" kind="secondary" title={`${t("soul_app.settings.open_system_settings")} ↗`} onPress={() => void Linking.openSettings()} />
          </View>
        </View>
      ) : null}
      {perm === "undetermined" && available ? (
        <View style={[styles.notice, { paddingHorizontal: gutter }]}>
          <Button testID="enable-push" kind="secondary" title={t("soul_app.settings.enable_push")} onPress={() => navigation.navigate("NotificationPrimer")} />
        </View>
      ) : null}
      {/* Denied: the switches dim to 55% but stay usable — the choice is remembered for when the system allows it. */}
      <View testID="push-toggles" style={perm === "denied" ? styles.dimmed : undefined}>
        {CATEGORIES.map(({ key }) => (
          <Toggle
            key={key}
            testID={`toggle-${key}`}
            title={t(`soul_app.settings.${key}`)}
            note={t(`soul_app.settings.${key}_note`)}
            value={settings[key] ?? true}
            onChange={(next) => onChange({ [key]: next })}
          />
        ))}
      </View>
      <Txt variant="caption" tone="subtle" style={[styles.foot, { paddingHorizontal: gutter }]}>
        {t("soul_app.settings.lock_screen")}
      </Txt>
    </>
  );
}

export function SettingsScreen() {
  const theme = useTheme();
  const { t } = useI18n();
  const toast = useToast();
  const askLogout = useAskLogout();
  const { state } = useSession();
  const { gutter } = useLayout();
  const remote = useRemote(soulApi.notificationSettings);
  // The last settings the SERVER confirmed; a toggle shows its new value at once and falls back on failure.
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const shown = settings ?? remote.data;
  if (state.status !== "signedIn") return null;
  const me = state.profile;

  const change = (patch: Partial<Record<Category, boolean>>) => {
    const before = shown;
    if (!before) return;
    setSettings({ ...before, ...patch });
    soulApi.updateNotificationSettings(patch).then(setSettings, () => {
      setSettings(before);
      toast(t("soul_app.settings.toggle_failed"), "failure");
    });
  };

  return (
    <Screen testID="settings">
      <View style={[styles.identity, { paddingHorizontal: gutter, borderBottomColor: theme.hair }]}>
        <View style={styles.nameRow}>
          <Txt variant="title">{me.name}</Txt>
          <Txt variant="value" tone="subtle" style={styles.code}>
            {me.soul_code}
          </Txt>
        </View>
        <View style={styles.civRow}>
          <Emblem civ={theme.civ} size={13} stroke={theme.mark} />
          <EnumValue namespace="souls.civilizations" value={me.civilization} tone="mark" variant="label" />
        </View>
      </View>

      <View style={[styles.group, { borderBottomColor: theme.hair }]}>
        <View style={{ paddingHorizontal: gutter }}>
          <Heading>{t("soul_app.settings.language")}</Heading>
        </View>
        <Language accountLocale={(shown?.locale as Locale | undefined) ?? null} onSaved={(locale) => shown && setSettings({ ...shown, locale })} />
        <Txt variant="caption" tone="subtle" style={[styles.foot, { paddingHorizontal: gutter }]}>
          {t("soul_app.settings.language_hint")}
        </Txt>
      </View>

      <View style={[styles.group, { borderBottomColor: theme.hair }]}>
        <View style={{ paddingHorizontal: gutter }}>
          <Heading>{t("soul_app.settings.notifications")}</Heading>
        </View>
        {shown ? (
          <Notifications settings={shown} onChange={change} />
        ) : remote.error ? (
          <SectionError testID="settings-error" onRetry={remote.reload} />
        ) : (
          // Handoff 4b: a thin skeleton, never a stale value that would then change.
          <Block last>
            <Skeleton lines={3} testID="settings-loading" />
          </Block>
        )}
      </View>

      <View style={[styles.end, { paddingHorizontal: gutter }]}>
        <EmblemDivider />
        <Button testID="logout" kind="secondary" title={t("soul_app.life.logout")} onPress={askLogout} style={styles.logout} />
        <Txt variant="value" tone="subtle" style={styles.version}>
          {t("soul_app.settings.version", { version: Constants.expoConfig?.version ?? "" })}
        </Txt>
      </View>
    </Screen>
  );
}

/**
 * Handoff 3c: explain what will be sent BEFORE the system dialog. "Yes" is the
 * only path to `requestPermissionsAsync`; "not now" leaves the system's one
 * chance unspent. Either way the primer is not offered again on its own — the
 * settings page keeps the way back.
 */
export function NotificationPrimerScreen() {
  const theme = useTheme();
  const { t } = useI18n();
  const { gutter } = useLayout();
  const navigation = useNavigation<NavigationProp<AppStackParams>>();
  const [busy, setBusy] = useState(false);
  const done = () => {
    platform().persistent.set(PRIMER_SEEN_KEY, "1");
    if (navigation.canGoBack()) navigation.goBack();
  };
  const yes = async () => {
    setBusy(true);
    if ((await requestPermission()) === "granted") await registerDevice();
    done();
  };
  return (
    <Screen testID="push-primer" edges={["top", "left", "right", "bottom"]}>
      <View style={[styles.primerHead, { paddingHorizontal: gutter, borderBottomColor: theme.hair }]}>
        <Icon name="info" size={26} color={theme.mark} strokeWidth={1.2} />
        <Txt variant="title" style={styles.center}>
          {t("soul_app.push.primer_title")}
        </Txt>
        <Txt variant="caption" tone="muted" style={styles.center}>
          {t("soul_app.push.primer_body")}
        </Txt>
      </View>
      <View style={[styles.primerList, { paddingHorizontal: gutter, borderBottomColor: theme.hair }]}>
        <Heading>{t("soul_app.push.will_notify")}</Heading>
        {CATEGORIES.map(({ key, icon }) => (
          <View key={key} style={styles.primerItem}>
            <View style={[styles.glyph, { borderColor: theme.mark }]}>
              <Icon name={icon} size={12} color={theme.mark} strokeWidth={1.3} />
            </View>
            <View style={styles.fill}>
              <Txt variant="bodyLg">{t(`soul_app.push.primer_${key}`)}</Txt>
              <Txt variant="caption" tone="subtle">
                {t(`soul_app.push.primer_${key}_note`)}
              </Txt>
            </View>
          </View>
        ))}
        <Hairline style={styles.primerRule} />
        <View style={styles.primerItem}>
          <View style={[styles.glyph, { borderColor: theme.hair2 }]}>
            <Txt variant="label" tone="subtle" style={styles.never}>
              ×
            </Txt>
          </View>
          <Txt variant="caption" tone="muted" style={styles.fill}>
            {t("soul_app.push.never")}
          </Txt>
        </View>
      </View>
      <Block last style={styles.primerButtons}>
        <Button testID="primer-yes" title={t("soul_app.push.yes")} onPress={() => void yes()} busy={busy} />
        <Button testID="primer-no" kind="secondary" title={t("soul_app.push.no")} onPress={done} />
      </Block>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { textAlign: "center" },
  pressed: { opacity: 0.8 },
  heading: { paddingTop: 22, paddingBottom: 10 },
  identity: { paddingVertical: GUTTER, borderBottomWidth: 1, gap: 6 },
  nameRow: { flexDirection: "row", alignItems: "baseline", flexWrap: "wrap", columnGap: 10 },
  code: { letterSpacing: 1.6 },
  civRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  group: { borderBottomWidth: 1 },
  row: { minHeight: 54, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderLeftWidth: 2 },
  toggleStacked: { gap: 10, paddingVertical: 14, borderBottomWidth: 1 },
  radio: { width: 16, height: 16, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  radioDot: { width: 8, height: 8 },
  current: { borderWidth: 1, paddingHorizontal: 6, paddingVertical: 1 },
  currentText: { fontSize: 10.5, letterSpacing: 0.4 },
  saveLine: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12, borderWidth: 1, borderLeftWidth: 2, paddingHorizontal: 12, paddingVertical: 10 },
  saveFailed: { marginTop: 12, borderWidth: 1, borderLeftWidth: 3, padding: 14, gap: 12 },
  saveRow: { flexDirection: "row", gap: 8 },
  saveActions: { flexDirection: "row", gap: 10 },
  foot: { paddingTop: 12, paddingBottom: 18 },
  track: { width: 44, height: 26, borderWidth: 1, padding: 2, justifyContent: "center" },
  trackLarge: { width: 58, height: 34, borderWidth: 1, padding: 3, justifyContent: "center" },
  trackOn: { alignItems: "flex-end" },
  knob: { width: 20, height: 20 },
  knobLarge: { width: 26, height: 26 },
  dimmed: { opacity: 0.55 },
  notice: { paddingBottom: 12 },
  denied: { borderWidth: 1, borderLeftWidth: 3, padding: 14, gap: 12 },
  end: { paddingTop: 26, paddingBottom: 34, gap: 16, alignItems: "stretch" },
  logout: { alignSelf: "center", minWidth: 160 },
  version: { textAlign: "center", fontSize: 11 },
  primerHead: { alignItems: "center", gap: 12, paddingTop: 34, paddingBottom: 26, borderBottomWidth: 1 },
  primerList: { paddingBottom: 18, borderBottomWidth: 1, gap: 14 },
  primerItem: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  primerRule: { marginVertical: 2 },
  glyph: { width: 18, height: 18, marginTop: 3, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  never: { fontSize: 11, lineHeight: 14, letterSpacing: 0 },
  primerButtons: { gap: 10 },
});
