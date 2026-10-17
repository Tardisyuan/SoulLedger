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
import { BCP47_FOR_LOCALE, LOCALE_LABELS, SUPPORTED_LOCALES, type Locale } from "@soulledger/core/config/locale";
import { platform } from "@soulledger/core/platform";
import { useFocusEffect, useNavigation, type NavigationProp } from "@react-navigation/native";
import Constants from "expo-constants";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking, Pressable, StyleSheet, View } from "react-native";

import { Emblem, Icon, type IconName } from "../emblems";
import { useAskLogout, useToast } from "../feedback";
import { translate, useI18n } from "../i18n";
import { PRIMER_SEEN_KEY, easProjectId, permission, registerDevice, requestPermission, type Permission } from "../push";
import { useSession } from "../session";
import {
  Block,
  Button,
  EnumValue,
  FieldError,
  GUTTER,
  Hairline,
  Loader,
  Notice,
  RadioMark,
  Screen,
  SectionLabel,
  SectionError,
  Skeleton,
  SwitchMark,
  Txt,
  useLayout,
  useReloadOnRefocus,
  useRemote,
  useTheme,
} from "../ui";
import type { AppStackParams } from "./applications";
import { formatSoulCode, spellSoulCode } from "@soulledger/core/domain/soulCode";
import { BioRow } from "./bio";

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
    <SectionLabel style={styles.heading}>
      {children}
    </SectionLabel>
  );
}

function LanguageRow({ l, selected, busy, onPick }: { l: Locale; selected: boolean; busy: boolean; onPick: () => void }) {
  const theme = useTheme();
  const { t } = useI18n();
  const { gutter, stack } = useLayout();
  // 「当前」 beside the text column beats it for width at large text and lands on the subtitle: stacked, it sits under the column instead.
  const current =
    selected && !busy ? (
      <View testID={`language-${l}-current`} style={[styles.current, stack && styles.currentStacked, { borderColor: theme.ink }]}>
        <Txt variant="label" style={styles.currentText}>
          {t("soul_app.settings.current")}
        </Txt>
      </View>
    ) : null;
  return (
    <Pressable
      testID={`language-${l}`}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      // The row reads the language's own name and note, so it is read in that language (iOS; Android has no such prop).
      accessibilityLanguage={BCP47_FOR_LOCALE[l]}
      onPress={onPick}
      style={({ pressed }) => [
        styles.row,
        { paddingHorizontal: gutter, borderBottomColor: theme.hair, borderLeftColor: selected ? theme.ink : "transparent" },
        pressed && styles.pressed,
      ]}
    >
      {/* 单选:墨色,不是强调色(第三类 F 组);v2 起是圆的(补足 A2),不再和复选框同形。 */}
      <RadioMark on={selected} />
      <View testID={`language-${l}-text`} style={styles.fill}>
        <Txt variant="bodyLg">{selfName(l)}</Txt>
        <Txt variant="caption" tone="subtle">
          {translate(l, "soul_app.settings.language_note")}
        </Txt>
        {stack ? current : null}
      </View>
      {busy ? <Loader testID="language-saving" size={20} /> : null}
      {stack ? null : current}
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
          <FieldError testID="language-save-failed" text={t("soul_app.settings.save_failed", { current: selfName(save.to), previous: selfName(save.from) })} />
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
  note?: string;
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
        {note ? (
          <Txt variant="caption" tone="subtle">
            {note}
          </Txt>
        ) : null}
      </View>
      {/* Handoff 3c: square, like everything else — the knob's side and the ink fill (补足 A1) say "on". */}
      <SwitchMark on={value} large={stack} />
    </Pressable>
  );
}

type Category = "rebirth" | "judgment" | "residence" | "chat" | "social_comments" | "social_review";
const CATEGORIES: { key: Category; icon: IconName }[] = [
  { key: "rebirth", icon: "cycle" },
  { key: "judgment", icon: "ledger" },
  { key: "residence", icon: "info" },
  // New letters: a soul's message, a reply from the hall (`chat_message`, lands on the Conversation).
  { key: "chat", icon: "letter" },
];

