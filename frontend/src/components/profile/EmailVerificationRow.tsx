"use client";

import { useMutation } from "@tanstack/react-query";
import { authApi } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { showToast } from "@/src/components/ui/Toast";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";

const DT = "py-2 border-b border-[oklch(var(--color-rule))] text-[oklch(var(--color-ink-subtle))] self-stretch flex items-center";
const DD = "py-2 border-b border-[oklch(var(--color-rule))] text-[oklch(var(--color-ink))] min-w-0 flex items-center gap-2 flex-wrap";

/**
 * 资料页「邮箱验证」一行(2026-10-09):已验证 / 未验证,未验证时给「发送验证邮件」。
 * 只有已验证的邮箱才收得到「忘记密码」的重置邮件;改邮箱后后端立刻把它算回未验证(存的是被验证的地址),
 * 所以这一行读的是 `/auth/profile/` 的 `email_verified`,不在前端自己记。没有邮箱时不显示这一行。
 */
export function EmailVerificationRow({ hasEmail, verified }: { hasEmail: boolean; verified: boolean }) {
  const { t } = useI18n();
  const send = useMutation({
    mutationFn: () => authApi.sendEmailVerification(),
    onSuccess: () => showToast(t("profile.email_verification_sent"), "success"),
    onError: (err: unknown) => {
      const status = (err as { response?: { status?: number } })?.response?.status;
      showToast(t(status === 429 ? "auth.rate_limited" : "profile.email_verification_failed"), "error");
    },
  });

  if (!hasEmail) return null;
  return (
    <>
      <dt className={DT}>{t("profile.email_verification")}</dt>
      <dd className={DD} data-testid="email-verification">
        {verified ? (
          <Badge tone="success" glyph="✓">{t("profile.email_verified")}</Badge>
        ) : (
          <>
            <Badge tone="warning" glyph="○">{t("profile.email_unverified")}</Badge>
            <Button variant="secondary" size="sm" type="button" loading={send.isPending} onClick={() => send.mutate()}>
              {t("profile.email_send_verification")}
            </Button>
            <span className="basis-full text-xs text-[oklch(var(--color-ink-muted))]">{t("profile.email_verification_hint")}</span>
          </>
        )}
      </dd>
    </>
  );
}
