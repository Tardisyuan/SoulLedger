/**
 * 两步验证: turn it on (a four-step wizard, as the web's MfaSetupWizard), see its state, regenerate
 * the recovery codes, turn it off.
 *
 * ON A PHONE the QR code is skipped -- a camera cannot scan its own screen. The key is shown as
 * selectable text and `otpauth://` opens the authenticator app. There is no clipboard module in this
 * app (adding one is a native change and a new dev client), so "copy" is a long-press selection.
 *
 * Only step 4's 完成 turns it on; leaving earlier drops the unconfirmed secret server-side
 * (`cancelSetup`, also on unmount). The RECOVERY CODES live in this component's state and nowhere
 * else: not in the session, a store, a log line or a navigation param, and they go with the unmount.
 * Step 4 cannot be left until the officer has ticked 「我已妥善保存」 and pressed 完成.
 */
import { mfaApi, type MfaSetupResponse, type MfaStatus } from "@soulledger/core/api/auth";
import { useCallback, useEffect, useRef, useState } from "react";
import { Linking, TextInput, View } from "react-native";

import { ActionButton, Segmented } from "../kit";
import { mfaManageFailureKey } from "../rules";
import { useSession } from "../session";
import { Button, FieldError, Input, Notice, Txt, family, space, useI18n, useRemote, useTheme, useToast } from "../shared";
import { AccountFrame } from "./account";

const STEPS = 4;

/** 密钥四位一组、组间一格、每行四组(16 位),手抄用。仍是一整串文字,长按选中整串。 */
const groupKey = (secret: string) =>
  (secret.match(/.{1,4}/g) ?? [])
    .map((g, i) => (i === 0 ? g : i % 4 === 0 ? `\n${g}` : ` ${g}`))
    .join("");
const digits = (s: string) => s.replace(/\D/g, "").slice(0, 6);

export function MfaScreen({ onBack, onLocked }: { onBack: () => void; onLocked?: (locked: boolean) => void }) {
  const { t } = useI18n();
  const { setMfaEnabled } = useSession();
  const load = useCallback(() => mfaApi.status().then((r) => r.data), []);
  const status = useRemote(load);
  const [mode, setMode] = useState<"manage" | "wizard">("manage");
  const [wizardLocked, setWizardLocked] = useState(false);
  const lock = useCallback(
    (locked: boolean) => {
      setWizardLocked(locked);
      onLocked?.(locked);
    },
    [onLocked]
  );

  const body = () => {
    if (mode === "wizard") {
      return (
        <Wizard
          onLocked={lock}
          onLeave={() => {
            setMode("manage");
            void status.reload();
          }}
          onEnabled={() => setMfaEnabled(true)}
        />
      );
    }
    if (!status.data) {
      return status.error ? (
        <Notice tone="neg" testID="mfa-load-failed" onRetry={() => void status.reload()}>{`! ${t("mfa.manage.load_failed")}`}</Notice>
      ) : (
        <Txt variant="body" tone="muted">{t("soul_app.common.loading")}</Txt>
      );
    }
    return status.data.enabled ? (
      <Enabled
        status={status.data}
        onChanged={() => void status.reload()}
        onDisabled={() => {
          setMfaEnabled(false);
          void status.reload();
        }}
      />
    ) : (
      <Disabled status={status.data} onStart={() => setMode("wizard")} />
    );
  };

  return (
    <AccountFrame testID="mfa-screen" onBack={onBack} locked={wizardLocked}>
      {mode === "wizard" ? null : <Txt variant="title">{t("mfa.title")}</Txt>}
      {body()}
    </AccountFrame>
  );
}

function Disabled({ status, onStart }: { status: MfaStatus; onStart: () => void }) {
  const { t } = useI18n();
  const { state } = useSession();
  const role = state.status === "signedIn" ? state.user.role : "";
  return (
    <View testID="mfa-off" style={{ gap: space[4] }}>
      <Txt variant="bodyLg">{`○ ${t("mfa.badge_off")}`}</Txt>
      <Txt variant="body" tone="muted">{t("mfa.manage.off_body")}</Txt>
      {status.required ? <Notice tone="neutral" testID="mfa-required-note">{t("mfa.manage.required_note", { role: t(`users.roles.${role}`) })}</Notice> : null}
      <Button testID="mfa-start" title={t("mfa.setup.open")} onPress={onStart} />
    </View>
  );
}

