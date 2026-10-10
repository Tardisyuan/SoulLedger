/**
 * 两步验证 for the soul (设计 第十八批): the settings row's state, the three-step wizard, the management
 * page, the two confirmation sheets. The sign-in side (the second step, the lost-phone page) is `loginMfa.tsx`.
 *
 * THE RULES THIS SCREEN KEEPS
 *   自愿 -- nothing here nags; the settings row says 「○ 未开启」 and that is all.
 *   Step ③ shows the ten recovery codes ONCE. They live in this component's state and nowhere else: not the
 *   session, not a store, not a navigation param, not a log line; they go with the unmount. Step ③ cannot be
 *   left until the box is ticked and 「完成」 pressed: the iOS swipe is off (`gestureEnabled`), the Android key
 *   and the header have no way out (`beforeRemove` refuses), and a deep link or a tapped notification waits
 *   (`holdNavigation`) instead of dragging the soul off the page.
 *   "存为文件" is not here: saving a file needs a file-system / sharing module this App does not ship, and a
 *   new native module is a new dev client. Copy-all and long-press selection are the two ways out.
 *   The key is shown in groups of four, four groups to a line, as one selectable string (the officer app's way);
 *   the QR code is skipped -- a camera cannot scan its own screen -- and `otpauth://` opens the authenticator.
 */
import { soulApi, soulErrorMessage, soulMfaFailure, type SoulMfaStatus } from "@soulledger/core/api/soul";
import { useNavigation, type NavigationProp } from "@react-navigation/native";
import * as Clipboard from "expo-clipboard";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { KeyboardAvoidingView, Linking, Pressable, ScrollView, StyleSheet, View } from "react-native";

import { Icon } from "../emblems";
import { AppHeader } from "../chrome";
import { useToast } from "../feedback";
import { family } from "../fonts";
import { useI18n } from "../i18n";
import { holdNavigation } from "../navLock";
import { secretLines, stateOfFailure, type StepState } from "../mfa";
import { formatStamp } from "../rules";
import { Button, Input, Interp, Notice, Screen, ScreenError, Skeleton, Txt, useRemote, useTheme } from "../ui";
import type { AppStackParams } from "./applications";
import { ButtonPair, CheckRow, CoverRule, DigitField, Heading, MfaSheet, StepNotice, TextLink } from "./mfaParts";

/**
 * Step ③ and the regenerated set: no way out but 「完成」. Returns `allowLeave()` -- call it before leaving on purpose.
 * `active` false (the codes are gone) releases everything.
 */
function useCodesGuard(active: boolean): () => void {
  const navigation = useNavigation();
  const allow = useRef(false);
  useEffect(() => {
    if (!active) return;
    allow.current = false;
    const release = holdNavigation();
    navigation.setOptions({ gestureEnabled: false });
    const off = navigation.addListener("beforeRemove", (event) => {
      if (!allow.current) event.preventDefault();
    });
    return () => {
      off();
      release();
      navigation.setOptions({ gestureEnabled: true });
    };
  }, [active, navigation]);
  return useCallback(() => {
    allow.current = true;
  }, []);
}

// ── wizard header ────────────────────────────────────────────────────────

function WizardHeader({ step, onClose }: { step: 1 | 2 | 3; onClose?: () => void }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  return (
    <View>
      <CoverRule />
      <View style={[styles.bar, { backgroundColor: t.s1, borderBottomColor: t.hair }]}>
        {onClose ? (
          <Pressable
            testID="wizard-close"
            accessibilityRole="button"
            accessibilityLabel={tr("soul_app.mfa.setup.exit_note")}
            onPress={onClose}
            style={styles.closeHit}
          >
            <Icon name="close" size={16} color={t.ink} strokeWidth={1.4} />
          </Pressable>
        ) : (
          <View style={styles.closeGap} />
        )}
        <Txt accessibilityRole="header" style={styles.barTitle}>
          {tr("soul_app.mfa.setup.title")}
        </Txt>
        <Txt testID="wizard-step" variant="value" tone="muted" style={styles.stepText}>
          {`${step} / 3`}
        </Txt>
      </View>
    </View>
  );
}

