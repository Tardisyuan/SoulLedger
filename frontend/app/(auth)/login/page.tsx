"use client";

import { useEffect, useState, useRef } from "react";
import { TextField } from "@/src/components/ui/Field";
import { Button } from "@/src/components/ui/Button";
import { useSubmitErrorFocus } from "@/src/lib/submitErrorFocus";
import { authApi, isMfaRequired, type PublicCivilization, type LoginFailedBody, type LoginLockedBody } from "@soulledger/core/api";
import { setAccessToken, setRefreshToken } from "@soulledger/core/platform";
import { loginSchema } from "@soulledger/core/validations/schemas";
import { useFormValidation } from "@soulledger/core/validations/useFormValidation";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { LoginShell } from "@/src/components/auth/LoginShell";
import { CIVILIZATION_MARK } from "@/src/lib/civilizationIdentity";
import { defaultViewRoute } from "@/src/lib/defaultView";
import { storeMfaPending } from "@/src/lib/mfaPending";
import { cn } from "@/lib/utils";

/**
 * 登录(A9 §二,Design 2026-10-03):两栏 `minmax(0,1fr)` + 560,左 canvas 放律条与四文明,
 * 右 surface-1 放表单,中间 1px line。两栏共用三条横线:顶行 44(上边距 40)、内容起始线 216、底行。
 * 墨色宽带(v3 身份带的中性皮)去掉了 —— 登录前没有身份,品牌行就是这一页的头。
 * 393:顶栏 56 + 表单是首屏,律条放到表单**下方**(默认 4 行,可展开),四文明是 56 高的列表。
 *
 * 这一页**没有文明色**:登录前没有租户,主按钮走中性皮(墨色)。四文明的字形 ■●▲◆ 也是墨色。
 *
 * How the account controls landed (kept from 第三类 D 组 10a):
 * - 文明行: a LIST, not radios. A user has exactly one tenant (`User.tenant`) and the token's
 *   `tenant_code` is copied from it, so login takes no tenant and a radio would be a control that
 *   changes nothing the request carries. The rows come from the public `/auth/civilizations/`;
 *   the marked row is the civilization this device last signed in to (`LAST_TENANT_KEY`).
 *   A9 does not draw this list; it is kept (a behaviour of the page) and listed in the report.
 * - 「在此设备上保持登录 30 天」: `remember` on the login request (30-day refresh token).
 * - 忘记密码: accounts are opened by an administrator, so it notifies them — no reset link.
 * - The three failure states (A9 §二「状态」): `LoginView` counts failures per IP
 *   (`LOGIN_MAX_ATTEMPTS` / `LOGIN_WINDOW_SECONDS` in backend/apps/authentication/views.py) and
 *   returns `remaining_attempts` on a 401; a lockout is a 429 with `code: "login_locked"` and
 *   `retry_after`; no response at all (or a 5xx) is 「连不上服务器」 with a retry.
 * - 两步验证(A12):a 200 with `mfa_required` carries no tokens. The pending token goes to
 *   `sessionStorage` (`src/lib/mfaPending.ts`) and the page hands over to `/login/verify`, which
 *   wears the same shell (`src/components/auth/LoginShell.tsx` — the two-column skeleton, the
 *   statute and the four civilizations moved there verbatim so both steps share them).
 */

/** The tenant code this device last signed in to — only ever used to mark a row. */
const LAST_TENANT_KEY = "soulledger_last_tenant";

const REMEMBER_DAYS = 30;

/**
 * The server's limiter, for the two sentences that name it (「还可以再试 n 次,之后账号锁定 m 分钟」,
 * 「连续输错 n 次」). The API does not send them; LoginPage.test.tsx reads views.py and holds the rendered numbers
 * to it, so a change there goes red here instead of leaving the page saying the old numbers.
 */
const LOGIN_LIMIT = { attempts: 5, windowMinutes: 15 } as const;