/** Ten codes in two equal columns of five, no numbering; each column is selectable text. */
function RecoveryCodes({ codes }: { codes: string[] }) {
  const { t } = useI18n();
  return (
    <View testID="mfa-recovery-codes" style={{ gap: space[3] }}>
      <Notice tone="neutral">
        <Txt variant="caption">{`◐ ${t("mfa.setup.step4_warning")}`}</Txt>
      </Notice>
      <View testID="mfa-codes-text" style={{ flexDirection: "row", gap: space[5] }}>
        {[codes.slice(0, Math.ceil(codes.length / 2)), codes.slice(Math.ceil(codes.length / 2))].map((col, i) => (
          <Txt key={i} testID={`mfa-codes-col-${i}`} selectable variant="bodyLg" style={{ fontFamily: family.mono[500], lineHeight: 30 }}>
            {col.join("\n")}
          </Txt>
        ))}
      </View>
      <Txt variant="caption" tone="muted">{t("officer_app.mfa.select_hint")}</Txt>
    </View>
  );
}

/**
 * 「确认是本人」:6 位动态码或密码二选一。关闭与重新生成恢复码共用这一块(后端也是同一个确认、同一把锁);
 * `id` 是两处各自的 testID 前缀。
 */
function OwnerConfirm({
  id, method, onMethod, code, onCode, password, onPassword,
}: {
  id: string;
  method: "totp" | "password";
  onMethod: (m: "totp" | "password") => void;
  code: string;
  onCode: (v: string) => void;
  password: string;
  onPassword: (v: string) => void;
}) {
  const { t } = useI18n();
  return (
    <>
      <Segmented
        testID={`${id}-method`}
        value={method}
        onChange={onMethod}
        options={[
          { key: "totp", label: t("mfa.manage.confirm_by_totp") },
          { key: "password", label: t("mfa.manage.confirm_by_password") },
        ]}
      />
      {method === "totp" ? (
        <Input testID={`${id}-code`} label={t("mfa.verify.code_label")} value={code} onChangeText={(v) => onCode(digits(v))} mono keyboardType="number-pad" maxLength={6} autoComplete="one-time-code" textContentType="oneTimeCode" />
      ) : (
        <Input
          testID={`${id}-password`}
          label={t("auth.password")}
          value={password}
          onChangeText={onPassword}
          secureTextEntry
          textContentType="password"
          autoComplete="current-password"
          secureToggle={{ show: t("soul_app.common.show"), hide: t("soul_app.common.hide") }}
        />
      )}
    </>
  );
}

