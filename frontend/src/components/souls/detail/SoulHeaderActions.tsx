"use client";

import { useCallback, useRef } from "react";
import { useRovingPopupKeys } from "@/components/ui/data-grid/useRovingPopupKeys";
import { useI18n } from "@/src/contexts/I18nContext";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { Button } from "@/src/components/ui/Button";

/** 编辑 + the overflow menu that keeps 删除 out of arm's reach. */
export function SoulHeaderActions({
  onEdit,
  onDelete,
  isOverflowMenuOpen,
  setIsOverflowMenuOpen,
}: {
  onEdit: () => void;
  onDelete: () => void;
  /* The open/closed flag stays owned by the page. It used to live there while
     this markup was inlined, and a menu left open across a data reload kept
     its state; hoisting the state in here would have quietly closed it. */
  isOverflowMenuOpen: boolean;
  setIsOverflowMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  // `souls.detail.more_actions` is in no bundle, so this is one of the call
  // sites where `tf` really does render its literal rather than a translation.
  const { t, tf } = useI18n();

  /**
   * The keyboard half of the `role="menu"` below — which was declared and not
   * kept.
   *
   * What was missing: focus into the menu on open, ArrowUp/Down/Home/End,
   * Escape, and focus returned to the ⋯ trigger on close. Its only dismissal
   * path was a click on the scrim, and that scrim is `aria-hidden
   * tabIndex={-1}` — unreachable by keyboard. So a screen-reader user was
   * promised menu navigation and given none of it.
   *
   * Delete is still *completable* by keyboard (the item is a real `<button>`
   * in tab order), so this is a broken promise to assistive tech rather than a
   * dead end. It is still the third instance of this exact defect: `ActionsMenu`
   * and `FilterBar` were the two found in the 2026-09-01 round, and
   * `useRovingPopupKeys` was written for them — its own header names those two.
   * `grep -rn useRovingPopupKeys` returned exactly those two consumers until
   * this line. The hook existed; this menu was not in the sweep.
   *
   * `usePopupOpenState` is deliberately NOT used: the open flag is owned by the
   * page (see the prop comment above), and hoisting it in here would quietly
   * close the menu across a data reload. The focus-restore rule that hook
   * carries is reproduced in `close` instead, which is the one line of it that
   * matters here.
   */
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(
    (restoreFocus: boolean) => {
      setIsOverflowMenuOpen(false);
      // Restored BEFORE the caller runs anything: `onDelete` opens a
      // confirmation dialog, and a dialog returns focus on close to whatever
      // held it on open — so the trigger has to be that element, or the return
      // lands on `<body>`. Same reasoning as `ActionsMenu`'s header.
      if (restoreFocus) triggerRef.current?.focus();
    },
    [setIsOverflowMenuOpen]
  );
  const { containerRef: menuRef, itemRefs } = useRovingPopupKeys({
    open: isOverflowMenuOpen,
    // One entry, always available. An array rather than a number because the
    // hook's contract is per-entry: a second action added here gets arrow
    // navigation without touching the hook.
    enabled: [true],
    onRequestClose: close,
  });

  return (
    <div className="flex items-center gap-3">
      <RequirePermission permissions="soul.update">
        <Button type="button" variant="secondary" onClick={onEdit}>
          {t("souls.detail.edit")}
        </Button>
      </RequirePermission>
      {/* 破坏性动作住在溢出菜单里,而不是紧挨编辑的一个足量红按钮
          (Stage 3 文档缺陷 #3)—— 删除既少见又后果重大,不该和日常的编辑
          分享同一份视觉权重。 */}
      <RequirePermission permissions="soul.delete">
        <div className="relative">
          <Button
            ref={triggerRef}
            type="button"
            variant="secondary"
            onClick={() => setIsOverflowMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={isOverflowMenuOpen}
            aria-label={tf("souls.detail.more_actions", "更多操作")}
          >
            ⋯
          </Button>
          {isOverflowMenuOpen && (
            <>
              <button
                type="button"
                aria-hidden="true"
                tabIndex={-1}
                className="fixed inset-0 z-10 cursor-default"
                onClick={() => setIsOverflowMenuOpen(false)}
              />
              <div
                ref={menuRef}
                role="menu"
                className="absolute right-0 mt-1 w-40 z-20 bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] shadow-lg py-1"
              >
                <button
                  ref={(el) => { itemRefs.current[0] = el; }}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    close(true);
                    onDelete();
                  }}
                  className="w-full text-left px-3 py-1 text-03 text-[hsl(var(--color-status-error))] hover:bg-[hsl(var(--color-status-error)/0.1)] transition-colors"
                >
                  {t("souls.detail.delete")}
                </button>
              </div>
            </>
          )}
        </div>
      </RequirePermission>
    </div>
  );
}
