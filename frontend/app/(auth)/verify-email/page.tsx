"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { authApi } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { LoginShell } from "@/src/components/auth/LoginShell";

/**
 * 邮箱验证链接的落点(2026-10-09):`?uid=…&token=…`,打开即验证。令牌本身就是凭据,
 * 所以不要求已登录(proxy.ts 里是公开路由);读出后立刻从地址栏抹掉。
 * 链接只能用一次 —— React 严格模式下 effect 会跑两遍,用 ref 挡住第二次,否则第二次请求会把成功的页面
 * 改成「链接无效」。
 *
 * 只有服务器明确拒绝(4xx,429 除外)才是「链接无效」。连不上、5xx、被限流时令牌并没有被用掉,
 * 所以是 `failed`:说连不上,给「重试」。令牌已从地址栏抹掉,留在 ref 里供重试 —— 此前这几种情况
 * 一律报「链接无效」,而刷新只剩一个没有参数的页面(2026-10-13 只读检查发现)。
 */
export default function VerifyEmailPage() {
  const { t } = useI18n();
  const [phase, setPhase] = useState<"working" | "done" | "invalid" | "failed">("working");
  const started = useRef(false);
  const credential = useRef<{ uid: string; token: string } | null>(null);

  const verify = () => {
    if (!credential.current) return;
    setPhase("working");
    authApi
      .verifyEmail(credential.current)
      .then(() => setPhase("done"))
      .catch((err: unknown) => {
        const status = (err as { response?: { status?: number } })?.response?.status;
        setPhase(status !== undefined && status >= 400 && status < 500 && status !== 429 ? "invalid" : "failed");
      });
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const params = new URLSearchParams(window.location.search);
    const uid = params.get("uid");
    const token = params.get("token");
    window.history.replaceState(null, "", window.location.pathname);
    if (!uid || !token) {
      setPhase("invalid");
      return;
    }
    credential.current = { uid, token };
    verify();
  }, []);

  const link = "inline-flex min-h-11 items-center text-xs text-[oklch(var(--color-ink))] underline underline-offset-2";
  const box = "rounded-control border border-[oklch(var(--color-line))] bg-[oklch(var(--color-canvas))] px-4 py-3 text-sm";

  return (
    <LoginShell narrowStatute={false} back={{ href: "/login", label: t("auth.back_to_login") }}>
      <div className="flex flex-col gap-4" data-testid="verify-email" data-phase={phase}>
        <h1 className="font-title text-xl font-semibold text-[oklch(var(--color-ink))]">{t("auth.verify_title")}</h1>
        {phase === "working" ? (
          <p role="status" className="text-sm text-[oklch(var(--color-ink-muted))]">{t("auth.verify_working")}</p>
        ) : phase === "done" ? (
          <div role="status" className={`${box} text-[oklch(var(--color-ink))]`}>
            <p className="font-semibold">{t("auth.verify_done")}</p>
            <p className="mt-1 text-[oklch(var(--color-ink-muted))]">{t("auth.verify_done_body")}</p>
          </div>
        ) : phase === "failed" ? (
          <div role="alert" className={box} data-testid="verify-email-failed">
            <p className="font-medium text-[oklch(var(--color-danger))]">
              <span aria-hidden="true">! </span>
              {t("auth.error_network")}
            </p>
            <button type="button" onClick={verify} className={link}>
              {t("common.retry")}
            </button>
          </div>
        ) : (
          <div role="alert" className={box}>
            <p className="font-medium text-[oklch(var(--color-danger))]">
              <span aria-hidden="true">! </span>
              {t("auth.verify_invalid")}
            </p>
            <p className="mt-1 text-xs text-[oklch(var(--color-ink-muted))]">{t("auth.verify_invalid_body")}</p>
          </div>
        )}
        {phase === "done" || phase === "invalid" ? (
          <Link href="/profile" className={link}>
            {t("auth.verify_go_profile")}
          </Link>
        ) : null}
      </div>
    </LoginShell>
  );
}
