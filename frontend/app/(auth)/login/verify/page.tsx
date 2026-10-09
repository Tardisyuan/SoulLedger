"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { mfaApi, type MfaRefusal } from "@soulledger/core/api";
import { setAccessToken, setRefreshToken } from "@soulledger/core/platform";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { LoginShell } from "@/src/components/auth/LoginShell";
import { CodeInput } from "@/src/components/auth/CodeInput";
import { Button } from "@/src/components/ui/Button";
import { defaultViewRoute } from "@/src/lib/defaultView";
import { goTo, replaceWith } from "@/src/lib/navigate";
import { clearMfaPending, readMfaPending, type MfaPending } from "@/src/lib/mfaPending";
import { cn } from "@/lib/utils";

/**
 * 登录第二步 `/login/verify`(A12,Design 2026-10-09):A9 的骨架,左栏不动,右栏换成一个 56 高的码框。
 * 待验证令牌从 `sessionStorage` 读(`src/lib/mfaPending.ts`);没有就回 /login。
 *
 * 状态(每个都是 A9 那种提示块):不对(! danger,还可以再试 n 次)、过期(◐ warning)、
 * 锁定(◐ warning,输入与按钮禁用,到点自己解开)、连不上(! danger,重试)、验证中。
 * 「手机不在身边?改用恢复码」切到恢复码模式:标题「用恢复码登录」,mono 22,不分大小写,连字符可不填。
 * 「30 天内不再询问」是**另一个**设备令牌(httpOnly cookie),与「保持登录」无关。
 */
type Failure =
  | { kind: "wrong"; remaining: number | null; lockMinutes: number | null }
  | { kind: "expired" }
  | { kind: "locked"; until: Date }
  | { kind: "network" }
  | { kind: "pending" };

const REMEMBER_DEVICE_DAYS = 30;

