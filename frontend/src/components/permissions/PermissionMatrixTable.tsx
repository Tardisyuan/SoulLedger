"use client";

import { useId } from "react";
import { Permission, Role } from "@soulledger/core/api";
import { ADMIN_ROLE_NAME, ROLE_FORBIDDEN_CODENAMES } from "@soulledger/core/api/perm";
import { matrixCellKey } from "@soulledger/core/hooks/usePermissionMatrix";
import { useI18n } from "@/src/contexts/I18nContext";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { GrantMap } from "./matrixDiff";
import type { CellFailure } from "./useMatrixCells";

/**
 * 权限格 PermCell(E-11a):
 *
 *   ■ 有 — 墨色实心方块        □ 无 — 空框
 *   ＋ / − 未保存 — 2 px 强调色焦点环 + 字形
 *   ! 保存失败 — 危险色,原因在描述里(aria-describedby)与 title 上
 *   ◇ 引起冲突 — 警示色,这次改动会让某条审批流的某一步无人可批
 *   始终 — ADMIN 整列(第三类 F 组):降低不透明度的墨块,等宽字「始终」。服务端对 ADMIN
 *          在读授权之前就答「有」(`admin_always_all`),所以这里点不动,悬停 / 聚焦说明原因
 *   ! 禁授 — 服务端禁止授予该角色的格子(`ROLE_FORBIDDEN_CODENAMES`),一开始就摆明;
 *          与「!」保存失败(勾了之后被退回)区分:禁授是规则,拒绝是事后结果
 *
 * State is never colour alone: every non-plain state carries a glyph, and the
 * same word goes to the accessible description.
 */
export type CellState = "on" | "off" | "grant" | "revoke" | "failed" | "conflict" | "lock" | "deny";

/** A cell the server decides by rule, whatever is ticked: 「始终」 for ADMIN, 「! 禁授」 for a forbidden grant. */
export function ruleState(role: string, codename: string): "lock" | "deny" | null {
  if (role === ADMIN_ROLE_NAME) return "lock";
  return ROLE_FORBIDDEN_CODENAMES[role]?.includes(codename) ? "deny" : null;
}

export function cellState({
  granted,
  pending,
  failure,
  conflict,
}: {
  granted: boolean;
  pending: boolean;
  failure: boolean;
  conflict: boolean;
}): CellState {
  if (failure) return "failed";
  if (conflict) return "conflict";
  if (pending) return granted ? "grant" : "revoke";
  return granted ? "on" : "off";
}

const GLYPH: Record<Exclude<CellState, "lock" | "deny">, string> = { on: "", off: "", grant: "＋", revoke: "−", failed: "!", conflict: "◇" };

const CELL_CLASS: Record<CellState, string> = {
  on: "bg-[oklch(var(--color-ink))] text-[oklch(var(--color-canvas))]",
  off: "border border-[oklch(var(--color-line))]",
  grant:
    "bg-[oklch(var(--color-ink))] text-[oklch(var(--color-canvas))] outline-2 outline-offset-2 outline-[oklch(var(--color-accent))]",
  revoke:
    "border border-[oklch(var(--color-line))] text-[oklch(var(--color-accent-ink))] outline-2 outline-offset-2 outline-[oklch(var(--color-accent))]",
  failed: "border border-[oklch(var(--color-danger))] bg-[oklch(var(--color-danger-tint))] text-[oklch(var(--color-danger))]",
  conflict:
    "border border-[oklch(var(--color-warning))] bg-[oklch(var(--color-warning-tint))] text-[oklch(var(--color-warning))] outline-2 outline-offset-2 outline-[oklch(var(--color-accent))]",
  lock: "bg-[oklch(var(--color-ink))] text-[oklch(var(--color-canvas))] opacity-72",
  deny: "border border-[oklch(var(--color-danger))] bg-[oklch(var(--color-danger-tint))] text-[oklch(var(--color-danger))]",
};

