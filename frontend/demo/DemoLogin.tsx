"use client";

import { useState } from "react";
import { authApi, isMfaRequired } from "@soulledger/core/api";
import { setAccessToken, setRefreshToken } from "@soulledger/core/platform";
import { Button } from "@/src/components/ui/Button";
import { LoginShell } from "@/src/components/auth/LoginShell";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { defaultViewRoute } from "@/src/lib/defaultView";
import { DEMO_USERNAMES, type DemoRole } from "./store";

const ROLES: DemoRole[] = ["judge", "admin", "moderator"];

/** The demo's login page: one click per role, through the same `authApi.login` the real page uses (the demo answers it). */
export default function DemoLogin() {
  const { t } = useI18n();
  const { setUser } = useTenant();
  const [entering, setEntering] = useState<DemoRole | null>(null);

  const enter = async (role: DemoRole) => {
    setEntering(role);
    const { data } = await authApi.login({ username: DEMO_USERNAMES[role], password: "demo", remember: false });
    if (isMfaRequired(data)) return;
    setAccessToken(data.access);
    setRefreshToken(data.refresh);
    if (data.user) setUser(data.user);
    window.location.href = await defaultViewRoute(data.user);
  };

  return (
    <LoginShell>
      <div className="flex flex-col gap-4" data-testid="demo-login">
        <h1 className="text-lg text-[oklch(var(--color-ink))]">{t("demo.login_title")}</h1>
        <p className="text-sm text-[oklch(var(--color-ink-muted))]">{t("demo.login_desc")}</p>
        {ROLES.map((role) => (
          <div key={role} className="flex flex-col gap-1">
            <Button
              type="button"
              variant={role === "judge" ? "primary" : "secondary"}
              className="w-full"
              disabled={entering !== null}
              loading={entering === role}
              onClick={() => void enter(role)}
              data-testid={`demo-enter-${role}`}
            >
              {t("demo.enter_as", { role: t(`demo.role_${role}`) })}
            </Button>
            <p className="text-xs text-[oklch(var(--color-ink-subtle))]">{t(`demo.role_${role}_desc`)}</p>
          </div>
        ))}
      </div>
    </LoginShell>
  );
}