type LoginFailure =
  | { kind: "credentials"; remaining: number | null }
  | { kind: "locked"; until: Date }
  | { kind: "network" };

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
        <h2 className="text-lg text-[oklch(var(--color-ink))]">{t("auth.forgot_password")}</h2>
        {/* 第三类 F 组 2.6:对任何账号名都是同一句 —— 账号不存在时后端不发通知,这里也不说。 */}
        <div role="status" className="rounded-control border border-[oklch(var(--color-line))] bg-[oklch(var(--color-canvas))] px-4 py-3 text-sm text-[oklch(var(--color-ink))]">
          <p className="font-semibold">{t("auth.forgot_sent")}</p>
          <p className="mt-1 text-[oklch(var(--color-ink-muted))]">{t("auth.forgot_sent_body")}</p>
        </div>
        <Button type="button" variant="ghost" onClick={onClose} className="w-full">
          {t("auth.back_to_login")}
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" data-testid="password-help-form">
      <h2 className="text-lg text-[oklch(var(--color-ink))]">{t("auth.forgot_password")}</h2>
      <p className="text-xs text-[oklch(var(--color-ink-muted))]">{t("auth.forgot_desc")}</p>
      <TextField
        id="password-help-username"
        name="username"
        autoComplete="username"
        type="text"
        label={t("auth.account")}
        value={username}
        onChange={(e) => setUsername(e.target.value)}
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
        disabled={state === "sending" || !username.trim()}
        loading={state === "sending"}
        className="w-full"
      >
        {t("auth.forgot_submit")}
      </Button>
      <Button type="button" variant="ghost" onClick={onClose} className="w-full">
        {t("auth.back_to_login")}
      </Button>
    </form>
  );
}