/**
 * 第四十批 S-c: the circle's own group under 推送 — comments and replies, review results. Hall warnings are listed
 * too but cannot be turned off (the server never files them under a category).
 */
const SOCIAL_CATEGORIES: { key: Category; title: string }[] = [
  { key: "social_comments", title: "soul_app.settings.push_comments" },
  { key: "social_review", title: "soul_app.settings.push_review" },
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
            <Button testID="open-system-settings" kind="secondary" title={`${t("soul_app.settings.open_system_settings")} ↗\uFE0E`} onPress={() => void Linking.openSettings()} />
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
        <View style={{ paddingHorizontal: gutter }}>
          <Heading>{t("soul_app.settings.push_social")}</Heading>
        </View>
        {SOCIAL_CATEGORIES.map(({ key, title }) => (
          <Toggle
            key={key}
            testID={`toggle-${key}`}
            title={t(title)}
            value={settings[key] ?? true}
            onChange={(next) => onChange({ [key]: next })}
          />
        ))}
        {/* 殿司警告: always on — shown so the soul knows it exists, as a state, not a switch. */}
        <View
          testID="toggle-warning-locked"
          accessible
          accessibilityRole="switch"
          accessibilityLabel={t("soul_app.settings.push_warning")}
          accessibilityState={{ checked: true, disabled: true }}
          style={[styles.row, { paddingHorizontal: gutter, borderBottomColor: theme.hair, borderLeftColor: "transparent" }]}
        >
          <View style={styles.fill}>
            <Txt variant="bodyLg">{t("soul_app.settings.push_warning")}</Txt>
            <Txt variant="caption" tone="subtle">
              {t("soul_app.settings.locked")}
            </Txt>
          </View>
          <View style={styles.dimmed}>
            <SwitchMark on />
          </View>
        </View>
      </View>
      <Txt variant="caption" tone="subtle" style={[styles.foot, { paddingHorizontal: gutter }]}>
        {t("soul_app.settings.lock_screen")}
      </Txt>
      <Pressable
        testID="open-history"
        accessibilityRole="button"
        onPress={() => navigation.navigate("NotificationHistory")}
        style={({ pressed }) => [
          styles.row,
          { paddingHorizontal: gutter, borderBottomColor: theme.hair, borderLeftColor: "transparent" },
          pressed && styles.pressed,
        ]}
      >
        <View style={styles.fill}>
          <Txt variant="bodyLg">{t("soul_app.settings.history")}</Txt>
          <Txt variant="caption" tone="subtle">
            {t("soul_app.settings.history_note")}
          </Txt>
        </View>
        <Icon name="chevron" size={14} color={theme.inkSubtle} />
      </Pressable>
    </>
  );
}

/**
 * One row of the grouped list (第十八批): 56 high, the name at the left, a state or nothing, then the chevron.
 * 账号安全 and 关于 are rows; language and notifications keep their inline controls under 偏好.
 */
function NavRow({ testID, label, state, bold, onPress }: { testID: string; label: string; state?: string | null; bold?: boolean; onPress: () => void }) {
  const theme = useTheme();
  const { gutter } = useLayout();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.navRow, { paddingHorizontal: gutter, borderBottomColor: theme.hair }, pressed && styles.pressed]}
    >
      <Txt variant="bodyLg" style={styles.fill}>
        {label}
      </Txt>
      {state ? (
        <Txt testID={`${testID}-state`} variant={bold ? "section" : "bodyLg"} tone={bold ? "ink" : "muted"}>
          {state}
        </Txt>
      ) : null}
      <Icon name="chevron" size={14} color={theme.inkSubtle} />
    </Pressable>
  );
}

/**
 * 联系邮箱 (第四十批 S-b): the address masked (first two, ***, the whole domain), 「更改 ›」 or 「添加 ›」, and under it
 * what the address is for. A hall that does it at the counter: no action, and the line under it says where to go.
 */
