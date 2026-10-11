"use client";

import { useEffect, useRef, useState } from "react";
import { mfaApi, type MfaRefusal, type MfaSetupResponse } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { BaseModal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { TextField } from "@/src/components/ui/Field";
import { CodeInput } from "@/src/components/auth/CodeInput";
import { QrCode } from "@/src/components/auth/QrCode";
import { RecoveryCodesPanel } from "@/src/components/auth/RecoveryCodesPanel";
import { cn } from "@/lib/utils";

const STEPS = 4;

/** 密钥四位一组,手抄用。 */
export function groupKey(secret: string): string {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}

/**
 * 开启两步验证的向导(A12):640 的 BaseModal,四段步条(✓ / ● / ○),脚注「中途退出不会开启」
 * 每一步都在。**只有第四步的「完成」才开启**:第三步验过码、拿到恢复码,状态仍是未开启;
 * 任何一步关掉对话框都调 `cancelSetup`,服务器丢掉未确认的密钥。
 *
 * 393:BaseModal 自己贴到底部全宽;顶部「n / 4」与 ✕ 由对话框标题行承担。
 */
export function MfaSetupWizard({ username, onClose, onEnabled }: { username: string; onClose: () => void; onEnabled: () => void }) {
  const { t } = useI18n();
  const [step, setStep] = useState(1);
  const [setup, setSetup] = useState<MfaSetupResponse | null>(null);
  const [setupError, setSetupError] = useState(false);
  // 开始设置先输当前密码:已登录不等于是本人。错误在第一步的密码框下说。
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  // 登录的尝试次数用完(429):框下说一句,「下一步」这一轮不再可点。
  const [locked, setLocked] = useState(false);
  // 密码不对:焦点回到框里(第十九批)。框在请求期间是禁用的,所以等它恢复后再聚焦。
  const passwordRef = useRef<HTMLInputElement>(null);
  const [refusals, setRefusals] = useState(0);
  useEffect(() => {
    if (refusals > 0) passwordRef.current?.focus();
  }, [refusals]);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [codes, setCodes] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState(false);
  const [keyCopied, setKeyCopied] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);
  const done = step > STEPS;

  // 第一步「下一步」带着密码去要一把新密钥;已经拿过(回到上一步再来)就不再要,也不再问密码。
  const start = async () => {
    if (setup) return setStep(2);
    if (starting || locked) return;
    setStarting(true);
    setPasswordError(null);
    setSetupError(false);
    try {
      const r = await mfaApi.setup(password);
      setSetup(r.data);
      setPassword("");
      setStep(2);
    } catch (err: unknown) {
      const body = (err as { response?: { data?: Partial<MfaRefusal> } })?.response?.data;
      if (body?.code === "wrong_password") {
        setPasswordError(t("mfa.setup.password_wrong"));
        setRefusals((n) => n + 1);
      } else if (body?.code === "login_locked") {
        setPasswordError(t("mfa.setup.password_locked"));
        setLocked(true);
        setRefusals((n) => n + 1);
      } else setSetupError(true);
    } finally {
      setStarting(false);
    }
  };

  // 第三步进场把焦点放进码框(不用 autoFocus 属性,jsx-a11y)。
  useEffect(() => {
    if (step === 3) codeRef.current?.focus();
  }, [step]);

  const leave = () => {
    if (!done) void mfaApi.cancelSetup().catch(() => {});
    onClose();
  };

  const confirm = async (value: string) => {
    if (confirming || value.length !== 6) return;
    setConfirming(true);
    setCodeError(null);
    try {
      const r = await mfaApi.confirm(value);
      setCodes(r.data.recovery_codes);
      setStep(4);
    } catch (err: unknown) {
      const body = (err as { response?: { data?: Partial<MfaRefusal> } })?.response?.data;
      setCodeError(t(body?.code === "expired" ? "mfa.verify.error_expired" : "mfa.setup.step3_error"));
      setCode("");
      requestAnimationFrame(() => {
        codeRef.current?.focus();
        codeRef.current?.select();
      });
    } finally {
      setConfirming(false);
    }
  };

  const complete = async () => {
    if (!saved || completing) return;
    setCompleting(true);
    setCompleteError(false);
    try {
      await mfaApi.complete();
      setStep(STEPS + 1);
      onEnabled();
    } catch {
      setCompleteError(true);
    } finally {
      setCompleting(false);
    }
  };

  const copyKey = async () => {
    if (!setup) return;
    try {
      await navigator.clipboard.writeText(setup.secret);
      setKeyCopied(true);
    } catch {
      setKeyCopied(false);
    }
  };

  const footer = done ? (
    <div className="flex justify-end">
      <Button type="button" variant="primary" size="lg" onClick={onClose}>
        {t("common.close")}
      </Button>
    </div>
  ) : (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="ghost" size="lg" onClick={() => setStep((s) => Math.max(1, s - 1))} disabled={step === 1 || step === 4}>
          {t("mfa.setup.back")}
        </Button>
        {step === 1 ? (
          <Button type="button" variant="primary" size="lg" data-testid="mfa-start" onClick={() => void start()} disabled={(!setup && (locked || password.length === 0)) || starting} loading={starting}>
            {t("mfa.setup.next")}
          </Button>
        ) : step === 2 ? (
          <Button type="button" variant="primary" size="lg" onClick={() => setStep(3)}>
            {t("mfa.setup.next")}
          </Button>
        ) : step === 3 ? (
          <Button type="button" variant="primary" size="lg" onClick={() => void confirm(code)} disabled={code.length !== 6 || confirming} loading={confirming}>
            {t("mfa.setup.next")}
          </Button>
        ) : (
          <Button type="button" variant="primary" size="lg" data-testid="mfa-finish" onClick={() => void complete()} disabled={!saved || completing} loading={completing}>
            {t("mfa.setup.finish")}
          </Button>
        )}
      </div>
      {/* 每一步都在的脚注。 */}
      <p className="text-2xs text-[oklch(var(--color-ink-subtle))]">{t("mfa.setup.exit_note")}</p>
    </div>
  );

  return (
    <BaseModal
      isOpen
      wide
      dismissOnOutsideClick={false}
      onClose={leave}
      title={done ? t("mfa.setup.done_title") : `${t("mfa.setup.title")} · ${t("mfa.setup.step_of", { n: String(step), total: String(STEPS) })}`}
      footer={footer}
    >
      <div className="flex flex-col gap-4" data-testid="mfa-wizard" data-step={step}>
        {!done ? (
          <ol className="m-0 grid list-none grid-cols-4 gap-2" aria-label={t("mfa.setup.step_of", { n: String(step), total: String(STEPS) })}>
            {Array.from({ length: STEPS }, (_, i) => i + 1).map((n) => (
              <li
                key={n}
                aria-current={n === step ? "step" : undefined}
                className={cn(
                  "border-t-2 pt-1 text-2xs",
                  n < step
                    ? "border-[oklch(var(--color-ink))] text-[oklch(var(--color-ink))]"
                    : n === step
                      ? "border-[oklch(var(--color-ink))] text-[oklch(var(--color-ink))]"
                      : "border-[oklch(var(--color-line))] text-[oklch(var(--color-ink-subtle))]"
                )}
              >
                <span aria-hidden="true">{n < step ? "✓" : n === step ? "●" : "○"} </span>
                {t(`mfa.setup.step${n}_title`)}
              </li>
            ))}
          </ol>
        ) : null}

        {step === 1 ? (
          <section className="flex flex-col gap-2">
            <h3 className="text-lg text-[oklch(var(--color-ink))]">{t("mfa.setup.step1_title")}</h3>
            <p className="text-sm text-[oklch(var(--color-ink-muted))]">{t("mfa.setup.step1_body")}</p>
            {setup ? null : (
              <>
                <hr data-testid="mfa-password-divider" className="m-0 border-0 border-t border-[oklch(var(--color-line))]" />
                <p data-testid="mfa-password-hint" className="text-sm text-[oklch(var(--color-ink-muted))]">
                  {t("mfa.setup.password_hint")}
                </p>
                <TextField
                  inputRef={passwordRef}
                  label={t("mfa.manage.confirm_by_password")}
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (!locked) setPasswordError(null);
                  }}
                  error={passwordError ?? undefined}
                  disabled={starting}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void start();
                  }}
                />
              </>
            )}
            {setupError ? (
              <p role="alert" className="text-sm text-[oklch(var(--color-danger))]">
                <span aria-hidden="true">! </span>
                {t("mfa.setup.setup_failed")}
              </p>
            ) : null}
          </section>
        ) : null}

        {step === 2 ? (
          <section className="flex flex-col gap-4">
            <h3 className="text-lg text-[oklch(var(--color-ink))]">{t("mfa.setup.step2_title")}</h3>
            <p className="text-sm text-[oklch(var(--color-ink-muted))]">{t("mfa.setup.step2_body")}</p>
            {setup ? (
              <div className="flex flex-col gap-4 md:flex-row md:items-start">
                <div className="hidden shrink-0 md:block">
                  <QrCode value={setup.otpauth_url} label={t("mfa.setup.step2_title")} />
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-3">
                  {/* 393:相机扫不了自己的屏幕,主按钮是 otpauth:// 链接。 */}
                  <a
                    href={setup.otpauth_url}
                    className="flex h-14 items-center justify-center bg-[oklch(var(--color-ink))] px-4 text-sm text-[oklch(var(--color-canvas))] md:hidden"
                  >
                    {t("mfa.setup.step2_open")}
                    <span aria-hidden="true"> ↗</span>
                  </a>
                  <p className="text-xs text-[oklch(var(--color-ink-muted))]">{t("mfa.setup.manual_key")}</p>
                  <code data-testid="mfa-manual-key" className="break-all font-mono text-md leading-6 text-[oklch(var(--color-ink))]">
                    {groupKey(setup.secret)}
                  </code>
                  <div>
                    <Button type="button" variant="secondary" size="sm" onClick={() => void copyKey()}>
                      {keyCopied ? t("common.value.copied") : t("mfa.setup.copy_key")}
                    </Button>
                  </div>
                  <p className="text-2xs text-[oklch(var(--color-ink-subtle))]">{t("mfa.setup.key_meta")}</p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-[oklch(var(--color-ink-subtle))]">{t("common.loading")}</p>
            )}
          </section>
        ) : null}

        {step === 3 ? (
          <section className="flex flex-col gap-4">
            <h3 className="text-lg text-[oklch(var(--color-ink))]">{t("mfa.setup.step3_title")}</h3>
            <p className="text-sm text-[oklch(var(--color-ink-muted))]">{t("mfa.setup.step3_body")}</p>
            {codeError ? (
              <p role="alert" className="text-sm font-medium text-[oklch(var(--color-danger))]">
                <span aria-hidden="true">! </span>
                {codeError}
              </p>
            ) : null}
            <CodeInput
              ref={codeRef}
              kind="totp"
              className="w-60"
              label={t("mfa.verify.code_label")}
              value={code}
              onChange={(v) => {
                setCodeError(null);
                setCode(v);
              }}
              onComplete={(v) => void confirm(v)}
              error={codeError}
              disabled={confirming}
            />
          </section>
        ) : null}

        {step === 4 ? (
          <section className="flex flex-col gap-4">
            <h3 className="text-lg text-[oklch(var(--color-ink))]">{t("mfa.setup.step4_title")}</h3>
            <RecoveryCodesPanel codes={codes} saved={saved} onSavedChange={setSaved} username={username} />
            {completeError ? (
              <p role="alert" className="text-sm text-[oklch(var(--color-danger))]">
                <span aria-hidden="true">! </span>
                {t("mfa.setup.complete_failed")}
              </p>
            ) : null}
          </section>
        ) : null}

        {done ? (
          <section className="flex flex-col gap-2" data-testid="mfa-done">
            <p className="text-md text-[oklch(var(--color-ink))]">
              <span aria-hidden="true">✓ </span>
              {t("mfa.setup.done_title")}
            </p>
            <p className="text-sm text-[oklch(var(--color-ink-muted))]">{t("mfa.setup.done_body")}</p>
          </section>
        ) : null}
      </div>
    </BaseModal>
  );
}
