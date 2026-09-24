"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { TextField } from "@/src/components/ui/Field";
import { Button } from "@/src/components/ui/Button";
import { useSubmitErrorFocus } from "@/src/lib/submitErrorFocus";
import { authApi } from "@soulledger/core/api";
import { setAccessToken, setRefreshToken } from "@soulledger/core/platform";
import { formatSigil } from "@soulledger/core/config/civilizationSigil";
import { loginSchema } from "@soulledger/core/validations/schemas";
import { useFormValidation } from "@soulledger/core/validations/useFormValidation";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeToggle } from "@/src/components/layout/ThemeToggle";
import { CIVILIZATION_MARK, NUMBERING_SAMPLE } from "@/src/lib/civilizationIdentity";
import { LOGIN_STATUTES } from "@/src/lib/loginStatutes";
import { defaultViewRoute } from "@/src/lib/defaultView";

/**
 * 登录(第三类 D 组 10a):壳外页,左右各半。左半「今日律条」+ 四文明编号法,
 * 右半表单。窄屏律条缩到 20px 放在表单上方,编号法一行隐藏 —— 它是装饰。
 *
 * What the design drew and this page deliberately does not have:
 * - 文明单选行. `authApi.login(username, password)` takes no tenant; the tenant
 *   comes back on the user (`tokens.user.tenant`). A radio that changes nothing
 *   the request carries would be a control that lies.
 * - 「在此设备上保持登录 30 天」. There is no remember-me in the API; refresh
 *   lifetime is the backend's setting, not a login-time choice.
 * - 「还可以再试 N 次」. `LoginView` counts attempts per IP in cache
 *   (5 / 15 min) but returns no count, only a 429 once the limit is hit.
 * - 忘记密码. No such route or endpoint exists for staff accounts.
 */
const CIVS = ["CHINESE", "EUROPEAN", "EGYPTIAN", "GREEK"] as const;