function Enabled({ status, onChanged, onDisabled }: { status: MfaStatus; onChanged: () => void; onDisabled: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [asking, setAsking] = useState<"regen" | "disable" | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string[] | null>(null);
  const [method, setMethod] = useState<"totp" | "password">("totp");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");

  const regenerate = () => {
    setBusy(true);
    setFailure(null);
    mfaApi
      .regenerateRecoveryCodes(method === "totp" ? { method: "totp", code } : { method: "password", password })
      .then(
        (r) => {
          setFresh(r.data.recovery_codes);
          setAsking(null);
          setCode("");
          setPassword("");
          onChanged();
        },
        (e: unknown) => setFailure(t(mfaManageFailureKey(e, "mfa.manage.disable_failed")))
      )
      .finally(() => setBusy(false));
  };

  const disable = () => {
    setBusy(true);
    setFailure(null);
    mfaApi
      .disable(method === "totp" ? { method: "totp", code } : { method: "password", password })
      .then(
        () => {
          toast(t("mfa.manage.disabled_toast"), "success");
          onDisabled();
        },
        (e: unknown) => setFailure(t(mfaManageFailureKey(e, "mfa.manage.disable_failed")))
      )
      .finally(() => setBusy(false));
  };

  const ready = method === "totp" ? code.length === 6 : password.length > 0;
  const changeMethod = (m: "totp" | "password") => {
    setMethod(m);
    setFailure(null);
  };
  const cancel = () => {
    setAsking(null);
    setFailure(null);
    setCode("");
    setPassword("");
  };

  if (fresh) {
    return (
      <View testID="mfa-regenerated" style={{ gap: space[4] }}>
        <Txt variant="title">{t("mfa.manage.regenerate_done_title")}</Txt>
        <RecoveryCodes codes={fresh} />
        <Button testID="mfa-regenerated-close" title={t("common.close")} onPress={() => setFresh(null)} />
      </View>
    );
  }

  return (
    <View testID="mfa-on" style={{ gap: space[4] }}>
      <Txt variant="bodyLg">{`✓ ${t("mfa.badge_on")}`}</Txt>
      <Txt testID="mfa-codes-left" variant="body">{`${t("mfa.manage.codes_left")} · ${t("mfa.manage.codes_left_value", { n: String(status.recovery_codes_remaining) })}`}</Txt>
      {failure ? <Notice tone="neg" testID="mfa-failure">{`! ${failure}`}</Notice> : null}

      {asking === "regen" ? (
        <View style={{ gap: space[3] }}>
          <Txt variant="section">{t("mfa.manage.regenerate_title")}</Txt>
          <Txt variant="body" tone="muted">{t("mfa.manage.regenerate_body")}</Txt>
          <OwnerConfirm id="mfa-regen" method={method} onMethod={changeMethod} code={code} onCode={setCode} password={password} onPassword={setPassword} />
          <View style={{ flexDirection: "row", gap: space[3] }}>
            <ActionButton testID="mfa-regen-cancel" kind="outline" title={t("soul_app.common.cancel")} onPress={cancel} />
            <ActionButton testID="mfa-regen-confirm" kind="ink" title={t("mfa.manage.regenerate")} busy={busy} disabled={!ready} onPress={regenerate} />
          </View>
        </View>
      ) : asking === "disable" ? (
        <View style={{ gap: space[3] }}>
          <Txt variant="section">{t("mfa.manage.disable_title")}</Txt>
          <Txt variant="body" tone="muted">{t("mfa.manage.disable_body")}</Txt>
          <OwnerConfirm id="mfa-disable" method={method} onMethod={changeMethod} code={code} onCode={setCode} password={password} onPassword={setPassword} />
          <View style={{ flexDirection: "row", gap: space[3] }}>
            <ActionButton testID="mfa-disable-cancel" kind="outline" title={t("soul_app.common.cancel")} onPress={cancel} />
            <ActionButton testID="mfa-disable-confirm" kind="ink" title={t("mfa.manage.disable_confirm")} busy={busy} disabled={!ready} onPress={disable} />
          </View>
        </View>
      ) : (
        <View style={{ gap: space[3] }}>
          <ActionButton testID="mfa-regen" kind="outline" title={t("mfa.manage.regenerate")} onPress={() => setAsking("regen")} />
          <ActionButton testID="mfa-disable" kind="ink-outline" title={t("mfa.manage.disable")} onPress={() => setAsking("disable")} />
        </View>
      )}
    </View>
  );
}

function Wizard({ onLeave, onEnabled, onLocked }: { onLeave: () => void; onEnabled: () => void; onLocked: (locked: boolean) => void }) {
  const { t } = useI18n();
  const theme = useTheme();
  const [step, setStep] = useState(1);
  const [setup, setSetup] = useState<MfaSetupResponse | null>(null);
  const [setupFailed, setSetupFailed] = useState<string | null>(null);
  const [openFailed, setOpenFailed] = useState(false);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  // 登录的尝试次数用完(429):框下说一句,「下一步」这一轮不再可点。
  const [locked, setLocked] = useState(false);
  // 密码不对:焦点回到框里(第十九批)。
  const passwordRef = useRef<TextInput>(null);
  const [refusals, setRefusals] = useState(0);
  useEffect(() => {
    if (refusals > 0) passwordRef.current?.focus();
  }, [refusals]);
  const requested = useRef(false);
  const finished = useRef(false);
  const done = step > STEPS;

  // Step 4 cannot be left; after 完成 nothing is owed any more.
  useEffect(() => {
    onLocked(step === STEPS);
    return () => onLocked(false);
  }, [step, onLocked]);

  // Leaving before 完成 -- the back row, the Android key, the tab bar -- drops the unconfirmed secret.
  useEffect(
    () => () => {
      if (requested.current && !finished.current) void mfaApi.cancelSetup().catch(() => {});
    },
    []
  );

  // 第一步「下一步」带着当前密码去要一把新密钥(已登录不等于是本人);要到了就不再要,往返不换码,也不再问密码。
  const start = () => {
    if (setup) return setStep(2);
    if (busy || locked) return;
    setBusy(true);
    setPasswordError(null);
    setSetupFailed(null);
    mfaApi
      .setup(password)
      .then(
        (r) => {
          requested.current = true;
          setSetup(r.data);
          setPassword("");
          setStep(2);
        },
        (e: unknown) => {
          const code = (e as { response?: { data?: { code?: string } } })?.response?.data?.code;
          if (code === "wrong_password") {
            setPasswordError(t("mfa.setup.password_wrong"));
            setRefusals((n) => n + 1);
          } else if (code === "login_locked") {
            setPasswordError(t("mfa.setup.password_locked"));
            setLocked(true);
            setRefusals((n) => n + 1);
          } else setSetupFailed(t(mfaManageFailureKey(e, "mfa.setup.setup_failed")));
        }
      )
      .finally(() => setBusy(false));
  };

  const confirm = () => {
    setBusy(true);
    setCodeError(null);
    mfaApi
      .confirm(code)
      .then(
        (r) => {
          setCodes(r.data.recovery_codes);
          setStep(4);
        },
        (e: unknown) => {
          setCodeError(t(mfaManageFailureKey(e, "mfa.setup.step3_error")));
          setCode("");
        }
      )
      .finally(() => setBusy(false));
  };

  const complete = () => {
    setBusy(true);
    setCompleteError(null);
    mfaApi
      .complete()
      .then(
        () => {
          finished.current = true;
          setCodes([]);
          setStep(STEPS + 1);
          onEnabled();
        },
        (e: unknown) => setCompleteError(t(mfaManageFailureKey(e, "mfa.setup.complete_failed")))
      )
      .finally(() => setBusy(false));
  };

  const openAuthenticator = () => {
    if (!setup) return;
    setOpenFailed(false);
    Linking.openURL(setup.otpauth_url).catch(() => setOpenFailed(true));
  };

  if (done) {
    return (
      <View testID="mfa-done" style={{ gap: space[4] }}>
        <Txt variant="title">{`✓ ${t("mfa.setup.done_title")}`}</Txt>
        <Txt variant="body" tone="muted">{t("mfa.setup.done_body")}</Txt>
        <Button testID="mfa-done-close" title={t("common.close")} onPress={onLeave} />
      </View>
    );
  }

  return (
    <View testID="mfa-wizard" style={{ gap: space[4] }}>
      <Txt testID="mfa-step" variant="eyebrow" tone="muted">{`${t("mfa.setup.title")} · ${t("mfa.setup.step_of", { n: String(step), total: String(STEPS) })}`}</Txt>

      {step === 1 ? (
        <View style={{ gap: space[3] }}>
          <Txt variant="title">{t("mfa.setup.step1_title")}</Txt>
          <Txt variant="body" tone="muted">{t("mfa.setup.step1_body")}</Txt>
          {setup ? null : (
            <>
              <View testID="mfa-password-divider" style={{ height: 1, backgroundColor: theme.hair }} />
              <Txt testID="mfa-password-hint" variant="body" tone="muted">{t("mfa.setup.password_hint")}</Txt>
              <Input
                inputRef={passwordRef}
                testID="mfa-setup-password"
                label={t("mfa.manage.confirm_by_password")}
                error={passwordError}
                value={password}
                onChangeText={(v) => {
                  setPassword(v);
                  if (!locked) setPasswordError(null);
                }}
                editable={!busy}
                secureTextEntry
                textContentType="password"
                autoComplete="current-password"
                secureToggle={{ show: t("soul_app.common.show"), hide: t("soul_app.common.hide") }}
              />
            </>
          )}
          {setupFailed ? <Notice tone="neg" testID="mfa-setup-failed">{`! ${setupFailed}`}</Notice> : null}
        </View>
      ) : null}

      {step === 2 ? (
        <View style={{ gap: space[3] }}>
          <Txt variant="title">{t("officer_app.mfa.setup_key_title")}</Txt>
          <Txt variant="body" tone="muted">{t("officer_app.mfa.setup_key_body")}</Txt>
          {setupFailed ? (
            <Notice tone="neg" testID="mfa-setup-failed">{`! ${setupFailed}`}</Notice>
          ) : setup ? (
            <>
              <Txt variant="caption" tone="muted">{t("mfa.setup.manual_key")}</Txt>
              <Txt testID="mfa-manual-key" selectable variant="bodyLg" style={{ fontFamily: family.mono[500], lineHeight: 28 }}>
                {groupKey(setup.secret)}
              </Txt>
              <ActionButton testID="mfa-open-authenticator" kind="primary" title={`${t("mfa.setup.step2_open")} ↗︎`} onPress={openAuthenticator} />
              {openFailed ? <Notice tone="neutral" testID="mfa-open-failed">{t("officer_app.mfa.open_failed")}</Notice> : null}
              <Txt variant="caption" tone="muted">{t("officer_app.mfa.select_hint")}</Txt>
              <Txt variant="caption" tone="muted">{t("mfa.setup.key_meta")}</Txt>
            </>
          ) : (
            <Txt variant="body" tone="muted">{t("soul_app.common.loading")}</Txt>
          )}
        </View>
      ) : null}

      {step === 3 ? (
        <View style={{ gap: space[3] }}>
          <Txt variant="title">{t("mfa.setup.step3_title")}</Txt>
          <Txt variant="body" tone="muted">{t("mfa.setup.step3_body")}</Txt>
          {codeError ? <Notice tone="neg" testID="mfa-code-error">{`! ${codeError}`}</Notice> : null}
          <Input
            testID="mfa-setup-code"
            label={t("mfa.verify.code_label")}
            value={code}
            onChangeText={(v) => {
              setCodeError(null);
              setCode(digits(v));
            }}
            mono
            keyboardType="number-pad"
            maxLength={6}
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
          />
        </View>
      ) : null}

      {step === 4 ? (
        <View style={{ gap: space[3] }}>
          <Txt variant="title">{t("mfa.setup.step4_title")}</Txt>
          <RecoveryCodes codes={codes} />
          <ActionButton testID="mfa-saved" kind="outline" title={`${saved ? "✓" : "○"} ${t("mfa.setup.saved_check")}`} onPress={() => setSaved((v) => !v)} />
          {completeError ? <FieldError testID="mfa-complete-error" text={completeError} /> : null}
        </View>
      ) : null}

      <View style={{ gap: space[3] }}>
        {step < 3 ? (
          <Button
            testID="mfa-next"
            title={t("mfa.setup.next")}
            busy={step === 1 && busy}
            disabled={step === 1 ? !setup && (locked || password.length === 0) : !setup}
            onPress={() => (step === 1 ? start() : setStep(step + 1))}
          />
        ) : step === 3 ? (
          <Button testID="mfa-confirm" title={t("mfa.setup.next")} busy={busy} disabled={code.length !== 6} onPress={confirm} />
        ) : (
          <Button testID="mfa-finish" title={t("mfa.setup.finish")} busy={busy} disabled={!saved} onPress={complete} />
        )}
        {step > 1 && step < 4 ? <ActionButton testID="mfa-prev" kind="outline" title={t("mfa.setup.back")} onPress={() => setStep(step - 1)} /> : null}
        <Txt variant="caption" tone="muted">{t("mfa.setup.exit_note")}</Txt>
      </View>
    </View>
  );
}