function EmailRow() {
  const theme = useTheme();
  const { t } = useI18n();
  const { gutter } = useLayout();
  const navigation = useNavigation<NavigationProp<AppStackParams>>();
  const email = useRemote(soulApi.contactEmail);
  useReloadOnRefocus(email.reload);
  const d = email.data;
  if (!d) return null;
  const action = d.can_change ? t(d.email_masked ? "soul_app.settings.email_change" : "soul_app.settings.email_add") : null;
  const body = (
    <>
      <View style={styles.fill}>
        <Txt variant="bodyLg">{t("soul_app.settings.email")}</Txt>
        <Txt testID="email-masked" variant={d.email_masked ? "value" : "caption"} tone="muted">
          {d.email_masked || t("soul_app.settings.email_none")}
        </Txt>
      </View>
      {action ? (
        <Txt testID="email-action" variant="body">
          {`${action} ›`}
        </Txt>
      ) : null}
    </>
  );
  return (
    <>
      {action ? (
        <Pressable
          testID="open-contact-email"
          accessibilityRole="button"
          onPress={() => navigation.navigate("ContactEmail")}
          style={({ pressed }) => [styles.emailRow, { paddingHorizontal: gutter, borderBottomColor: theme.hair }, pressed && styles.pressed]}
        >
          {body}
        </Pressable>
      ) : (
        <View testID="open-contact-email" style={[styles.emailRow, { paddingHorizontal: gutter, borderBottomColor: theme.hair }]}>
          {body}
        </View>
      )}
      <Txt testID="email-hint" variant="caption" tone="subtle" style={[styles.emailHint, { paddingHorizontal: gutter }]}>
        {t(d.can_change ? "soul_app.settings.email_hint" : "soul_app.settings.email_in_person")}
      </Txt>
    </>
  );
}

function GroupLabel({ children, testID }: { children: string; testID?: string }) {
  const { gutter } = useLayout();
  return (
    <View style={[styles.groupLabel, { paddingHorizontal: gutter }]}>
      <Txt testID={testID} accessibilityRole="header" variant="section">
        {children}
      </Txt>
    </View>
  );
}