/** The drawn square, also used by the legend. */
export function PermGlyph({ state, className }: { state: CellState; className?: string }) {
  const { t } = useI18n();
  const word = state === "lock" ? t("permissions.matrix.lock_word") : state === "deny" ? `! ${t("permissions.matrix.deny_word")}` : null;
  return (
    <span
      aria-hidden="true"
      data-cell-state={state}
      className={cn(
        "inline-flex shrink-0 items-center justify-center font-mono text-2xs leading-none",
        word ? "min-h-5.5 min-w-5.5 px-1 whitespace-nowrap" : "h-4.5 w-4.5",
        CELL_CLASS[state],
        className
      )}
    >
      {word ?? GLYPH[state as keyof typeof GLYPH]}
    </span>
  );
}

export interface MatrixCellInfo {
  granted: (role: string, permId: number) => boolean;
  pending: (key: string) => boolean;
  failure: (key: string) => CellFailure | null;
  conflict: (key: string) => boolean;
  /** Words for a failure's reason, from its code. */
  failureReason: (f: CellFailure) => string;
}

function useCellDescription(info: MatrixCellInfo, role: string, perm: Permission) {
  const { t } = useI18n();
  const key = matrixCellKey(role, perm.id);
  const failure = info.failure(key);
  const rule = ruleState(role, perm.codename);
  const state =
    rule ??
    cellState({
      granted: info.granted(role, perm.id),
      pending: info.pending(key),
      failure: failure !== null,
      conflict: info.conflict(key),
    });
  const words =
    state === "lock"
      ? `${t("permissions.matrix.lock_word")} · ${ADMIN_ROLE_NAME}　${t("permissions.matrix.lock_hint")}`
      : state === "deny"
        ? `! ${t("permissions.matrix.deny_word")}　${t("permissions.matrix.deny_hint", { perm: perm.name || perm.codename })} role_forbidden_permission`
        : state === "failed" && failure
      ? `${t("permissions.matrix.state.failed")}: ${info.failureReason(failure)}`
      : state === "on" || state === "off"
        ? ""
        : t(`permissions.matrix.state.${state}`);
  return { key, state, words };
}

function MatrixCell({
  role,
  perm,
  info,
  disabled,
  onToggle,
  variant,
}: {
  role: string;
  perm: Permission;
  info: MatrixCellInfo;
  disabled: boolean;
  onToggle: () => void;
  variant: "grid" | "switch";
}) {
  const descId = useId();
  const { key, state, words } = useCellDescription(info, role, perm);
  // 「始终」 and 「! 禁授」 are rules, not choices: the cell says what the server enforces and does not toggle.
  const ruled = state === "lock" || state === "deny";
  const granted = state === "lock" ? true : state === "deny" ? false : info.granted(role, perm.id);
  return (
    <>
      <button
        type="button"
        role={variant === "grid" ? "checkbox" : "switch"}
        aria-checked={granted}
        aria-label={variant === "grid" ? `${role} — ${perm.codename}` : `${perm.name} ${perm.codename}`}
        aria-describedby={words ? descId : undefined}
        title={words || undefined}
        data-cell={key}
        disabled={disabled && !ruled}
        aria-disabled={ruled || undefined}
        data-rule={ruled ? state : undefined}
        onClick={ruled ? undefined : onToggle}
        className={cn(
          "flex items-center justify-center",
          variant === "grid" ? "h-8 w-full" : "min-h-11 min-w-11",
          ruled
            ? "cursor-help"
            : disabled
              ? "cursor-not-allowed opacity-70"
              : "cursor-pointer hover:bg-[oklch(var(--color-surface-3))]"
        )}
      >
        <PermGlyph state={state} className={variant === "switch" ? "h-5.5 w-5.5" : undefined} />
      </button>
      {words && (
        <span id={descId} className="sr-only">
          {words}
        </span>
      )}
    </>
  );
}

function roleLabel(roleMeta: Record<string, Role>, role: string) {
  return roleMeta[role]?.display_name || role;
}

/**
 * 角色 × 权限矩阵。桌面是表格(冻结首列,理由见下方注释);393 px 下改成
 * 「先选角色,再逐行开关」—— 五列方格在手机上既点不准也看不全。两种版式都在
 * DOM 里、按断点显隐,各自是完整的一份控件:网格里是 checkbox(名字是
 * 「角色 — 代码」),手机上是 switch(名字是权限名),两者不重名。
 */