function WizardFooter({ label, note, onPress, disabled, busy, testID }: { label: string; note: string; onPress: () => void; disabled?: boolean; busy?: boolean; testID: string }) {
  const t = useTheme();
  return (
    <View style={[styles.footer, { backgroundColor: t.s1, borderTopColor: t.hair }]}>
      <Button testID={testID} title={label} onPress={onPress} disabled={disabled} busy={busy} />
      <Txt variant="caption" tone="muted" style={styles.footNote}>
        {note}
      </Txt>
    </View>
  );
}

// ── the ten codes (step ③ and the regenerated set) ───────────────────────

function CodesPage({ codes, onDone, header, ownTop }: { codes: string[]; onDone: () => void; header: ReactNode; ownTop: boolean }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const toast = useToast();
  const [saved, setSaved] = useState(false);
  const allowLeave = useCodesGuard(true);

  const copyAll = () =>
    Clipboard.setStringAsync(codes.join("\n")).then(
      () => toast(tr("soul_app.mfa.copied")),
      () => toast(tr("soul_app.life.code_copy_failed"), "failure")
    );
  const done = () => {
    allowLeave();
    onDone();
  };

  return (
    <Screen scroll={false} edges={ownTop ? ["top", "left", "right", "bottom"] : ["left", "right", "bottom"]} testID="mfa-codes">
      {header}
      <KeyboardAvoidingView behavior="padding" style={styles.fill}>
        <ScrollView style={{ backgroundColor: t.s1 }} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
          <Heading>{tr("soul_app.mfa.codes.title")}</Heading>
          <Txt variant="bodyLg">{tr("soul_app.mfa.codes.body")}</Txt>
          <View testID="recovery-codes" style={[styles.codes, { backgroundColor: t.s0, borderColor: t.hair }]}>
            {codes.map((code, i) => (
              <Txt key={i} testID={`recovery-code-${i}`} selectable style={styles.code}>
                {code}
              </Txt>
            ))}
          </View>
          <Button testID="codes-copy" kind="secondary" title={tr("soul_app.mfa.codes.copy_all")} onPress={() => void copyAll()} />
          <CheckRow testID="codes-confirm" on={saved} onToggle={() => setSaved((v) => !v)}>
            {tr("soul_app.mfa.codes.confirm")}
          </CheckRow>
        </ScrollView>
        <WizardFooter testID="codes-done" label={tr("soul_app.mfa.codes.done")} note={tr("soul_app.mfa.codes.no_back")} onPress={done} disabled={!saved} />
      </KeyboardAvoidingView>
    </Screen>
  );
}

// ── the wizard ───────────────────────────────────────────────────────────

