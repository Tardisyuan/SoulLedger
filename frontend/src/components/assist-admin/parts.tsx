"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useI18n } from "@/src/contexts/I18nContext";
import { TAB_BASE, TAB_OFF, TAB_ON } from "@/src/lib/tabClasses";
import { Badge } from "@/src/components/ui/Badge";

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
      // 规范 v2 A1「开关」,与 SchedulerJobRow 同一套:开 = ink 实底、纸色滑块在右;关 = 空底、ink3 框与
      // 滑块在左;禁用 = s2 底、line 框(不调透明度)。v2 撤掉了强调色,accent 指向 ink —— 这里原先开 = accent
      // 底 + ink 滑块,两者同色,打开时整块一片(2026-09-30 用户截图)。
      className={`relative inline-flex h-[18px] w-8 shrink-0 items-center border-[1.5px] p-0.5 transition-colors duration-instant ${
        disabled
          ? "cursor-not-allowed border-[oklch(var(--color-line))] bg-[oklch(var(--color-disabled-surface))]"
          : checked
            ? "bg-[oklch(var(--color-ink))] border-[oklch(var(--color-ink))]"
            : "bg-transparent border-[oklch(var(--color-line-strong))]"
      } ${checked ? "justify-end" : "justify-start"}`}
    >
      <span
        aria-hidden="true"
        className={`block size-[11px] ${checked && !disabled ? "bg-[oklch(var(--color-canvas))]" : "bg-[oklch(var(--color-line-strong))]"}`}
      />
    </button>
  );
}

/**
 * 「评测专用 · 不能登录」 after the row's status tag in the souls and users lists (user 2026-09-29: the two
 * eval identities are shown, not hidden). Design's version: the status tag's size and padding, a dashed
 * border in the neutral subtle ink — not a feedback colour, it is not a state.
 */
export function EvalIdentityTag() {
  const { t } = useI18n();
  return (
    <Badge data-eval-identity="" className="ml-2 border-dashed text-[oklch(var(--color-ink-subtle))] border-[oklch(var(--color-ink-subtle))]">
      {t("assist_admin.identities.tag")}
    </Badge>
  );
}
