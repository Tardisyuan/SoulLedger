"use client";

import { useCallback, useMemo, useRef } from "react";
import { useRovingPopupKeys } from "@/components/ui/data-grid/useRovingPopupKeys";
import { useI18n } from "@/src/contexts/I18nContext";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { usePermissions } from "@/src/hooks/usePermissions";
import { Button } from "@/src/components/ui/Button";

/** 编辑 + the overflow menu: 重算功过 · 发起审批… · 删除 · 更正结案 (W-11a), each only for its holder. */
export function SoulHeaderActions({
  onEdit,
  onDelete,
  onCorrectSettlement,
  onRecalculate,
  onStartWorkflow,
  isOverflowMenuOpen,
  setIsOverflowMenuOpen,
}: {
  onEdit: () => void;
  onDelete: () => void;
  /** 「更正结案」:只在页面判定可做时(持有 `soul.correct_settlement` 且灵魂是 SETTLED)才给;没给就没有这一项。 */
  onCorrectSettlement?: () => void;
  /** 「重算功过」:只在持有 `ledger.manage` 时给(`LedgerRecalculateView` 要的码名);没给就没有这一项。 */
  onRecalculate?: () => void;
  /** 「发起审批…」(W-11):只在持有 `workflow.create` 时给;没给就没有这一项。 */
  onStartWorkflow?: () => void;
  /* The open/closed flag stays owned by the page. It used to live there while
     this markup was inlined, and a menu left open across a data reload kept
     its state; hoisting the state in here would have quietly closed it. */
  isOverflowMenuOpen: boolean;
  setIsOverflowMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  // `souls.detail.more_actions` is in no bundle, so this is one of the call
  // sites where `tf` really does render its literal rather than a translation.
  const { t, tf } = useI18n();
  // 删除仍按 `soul.delete`;菜单本身对持有其中任一项的人出现 —— 只能发起审批、不能删除的人也要看得到 ⋯。
  const { hasPermission } = usePermissions();
  const canDelete = hasPermission("soul.delete");

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
  // Per-entry, as the hook's contract says, in menu order: 重算功过, 发起审批…,
  // 删除, 更正结案 — each present only when the page handed one in (delete: when
  // held). Memoised: a fresh array every render would re-run the hook's
  // focus-on-open effect and pull focus back to the first item.
  // Keyed on the booleans, not the callbacks: the page passes fresh arrows.
  const hasRecalculate = Boolean(onRecalculate);
  const hasStartWorkflow = Boolean(onStartWorkflow);
  const hasCorrect = Boolean(onCorrectSettlement);
  const enabled = useMemo(
    () => [hasRecalculate, hasStartWorkflow, canDelete, hasCorrect],
    [hasRecalculate, hasStartWorkflow, canDelete, hasCorrect]
  );
  const { containerRef: menuRef, itemRefs } = useRovingPopupKeys({
    open: isOverflowMenuOpen,
    enabled,
    onRequestClose: close,
  });
  // 页面只在持有对应码名时才交来这些回调,所以门禁写成「任一」:码名与回调一一对应。
  const menuCodenames = [
    "soul.delete",
    ...(onRecalculate ? ["ledger.manage"] : []),
    ...(onStartWorkflow ? ["workflow.create"] : []),
  ];
  const itemClass = "w-full text-left px-3 py-1 text-sm hover:bg-[oklch(var(--color-surface-2))] transition-colors";

  return (
    <div className="flex flex-wrap items-center justify-end gap-3">
      <RequirePermission permissions="soul.update">
        <Button type="button" variant="secondary" onClick={onEdit}>
          {t("souls.detail.edit")}
        </Button>
      </RequirePermission>
      {/* 破坏性动作住在溢出菜单里,而不是紧挨编辑的一个足量红按钮
          (Stage 3 文档缺陷 #3)—— 删除既少见又后果重大,不该和日常的编辑
          分享同一份视觉权重。 */}
      <RequirePermission permissions={menuCodenames}>
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
                className="absolute right-0 mt-1 w-40 z-20 bg-[oklch(var(--color-surface-1))] border border-[oklch(var(--color-ink))] py-1"
              >
                {onRecalculate ? (
                  <button
                    ref={(el) => { itemRefs.current[0] = el; }}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      close(true);
                      onRecalculate();
                    }}
                    className={`${itemClass} text-[oklch(var(--color-ink))]`}
                  >
                    {t("souls.detail.recalculate")}
                  </button>
                ) : null}
                {onStartWorkflow ? (
                  <button
                    ref={(el) => { itemRefs.current[1] = el; }}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      close(true);
                      onStartWorkflow();
                    }}
                    className={`${itemClass} font-medium text-[oklch(var(--color-ink))]`}
                  >
                    {t("workflow.start.menu")}
                  </button>
                ) : null}
                {canDelete ? (
                  <button
                    ref={(el) => { itemRefs.current[2] = el; }}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      close(true);
                      onDelete();
                    }}
                    /* 移入回收站可恢复(「系统设置 › 回收站」):可逆的风险动作用 warning,
                       danger-strong 只给不可逆的删除(规范 v3)。 */
                    className={`${itemClass} text-[oklch(var(--color-warning))]`}
                  >
                    {t("souls.detail.delete")}
                  </button>
                ) : null}
                {onCorrectSettlement ? (
                  <button
                    ref={(el) => { itemRefs.current[3] = el; }}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      close(true);
                      onCorrectSettlement();
                    }}
                    /* 可逆(退回 DISPOSED,审判与处置都在)且单独审计:warning,不是 danger。 */
                    className={`${itemClass} text-[oklch(var(--color-warning))]`}
                  >
                    {t("souls.detail.correct_settlement.action")}
                  </button>
                ) : null}
              </div>
            </>
          )}
        </div>
      </RequirePermission>
    </div>
  );
}