function Wizard({ onExit, onEnabled }: { onExit: () => void; onEnabled: () => void }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const toast = useToast();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [setup, setSetup] = useState<{ secret: string; otpauth_url: string } | null>(null);
  const [setupFailed, setSetupFailed] = useState<{ key: string; params?: Record<string, string> } | null>(null);
  const [openFailed, setOpenFailed] = useState(false);
  const [code, setCode] = useState("");
  const [bind, setBind] = useState<StepState>({ kind: "idle" });
  const [codes, setCodes] = useState<string[]>([]);
  const requested = useRef(false);
  const finished = useRef(false);

  // Leaving before the codes are shown drops the unconfirmed secret server-side (best effort).
  useEffect(
    () => () => {
      if (requested.current && !finished.current) void soulApi.mfaCancelSetup().catch(() => {});
    },
    []
  );

  // A new secret is asked for once, when step 2 first appears; going back and forth does not change it.
  useEffect(() => {
    if (step !== 2 || requested.current) return;
    requested.current = true;
    soulApi.mfaSetup().then(setSetup, (e: unknown) => {
      requested.current = false;
      setSetupFailed(soulErrorMessage(e));
    });
  }, [step]);

  const retrySetup = () => {
    setSetupFailed(null);
    requested.current = true;
    soulApi.mfaSetup().then(setSetup, (e: unknown) => {
      requested.current = false;
      setSetupFailed(soulErrorMessage(e));
    });
  };

  const openAuthenticator = () => {
    if (!setup) return;
    setOpenFailed(false);
    Linking.openURL(setup.otpauth_url).catch(() => setOpenFailed(true));
  };

  const copyKey = () => {
    if (!setup) return;
    void Clipboard.setStringAsync(setup.secret).then(
      () => toast(tr("soul_app.mfa.copied")),
      () => toast(tr("soul_app.life.code_copy_failed"), "failure")
    );
  };

  const verify = async () => {
    if (code.length !== 6 || bind.kind === "busy") return;
    setBind({ kind: "busy" });
    try {
      const list = await soulApi.mfaConfirm(code);
      finished.current = true;
      setCodes(list);
      setCode("");
      setBind({ kind: "idle" });
      setStep(3);
    } catch (e) {
      setBind(stateOfFailure(soulMfaFailure(e)));
    }
  };

  if (step === 3) {
    return (
      <CodesPage
        codes={codes}
        ownTop
        header={<WizardHeader step={3} />}
        onDone={() => {
          setCodes([]);
          onEnabled();
        }}
      />
    );
  }

  const wrong = bind.kind === "wrong";
  return (
    <Screen scroll={false} edges={["top", "left", "right", "bottom"]} testID="mfa-wizard">
      <WizardHeader step={step} onClose={onExit} />
      <KeyboardAvoidingView behavior="padding" style={styles.fill}>
        <ScrollView style={{ backgroundColor: t.s1 }} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
          {step === 1 ? (
            <>
              <Heading>{tr("soul_app.mfa.intro.title")}</Heading>
              <Txt variant="bodyLg">{tr("soul_app.mfa.intro.body")}</Txt>
              <View style={[styles.aside, { borderColor: t.inkSubtle, backgroundColor: t.s0 }]}>
                <Txt variant="bodyLg" style={styles.bold}>
                  {tr("soul_app.mfa.intro.no_app_title")}
                </Txt>
                <Txt variant="bodyLg">{tr("soul_app.mfa.intro.no_app_body")}</Txt>
              </View>
              <View style={styles.why}>
                <Txt aria-hidden style={styles.diamond}>
                  ◇
                </Txt>
                <Txt variant="body" tone="muted" style={styles.fill}>
                  {tr("soul_app.mfa.intro.why")}
                </Txt>
              </View>
            </>
          ) : (
            <>
              <Heading>{tr("soul_app.mfa.bind.title")}</Heading>
              <View style={styles.section}>
                <Txt variant="body" tone="muted" style={styles.bold}>
                  {tr("soul_app.mfa.bind.add")}
                </Txt>
                {setupFailed ? (
                  <Notice tone="neg" testID="setup-failed" onRetry={retrySetup}>
                    {tr(setupFailed.key, setupFailed.params)}
                  </Notice>
                ) : setup ? (
                  <>
                    <Button testID="open-authenticator" title={`${tr("soul_app.mfa.bind.open")}︎`} onPress={openAuthenticator} />
                    {openFailed ? (
                      <Notice tone="neutral" testID="open-failed">
                        {tr("officer_app.mfa.open_failed")}
                      </Notice>
                    ) : null}
                    <Txt variant="body" tone="muted">
                      {tr("soul_app.mfa.bind.manual")}
                    </Txt>
                    <View style={[styles.keyBox, { borderColor: t.inkSubtle, backgroundColor: t.s0 }]}>
                      <Txt testID="secret-key" selectable style={styles.key}>
                        {secretLines(setup.secret).join("\n")}
                      </Txt>
                      <Pressable testID="copy-key" accessibilityRole="button" onPress={copyKey} style={styles.copyHit}>
                        <Txt variant="bodyLg" style={styles.bold}>
                          {tr("soul_app.mfa.bind.copy")}
                        </Txt>
                      </Pressable>
                    </View>
                    <Txt variant="caption" tone="muted">
                      {tr("soul_app.mfa.bind.select_hint")}
                    </Txt>
                  </>
                ) : (
                  <Skeleton lines={3} testID="setup-loading" />
                )}
              </View>
              <View style={[styles.rule, { backgroundColor: t.hair }]} />
              <DigitField
                testID="bind-code"
                label={tr("soul_app.mfa.bind.code_label", { app: tr("soul_app.app_name") })}
                value={code}
                onChange={(next) => {
                  setCode(next);
                  if (bind.kind !== "busy") setBind({ kind: "idle" });
                }}
                locked={bind.kind === "busy"}
                invalid={wrong}
              />
              {wrong ? (
                <Txt testID="bind-wrong" accessibilityRole="alert" variant="body" style={[styles.bold, { color: t.negInk }]}>
                  {tr("soul_app.mfa.bind.wrong")}
                </Txt>
              ) : (
                <StepNotice state={bind} />
              )}
            </>
          )}
        </ScrollView>
        {step === 1 ? (
          <WizardFooter testID="intro-next" label={tr("soul_app.mfa.intro.next")} note={tr("soul_app.mfa.setup.exit_note")} onPress={() => setStep(2)} />
        ) : (
          <WizardFooter
            testID="bind-next"
            label={tr(bind.kind === "busy" ? "soul_app.mfa.login.sending" : "soul_app.mfa.bind.next")}
            note={tr("soul_app.mfa.setup.exit_note")}
            onPress={() => void verify()}
            disabled={code.length !== 6 || !setup}
            busy={bind.kind === "busy"}
          />
        )}
      </KeyboardAvoidingView>
    </Screen>
  );
}