export default function LoginPage() {
  const { t } = useI18n();
  const { showToast } = useToast();
  const { setUser } = useTenant();
  const [form, setForm] = useState({ username: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  // Inline, not a toast (设计「错误」态). The toast used to be the only surface,
  // and it went away after a few seconds with the form still showing nothing.
  const [loginError, setLoginError] = useState<string | null>(null);
  // Index 0 on the server and the first client render, then a random pick
  // after mount: a random index during render would hydrate against a
  // different quote than the server sent.
  const [statuteIndex, setStatuteIndex] = useState(0);
  useEffect(() => {
    setStatuteIndex(Math.floor(Math.random() * LOGIN_STATUTES.length));
  }, []);
  const statute = LOGIN_STATUTES[statuteIndex];

  // `loginSchema` had ZERO consumers. It sat in lib/validations/schemas.ts
  // beside `judgmentCreateSchema`, which drifted to three civilizations while
  // nobody used it and would have shipped that defect the day anything did.
  // A schema with no caller is not a spare part; it is a claim nothing checks.
  //
  // It also closes the gap that made this the worst of the three validation
  // regimes in the app: the login form had no client-side validation at all,
  // so an empty submit was a round trip to be told what the form already knew.
  const { validate, getError, clearFieldError } = useFormValidation(loginSchema);

  // 校验失败后焦点落在第一个被标为 invalid 的字段上,而不是留在提交按钮。
  // `useFormValidation` 的错误经 `Field` 变成 `aria-invalid`,所以这里不需要
  // 一张字段名清单 —— 问文档就行,DOM 顺序即视觉顺序。
  const formRef = useRef<HTMLFormElement>(null);
  useSubmitErrorFocus(!!getError("username") || !!getError("password"), formRef);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const result = validate(form);
    if (!result.success) return;

    setLoading(true);
    setLoginError(null);

    try {
      const res = await authApi.login(form.username, form.password);

      const tokens = res.data;
      // Through the ports, the same way `rotateRefreshToken` writes them. This
      // page used to `sessionStorage.setItem` and `document.cookie =` directly
      // — a second copy of where each token lives, and `TenantContext.logout`
      // was a third; the third one was wrong (FL-02). `lib/platform/web.ts` is
      // the one place that knows the access token is session-scoped and the
      // refresh token a `SameSite=Lax` cookie with `Secure` keyed on the page
      // protocol; nothing about those attributes changed.
      setAccessToken(tokens.access);
      setRefreshToken(tokens.refresh);

      // Populate TenantContext so downstream components have tenant/user info
      if (tokens.user) {
        setUser(tokens.user);
      }

      showToast(t("auth.login_success"), "success");
      // /dashboard unless the operator picked 操作员 on /welcome.
      window.location.href = defaultViewRoute();
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
      setLoginError(t(i18nKey) || raw);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[oklch(var(--color-canvas))]">
      {/* 壳外页的页头:没有侧栏、没有面包屑,只有品牌、语言、主题。 */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-[oklch(var(--color-block))] px-4 md:px-6 font-mono text-xs">
        <span aria-hidden="true" className="font-semibold tracking-[var(--tracking-meta)] text-[oklch(var(--color-ink))]">SOULLEDGER</span>
        <h1 className="text-xs font-normal text-[oklch(var(--color-ink-muted))]">{t("nav.title")}</h1>
        <span className="ml-auto flex items-center gap-3">
          <LanguageSwitcher />
          <ThemeToggle />
        </span>
      </header>

      <main className="grid flex-1 grid-cols-1 content-start md:grid-cols-2 md:content-normal">
        <section
          aria-label={t("auth.statute_of_day")}
          className="flex flex-col gap-4 md:gap-6 bg-[oklch(var(--color-surface-1))] px-4 py-6 md:px-14 md:py-14 md:border-r md:border-[oklch(var(--color-line))]"
        >
          <div className="font-mono text-2xs text-[oklch(var(--color-ink-subtle))] pb-1 border-b border-[oklch(var(--color-block))]">
            {t("auth.statute_of_day")}
          </div>
          <figure className="m-0 flex flex-col gap-3">
            <blockquote
              data-testid="login-statute"
              className="m-0 max-w-[28ch] border-l-2 border-[oklch(var(--color-ink))] pl-4 font-serif text-quote md:text-xl text-pretty text-[oklch(var(--color-ink))]"
            >
              {statute.text}
            </blockquote>
            <figcaption className="pl-[18px] font-mono text-xs text-[oklch(var(--color-ink-muted))]">
              〔{formatSigil(statute.civilization, statute.ref)} · {statute.code}〕
            </figcaption>
          </figure>
          <p className="text-xs text-[oklch(var(--color-ink-subtle))]">{t("auth.statute_fixed_note")}</p>
          {/* 编号法:四文明各一格。窄屏隐藏(设计:装饰,不属于信息)。 */}
          <dl
            aria-label={t("auth.numbering")}
            className="mt-auto hidden md:grid grid-cols-4 border-t border-[oklch(var(--color-block))]"
          >
            {CIVS.map((civ) => (
              <div key={civ} className="pt-2 pr-3 border-r border-[oklch(var(--color-rule))] last:border-r-0">
                <dt className="text-xs text-[oklch(var(--color-ink-muted))]">
                  <span aria-hidden="true">{CIVILIZATION_MARK[civ]} </span>
                  {t(`organization.civilizations.${civ}`)}
                </dt>
                <dd className="m-0 mt-0.5 font-mono text-sm text-[oklch(var(--color-ink))]">{NUMBERING_SAMPLE[civ]}</dd>
              </div>
            ))}
          </dl>
        </section>

        <div className="flex justify-center px-4 py-6 md:px-14 md:py-14">
          <form ref={formRef} onSubmit={handleSubmit} className="flex w-full max-w-[360px] flex-col gap-4">
            <h2 className="text-md text-[oklch(var(--color-ink))]">{t("auth.login")}</h2>

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
            <div className="relative">
              <TextField
                id="login-password"
                name="password"
                autoComplete="current-password"
                type={showPassword ? "text" : "password"}
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
              {/* In the label row rather than inside the input: the input's
                  bottom edge moves when an error line appears under it. The
                  visible word is the whole name — an aria-label containing
                  「密码」 would make `getByLabel("密码")` match two elements. */}
              <button
                type="button"
                aria-controls="login-password"
                aria-pressed={showPassword}
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-0 top-0 text-xs text-[oklch(var(--color-ink-subtle))] hover:text-[oklch(var(--color-ink))]"
              >
                {showPassword ? t("soul_app.common.hide") : t("soul_app.common.show")}
              </button>
            </div>

            {loginError && (
              <div
                role="alert"
                data-testid="login-error"
                className="border border-[oklch(var(--color-danger))] bg-[oklch(var(--color-danger-tint))] px-4 py-3 text-sm font-medium text-[oklch(var(--color-danger))]"
              >
                <span aria-hidden="true">! </span>
                {loginError}
              </div>
            )}

            <Button
              type="submit"
              variant="primary"
              disabled={loading}
              loading={loading}
              className="w-full h-10 max-sm:h-12"
            >
              {loading ? t("auth.logging_in") : t("auth.login")}
              {!loading && (
                <span aria-hidden="true" className="font-mono text-2xs opacity-80">⏎</span>
              )}
            </Button>

            <p className="text-xs text-[oklch(var(--color-ink-subtle))]">
              <Link href="/" className="text-[oklch(var(--color-accent-ink))] underline">
                {t("nav.home")}
              </Link>
            </p>
          </form>
        </div>
      </main>
    </div>
  );
}
