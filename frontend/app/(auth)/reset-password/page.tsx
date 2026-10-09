"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { authApi, type OfficerResetRefusal } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { LoginShell } from "@/src/components/auth/LoginShell";
import { TextField } from "@/src/components/ui/Field";
import { Button } from "@/src/components/ui/Button";

/**
 * 重置密码(2026-10-09):邮件里的链接落在这里,`?uid=…&token=…`。
 *
 * 令牌读出来之后立刻从地址栏抹掉(`history.replaceState`):它是一次性的凭据,不该留在历史记录里,
 * 也不该随 Referer 跟着出站链接走。没有 uid / token 的直接打开,与链接失效是同一个页面状态。
 * 失败只分三种:链接无效(重新申请)、新密码太弱(留在表单里改)、其余(重试)。
 */
type Phase = "reading" | "form" | "invalid" | "done";

export default function ResetPasswordPage() {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>("reading");
  const [credential, setCredential] = useState<{ uid: string; token: string } | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const uid = params.get("uid");
    const token = params.get("token");
    if (uid && token) {
      setCredential({ uid, token });
      setPhase("form");
      window.history.replaceState(null, "", window.location.pathname);
    } else {
      setPhase("invalid");
    }
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!credential || loading) return;
    if (password !== confirm) {
      setError(t("profile.password_mismatch"));
      return;
    }
    if (password.length < 8) {
      setError(t("profile.password_too_short"));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await authApi.confirmOfficerReset({ ...credential, new_password: password });
      setPhase("done");
    } catch (err: unknown) {
      const response = (err as { response?: { status?: number; data?: Partial<OfficerResetRefusal> } })?.response;
      if (response?.data?.code === "reset_link_invalid") {
        setPhase("invalid");
      } else if (response?.data?.code === "weak_password") {
        setError(`${t("auth.reset_weak")}${response.data.error ? ` · ${response.data.error}` : ""}`);
      } else {
        setError(t(response?.status === 429 ? "auth.rate_limited" : "auth.forgot_failed"));
      }
    } finally {
      setLoading(false);
    }
  };

  const link = "inline-flex min-h-11 items-center text-xs text-[oklch(var(--color-ink))] underline underline-offset-2";
  const box = "rounded-control border border-[oklch(var(--color-line))] bg-[oklch(var(--color-canvas))] px-4 py-3 text-sm";

  return (
    <LoginShell narrowStatute={false} back={{ href: "/login", label: t("auth.back_to_login") }}>
      {phase === "reading" ? null : phase === "invalid" ? (
        <div className="flex flex-col gap-4" data-testid="officer-reset-invalid">
          <h1 className="font-title text-xl font-semibold text-[oklch(var(--color-ink))]">{t("auth.reset_title")}</h1>
          <div role="alert" className={box}>
            <p className="font-medium text-[oklch(var(--color-danger))]">
              <span aria-hidden="true">! </span>
              {t("auth.reset_invalid")}
            </p>
            <p className="mt-1 text-xs text-[oklch(var(--color-ink-muted))]">{t("auth.reset_invalid_body")}</p>
          </div>
          <Link href="/forgot-password" className={link}>
            {t("auth.reset_request_again")}
          </Link>
        </div>
      ) : phase === "done" ? (
        <div className="flex flex-col gap-4" data-testid="officer-reset-done">
          <h1 className="font-title text-xl font-semibold text-[oklch(var(--color-ink))]">{t("auth.reset_title")}</h1>
          <div role="status" className={`${box} text-[oklch(var(--color-ink))]`}>
            <p className="font-semibold">{t("auth.reset_done")}</p>
            <p className="mt-1 text-[oklch(var(--color-ink-muted))]">{t("auth.reset_done_body")}</p>
          </div>
          <Link href="/login" className={link}>
            {t("auth.back_to_login")}
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="flex w-full flex-col gap-4" data-testid="officer-reset-password-form" aria-busy={loading || undefined}>
          <div>
            <h1 className="font-title text-xl font-semibold text-[oklch(var(--color-ink))]">{t("auth.reset_title")}</h1>
            <p className="mt-1 text-sm text-[oklch(var(--color-ink-muted))]">{t("auth.reset_subtitle")}</p>
          </div>
          <TextField
            id="reset-new-password"
            name="new_password"
            autoComplete="new-password"
            type="password"
            label={t("profile.new_password")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
          <TextField
            id="reset-confirm-password"
            name="confirm_password"
            autoComplete="new-password"
            type="password"
            label={t("profile.confirm_password")}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            minLength={8}
            required
          />
          {error && (
            <div role="alert" className={`${box} font-medium text-[oklch(var(--color-danger))]`}>
              <span aria-hidden="true">! </span>
              {error}
            </div>
          )}
          <Button type="submit" variant="primary" size="lg" disabled={loading} loading={loading} className="w-full">
            {t("auth.reset_submit")}
          </Button>
        </form>
      )}
    </LoginShell>
  );
}
