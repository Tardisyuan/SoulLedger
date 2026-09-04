"use client";

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
                role="menu"
                className="absolute right-0 mt-1 w-40 z-20 bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] shadow-lg py-1"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setIsOverflowMenuOpen(false);
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
