"use client";

import { LoginShell } from "@/src/components/auth/LoginShell";
import { useI18n } from "@/src/contexts/I18nContext";
import { DemoEntrances } from "./DemoEntrances";

/** The demo's login page: the same ways in as the landing page. */
export default function DemoLogin() {
  const { t } = useI18n();
  return (
    <LoginShell>
      <div className="flex flex-col gap-4" data-testid="demo-login">
        <h1 className="text-lg text-[oklch(var(--color-ink))]">{t("demo.landing.pick")}</h1>
        <p className="text-sm text-[oklch(var(--color-ink-muted))]">{t("demo.login_desc")}</p>
        <DemoEntrances />
      </div>
    </LoginShell>
  );
}
