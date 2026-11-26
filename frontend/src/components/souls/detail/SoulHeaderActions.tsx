"use client";

import { ActionsMenu, type OverflowMenuItem } from "@/components/ui/data-grid/ActionsMenu";
import { useI18n } from "@/src/contexts/I18nContext";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { usePermissions } from "@/src/hooks/usePermissions";
import { Button, buttonVariants } from "@/src/components/ui/Button";

/** 编辑 + the overflow menu: 重算功过 · 发起审批… · 删除 · 更正结案 (W-11a), each only for its holder. */
export function SoulHeaderActions({
  onEdit,
  onDelete,
  onCorrectSettlement,
  onRecalculate,
  onStartWorkflow,
  onRegisterByTudi,
  onMarkLost,
  onRecall,
  isOverflowMenuOpen,
  setIsOverflowMenuOpen,
}: {
  /** 「编辑」:页面在菜单按钮配置关掉它时不给(第四十批 W-b),权限门 `soul.update` 照旧在这里。 */
  onEdit?: () => void;
  /** 「删除」:同上,不给就没有这一项;给了仍要 `soul.delete`。 */
  onDelete?: () => void;
  /** 「更正结案」:只在页面判定可做时(持有 `soul.correct_settlement` 且灵魂是 SETTLED)才给;没给就没有这一项。 */
  onCorrectSettlement?: () => void;
  /** 「重算功过」:只在持有 `ledger.manage` 时给(`LedgerRecalculateView` 要的码名);没给就没有这一项。 */
  onRecalculate?: () => void;
  /** 「发起审批…」(W-11):只在持有 `workflow.create` 时给;没给就没有这一项。 */
  onStartWorkflow?: () => void;
  /** 「以土地公名义登记死亡」(第五十七批 S-6):只地府、在世、持 `soul.die` 时给。 */
  onRegisterByTudi?: () => void;
  /** 「标记失踪」(第五十批 L-1):只在 DISPOSED 且持有 `soul.transition` 时给。排在删除之前,中间一条分隔线。 */
  onMarkLost?: () => void;
  /** 「召回」(L-3):只在 LOST 且持有 `soul.transition` 时给;操作区的主按钮。 */
  onRecall?: () => void;
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
  const canDelete = hasPermission("soul.delete") && Boolean(onDelete);

  // The shared row menu (portal, roving keys, Escape, focus back to ⋯ before the action runs). It used to be drawn
  // here by hand with its own scrim (ui-style-web §2.4, 2026-11-26). Menu order: 重算功过 · 发起审批… · 土地登记 ·
  // 标记失踪 | 删除 · 更正结案, each only when the page handed one in (delete: when held).
  const items: OverflowMenuItem[] = [
    ...(onRecalculate ? [{ key: "recalculate", label: t("souls.detail.recalculate"), onSelect: onRecalculate }] : []),
    ...(onStartWorkflow ? [{ key: "workflow", label: t("workflow.start.menu"), onSelect: onStartWorkflow }] : []),
    ...(onRegisterByTudi
      ? [{ key: "tudi", label: t("earthGods.register_death"), onSelect: onRegisterByTudi, testId: "soul-register-by-tudi" }]
      : []),
    ...(onMarkLost ? [{ key: "lost", label: t("souls.lost.mark"), onSelect: onMarkLost, separatorAfter: true }] : []),
    /* 移入回收站可恢复(「系统设置 › 回收站」):可逆的风险动作用 warning,danger-strong 只给不可逆的删除(规范 v3)。 */
    ...(canDelete && onDelete
      ? [{ key: "delete", label: t("souls.detail.delete"), onSelect: onDelete, tone: "warning" as const }]
      : []),
    /* 可逆(退回 DISPOSED,审判与处置都在)且单独审计:warning,不是 danger。 */
    ...(onCorrectSettlement
      ? [{ key: "correct", label: t("souls.detail.correct_settlement.action"), onSelect: onCorrectSettlement, tone: "warning" as const }]
      : []),
  ];
  // 页面只在持有对应码名时才交来这些回调,所以门禁写成「任一」:码名与回调一一对应。
  const menuCodenames = [
    ...(onDelete ? ["soul.delete"] : []),
    ...(onRecalculate ? ["ledger.calculate"] : []),
    ...(onStartWorkflow ? ["workflow.create"] : []),
    ...(onRegisterByTudi ? ["tudi.register"] : []),
    ...(onCorrectSettlement ? ["soul.correct_settlement"] : []),
    ...(onMarkLost ? ["soul.transition"] : []),
  ];

  return (
    <div className="flex flex-wrap items-center justify-end gap-3">
      {onRecall && (
        <RequirePermission permissions="soul.transition">
          <Button type="button" variant="primary" onClick={onRecall}>
            {t("souls.lost.recall")}
          </Button>
        </RequirePermission>
      )}
      {onEdit && (
        <RequirePermission permissions="soul.update">
          <Button type="button" variant="secondary" onClick={onEdit}>
            {t("souls.detail.edit")}
          </Button>
        </RequirePermission>
      )}
      {/* 破坏性动作住在溢出菜单里,而不是紧挨编辑的一个足量红按钮
          (Stage 3 文档缺陷 #3)—— 删除既少见又后果重大,不该和日常的编辑
          分享同一份视觉权重。 */}
      <RequirePermission permissions={menuCodenames}>
        <ActionsMenu
          items={items}
          menuLabel={tf("souls.detail.more_actions", "更多操作")}
          trigger={{ label: "⋯", className: buttonVariants({ variant: "secondary" }) }}
          open={isOverflowMenuOpen}
          onOpenChange={setIsOverflowMenuOpen}
        />
      </RequirePermission>
    </div>
  );
}
