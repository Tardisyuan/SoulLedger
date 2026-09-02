"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { TextField } from "@/src/components/ui/Field";
import { Button } from "@/src/components/ui/Button";
import { authApi } from "@soulledger/core/api";
import { loginSchema } from "@soulledger/core/validations/schemas";
import { useFormValidation } from "@soulledger/core/validations/useFormValidation";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { useTenant } from "@/src/contexts/TenantContext";

export default function LoginPage() {
  const { t } = useI18n();
  const { showToast } = useToast();
  const { setUser } = useTenant();
  const router = useRouter();
  const [form, setForm] = useState({ username: "", password: "" });
  const [loading, setLoading] = useState(false);
  // `loginSchema` had ZERO consumers. It sat in lib/validations/schemas.ts
  // beside `judgmentCreateSchema`, which drifted to three civilizations while
  // nobody used it and would have shipped that defect the day anything did.
  // A schema with no caller is not a spare part; it is a claim nothing checks.
  //
  // It also closes the gap that made this the worst of the three validation
  // regimes in the app: the login form had no client-side validation at all,
  // so an empty submit was a round trip to be told what the form already knew.
  const { validate, getError, clearFieldError } = useFormValidation(loginSchema);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const result = validate(form);
    if (!result.success) return;

    setLoading(true);

    try {
      const res = await authApi.login(form.username, form.password);

      const tokens = res.data;
      // Store access token in sessionStorage (not cookie) to limit XSS exposure
      sessionStorage.setItem("soulledger_access", tokens.access);
      // `Secure` only over https — it is dropped on plain http, which is what
      // `npm run dev` and the e2e suite serve. Same rule as the refresh
      // interceptor's; see packages/core/src/api/client.ts::refreshCookie.
      const secure = location.protocol === "https:" ? "; Secure" : "";
      document.cookie = `soulledger_refresh=${tokens.refresh}; path=/; max-age=604800; SameSite=Lax${secure}`;

      // Populate TenantContext so downstream components have tenant/user info
      if (tokens.user) {
        setUser(tokens.user);
      }

      showToast(t("auth.login_success"), "success");
      window.location.href = "/dashboard";
      return;
    } catch (err: unknown) {
      const raw = (err as { response?: { data?: { detail?: string } } })
        ?.response?.data?.detail || "Login failed";

      // Map backend error messages to i18n keys
      const msgKey: Record<string, string> = {
        "No active account found with the given credentials": "auth.error_invalid_credentials",
        "Invalid token": "auth.error_invalid_token",
        "Token has expired": "auth.error_token_expired",
      };

      const i18nKey = msgKey[raw] ?? "auth.error_login_failed";
      showToast(t(i18nKey) || raw, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[hsl(var(--color-canvas))]">
      <div className="w-full max-w-md px-6">
        {/* On the type scale and the spacing rhythm, and on the shared form
            primitives. This was the last page still speaking pre-migration
            Tailwind — `text-3xl` / `text-xl` / `text-sm`, `p-8`, `py-2.5` —
            which mattered more here than anywhere else, because it is the
            first screen anyone sees.

            The defect underneath the styling: the submit button was
            `bg-accent` with `text-ink`. Dark-mode ink is
            `210 11% 96%`, near-white, so the label measured **1.95:1** on the
            amber fill; `Button`'s primary is `text-black`, which is 9.82:1.
            Same accent-foreground mistake as FollowButton, on the one control
            every user presses. */}
        <div className="text-center mb-6">
          <h1 className="text-07 text-[hsl(var(--color-ink))] mb-2">{t("nav.title")}</h1>
          <p className="text-04 text-[hsl(var(--color-ink-muted))]">{t("home.hero_subtitle")}</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] p-6"
        >
          <h2 className="text-06 text-[hsl(var(--color-ink))] mb-6 text-center">
            {t("auth.login")}
          </h2>

          <div className="space-y-4">
            <TextField
              id="login-username"
              name="username"
              autoComplete="username"
              type="text"
              label={t("auth.username")}
              value={form.username}
              onChange={(e) => {
                clearFieldError("username");
                setForm({ ...form, username: e.target.value });
              }}
              error={getError("username")}
              placeholder="admin"
              required
            />
            <TextField
              id="login-password"
              name="password"
              autoComplete="current-password"
              type="password"
              label={t("auth.password")}
              value={form.password}
              onChange={(e) => {
                clearFieldError("password");
                setForm({ ...form, password: e.target.value });
              }}
              error={getError("password")}
              placeholder="••••••••"
              required
            />
          </div>

          <Button
            type="submit"
            variant="primary"
            disabled={loading}
            loading={loading}
            className="w-full mt-6"
          >
            {loading ? t("auth.logging_in") : t("auth.login")}
          </Button>
        </form>

        <p className="text-center text-03 text-[hsl(var(--color-ink-subtle))] mt-6">
          <Link href="/" className="text-[hsl(var(--color-accent-ink))] hover:underline">
            {t("nav.home")}
          </Link>
        </p>
      </div>
    </div>
  );
}