// ── management ───────────────────────────────────────────────────────────

function Fact({ label, children }: { label: string; children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={[styles.fact, { borderTopColor: t.hair }]}>
      <Txt variant="caption" tone="muted">
        {label}
      </Txt>
      {children}
    </View>
  );
}

type Asking = "disable" | "regen" | null;

function Manage({ status, onBack, onRegenerated, onDisabled }: { status: SoulMfaStatus; onBack: () => void; onRegenerated: (codes: string[]) => void; onDisabled: () => void }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const [asking, setAsking] = useState<Asking>(null);
  const [method, setMethod] = useState<"totp" | "password">("totp");
  const [digits, setDigits] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<StepState>({ kind: "idle" });
  const busy = state.kind === "busy";
  const left = status.recovery_codes_remaining;

  const close = () => {
    if (busy) return;
    setAsking(null);
    setMethod("totp");
    setDigits("");
    setPassword("");
    setState({ kind: "idle" });
  };

  const regenerate = async () => {
    setState({ kind: "busy" });
    try {
      const codes = await soulApi.mfaRegenerate();
      setAsking(null);
      setState({ kind: "idle" });
      onRegenerated(codes);
    } catch (e) {
      setState(stateOfFailure(soulMfaFailure(e)));
    }
  };

  const disable = async () => {
    setState({ kind: "busy" });
    try {
      await soulApi.mfaDisable(method === "totp" ? { method: "totp", code: digits } : { method: "password", password });
      setPassword("");
      setDigits("");
      onDisabled();
    } catch (e) {
      setState(stateOfFailure(soulMfaFailure(e)));
    }
  };

  const used = status.last_used_at ? formatStamp(status.last_used_at) : null;
  const via = status.last_used_method === "recovery" ? tr("officer_app.mfa.recovery_label") : tr("soul_app.mfa.manage.via_code");

  return (
    <Screen scroll={false} testID="mfa-manage">
      <AppHeader title={tr("officer_app.mfa.title")} onBack={onBack} />
      <ScrollView contentContainerStyle={styles.manage}>
        <View style={[styles.panel, { backgroundColor: t.s1, borderColor: t.hair }]}>
          <View testID="mfa-on" style={[styles.tag, { borderColor: t.ink }]}>
            <Txt style={styles.tagText}>{tr("soul_app.settings.mfa_on")}</Txt>
          </View>
          <Txt variant="body" tone="muted" style={styles.panelBody}>
            {tr("soul_app.mfa.manage.body")}
          </Txt>
          <Fact label={tr("soul_app.mfa.manage.enabled_at")}>
            <Txt testID="mfa-enabled-at" style={styles.mono}>{formatStamp(status.confirmed_at) ?? "—"}</Txt>
          </Fact>
          <Fact label={tr("soul_app.mfa.manage.last_used")}>
            {used ? (
              <Txt testID="mfa-last-used">
                <Txt style={styles.mono}>{used}</Txt>
                {` · ${via}`}
              </Txt>
            ) : (
              <Txt testID="mfa-last-used" tone="muted">—</Txt>
            )}
          </Fact>
          <View style={[styles.fact, styles.factRow, { borderTopColor: t.hair }]}>
            <Interp
              testID="mfa-codes-left"
              variant="bodyLg"
              style={styles.fill}
              text={tr("soul_app.mfa.manage.codes_left")}
              parts={{ n: <Txt style={styles.mono}>{String(left)}</Txt> }}
            />
            <TextLink testID="mfa-regen" title={tr("soul_app.mfa.manage.regen")} onPress={() => setAsking("regen")} />
          </View>
          {left <= 2 ? (
            <View testID="mfa-low" accessibilityRole="alert" style={[styles.low, { borderColor: t.warn, backgroundColor: t.s0 }]}>
              <Txt style={styles.bold} accessibilityElementsHidden importantForAccessibility="no">
                ◐
              </Txt>
              <Txt variant="bodyLg" style={styles.fill}>
                {tr("soul_app.mfa.manage.low", { n: String(left) })}
              </Txt>
            </View>
          ) : null}
        </View>
        <TextLink testID="mfa-disable" title={tr("soul_app.mfa.manage.disable")} onPress={() => setAsking("disable")} />
        <Txt variant="body" tone="muted">
          {tr("soul_app.mfa.manage.new_phone")}
        </Txt>
      </ScrollView>

      <MfaSheet testID="regen-sheet" open={asking === "regen"} onClose={close} closeLabel={tr("soul_app.common.cancel")}>
        <Txt accessibilityRole="header" style={styles.sheetTitle}>
          {tr("soul_app.mfa.regen.title")}
        </Txt>
        <Txt variant="bodyLg">{tr("soul_app.mfa.regen.body", { n: String(left) })}</Txt>
        <StepNotice state={state} />
        <ButtonPair>
          <Button testID="regen-cancel" kind="secondary" title={tr("soul_app.common.cancel")} onPress={close} disabled={busy} style={styles.fill} />
          <Button testID="regen-confirm" title={tr("soul_app.mfa.manage.regen")} onPress={() => void regenerate()} busy={busy} style={styles.fill} />
        </ButtonPair>
      </MfaSheet>

      <MfaSheet testID="disable-sheet" open={asking === "disable"} onClose={close} closeLabel={tr("soul_app.common.cancel")}>
        <Txt accessibilityRole="header" style={styles.sheetTitle}>
          {tr("soul_app.mfa.disable.title")}
        </Txt>
        <Txt variant="bodyLg">{tr("soul_app.mfa.disable.body")}</Txt>
        <StepNotice state={state} password={method === "password"} />
        {method === "totp" ? (
          <>
            <DigitField
              testID="disable-code"
              label={tr("soul_app.mfa.login.code_label")}
              value={digits}
              onChange={(next) => {
                setDigits(next);
                if (!busy) setState({ kind: "idle" });
              }}
              locked={busy || state.kind === "locked"}
            />
            <TextLink
              testID="disable-use-password"
              title={tr("soul_app.mfa.disable.use_password")}
              onPress={() => {
                setMethod("password");
                setState({ kind: "idle" });
              }}
            />
          </>
        ) : (
          <>
            <Input
              testID="disable-password"
              label={tr("soul_app.login.password")}
              value={password}
              onChangeText={(next) => {
                setPassword(next);
                if (!busy) setState({ kind: "idle" });
              }}
              editable={!busy && state.kind !== "locked"}
              secureTextEntry
              textContentType="password"
              autoComplete="current-password"
              secureToggle={{ show: tr("soul_app.common.show"), hide: tr("soul_app.common.hide") }}
            />
            <TextLink
              testID="disable-use-code"
              title={tr("soul_app.mfa.login.use_code")}
              onPress={() => {
                setMethod("totp");
                setState({ kind: "idle" });
              }}
            />
          </>
        )}
        <ButtonPair>
          <Button testID="disable-cancel" kind="secondary" title={tr("soul_app.common.cancel")} onPress={close} disabled={busy} style={styles.fill} />
          <Button
            testID="disable-confirm"
            kind="danger"
            title={tr("soul_app.mfa.disable.ok")}
            onPress={() => void disable()}
            busy={busy}
            disabled={state.kind === "locked" || (method === "totp" ? digits.length !== 6 : !password)}
            style={styles.fill}
          />
        </ButtonPair>
      </MfaSheet>
    </Screen>
  );
}