export function PermissionMatrixTable({
  matrixReady,
  roleNames,
  roleMeta,
  categories,
  checked,
  isSaving,
  isVisible,
  onToggle,
  categoryTally,
  info,
  mobileRole,
  onMobileRoleChange,
}: {
  matrixReady: boolean;
  roleNames: string[];
  roleMeta: Record<string, Role>;
  categories: { category: string; perms: Permission[] }[];
  allPerms?: Permission[];
  checked: GrantMap | null;
  isSaving: boolean;
  isVisible: (perm: Permission) => boolean;
  onToggle: (role: string, permId: number) => void;
  categoryTally: (perms: Permission[], role: string) => string;
  info: MatrixCellInfo;
  mobileRole: string;
  onMobileRoleChange: (role: string) => void;
}) {
  const { t } = useI18n();

  if (!matrixReady) {
    return (
      <div className="space-y-2" aria-busy="true">
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    );
  }

  if (roleNames.length === 0) {
    return <p className="text-sm text-[oklch(var(--color-ink-muted))]">{t("permissions.matrix.no_roles")}</p>;
  }

  const shown = categories
    .map(({ category, perms }) => ({ category, perms, visible: perms.filter(isVisible) }))
    .filter((c) => c.visible.length > 0);
  const visibleCount = shown.reduce((n, c) => n + c.visible.length, 0);
  const totalCount = categories.reduce((n, c) => n + c.perms.length, 0);
  const role = roleNames.includes(mobileRole) ? mobileRole : roleNames[0];

  return (
    <>
      <p className="mb-2 font-mono text-2xs text-[oklch(var(--color-ink-subtle))]" aria-live="polite">
        {t("permissions.matrix.showing", { shown: String(visibleCount), total: String(totalCount) })}
      </p>

      {visibleCount === 0 && (
        <p className="py-6 text-sm text-[oklch(var(--color-ink-muted))]">{t("permissions.matrix.no_differences")}</p>
      )}

      {/* ── ≥ md: the grid ──
          冻结首列:sticky 挂在**单元格**上(不是 <tr>),表格用
          `border-separate border-spacing-0`(不是 border-collapse)。挂在 <tr>
          上时表头行、分类行、正文行是三个互不比较 z-index 的层叠上下文,冻结列
          的角单元格压不住表头;collapse 下边框归表格,sticky 单元格滚动时边框
          留在原地。滚到第 8 个角色时,第一列必须还在说这一行是哪条权限。 */}
      {visibleCount > 0 && (
        <div className="hidden max-h-[65vh] overflow-auto md:block">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="h-11">
                <th className="sticky top-0 left-0 z-40 min-w-[240px] border-b border-[oklch(var(--color-block))] bg-[oklch(var(--color-canvas))] px-3 text-left font-mono text-2xs font-normal text-[oklch(var(--color-ink-subtle))]">
                  {t("permissions.matrix.codename_col")}
                </th>
                {roleNames.map((r) => (
                  <th
                    key={r}
                    className="sticky top-0 z-30 min-w-[96px] border-b border-[oklch(var(--color-block))] bg-[oklch(var(--color-canvas))] px-2 text-center font-medium text-[oklch(var(--color-ink))]"
                  >
                    <div>{roleLabel(roleMeta, r)}</div>
                    <div className="font-mono text-2xs font-normal text-[oklch(var(--color-ink-subtle))]">{r}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map(({ category, perms, visible }) => (
                <MatrixGroup
                  key={category}
                  category={category}
                  perms={perms}
                  visible={visible}
                  roleNames={roleNames}
                  isSaving={isSaving}
                  onToggle={onToggle}
                  categoryTally={categoryTally}
                  info={info}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── < md: pick a role, then toggle rows ── */}
      {visibleCount > 0 && (
        <div className="md:hidden">
          <label className="flex items-center gap-2 border-b border-[oklch(var(--color-block))] pb-2 text-sm">
            <span className="font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">{t("permissions.matrix.role_picker")}</span>
            <select
              aria-label={t("permissions.matrix.role_picker")}
              value={role}
              onChange={(e) => onMobileRoleChange(e.target.value)}
              className="min-h-11 flex-1 border border-[oklch(var(--color-line))] bg-[oklch(var(--color-surface-1))] px-2 text-sm"
            >
              {roleNames.map((r) => (
                <option key={r} value={r}>
                  {r} · {roleLabel(roleMeta, r)}
                </option>
              ))}
            </select>
          </label>
          {shown.map(({ category, perms, visible }) => (
            <section key={category} aria-label={category}>
              <h3 className="flex justify-between border-b border-[oklch(var(--color-block))] pt-4 pb-1 font-mono text-2xs uppercase tracking-widest text-[oklch(var(--color-ink-subtle))]">
                <span>{category}</span>
                <span>{categoryTally(perms, role)}</span>
              </h3>
              <ul>
                {visible.map((perm) => (
                  <li key={perm.id} className="flex min-h-12 items-center justify-between gap-3 border-b border-[oklch(var(--color-rule))]">
                    <span className="min-w-0">
                      <span className="block text-sm text-[oklch(var(--color-ink))]">{perm.name}</span>
                      <span className="block font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">{perm.codename}</span>
                    </span>
                    <MatrixCell
                      role={role}
                      perm={perm}
                      info={info}
                      disabled={isSaving}
                      onToggle={() => onToggle(role, perm.id)}
                      variant="switch"
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

function MatrixGroup({
  category,
  perms,
  visible,
  roleNames,
  isSaving,
  onToggle,
  categoryTally,
  info,
}: {
  category: string;
  perms: Permission[];
  visible: Permission[];
  roleNames: string[];
  isSaving: boolean;
  onToggle: (role: string, permId: number) => void;
  categoryTally: (perms: Permission[], role: string) => string;
  info: MatrixCellInfo;
}) {
  return (
    <>
      {/* 组头与区块标题同一样式(E-11a):等宽 11 px、字距、下接区块边界。
          `top-[44px]` 对着表头那一行的 h-11。 */}
      <tr>
        <th
          scope="colgroup"
          className="sticky top-[44px] left-0 z-30 border-b border-[oklch(var(--color-block))] bg-[oklch(var(--color-canvas))] px-3 pt-3 pb-1 text-left font-mono text-2xs font-normal uppercase tracking-widest text-[oklch(var(--color-ink-subtle))]"
        >
          {category}
        </th>
        {roleNames.map((role) => (
          <td
            key={role}
            className="sticky top-[44px] z-20 border-b border-[oklch(var(--color-block))] bg-[oklch(var(--color-canvas))] px-2 pt-3 pb-1 text-center font-mono text-2xs text-[oklch(var(--color-ink-subtle))]"
          >
            {categoryTally(perms, role)}
          </td>
        ))}
      </tr>
      {visible.map((perm) => (
        <tr key={perm.id} className="group hover:bg-[oklch(var(--color-surface-2))]">
          <th
            scope="row"
            className="sticky left-0 z-10 border-b border-[oklch(var(--color-rule))] bg-[oklch(var(--color-canvas))] px-3 py-1 text-left font-normal transition-colors group-hover:bg-[oklch(var(--color-surface-2))]"
          >
            <div className="text-sm text-[oklch(var(--color-ink))]">{perm.name}</div>
            <div className="font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">{perm.codename}</div>
          </th>
          {roleNames.map((role) => (
            <td key={role} className="border-b border-[oklch(var(--color-rule))] px-1 py-1 text-center">
              <MatrixCell
                role={role}
                perm={perm}
                info={info}
                disabled={isSaving}
                onToggle={() => onToggle(role, perm.id)}
                variant="grid"
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/** ■ 有 □ 无 ＋ − 未保存 ! 保存失败 ◇ 引起冲突 始终 ! 禁授 */
export function PermLegend() {
  const { t } = useI18n();
  const items: [CellState, string][] = [
    ["on", "permissions.matrix.legend.on"],
    ["off", "permissions.matrix.legend.off"],
    ["grant", "permissions.matrix.legend.unsaved"],
    ["failed", "permissions.matrix.legend.failed"],
    ["conflict", "permissions.matrix.legend.conflict"],
    ["lock", "permissions.matrix.legend.lock"],
    ["deny", "permissions.matrix.legend.deny"],
  ];
  return (
    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[oklch(var(--color-ink-muted))]">
      {items.map(([state, key]) => (
        <li key={state} className="flex items-center gap-1.5">
          <PermGlyph state={state} />
          {state === "grant" && <PermGlyph state="revoke" />}
          {t(key)}
        </li>
      ))}
    </ul>
  );
}