export default function LoginVerifyPage() {
  const { t, formatDate } = useI18n();
  const { showToast } = useToast();
  const { setUser } = useTenant();
  const [pending, setPending] = useState<MfaPending | null | undefined>(undefined);
  const [mode, setMode] = useState<"totp" | "recovery">("totp");
  const [code, setCode] = useState("");
  const [rememberDevice, setRememberDevice] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 读交接;没有就是直接打开了这个地址,退回登录页。
  useEffect(() => {
    const p = readMfaPending();
    setPending(p);
    if (!p) replaceWith("/login");
  }, []);

  // 焦点一进页面就在码框里(不用 autoFocus 属性,jsx-a11y)。
  useEffect(() => {
    if (pending) inputRef.current?.focus();
  }, [pending]);

  const lockedUntil = failure?.kind === "locked" ? failure.until.getTime() : null;
  useEffect(() => {
    if (lockedUntil === null) return;
    const id = setTimeout(() => setFailure(null), Math.max(0, lockedUntil - Date.now()));
    return () => clearTimeout(id);
  }, [lockedUntil]);
  const locked = lockedUntil !== null;

  const refocus = () => {
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  };

  const submit = async (value = code) => {
    if (!pending || loading || locked) return;
    if (mode === "totp" ? value.length !== 6 : value.length === 0) return;
    setLoading(true);
    setFailure(null);
    try {
      const res = await mfaApi.verify({
        pending_token: pending.pending_token,
        ...(mode === "totp" ? { code: value } : { recovery_code: value }),
        remember_device: rememberDevice,
      });
      clearMfaPending();
      setAccessToken(res.data.access);
      setRefreshToken(res.data.refresh);
      setUser(res.data.user);
      showToast(t("auth.login_success"), "success");
      goTo(await defaultViewRoute());
      return;
    } catch (err: unknown) {
      const response = (err as { response?: { status?: number; data?: Partial<MfaRefusal> } })?.response;
      const data = response?.data;
      const status = response?.status;
      if (status === 429 && data?.code === "locked") {
        setFailure({ kind: "locked", until: new Date(Date.now() + (data.retry_after ?? 900) * 1000) });
        return;
      }
      if (status === 401) {
        clearMfaPending();
        setFailure({ kind: "pending" });
        return;
      }
      if (!response || (status !== undefined && status >= 500)) {
        setFailure({ kind: "network" });
        return;
      }
      if (data?.code === "expired") setFailure({ kind: "expired" });
      else setFailure({ kind: "wrong", remaining: data?.remaining_attempts ?? null, lockMinutes: data?.lock_minutes ?? null });
      setCode("");
      refocus();
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (next: "totp" | "recovery") => {
    setMode(next);
    setCode("");
    setFailure(null);
    refocus();
  };

  if (!pending) return null;

  const notice = failure ? (
    <div
      role="alert"
      data-testid="mfa-error"
      data-kind={failure.kind}
      className={cn(
        "flex items-start gap-3 rounded-control border bg-[oklch(var(--color-canvas))] px-4 py-3 text-sm",
        failure.kind === "locked" || failure.kind === "expired" ? "border-[oklch(var(--color-warning))]" : "border-[oklch(var(--color-line))]"
      )}
    >
      <div className="min-w-0 flex-1">
        {failure.kind === "wrong" ? (
          <>
            <p className="font-medium text-[oklch(var(--color-danger))]">
              <span aria-hidden="true">! </span>
              {t(mode === "recovery" ? "mfa.verify.error_recovery_wrong" : "mfa.verify.error_wrong")}
            </p>
            {failure.remaining !== null && failure.lockMinutes !== null ? (
              <p className="mt-1 text-xs text-[oklch(var(--color-ink-muted))]">
                {t("mfa.verify.error_wrong_body", { n: String(failure.remaining), m: String(failure.lockMinutes) })}
              </p>
            ) : null}
          </>
        ) : failure.kind === "expired" ? (
          <>
            <p className="font-medium text-[oklch(var(--color-ink))]">
              <span aria-hidden="true">◐ </span>
              {t("mfa.verify.error_expired")}
            </p>
            <p className="mt-1 text-xs text-[oklch(var(--color-ink-muted))]">{t("mfa.verify.error_expired_body")}</p>
          </>
        ) : failure.kind === "locked" ? (
          <>
            <p className="font-medium text-[oklch(var(--color-ink))]">
              <span aria-hidden="true">◐ </span>
              {t("mfa.verify.error_locked")}
            </p>
            <p className="mt-1 text-xs text-[oklch(var(--color-ink-muted))]">
              {t("mfa.verify.error_locked_body", { time: formatDate(failure.until, { hour: "2-digit", minute: "2-digit" }) })}
            </p>
          </>
        ) : failure.kind === "pending" ? (
          <p className="font-medium text-[oklch(var(--color-danger))]">
            <span aria-hidden="true">! </span>
            {t("mfa.verify.error_pending")}
          </p>
        ) : (
          <>
            <p className="font-medium text-[oklch(var(--color-danger))]">
              <span aria-hidden="true">! </span>
              {t("auth.error_network")}
            </p>
            <p className="mt-1 text-xs text-[oklch(var(--color-ink-muted))]">{t("auth.error_network_body")}</p>
          </>
        )}
      </div>
      {failure.kind === "network" ? (
        <Button type="button" variant="secondary" size="sm" onClick={() => void submit()} disabled={loading}>
          {t("common.retry")}
        </Button>
      ) : null}
    </div>
  ) : null;

  const back = { href: "/login", label: t("mfa.verify.back") };

  return (
    <LoginShell narrowStatute={false} back={back}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="flex w-full flex-col gap-4"
        aria-busy={loading || undefined}
        data-testid="mfa-verify-form"
        data-mode={mode}
      >
        <Link href="/login" className="hidden min-h-11 items-center gap-1 text-xs text-[oklch(var(--color-ink))] underline underline-offset-2 md:inline-flex">
          <span aria-hidden="true">‹ </span>
          {t("mfa.verify.back")}
        </Link>
        <div>
          <h1 className="font-title text-xl leading-9 font-semibold text-[oklch(var(--color-ink))]">
            {t(mode === "recovery" ? "mfa.verify.recovery_title" : "mfa.verify.title")}
          </h1>
          <p className="mt-1 text-sm text-[oklch(var(--color-ink-muted))]">
            {t(mode === "recovery" ? "mfa.verify.recovery_subtitle" : "mfa.verify.subtitle", { id: pending.username })}
          </p>
        </div>

        {notice}

        <CodeInput
          ref={inputRef}
          id="mfa-code"
          kind={mode}
          label={t(mode === "recovery" ? "mfa.verify.recovery_label" : "mfa.verify.code_label")}
          hint={t(mode === "recovery" ? "mfa.verify.recovery_hint" : "mfa.verify.code_hint")}
          value={code}
          onChange={(v) => {
            if (failure && failure.kind !== "locked") setFailure(null);
            setCode(v);
          }}
          onComplete={(v) => void submit(v)}
          error={failure && (failure.kind === "wrong" || failure.kind === "expired") ? failure.kind : null}
          disabled={loading || locked || failure?.kind === "pending"}
        />

        <label className="flex min-h-11 items-center gap-2 text-xs text-[oklch(var(--color-ink-muted))]">
          <input
            type="checkbox"
            name="remember_device"
            className="size-4.5"
            checked={rememberDevice}
            onChange={(e) => setRememberDevice(e.target.checked)}
            disabled={locked}
          />
          {t("mfa.verify.remember_device", { days: String(REMEMBER_DEVICE_DAYS) })}
        </label>

        <Button
          type="submit"
          variant="primary"
          size="lg"
          disabled={loading || locked || failure?.kind === "pending" || (mode === "totp" ? code.length !== 6 : code.length === 0)}
          loading={loading}
          className="w-full"
        >
          {loading ? t("mfa.verify.submitting") : t("mfa.verify.submit")}
          {!loading && <span aria-hidden="true" className="font-mono text-2xs opacity-80">↵</span>}
        </Button>

        <button
          type="button"
          onClick={() => switchMode(mode === "totp" ? "recovery" : "totp")}
          className="min-h-11 text-xs text-[oklch(var(--color-ink))] underline underline-offset-2"
        >
          {t(mode === "totp" ? "mfa.verify.use_recovery" : "mfa.verify.use_totp")}
        </button>
      </form>
    </LoginShell>
  );
}
