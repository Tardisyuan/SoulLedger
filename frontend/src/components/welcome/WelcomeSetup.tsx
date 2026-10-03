"use client";

import { useEffect, useState } from "react";
import { useI18n, LOCALE_LABELS, type Locale } from "@/src/contexts/I18nContext";
import { useTheme } from "@/src/contexts/ThemeContext";
import type { AuthUser } from "@/src/contexts/TenantContext";
import { Button } from "@/src/components/ui/Button";
import { SelectField } from "@/src/components/ui/Field";
import { RoleName } from "@/src/components/users/RoleName";
import { MissingValue } from "@/src/components/ui/DomainValue";
import { BrandMark } from "@/src/components/brand/BrandMark";
import { cn } from "@/lib/utils";
import { TENANT_CODE_TO_CIVILIZATION } from "@soulledger/core/config/civilizations";
import { authApi } from "@soulledger/core/api";
import { loadDefaultView, saveDefaultView, type DefaultView } from "@/src/lib/defaultView";
import { QUEUE_SHORTCUTS } from "@/src/lib/queueShortcuts";
import { APP_VERSION } from "@/src/lib/appVersion";

/**
 * 首次设置(A9 §三「首次进入」):单独占一屏,不和常规内容同时出现。960 宽的面板,左 280 是
 * 步骤栏,右边是当前这一步,底栏 80 放「跳过，直接进入」「上一步」「继续」。393 全屏、没有步骤栏:
 * 顶上是步数、「跳过」和一条 4 段进度条,底部「上一步」「继续」各 56。
 *
 * 四步沿用原清单(第三类 D 组 10b)的内容与交互:确认身份、默认视图(存在服务器上,
 * `/auth/profile/preferences/`)、语言与主题、快捷键(队列那张表,`src/lib/queueShortcuts.ts`)。
 *
 * 做完或跳过,写入 `onboarded` —— 存在服务器上(`/auth/profile/preferences/`),跟着账号走,
 * 换浏览器不再重做。「重看首次设置」只是再打开这一屏,不清这个标记。
 */
export const TOTAL_STEPS = 4;

/**
 * The localStorage era's per-user key. Read ONCE, as a migration: local says done and the
 * server says not → write true to the server, then remove the key. If that write fails the
 * key stays and the next visit tries again. Nothing writes the key any more.
 */
const LEGACY_ONBOARDED_KEY = "soulledger_onboarded";
const legacyKeyFor = (userId: number) => `${LEGACY_ONBOARDED_KEY}:${userId}`;

function readLegacy(userId: number): boolean {
  try {
    return localStorage.getItem(legacyKeyFor(userId)) === "1";
  } catch {
    return false;
  }
}

function clearLegacy(userId: number): void {
  try {
    localStorage.removeItem(legacyKeyFor(userId));
  } catch {
    // Storage disabled: there is nothing there to clear either.
  }
}

/** Has this user done (or skipped) the setup? The server's answer, migrating a local one once. */
export async function loadOnboarded(userId: number): Promise<boolean> {
  let server: boolean;
  try {
    server = (await authApi.preferences()).data.onboarded === true;
  } catch {
    // Server unreadable: do not trap the operator in setup on every visit.
    return true;
  }
  if (server) {
    clearLegacy(userId);
    return true;
  }
  if (!readLegacy(userId)) return false;
  try {
    await authApi.updatePreferences({ onboarded: true });
    clearLegacy(userId);
  } catch {
    // Kept locally; the next visit migrates it instead.
  }
  return true;
}

type ThemeChoice = "system" | "light" | "dark";

