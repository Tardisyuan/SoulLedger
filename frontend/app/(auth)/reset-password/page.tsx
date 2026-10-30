"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { authApi } from "@soulledger/core/api";
import { passwordReasonKeys, splitCommonReasons } from "@soulledger/core/api/auth";
import { useI18n } from "@/src/contexts/I18nContext";
import { LoginShell } from "@/src/components/auth/LoginShell";
import { PasswordRuleFields, usePasswordRules } from "@/src/components/auth/PasswordRules";
import { Button } from "@/src/components/ui/Button";
import { responseCode, responseData, responseStatus } from "@soulledger/core/api/client";

/**
 * 重置密码(2026-10-09):邮件里的链接落在这里,`?uid=…&token=…`。
 *
 * 令牌读出来之后立刻从地址栏抹掉(`history.replaceState`):它是一次性的凭据,不该留在历史记录里,
 * 也不该随 Referer 跟着出站链接走。没有 uid / token 的直接打开,与链接失效是同一个页面状态。
 * 失败只分三种:链接无效(重新申请)、新密码太弱(留在表单里改)、其余(重试)。
 */
type Phase = "reading" | "form" | "invalid" | "done";

/** The shape Django's uid (urlsafe base64) and reset token (`<base36>-<hex>`) have; the app accepts the same and nothing else. */
const UID_SHAPE = /^[A-Za-z0-9_-]{1,32}$/;
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{8,128}$/;
const OFFICER_APP_RESET = "soulledger-officer://reset";

export default function ResetPasswordPage() {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>("reading");
  const [credential, setCredential] = useState<{ uid: string; token: string } | null>(null);
  const rules = usePasswordRules();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 严格模式下 effect 跑两遍:第一遍读到凭据并把地址栏抹掉,第二遍读到空参数就会把表单换成「链接无效」。
  // 与 verify-email 同一个守卫。
  const read = useRef(false);
  useEffect(() => {
    if (read.current) return;
    read.current = true;
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
    if (!rules.check()) return;
    setLoading(true);
    setError(null);
    try {
      await authApi.confirmOfficerReset({ ...credential, new_password: rules.next });
      setPhase("done");
    } catch (err: unknown) {
      const code = responseCode(err);
      if (code === "reset_link_invalid") {
        setPhase("invalid");
      } else if (code === "weak_password") {
        // 「太常见 / 太像」:清单上的 ◇ 换成 password_rules.common_*。其余原因(最近用过、管理员太短…)逐条说,
        // 不再一律当「太常见」(2026-10-23);Django 的英文句子仍不显示。
        const { common, rest } = splitCommonReasons(passwordReasonKeys(responseData(err)));
        if (common || !rest.length) rules.reject();
        if (rest.length) setError(rest.map((key) => t(key)).join("；"));
      } else {
        setError(t(responseStatus(err) === 429 ? "auth.rate_limited" : "auth.forgot_failed"));
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
        <form onSubmit={submit} noValidate className="flex w-full flex-col gap-4" data-testid="officer-reset-password-form" aria-busy={loading || undefined}>
          <div>
            <h1 className="font-title text-xl font-semibold text-[oklch(var(--color-ink))]">{t("auth.reset_title")}</h1>
            <p className="mt-1 text-sm text-[oklch(var(--color-ink-muted))]">{t("auth.reset_subtitle")}</p>
          </div>
          <PasswordRuleFields
            rules={rules}
            idPrefix="reset-password"
            newLabel={t("profile.new_password")}
            confirmLabel={t("profile.confirm_password")}
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
          {/* A plain link into the app: without the app installed it does nothing, and this form stays the way to finish. */}
          {credential && UID_SHAPE.test(credential.uid) && TOKEN_SHAPE.test(credential.token) ? (
            <a
              data-testid="officer-reset-open-app"
              href={`${OFFICER_APP_RESET}?uid=${encodeURIComponent(credential.uid)}&token=${encodeURIComponent(credential.token)}`}
              className={link}
            >
              {t("auth.reset_open_in_app")}
            </a>
          ) : null}
        </form>
      )}
    </LoginShell>
  );
}
