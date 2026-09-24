"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/src/contexts/I18nContext";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeToggle } from "@/src/components/layout/ThemeToggle";
import { buttonVariants } from "@/src/components/ui/Button";
import { cn } from "@/lib/utils";
import { readDefaultView, routeForView, writeDefaultView, type DefaultView } from "@/src/lib/defaultView";

/**
 * 首次进入四步清单(第三类 D 组 10b)。步骤行 StepRow:已完成 = 墨底 ✓,
 * 当前 = 左侧 3px 墨线,未到 = 序号。不做轮播,每一步都能跳过。
 *
 * 快捷键一步列的是**这个应用里真有的**六个键 —— 审判队列
 * (`JudgmentQueueConsole.tsx` 的 keydown)。设计稿上的 ⌘K / Q / ⌘⏎ / ⌘Z
 * 在代码里都不存在,印出来就是在教人按一个没反应的键。说明文字复用队列自己的
 * 键盘映射文案(`judgment.queue.key_*`),两处不会各说各的。
 */
const KEYS: { key: string; label: string }[] = [
  { key: "1–4", label: "judgment.queue.key_verdicts" },
  { key: "S", label: "judgment.queue.key_defer" },
  { key: "U", label: "judgment.queue.key_undo" },
  { key: "N", label: "judgment.queue.key_notes" },
  { key: "Esc", label: "judgment.queue.key_leave" },
  { key: "? / H", label: "judgment.queue.key_help" },
];

const TOTAL = 4;

export function WelcomeChecklist({ signedIn }: { signedIn: boolean }) {
  const { t } = useI18n();
  // Read after mount: localStorage is not there on the server render.
  const [view, setView] = useState<DefaultView | null>(null);
  useEffect(() => setView(readDefaultView()), []);
  const [advanced, setAdvanced] = useState(0);

  // What the data already settles, and how far 继续 has been pressed; the
  // further of the two is the current step. 确认身份 is done once there is a
  // session to confirm; 默认视图 once a choice is stored.
  const settled = signedIn ? (view ? 2 : 1) : 0;
  const current = Math.max(settled, advanced);
  const state = (i: number) => (i < current ? "done" : i === current ? "current" : "future");

  const choose = (next: DefaultView) => {
    writeDefaultView(next);
    setView(next);
  };

  const steps: { title: string; desc: React.ReactNode; body?: React.ReactNode }[] = [
    {
      title: t("welcome.identity"),
      desc: signedIn ? (
        t("welcome.identity_desc")
      ) : (
        <Link href="/login" className="text-[oklch(var(--color-accent-ink))] underline">
          {t("auth.login")}
        </Link>
      ),
    },
    {
      title: t("welcome.default_view"),
      desc: t("welcome.default_view_desc"),
      body: (
        <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
          {(["operator", "admin"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={view === option}
              data-testid={`welcome-view-${option}`}
              onClick={() => choose(option)}
              className={cn(
                "px-3 py-2 text-left border",
                view === option
                  ? "border-[oklch(var(--color-block))] bg-[oklch(var(--color-surface-2))] shadow-[inset_0_-3px_0_oklch(var(--color-ink))]"
                  : "border-[oklch(var(--color-line))] hover:bg-[oklch(var(--color-surface-2))]"
              )}
            >
              <span className="block font-medium text-[oklch(var(--color-ink))]">
                {option === "admin" ? t("users.roles.ADMIN") : t("welcome.view_operator")}
              </span>
              <span className="block text-xs text-[oklch(var(--color-ink-muted))]">
                {t(option === "admin" ? "welcome.view_admin_desc" : "welcome.view_operator_desc")}
              </span>
            </button>
          ))}
        </div>
      ),
    },
    {
      title: t("welcome.prefs"),
      desc: t("welcome.prefs_desc"),
      body: (
        <div className="mt-2 flex items-center gap-3">
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      ),
    },
    {
      title: t("judgment.queue.keyboard_help"),
      desc: t("welcome.keys_desc"),
      body: (
        <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1.5 text-xs md:grid-cols-3">
          {KEYS.map(({ key, label }) => (
            <div key={key} className="flex items-center gap-2">
              <dt className="min-w-5 border border-[oklch(var(--color-line))] px-1.5 text-center font-mono text-2xs">{key}</dt>
              <dd className="m-0 text-[oklch(var(--color-ink-muted))]">{t(label)}</dd>
            </div>
          ))}
        </dl>
      ),
    },
  ];

  const enterHref = routeForView(view);

  return (
    <section aria-labelledby="welcome-checklist-title" className="max-w-[720px]">
      <div className="font-mono text-xs text-[oklch(var(--color-ink-subtle))]">
        {t("welcome.first_run", { n: String(Math.min(current + 1, TOTAL)), total: String(TOTAL) })}
      </div>
      <h2 id="welcome-checklist-title" className="mt-1 text-sm font-medium text-[oklch(var(--color-ink-muted))]">
        {t("welcome.setup_intro")}
      </h2>
      <ol className="mt-4 border-t border-[oklch(var(--color-block))]">
        {steps.map((step, i) => {
          const s = state(i);
          return (
            <li
              key={step.title}
              data-step-state={s}
              aria-current={s === "current" ? "step" : undefined}
              className={cn(
                "flex gap-3 py-3 border-b border-[oklch(var(--color-rule))]",
                s === "current" && "pl-3 bg-[oklch(var(--color-surface-1))] shadow-[inset_3px_0_0_oklch(var(--color-ink))]"
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-6 flex-none items-center justify-center border border-[oklch(var(--color-block))] font-mono text-xs",
                  s === "done" ? "bg-[oklch(var(--color-ink))] text-[oklch(var(--color-canvas))]" : "text-[oklch(var(--color-ink))]"
                )}
              >
                {s === "done" ? "✓" : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-medium text-[oklch(var(--color-ink))]">{step.title}</span>
                  {s !== "future" && (
                    <span className="text-xs text-[oklch(var(--color-ink-subtle))]">
                      {s === "done" ? t("welcome.step_done") : t("welcome.step_current")}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-xs text-[oklch(var(--color-ink-muted))]">{step.desc}</div>
                {step.body}
              </div>
            </li>
          );
        })}
      </ol>
      <div className="mt-6 flex flex-wrap gap-2">
        {current < TOTAL - 1 ? (
          <button
            type="button"
            onClick={() => setAdvanced(current + 1)}
            className={buttonVariants({ variant: "primary", size: "md" })}
          >
            {t("welcome.continue")}
          </button>
        ) : (
          <Link href={enterHref} className={buttonVariants({ variant: "primary", size: "md" })}>
            {t("welcome.continue")}
          </Link>
        )}
        <Link href={enterHref} className={buttonVariants({ variant: "ghost", size: "md" })}>
          {t("welcome.skip")}
        </Link>
      </div>
    </section>
  );
}
