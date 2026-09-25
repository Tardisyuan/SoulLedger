"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { TextField } from "@/src/components/ui/Field";
import { Button } from "@/src/components/ui/Button";
import { useSubmitErrorFocus } from "@/src/lib/submitErrorFocus";
import { authApi, type PublicCivilization, type LoginFailedBody, type LoginLockedBody } from "@soulledger/core/api";
import { setAccessToken, setRefreshToken } from "@soulledger/core/platform";
import { formatSigil } from "@soulledger/core/config/civilizationSigil";
import { formatCitation } from "@soulledger/core/config/statuteCitation";
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
 * How the design's four account controls landed:
 * - 文明行: a LIST, not radios. A user has exactly one tenant (`User.tenant`)
 *   and the token's `tenant_code` is copied from it, so login takes no tenant
 *   and a radio would be a control that changes nothing the request carries.
 *   The rows come from the public `/auth/civilizations/`; the marked row is
 *   the civilization this device last signed in to (`LAST_TENANT_KEY`).
 * - 「在此设备上保持登录 30 天」: `remember` on the login request. The server
 *   issues a 30-day refresh token carrying a `remember` claim, and
 *   `lib/platform/web.ts` sizes the cookie from it; unticked, the cookie is a
 *   session cookie.
 * - 忘记密码: accounts are opened by an administrator, so it notifies them
 *   (`/auth/password-help/`) — no reset link. The confirmation is the same
 *   sentence whatever username was typed.
 * - 「还可以再试 N 次」: `LoginView` counts failures per IP (5 / 15 min) and
 *   returns `remaining_attempts` on a failed login; a lockout is a 429 with
 *   `code: "login_locked"` and `retry_after`, shown as 「已锁定，M 分钟后再试」.
 */
const CIVS = ["CHINESE", "EUROPEAN", "EGYPTIAN", "GREEK"] as const;

/** The tenant code this device last signed in to — only ever used to mark a row. */
const LAST_TENANT_KEY = "soulledger_last_tenant";

const REMEMBER_DAYS = 30;

function readLastTenant(): string | null {
  try {
    return localStorage.getItem(LAST_TENANT_KEY);
  } catch {
    return null;
  }
}

function writeLastTenant(code: string | undefined): void {
  try {
    if (code) localStorage.setItem(LAST_TENANT_KEY, code);
  } catch {
    // Storage disabled: the rows simply go unmarked next time.
  }
}

/**
 * 忘记密码. Posts the username and shows ONE confirmation for every answer the
 * server can give with a 200 — the endpoint never says whether the account
 * exists, and this form must not reintroduce the difference by branching on
 * anything but the status.
 */
function PasswordHelp({ initialUsername, onClose }: { initialUsername: string; onClose: () => void }) {
  const { t } = useI18n();
  const [username, setUsername] = useState(initialUsername);
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return;
    setState("sending");
    setError(null);
    try {
      await authApi.requestPasswordHelp(username.trim());
      setState("sent");
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      setError(t(status === 429 ? "auth.rate_limited" : "auth.forgot_failed"));
      setState("idle");
    }
  };

  if (state === "sent") {
    return (
      <div className="flex flex-col gap-4" data-testid="password-help-sent">
        <h2 className="text-md text-[oklch(var(--color-ink))]">{t("auth.forgot_password")}</h2>
        {/* 第三类 F 组 2.6:对任何账号名都是同一句 —— 账号不存在时后端不发通知,这里也不说。 */}
        <div role="status" className="border border-[oklch(var(--color-line))] bg-[oklch(var(--color-surface-1))] px-4 py-3 text-sm text-[oklch(var(--color-ink))]">
          <p className="font-semibold">{t("auth.forgot_sent")}</p>
          <p className="mt-1 text-[oklch(var(--color-ink-muted))]">{t("auth.forgot_sent_body")}</p>
        </div>
        <Button type="button" variant="ghost" onClick={onClose} className="w-full h-10 max-sm:h-12">
          {t("auth.back_to_login")}
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" data-testid="password-help-form">
      <h2 className="text-md text-[oklch(var(--color-ink))]">{t("auth.forgot_password")}</h2>
      <p className="text-xs text-[oklch(var(--color-ink-muted))]">{t("auth.forgot_desc")}</p>
      <TextField
        id="password-help-username"
        name="username"
        autoComplete="username"
        type="text"
        label={t("auth.username")}
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        required
      />
      {error && (
        <div
          role="alert"
          className="border border-[oklch(var(--color-danger))] bg-[oklch(var(--color-danger-tint))] px-4 py-3 text-sm font-medium text-[oklch(var(--color-danger))]"
        >
          {error}
        </div>
      )}
      <Button
        type="submit"
        variant="primary"
        disabled={state === "sending" || !username.trim()}
        loading={state === "sending"}
        className="w-full h-10 max-sm:h-12"
      >
        {t("auth.forgot_submit")}
      </Button>
      <Button type="button" variant="ghost" onClick={onClose} className="w-full h-10 max-sm:h-12">
        {t("auth.back_to_login")}
      </Button>
    </form>
  );
}

