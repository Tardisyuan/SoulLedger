"use client";

import { useState } from "react";
import Link from "next/link";
import { authApi } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { LoginShell } from "@/src/components/auth/LoginShell";
import { TextField } from "@/src/components/ui/Field";
import { Button } from "@/src/components/ui/Button";

/**
 * 官员「忘记密码」(2026-10-09):用户名或邮箱 → 往**已验证**的邮箱发一条 1 小时的一次性链接。
 *
 * 对任何输入都是同一句「已发送(如果账号存在且邮箱已验证)」:后端对不存在的账号、没验证的邮箱、
 * 灵魂账号都答同一个 200,所以这里只按状态码分支(429 = 太频繁),绝不按响应体分支。
 * 邮箱没验证的人收不到信 —— 页面给一条退路:通知管理员(登录页的 `?help=1` 表单,原有流程不变)。
 */
export default function ForgotPasswordPage() {
  const { t } = useI18n();
  const [identifier, setIdentifier] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier.trim() || state === "sending") return;
    setState("sending");
    setError(null);
    try {
      await authApi.requestOfficerReset(identifier.trim());
      setState("sent");
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      setError(t(status === 429 ? "auth.rate_limited" : "auth.forgot_failed"));
      setState("idle");
    }
  };

  const notifyAdmin = (
    <Link
      href="/login?help=1"
      className="inline-flex min-h-11 items-center text-xs text-[oklch(var(--color-ink))] underline underline-offset-2"
    >
      {t("auth.forgot_notify_admin")}
    </Link>
  );

  return (
    <LoginShell narrowStatute={false} back={{ href: "/login", label: t("auth.back_to_login") }}>
      {state === "sent" ? (
        <div className="flex flex-col gap-4" data-testid="officer-reset-sent">
          <h1 className="font-title text-xl font-semibold text-[oklch(var(--color-ink))]">{t("auth.forgot_password")}</h1>
          <div
            role="status"
            className="rounded-control border border-[oklch(var(--color-line))] bg-[oklch(var(--color-canvas))] px-4 py-3 text-sm text-[oklch(var(--color-ink))]"
          >
            <p className="font-semibold">{t("auth.forgot_email_sent")}</p>
            <p className="mt-1 text-[oklch(var(--color-ink-muted))]">{t("auth.forgot_email_sent_body")}</p>
          </div>
          {notifyAdmin}
          <Link
            href="/login"
            className="inline-flex min-h-11 items-center text-xs text-[oklch(var(--color-ink))] underline underline-offset-2"
          >
            {t("auth.back_to_login")}
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="flex w-full flex-col gap-4" data-testid="officer-reset-form" aria-busy={state === "sending" || undefined}>
          <div>
            <h1 className="font-title text-xl font-semibold text-[oklch(var(--color-ink))]">{t("auth.forgot_password")}</h1>
            <p className="mt-1 text-sm text-[oklch(var(--color-ink-muted))]">{t("auth.forgot_email_desc")}</p>
          </div>
          <TextField
            id="officer-reset-identifier"
            name="identifier"
            autoComplete="username"
            type="text"
            label={t("auth.forgot_email_label")}
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            required
          />
          {error && (
            <div
              role="alert"
              className="rounded-control border border-[oklch(var(--color-line))] bg-[oklch(var(--color-canvas))] px-4 py-3 text-sm font-medium text-[oklch(var(--color-danger))]"
            >
              <span aria-hidden="true">! </span>
              {error}
            </div>
          )}
          <Button
            type="submit"
            variant="primary"
            size="lg"
            disabled={state === "sending" || !identifier.trim()}
            loading={state === "sending"}
            className="w-full"
          >
            {t("auth.forgot_email_submit")}
          </Button>
          {notifyAdmin}
          <Link
            href="/login"
            className="inline-flex min-h-11 items-center text-xs text-[oklch(var(--color-ink))] underline underline-offset-2"
          >
            {t("auth.back_to_login")}
          </Link>
        </form>
      )}
    </LoginShell>
  );
}