export function WelcomeSetup({
  user,
  startAt = 0,
  onDone,
}: {
  user: AuthUser;
  startAt?: number;
  onDone: () => void;
}) {
  const { t, locale, setLocale, hydrated } = useI18n();
  // 租户展示名是库里的英文;文明名走语言包(2026-10-03 演示账号上露出「Chinese Afterlife」)。
  const civ = user.tenant?.code ? TENANT_CODE_TO_CIVILIZATION[user.tenant.code] : undefined;
  const civName = civ ? t(`tenant.civilizations.${civ}`) : undefined;
  const { theme, setTheme, followsSystem, followSystem } = useTheme();
  const [step, setStep] = useState(startAt);

  // The server's value; loading it also migrates a choice this browser stored in
  // the localStorage era — see `src/lib/defaultView.ts`.
  const [view, setView] = useState<DefaultView | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadDefaultView()
      .then((saved) => {
        if (!cancelled) setView(saved);
      })
      .catch(() => {
        // Unreadable: the step shows unchosen, which is what it is.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Optimistic, then settled by the server's answer; a failed save puts the
  // previous value back rather than showing a choice that was not kept.
  const choose = (next: DefaultView) => {
    const previous = view;
    setView(next);
    saveDefaultView(next)
      .then(setView)
      .catch(() => setView(previous));
  };

  const finish = () => {
    // Not awaited: a failed save shows the setup again next visit, which is the honest outcome.
    authApi.updatePreferences({ onboarded: true }).catch(() => {});
    onDone();
  };

  const themeChoice: ThemeChoice = followsSystem ? "system" : theme;
  const pickTheme = (c: ThemeChoice) => (c === "system" ? followSystem() : setTheme(c));

  const steps: { name: string; title: string; desc: string; body: React.ReactNode }[] = [
    {
      name: t("welcome.identity"),
      title: t("welcome.identity"),
      desc: t("welcome.onboarding_wrong_identity"),
      body: (
        <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-3 text-sm">
          <dt className="text-[oklch(var(--color-ink-muted))]">{t("auth.civilization")}</dt>
          <dd className="m-0 text-[oklch(var(--color-ink))]">{civName ?? user.tenant?.display_name ?? <MissingValue kind="unrecorded" />}</dd>
          <dt className="text-[oklch(var(--color-ink-muted))]">{t("welcome.user_role")}</dt>
          <dd className="m-0 text-[oklch(var(--color-ink))]">
            <RoleName value={user.role} />
          </dd>
        </dl>
      ),
    },
    {
      name: t("welcome.default_view"),
      title: t("welcome.onboarding_view_title"),
      desc: t("welcome.default_view_desc"),
      body: (
        <div role="radiogroup" aria-label={t("welcome.default_view")} className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {(["operator", "admin"] as const).map((option) => (
            <label
              key={option}
              className={cn(
                "grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-control p-4",
                view === option ? "border-2 border-[oklch(var(--color-ink))]" : "border border-[oklch(var(--color-line-strong))]"
              )}
            >
              <input
                type="radio"
                name="welcome-default-view"
                data-testid={`welcome-view-${option}`}
                className="row-span-2 mt-0.5 size-4.5"
                checked={view === option}
                onChange={() => choose(option)}
              />
              <span className="text-sm font-medium text-[oklch(var(--color-ink))]">
                {option === "admin" ? t("users.roles.ADMIN") : t("welcome.view_operator")}
              </span>
              <span className="text-xs text-[oklch(var(--color-ink-muted))]">
                {t(option === "admin" ? "welcome.view_admin_desc" : "welcome.view_operator_desc")}
              </span>
            </label>
          ))}
        </div>
      ),
    },
    {
      name: t("welcome.prefs"),
      title: t("welcome.prefs"),
      desc: t("welcome.prefs_desc"),
      body: (
        <div className="flex flex-col gap-4">
          <SelectField
            id="welcome-locale"
            label={t("nav.language")}
            value={locale}
            disabled={!hydrated}
            onChange={(e) => setLocale(e.target.value as Locale)}
            options={(Object.keys(LOCALE_LABELS) as Locale[]).map((l) => ({ value: l, label: LOCALE_LABELS[l] }))}
          />
          <div role="radiogroup" aria-label={t("welcome.prefs")} className="grid grid-cols-1 gap-2 md:grid-cols-3">
            {(["system", "light", "dark"] as const).map((c) => (
              <label
                key={c}
                className={cn(
                  "flex h-12 cursor-pointer items-center gap-3 rounded-control px-3 text-sm text-[oklch(var(--color-ink))]",
                  themeChoice === c ? "border-2 border-[oklch(var(--color-ink))]" : "border border-[oklch(var(--color-line-strong))]"
                )}
              >
                <input
                  type="radio"
                  name="welcome-theme"
                  data-testid={`welcome-theme-${c}`}
                  className="size-4.5"
                  checked={themeChoice === c}
                  onChange={() => pickTheme(c)}
                />
                {t(`welcome.onboarding_theme_${c}`)}
              </label>
            ))}
          </div>
        </div>
      ),
    },
    {
      name: t("judgment.queue.keyboard_help"),
      title: t("judgment.queue.keyboard_help"),
      desc: t("welcome.keys_desc"),
      body: (
        <dl className="m-0 border-t border-[oklch(var(--color-line))] text-sm">
          {QUEUE_SHORTCUTS.map(({ key, label }) => (
            <div key={key} data-shortcut={key} className="flex min-h-11 items-center gap-3 border-b border-[oklch(var(--color-line))]">
              <dt className="min-w-8 rounded-control border border-[oklch(var(--color-line-strong))] px-2 text-center font-mono text-xs">{key}</dt>
              <dd className="m-0 text-[oklch(var(--color-ink-muted))]">{t(label)}</dd>
            </div>
          ))}
        </dl>
      ),
    },
  ];

  const current = steps[step];
  const progress = t("welcome.first_run", { n: String(step + 1), total: String(TOTAL_STEPS) });
  const last = step === TOTAL_STEPS - 1;

  return (
    <section
      aria-labelledby="welcome-setup-title"
      data-testid="welcome-setup"
      className="mx-auto grid w-full max-w-[960px] grid-cols-1 overflow-hidden rounded-panel border border-[oklch(var(--color-line))] bg-[oklch(var(--color-surface-1))] md:grid-cols-[280px_minmax(0,1fr)]"
    >
      <aside className="hidden flex-col border-r border-[oklch(var(--color-line))] p-6 md:flex">
        <p className="font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">{progress}</p>
        <ol className="m-0 mt-4 p-0 list-none">
          {steps.map((s, i) => {
            const state = i < step ? "done" : i === step ? "current" : "future";
            return (
              <li
                key={s.name}
                data-step-state={state}
                aria-current={state === "current" ? "step" : undefined}
                className="flex h-14 items-center gap-3"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex size-6 flex-none items-center justify-center rounded-control font-mono text-xs",
                    state === "done" && "bg-[oklch(var(--color-ink))] text-[oklch(var(--color-canvas))]",
                    state === "current" && "border-2 border-[oklch(var(--color-ink))] text-[oklch(var(--color-ink))]",
                    state === "future" && "border border-[oklch(var(--color-line-strong))] text-[oklch(var(--color-ink-muted))]"
                  )}
                >
                  {state === "done" ? "✓" : i + 1}
                </span>
                <span
                  className={cn(
                    "text-sm",
                    state === "current" ? "font-semibold text-[oklch(var(--color-ink))]" : state === "done" ? "text-[oklch(var(--color-ink))]" : "text-[oklch(var(--color-ink-muted))]"
                  )}
                >
                  {s.name}
                </span>
              </li>
            );
          })}
        </ol>
        <div className="mt-auto pt-6 text-xs text-[oklch(var(--color-ink-muted))]">
          <p>{t("welcome.onboarding_can_change")}</p>
          <p className="mt-1 font-mono">{APP_VERSION}</p>
        </div>
      </aside>

      <div className="flex min-h-0 flex-col">
        {/* 393:顶栏放标、步数和「跳过」,下面 4 段 2px 进度条。 */}
        <div className="flex h-14 items-center justify-between gap-3 border-b border-[oklch(var(--color-line))] px-4 md:hidden">
          <span className="flex items-center gap-2">
            <BrandMark size={24} />
            <span className="font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">{progress}</span>
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={finish}>
            {t("welcome.onboarding_skip")}
          </Button>
        </div>
        <div aria-hidden="true" className="grid grid-cols-4 gap-1 px-4 pt-2 md:hidden">
          {steps.map((s, i) => (
            <span key={s.name} className={cn("h-0.5", i <= step ? "bg-[oklch(var(--color-ink))]" : "bg-[oklch(var(--color-line))]")} />
          ))}
        </div>

        <div className="flex-1 p-4 md:p-6">
          <h2 id="welcome-setup-title" className="text-lg text-[oklch(var(--color-ink))]">
            {current.title}
          </h2>
          <p className="mt-1 text-sm text-[oklch(var(--color-ink-muted))]">{current.desc}</p>
          <div className="mt-6">{current.body}</div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[oklch(var(--color-line))] p-4 md:h-20 md:px-6 md:py-0">
          <Button type="button" variant="ghost" onClick={finish} className="hidden md:inline-flex">
            {t("welcome.skip")}
          </Button>
          <div className="flex flex-1 gap-3 md:flex-none">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setStep((s) => s - 1)}
              disabled={step === 0}
              className="flex-1 max-md:h-(--control-h-lg) md:flex-none"
            >
              {t("welcome.onboarding_back")}
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => (last ? finish() : setStep((s) => s + 1))}
              className="flex-1 max-md:h-(--control-h-lg) md:flex-none"
            >
              {t("welcome.continue")}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