export default function LoginPage() {
  const { t, formatDate } = useI18n();
  const { showToast } = useToast();
  const { setUser } = useTenant();
  const [form, setForm] = useState({ username: "", password: "" });
  const [remember, setRemember] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  // Inline, not a toast (设计「错误」态), in a box under the form's title.
  const [failure, setFailure] = useState<LoginFailure | null>(null);

  // 锁定到期后自己解开:按钮与密码框恢复,提示框收起。
  const lockedUntil = failure?.kind === "locked" ? failure.until.getTime() : null;
  useEffect(() => {
    if (lockedUntil === null) return;
    const id = setTimeout(() => setFailure(null), Math.max(0, lockedUntil - Date.now()));
    return () => clearTimeout(id);
  }, [lockedUntil]);
  const locked = lockedUntil !== null;

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

  // `loginSchema` gives the form client-side validation, so an empty submit
  // is not a round trip to be told what the form already knew.
  const { validate, getError, clearFieldError } = useFormValidation(loginSchema);

  // 校验失败后焦点落在第一个被标为 invalid 的字段上,而不是留在提交按钮。
  const formRef = useRef<HTMLFormElement>(null);
  useSubmitErrorFocus(!!getError("username") || !!getError("password"), formRef);

  const submit = async () => {
    const result = validate(form);
    if (!result.success) return;

    setLoading(true);
    setFailure(null);

    try {
      const res = await authApi.login({ username: form.username, password: form.password, remember });

      if (isMfaRequired(res.data)) {
        // 第二步。What was typed is not kept: the pending token is the proof the password was right.
        storeMfaPending({ pending_token: res.data.pending_token, username: res.data.username });
        window.location.assign("/login/verify");
        return;
      }
      const tokens = res.data;
      // Through the ports: `lib/platform/web.ts` is the one place that knows the
      // access token is session-scoped and the refresh token a cookie.
      setAccessToken(tokens.access);
      setRefreshToken(tokens.refresh);

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
      const status = response?.status;
      if (status === 429 && data?.code === "login_locked") {
        setFailure({ kind: "locked", until: new Date(Date.now() + (data.retry_after ?? LOGIN_LIMIT.windowMinutes * 60) * 1000) });
        return;
      }
      // No response, or the server fell over: what was typed stays, and 重试 sends it again.
      if (!response || (status !== undefined && status >= 500)) {
        setFailure({ kind: "network" });
        return;
      }
      // 账号或密码不对:密码清空,账号保留,焦点回到密码框。字段本身不标红,提示框不说哪个错。
      setFailure({ kind: "credentials", remaining: typeof data?.remaining_attempts === "number" ? data.remaining_attempts : null });
      setForm((f) => ({ ...f, password: "" }));
      requestAnimationFrame(() => document.getElementById("login-password")?.focus());
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void submit();
  };

  const notice = failure ? (
    <div
      role="alert"
      data-testid="login-error"
      data-kind={failure.kind}
      className={cn(
        "flex items-start gap-3 rounded-control border bg-[oklch(var(--color-canvas))] px-4 py-3 text-sm",
        failure.kind === "locked" ? "border-[oklch(var(--color-warning))]" : "border-[oklch(var(--color-line))]"
      )}
    >
      <div className="min-w-0 flex-1">
        {failure.kind === "credentials" ? (
          <>
            <p className="font-medium text-[oklch(var(--color-danger))]">
              <span aria-hidden="true">! </span>
              {t("auth.error_credentials")}
            </p>
            {failure.remaining !== null ? (
              <p className="mt-1 text-xs text-[oklch(var(--color-ink-muted))]">
                {t("auth.error_attempts_body", { n: String(failure.remaining), m: String(LOGIN_LIMIT.windowMinutes) })}
              </p>
            ) : null}
          </>
        ) : failure.kind === "locked" ? (
          <>
            <p className="font-medium text-[oklch(var(--color-ink))]">
              <span aria-hidden="true">◐ </span>
              {t("auth.error_locked_title")}
            </p>
            <p className="mt-1 text-xs text-[oklch(var(--color-ink-muted))]">
              {t("auth.error_locked_body", {
                n: String(LOGIN_LIMIT.attempts),
                time: formatDate(failure.until, { hour: "2-digit", minute: "2-digit" }),
              })}
            </p>
          </>
        ) : (
          <>
            <p className="font-medium text-[oklch(var(--color-danger))]">
              <span aria-hidden="true">! </span>
              {t("auth.error_network")}
            </p>
            <p className="mt-1 text-xs text-[oklch(var(--color-ink-muted))]">{t("auth.error_network_body")}</p>
          </>
        )}
      </div>
      {failure.kind === "network" ? (
        <Button type="button" variant="secondary" size="sm" onClick={() => void submit()} disabled={loading}>
          {t("common.retry")}
        </Button>
      ) : null}
    </div>
  ) : null;

  return (
    <LoginShell>
      {helpOpen ? (
        <PasswordHelp initialUsername={form.username} onClose={() => setHelpOpen(false)} />
      ) : (
        <form ref={formRef} onSubmit={handleSubmit} className="flex w-full flex-col gap-4" aria-busy={loading || undefined}>
          <div>
            {/* 这一页唯一的 <h1>。 */}
            <h1 className="font-title text-xl font-semibold text-[oklch(var(--color-ink))]">{t("auth.login")}</h1>
            <p className="mt-1 text-sm text-[oklch(var(--color-ink-muted))]">{t("auth.subtitle")}</p>
          </div>

          {notice}

          {civilizations.length > 0 && (
            <section aria-labelledby="login-civilization-label" className="flex flex-col gap-2">
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
                        "flex items-center gap-2 border-b border-l-3 border-[oklch(var(--color-rule))] px-2 py-2 text-sm " +
                        // An ink bar, not a ●/○ glyph: ● is already the European shape mark beside it.
                        (marked
                          ? "bg-[oklch(var(--color-surface-2))] text-[oklch(var(--color-ink))] border-l-[oklch(var(--color-ink))]"
                          : "border-l-transparent text-[oklch(var(--color-ink-muted))]")
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
            label={t("auth.account")}
            value={form.username}
            onChange={(e) => {
              clearFieldError("username");
              setForm({ ...form, username: e.target.value });
            }}
            error={getError("username")}
            disabled={loading}
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
              data-revealed={showPassword || undefined}
              disabled={loading || locked}
              // Room for the 显示 button laid over the input's right end.
              style={{ paddingRight: 64 }}
              required
            />
            {/* 叠在输入框右端:标签行 18 + 间距 4,按钮 44 在 48 的框里上下各让 2。
                The visible word is the whole name — an aria-label containing 「密码」 would make
                `getByLabel("密码")` match two elements. */}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-controls="login-password"
              aria-pressed={showPassword}
              onClick={() => setShowPassword((v) => !v)}
              className="absolute top-6 right-0.5"
            >
              {showPassword ? t("soul_app.common.hide") : t("soul_app.common.show")}
            </Button>
          </div>

          <div className="flex items-center justify-between gap-3">
            <label className="flex min-h-11 items-center gap-2 text-xs text-[oklch(var(--color-ink-muted))]">
              <input
                type="checkbox"
                name="remember"
                className="size-4.5"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />
              {t("auth.remember_me", { days: String(REMEMBER_DAYS) })}
            </label>
            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              className="min-h-11 shrink-0 text-xs text-[oklch(var(--color-ink))] underline underline-offset-2"
            >
              {t("auth.forgot_password")}
            </button>
          </div>

          <Button type="submit" variant="primary" size="lg" disabled={loading || locked} loading={loading} className="w-full">
            {loading ? t("auth.submitting") : t("auth.login")}
            {!loading && (
              <span aria-hidden="true" className="font-mono text-2xs opacity-80">↵</span>
            )}
          </Button>
        </form>
      )}
    </LoginShell>
  );
}