export function SettingsScreen() {
  const theme = useTheme();
  const { t } = useI18n();
  const toast = useToast();
  const askLogout = useAskLogout();
  const { state } = useSession();
  const { gutter } = useLayout();
  const navigation = useNavigation<NavigationProp<AppStackParams>>();
  const remote = useRemote(soulApi.notificationSettings);
  // Where 两步验证 stands, for the 账号安全 row; read again whenever this page is shown (the wizard and the
  // management page both come back here).
  const mfa = useRemote(soulApi.mfaStatus);
  useReloadOnRefocus(mfa.reload);
  // The device count for 登录设备与记录; the sub-page's 「退出」 changes it, so it is read again on return.
  const devices = useRemote(soulApi.signInSessions);
  useReloadOnRefocus(devices.reload);
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
        <Txt variant="title">{me.name}</Txt>
        <View style={styles.civRow}>
          <Emblem civ={theme.civ} size={13} stroke={theme.inkMuted} />
          <EnumValue namespace="souls.civilizations" value={me.civilization} tone="muted" variant="label" />
        </View>
      </View>

      <GroupLabel testID="group-prefs">{t("soul_app.settings.group_prefs")}</GroupLabel>
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

      <GroupLabel testID="group-security">{t("soul_app.settings.group_security")}</GroupLabel>
      <View style={[styles.rows, { borderTopColor: theme.hair }]}>
        <NavRow testID="open-change-password" label={t("profile.change_password")} onPress={() => navigation.navigate("AccountPassword")} />
        <NavRow
          testID="open-mfa"
          label={t("officer_app.mfa.title")}
          state={mfa.data ? t(mfa.data.enabled ? "soul_app.settings.mfa_on" : "soul_app.settings.mfa_off") : null}
          bold={mfa.data?.enabled === true}
          onPress={() => navigation.navigate("Mfa")}
        />
        <BioRow />
        <NavRow
          testID="open-sign-ins"
          label={t("soul_app.security.history")}
          state={devices.data ? String(devices.data.length) : null}
          onPress={() => navigation.navigate("SignIns")}
        />
        <EmailRow />
      </View>
      {/* 第二十八批 S3: its own section under 账号安全, one row. */}
      <GroupLabel testID="group-data">{t("soul_app.settings.group_data")}</GroupLabel>
      <View style={[styles.rows, { borderTopColor: theme.hair }]}>
        <NavRow testID="open-export" label={t("soul_app.export.title")} onPress={() => navigation.navigate("DataExport")} />
      </View>
      {/* 第二十八批 S5: the bottom section; feedback is reached from the help page, not from a row of its own.
          关于 sits in it, under 帮助: on its own it was an unlabelled block between two labelled ones (seen on the simulator 2026-10-15). */}
      <GroupLabel testID="group-help">{t("soul_app.settings.group_help")}</GroupLabel>
      <View style={[styles.rows, { borderTopColor: theme.hair }]}>
        <NavRow testID="open-help" label={t("soul_app.help.title")} onPress={() => navigation.navigate("Help")} />
        <NavRow testID="open-about" label={t("about.title")} onPress={() => navigation.navigate("About")} />
      </View>

      <View style={[styles.end, { paddingHorizontal: gutter }]}>
        <Button testID="logout" kind="secondary" title={t("soul_app.life.logout")} onPress={askLogout} style={styles.logout} />
        <Txt testID="settings-soul-code" variant="body" tone="muted" style={styles.version} accessibilityLabel={t("soul_app.login.id_aria", { spelled: spellSoulCode(me.soul_code) })}>
          {`${t("soul_app.login.soul_code")} `}
          <Txt variant="value" tone="muted">
            {formatSoulCode(me.soul_code)}
          </Txt>
        </Txt>
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
        <Icon name="info" size={26} color={theme.inkSubtle} strokeWidth={1.2} />
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
            <View style={[styles.glyph, { borderColor: theme.inkSubtle }]}>
              <Icon name={icon} size={12} color={theme.inkMuted} strokeWidth={1.3} />
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
  fill: { flex: 1, minWidth: 0 },
  center: { textAlign: "center" },
  pressed: { opacity: 0.8 },
  heading: { paddingTop: 24, paddingBottom: 12 },
  identity: { paddingVertical: GUTTER, borderBottomWidth: 1, gap: 8 },
  civRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  group: { borderBottomWidth: 1 },
  row: { minHeight: 54, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderLeftWidth: 2 },
  toggleStacked: { gap: 12, paddingVertical: 16, borderBottomWidth: 1 },
  current: { borderWidth: 1, paddingHorizontal: 8, paddingVertical: 2, flexShrink: 0 },
  currentStacked: { alignSelf: "flex-start", marginTop: 4 },
  currentText: { fontSize: 11, letterSpacing: 0.4 },
  saveLine: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12, borderWidth: 1, borderLeftWidth: 2, paddingHorizontal: 12, paddingVertical: 12 },
  saveFailed: { marginTop: 12, borderWidth: 1, borderLeftWidth: 3, padding: 16, gap: 12 },
  saveRow: { flexDirection: "row", gap: 8 },
  saveActions: { flexDirection: "row", gap: 12 },
  foot: { paddingTop: 12, paddingBottom: 16 },
  dimmed: { opacity: 0.55 },
  notice: { paddingBottom: 12 },
  denied: { borderWidth: 1, borderLeftWidth: 3, padding: 16, gap: 12 },
  end: { paddingTop: 24, paddingBottom: 32, gap: 16, alignItems: "stretch" },
  groupLabel: { paddingTop: 24, paddingBottom: 8 },
  rows: { borderTopWidth: 1 },
  navRow: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 8, borderBottomWidth: 1 },
  emailRow: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, borderBottomWidth: 1 },
  emailHint: { paddingTop: 6, paddingBottom: 4 },
  logout: { alignSelf: "center", minWidth: 160 },
  version: { textAlign: "center", fontSize: 11 },
  primerHead: { alignItems: "center", gap: 12, paddingTop: 32, paddingBottom: 24, borderBottomWidth: 1 },
  primerList: { paddingBottom: 16, borderBottomWidth: 1, gap: 16 },
  primerItem: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  primerRule: { marginVertical: 2 },
  glyph: { width: 18, height: 18, marginTop: 4, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  never: { fontSize: 11, lineHeight: 14, letterSpacing: 0 },
  primerButtons: { gap: 12 },
});
