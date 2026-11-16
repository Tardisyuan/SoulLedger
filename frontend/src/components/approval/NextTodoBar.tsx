"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { TodoNext } from "@soulledger/core/hooks/useTodoNext";
import { localName } from "@soulledger/core/domain/localName";
import { useI18n } from "@/src/contexts/I18nContext";
import { buttonVariants } from "@/src/components/ui/Button";

/** Where a button goes: a link, or (inside a dialog) a callback. Neither: the button is not drawn. */
export type BarTarget = { href: string } | { onClick: () => void };

const BAR_BUTTON = "h-auto min-h-(--control-h-lg) flex-col gap-0 py-2 whitespace-normal";

function BarButton({ target, ink, grow, testId, label, children }: { target: BarTarget; ink: boolean; grow: string; testId: string; label?: string; children: ReactNode }) {
  const className = `${buttonVariants({ variant: ink ? "primary" : "secondary", size: "lg" })} ${BAR_BUTTON} ${grow}`;
  return "href" in target ? (
    <Link href={target.href} data-testid={testId} aria-label={label} className={className}>
      {children}
    </Link>
  ) : (
    <button type="button" data-testid={testId} aria-label={label} onClick={target.onClick} className={className}>
      {children}
    </button>
  );
}

/**
 * After a decision (officer App 第五十批 C1, `detail.tsx` NextBar): outline 「回到待办」 (or the caller's own way
 * back) and ink 「下一件」, 1 : 1.6, with 「{name} · 还剩 {n} 件」 under it -- who comes next, not 「3/7」. No next
 * row: one full-width ink way back, with 「今天的都办完了」 under it when this was the group's last row.
 * `nextTarget` null while the next row's address is still being looked up: the way back stands alone meanwhile.
 */
export function NextTodoBar({
  todo,
  nextTarget,
  leave,
}: {
  todo: TodoNext | null;
  nextTarget: BarTarget | null;
  leave: { label: string; target: BarTarget };
}) {
  const { t, locale } = useI18n();
  const next = todo?.next ?? null;
  if (next && nextTarget) {
    const name = localName(next, locale, "title");
    const meta = t("officer_app.detail.next_meta", { name, n: String(todo!.left) });
    return (
      <div data-testid="next-bar" className="flex gap-3">
        <BarButton target={leave.target} ink={false} grow="flex-1" testId="next-bar-leave">
          {leave.label}
        </BarButton>
        <BarButton target={nextTarget} ink grow="flex-[1.6]" testId="next-bar-next" label={t("officer_app.detail.next_aria", { name, n: String(todo!.left) })}>
          <span>{t("officer_app.detail.next")}</span>
          <span className="text-xs font-normal">{meta}</span>
        </BarButton>
      </div>
    );
  }
  return (
    <div data-testid="next-bar" className="flex">
      <BarButton target={leave.target} ink grow="flex-1" testId="next-bar-leave">
        <span>{leave.label}</span>
        {todo && !todo.next && <span className="text-xs font-normal">{t("officer_app.detail.all_done")}</span>}
      </BarButton>
    </div>
  );
}