export default function LoginPage() {
  const { t } = useI18n();
  const { showToast } = useToast();
  const { setUser } = useTenant();
  const [form, setForm] = useState({ username: "", password: "" });
  const [remember, setRemember] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
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

  // 文明行. Fetched after mount (the list is public) and marked from this
  // device's last sign-in. A failed fetch leaves the list out: it is
  // information, and signing in does not depend on it.
  const [civilizations, setCivilizations] = useState<PublicCivilization[]>([]);
  const [lastTenant, setLastTenant] = useState<string | null>(null);
  useEffect(() => {
    setLastTenant(readLastTenant());
    let cancelled = false;
    authApi
      .civilizations()
      .then((res) => {
        if (!cancelled) setCivilizations(res.data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

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
      const res = await authApi.login({ username: form.username, password: form.password, remember });

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
        writeLastTenant(tokens.user.tenant?.code);
      }

      showToast(t("auth.login_success"), "success");
      // The operator's saved 默认视图, asked of the server with the token just
      // stored; /dashboard when there is none.
      window.location.href = await defaultViewRoute();
      return;
    } catch (err: unknown) {
      const response = (err as { response?: { status?: number; data?: Partial<LoginFailedBody & LoginLockedBody> } })
        ?.response;
      const data = response?.data;
      // `LoginView` counts failures per IP (5 / 15 min). The 429 used to be
      // `{error}` only, which nothing here read, so a lockout said 「登录失败」.
      if (response?.status === 429 && data?.code === "login_locked") {
        const minutes = Math.max(1, Math.ceil((data.retry_after ?? 900) / 60));
        setLoginError(t("auth.error_locked", { minutes: String(minutes) }));
        return;
      }
      if (typeof data?.remaining_attempts === "number") {
        setLoginError(t("auth.error_attempts_left", { count: String(data.remaining_attempts) }));
        return;
      }
      const raw = data?.detail || "Login failed";

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
            {/* 〔文献 · 条号〕—— 与语料页「复制引用」同一个括号(core/config/statuteCitation)。 */}
            <figcaption data-testid="login-statute-cite" className="pl-[18px] font-mono text-xs text-[oklch(var(--color-ink-muted))]">
              {formatCitation(
                t(`judgment.statute_corpus.${statute.corpus}`),
                formatSigil(statute.civilization, statute.ref) ?? statute.code
              )}
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
          <div className="flex w-full max-w-[360px] flex-col gap-4">
            {helpOpen ? (
              <PasswordHelp initialUsername={form.username} onClose={() => setHelpOpen(false)} />
            ) : (
              <form ref={formRef} onSubmit={handleSubmit} className="flex w-full flex-col gap-4">
                <h2 className="text-md text-[oklch(var(--color-ink))]">{t("auth.login")}</h2>

                {civilizations.length > 0 && (
                  <section aria-labelledby="login-civilization-label" className="flex flex-col gap-1.5">
                    <p id="login-civilization-label" className="text-xs text-[oklch(var(--color-ink-muted))]">
                      {t("auth.civilization")}
                    </p>
                    <ul data-testid="login-civilizations" className="m-0 p-0 list-none border-t border-[oklch(var(--color-rule))]">
                      {civilizations.map((row) => {
                        const marked = row.code === lastTenant;
                        return (
                          <li
                            key={row.code}
                            aria-current={marked ? "true" : undefined}
                            className={
                              "flex items-center gap-2 border-b border-[oklch(var(--color-rule))] px-2 py-1.5 text-sm " +
                              // An ink bar, not a ●/○ glyph: ● is already the
                              // European shape mark right beside it.
                              (marked
                                ? "bg-[oklch(var(--color-surface-2))] text-[oklch(var(--color-ink))] shadow-[inset_3px_0_0_oklch(var(--color-ink))]"
                                : "text-[oklch(var(--color-ink-muted))]")
                            }
                          >
                            <span aria-hidden="true">{CIVILIZATION_MARK[row.civilization] ?? ""}</span>
                            <span>{t(`organization.civilizations.${row.civilization}`)}</span>
                          </li>
                        );
                      })}
                    </ul>
                    <p className="text-2xs text-[oklch(var(--color-ink-subtle))]">{t("auth.civilization_note")}</p>
                  </section>
                )}

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

                <div className="flex items-center justify-between gap-3">
                  <label className="flex items-center gap-2 text-xs text-[oklch(var(--color-ink-muted))]">
                    <input
                      type="checkbox"
                      name="remember"
                      checked={remember}
                      onChange={(e) => setRemember(e.target.checked)}
                    />
                    {t("auth.remember_me", { days: String(REMEMBER_DAYS) })}
                  </label>
                  <button
                    type="button"
                    onClick={() => setHelpOpen(true)}
                    className="shrink-0 text-xs text-[oklch(var(--color-accent-ink))] underline"
                  >
                    {t("auth.forgot_password")}
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
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
