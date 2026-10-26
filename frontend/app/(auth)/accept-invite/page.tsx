"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { authApi } from "@soulledger/core/api";
import { passwordReasonKeys } from "@soulledger/core/api/auth";
import { useI18n } from "@/src/contexts/I18nContext";
import { LoginShell } from "@/src/components/auth/LoginShell";
import { PasswordRuleFields, usePasswordRules } from "@/src/components/auth/PasswordRules";
import { Button } from "@/src/components/ui/Button";

/**
 * 接受邀请(第五十四批 V-3):邮件里的链接落在这里,`?uid=…&token=…`,与 `/reset-password` 同一个外壳。
 *
 * 与重置不同:失效页**不区分**是哪一种失效(过期 / 用过 / 被重发顶掉),也**不给「再要一个链接」**——
 * 邀请只能由管理员重发。令牌读出后立刻从地址栏抹掉(一次性凭据)。
 * `weak_password` 的原因逐条列出;429 时按钮置灰并倒数 `retry_after` 秒。
 */
type Phase = "reading" | "form" | "invalid" | "done";

export default function AcceptInvitePage() {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>("reading");
  const [credential, setCredential] = useState<{ uid: string; token: string } | null>(null);
  const rules = usePasswordRules();
  const [loading, setLoading] = useState(false);
  const [reasons, setReasons] = useState<string[]>([]);
  const [failed, setFailed] = useState(false);
  const [wait, setWait] = useState(0);

  // 严格模式下 effect 跑两遍:第一遍读到凭据并抹掉地址栏,第二遍读到空参数会误判成失效(同 reset-password)。
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

  useEffect(() => {
    if (wait <= 0) return;
    const timer = window.setTimeout(() => setWait((n) => n - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [wait]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!credential || loading || wait > 0) return;
    if (!rules.check()) return;
    setLoading(true);
    setReasons([]);
    setFailed(false);
    try {
      await authApi.acceptOfficerInvite({ ...credential, new_password: rules.next });
      setPhase("done");
    } catch (err: unknown) {
      const response = (err as { response?: { status?: number; data?: { code?: string; retry_after?: number } } })?.response;
      if (response?.data?.code === "invite_link_invalid") {
        setPhase("invalid");
      } else if (response?.data?.code === "weak_password") {
        rules.reject();
        setReasons(passwordReasonKeys(response.data));
      } else if (response?.status === 429) {
        setWait(Math.max(1, Math.ceil(Number(response.data?.retry_after) || 60)));
      } else {
        setFailed(true);
      }
    } finally {
      setLoading(false);
    }
  };

  const link = "inline-flex min-h-11 items-center text-xs text-[oklch(var(--color-ink))] underline underline-offset-2";
  const box = "rounded-control border border-[oklch(var(--color-line))] bg-[oklch(var(--color-canvas))] px-4 py-3 text-sm";
  const h1 = "font-title text-xl font-semibold text-[oklch(var(--color-ink))]";
  const note = <p className="text-xs text-[oklch(var(--color-ink-muted))]">{t("acceptInvite.link_note")}</p>;

  return (
    <LoginShell narrowStatute={false} back={{ href: "/login", label: t("auth.back_to_login") }}>
      {phase === "reading" ? null : phase === "invalid" ? (
        <div className="flex flex-col gap-4" data-testid="accept-invite-invalid">
          <h1 className={h1}>{t("acceptInvite.invalid_title")}</h1>
          <div role="alert" className={box}>
            <p className="text-[oklch(var(--color-ink-muted))]">{t("acceptInvite.invalid_body")}</p>
          </div>
          {note}
        </div>
      ) : phase === "done" ? (
        <div className="flex flex-col gap-4" data-testid="accept-invite-done">
          <h1 className={h1}>{t("acceptInvite.done_title")}</h1>
          <div role="status" className={`${box} text-[oklch(var(--color-ink))]`}>
            <p className="text-[oklch(var(--color-ink-muted))]">{t("acceptInvite.done_body")}</p>
          </div>
          <Link href="/login" className={link}>
            {t("acceptInvite.go_login")}
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="flex w-full flex-col gap-4" data-testid="accept-invite-form" aria-busy={loading || undefined}>
          <div>
            <h1 className={h1}>{t("acceptInvite.title")}</h1>
            <p className="mt-1 text-sm text-[oklch(var(--color-ink-muted))]">{t("acceptInvite.subtitle")}</p>
          </div>
          <PasswordRuleFields
            rules={rules}
            idPrefix="accept-invite"
            newLabel={t("acceptInvite.new_password")}
            confirmLabel={t("acceptInvite.confirm_password")}
          />
          {reasons.length > 0 && (
            <div role="alert" className={`${box} text-[oklch(var(--color-danger))]`} data-testid="accept-invite-weak">
              <p className="font-medium">
                <span aria-hidden="true">! </span>
                {t("acceptInvite.weak")}
              </p>
              <ul className="mt-1 list-none p-0">
                {reasons.map((key) => (
                  <li key={key}>{t(key)}</li>
                ))}
              </ul>
            </div>
          )}
          {wait > 0 && (
            <div role="alert" className={`${box} font-medium text-[oklch(var(--color-danger))]`}>
              <span aria-hidden="true">! </span>
              {t("acceptInvite.rate_limited", { seconds: String(wait) })}
            </div>
          )}
          {failed && (
            <div role="alert" className={`${box} font-medium text-[oklch(var(--color-danger))]`}>
              <span aria-hidden="true">! </span>
              {t("auth.forgot_failed")}
            </div>
          )}
          <Button type="submit" variant="primary" size="lg" disabled={loading || wait > 0} loading={loading} className="w-full">
            {t("acceptInvite.submit")}
          </Button>
          {note}
        </form>
      )}
    </LoginShell>
  );
}
