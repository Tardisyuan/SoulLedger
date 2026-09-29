"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useI18n } from "@/src/contexts/I18nContext";
import { TAB_BASE, TAB_OFF, TAB_ON } from "@/src/lib/tabClasses";

export const CONFIG_PATH = "/admin/assistant";
export const USAGE_PATH = "/admin/assistant/usage";

/** Money is in whatever unit the admin priced in (§8: no provider prices in code), so no currency sign. */
export const money = (n: number) => (n >= 1 ? n.toFixed(2) : n.toFixed(4));
export const count = (n: number) => n.toLocaleString("en-US");
export const pct = (share: number) => `${(share * 100).toFixed(1)}%`;

export const MONO = "font-mono tabular-nums";
export const MUTED = "text-[oklch(var(--color-ink-muted))]";
export const SUBTLE = "text-xs text-[oklch(var(--color-ink-subtle))]";

/** 「配置与测试」「实际用量」: two routes, each reachable directly (canvas 1a 一). */
export function AssistAdminTabs() {
  const { t } = useI18n();
  const pathname = usePathname();
  return (
    <>
      {([["config", CONFIG_PATH], ["usage", USAGE_PATH]] as const).map(([key, href]) => (
        <Link
          key={key}
          href={href}
          aria-current={pathname === href ? "page" : undefined}
          className={`${TAB_BASE} ${pathname === href ? TAB_ON : TAB_OFF}`}
        >
          {t(`assist_admin.tabs.${key}`)}
        </Link>
      ))}
    </>
  );
}

export function Section({ title, aside, children, id }: { title: ReactNode; aside?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section aria-labelledby={id} className="border-t border-[oklch(var(--color-block))] pt-3 pb-6">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={id} className="text-2xs uppercase text-[oklch(var(--color-ink-muted))]">
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

/**
 * The console's switch (same drawing as SchedulerJobRow). Disabled switches keep
 * their value and say why through `aria-describedby` (canvas 1a 五).
 */
export function Switch({
  checked,
  label,
  onChange,
  disabled = false,
  describedBy,
}: {
  checked: boolean;
  label: string;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  describedBy?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-disabled={disabled || undefined}
      aria-describedby={describedBy}
      onClick={() => !disabled && onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center border transition-colors ${disabled ? "opacity-50 cursor-not-allowed" : ""} ${
        checked
          ? "bg-[oklch(var(--color-accent))] border-[oklch(var(--color-accent))]"
          : "bg-[oklch(var(--color-surface-2))] border-[oklch(var(--color-hairline))]"
      }`}
    >
      <span
        aria-hidden="true"
        className={`inline-block h-4 w-4 bg-[oklch(var(--color-ink))] transition-transform ${checked ? "translate-x-6" : "translate-x-1"}`}
      />
    </button>
  );
}