// ── the route ────────────────────────────────────────────────────────────

/** Off: the wizard. On: the management page. `fresh` is the regenerated set, shown once like step ③. */
export function MfaScreen() {
  const navigation = useNavigation<NavigationProp<AppStackParams>>();
  const { t } = useI18n();
  const status = useRemote(soulApi.mfaStatus);
  const [fresh, setFresh] = useState<string[] | null>(null);
  const [justEnabled, setJustEnabled] = useState(false);

  const back = useCallback(() => {
    if (navigation.canGoBack()) navigation.goBack();
  }, [navigation]);

  if (fresh) {
    return (
      <CodesPage
        codes={fresh}
        ownTop={false}
        header={<AppHeader title={t("soul_app.mfa.codes.title")} />}
        onDone={() => {
          setFresh(null);
          void status.reload();
        }}
      />
    );
  }

  if (!status.data) {
    return (
      <Screen scroll={false} testID="mfa-loading">
        <AppHeader title={t("officer_app.mfa.title")} onBack={back} />
        {status.error ? (
          <ScreenError error={soulErrorMessage(status.error)} onRetry={() => void status.reload()} />
        ) : (
          <View style={styles.manage}>
            <Skeleton lines={5} testID="mfa-skeleton" />
          </View>
        )}
      </Screen>
    );
  }

  if (!status.data.enabled && !justEnabled) {
    return (
      <Wizard
        onExit={back}
        onEnabled={() => {
          setJustEnabled(true);
          void status.reload();
        }}
      />
    );
  }

  // Just enabled: the management page shows as soon as the status says so (a beat of the skeleton until then).
  if (!status.data.enabled) {
    return (
      <Screen scroll={false} testID="mfa-loading">
        <AppHeader title={t("officer_app.mfa.title")} onBack={back} />
        <View style={styles.manage}>
          <Skeleton lines={5} />
        </View>
      </Screen>
    );
  }

  return (
    <Manage
      status={status.data}
      onBack={back}
      onRegenerated={setFresh}
      onDisabled={() => {
        // Off again: the settings row (re-read on focus) says 「○ 未开启」; the soul lands back there, not in the wizard.
        back();
      }}
    />
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  bold: { fontFamily: family.ui[600] },
  mono: { fontFamily: family.mono[400] },
  bar: { height: 56, flexDirection: "row", alignItems: "center", gap: 4, paddingRight: 16, paddingLeft: 4, borderBottomWidth: 1 },
  closeHit: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  closeGap: { width: 12 },
  barTitle: { fontFamily: family.ui[600], fontSize: 17, lineHeight: 24 },
  stepText: { marginLeft: "auto" },
  page: { padding: 16, paddingTop: 24, gap: 16 },
  footer: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16, borderTopWidth: 1, gap: 8 },
  footNote: { textAlign: "center" },
  aside: { borderWidth: 1, padding: 16, gap: 4 },
  why: { flexDirection: "row", gap: 12, alignItems: "baseline" },
  diamond: { width: 16 },
  section: { gap: 12 },
  rule: { height: 1 },
  keyBox: { minHeight: 72, borderWidth: 1, flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, paddingLeft: 12, paddingRight: 4 },
  key: { flex: 1, fontFamily: family.mono[500], fontSize: 17, lineHeight: 28, letterSpacing: 1 },
  copyHit: { minHeight: 44, paddingHorizontal: 12, justifyContent: "center" },
  codes: { borderWidth: 1, paddingVertical: 12, paddingHorizontal: 16, flexDirection: "row", flexWrap: "wrap", columnGap: 16 },
  code: { width: "46%", fontFamily: family.mono[500], fontSize: 17, lineHeight: 32, letterSpacing: 0.7 },
  manage: { padding: 16, gap: 16 },
  panel: { borderWidth: 1, padding: 16 },
  tag: { alignSelf: "flex-start", height: 24, paddingHorizontal: 8, marginBottom: 8, justifyContent: "center", borderWidth: 1 },
  tagText: { fontFamily: family.ui[600], fontSize: 12, lineHeight: 16 },
  panelBody: { marginBottom: 12 },
  fact: { minHeight: 56, justifyContent: "center", borderTopWidth: 1 },
  factRow: { flexDirection: "row", alignItems: "center" },
  low: { flexDirection: "row", gap: 12, padding: 12, borderWidth: 1, marginTop: 8 },
  sheetTitle: { fontFamily: family.ui[600], fontSize: 20, lineHeight: 28 },
});
