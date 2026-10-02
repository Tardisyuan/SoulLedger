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
import { ROW_HOVER } from "@/components/ui/data-table";

/**
 * 权限格 PermCell(Design A6,2026-10-02 起;v3 的画法,取代 E-11a / C15):
 *
 *   ■ 已授 — 墨色实心方块        □ 未授 — ink3 空框
 *   ＋ 待授 / − 待撤 — 44 × 44 的格子,7% 墨底 + 2px 墨色强调环 + 600 字形
 *   ! 失败 — 1px danger 框、danger 字,原因在描述里(aria-describedby)与 title 上
 *   ◇ 冲突 — 1px 墨色虚线框 + 2px 墨色强调环;这次改动会让某条审批流的某一步无人可批
 *   始终 — ADMIN 整列:只有 11px ink3 的「始终」二字。服务端对 ADMIN 在读授权之前就答
 *          「有」(`admin_always_all`),所以这里点不动,悬停 / 聚焦说明原因
 *   禁授 — 11px ink3 字 + 135° 细斜线底。服务端禁止授予该角色的格子(`ROLE_FORBIDDEN_CODENAMES`),
 *          一开始就摆明;不用反馈色 —— 禁授是规则,「!」失败才是事后结果
 *
 * 格子里没有文明色,也不再借警示 / 强调色:未保存与冲突靠环与字形,不靠色相。
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

/** The 44 × 44 box the marked states draw (待授 / 待撤 / 失败 / 冲突 / 禁授). */
const BOX = "size-11";
const RING = "bg-[oklch(var(--color-ink)/0.07)] ring-2 ring-[oklch(var(--color-ink))] text-lg font-semibold text-[oklch(var(--color-ink))]";

const CELL_CLASS: Record<CellState, string> = {
  on: "size-3.5 bg-[oklch(var(--color-ink))]",
  off: "size-3.5 border border-[oklch(var(--color-ink-subtle))]",
  grant: `${BOX} ${RING}`,
  revoke: `${BOX} ${RING}`,
  failed: `${BOX} border border-[oklch(var(--color-danger))] text-sm font-semibold text-[oklch(var(--color-danger))]`,
  conflict: `${BOX} border border-dashed border-[oklch(var(--color-ink))] ring-2 ring-[oklch(var(--color-ink))] text-sm text-[oklch(var(--color-ink))]`,
  lock: "text-2xs text-[oklch(var(--color-ink-subtle))]",
  deny: `${BOX} text-2xs text-[oklch(var(--color-ink-subtle))] bg-[repeating-linear-gradient(135deg,oklch(var(--color-line))_0_1px,transparent_1px_5px)]`,
};

/** The drawn square, also used by the legend. */
export function PermGlyph({ state, className }: { state: CellState; className?: string }) {
  const { t } = useI18n();
  const word = state === "lock" ? t("permissions.matrix.lock_word") : state === "deny" ? t("permissions.matrix.deny_word") : null;
  return (
    <span
      aria-hidden="true"
      data-cell-state={state}
      className={cn(
        "inline-flex shrink-0 items-center justify-center leading-none",
        word && "whitespace-nowrap",
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
        ? `${t("permissions.matrix.deny_word")}　${t("permissions.matrix.deny_hint", { perm: perm.name || perm.codename })} role_forbidden_permission`
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
          "flex size-(--control-h-sm) items-center justify-center",
          variant === "grid" && "mx-auto",
          ruled
            ? "cursor-help"
            : disabled
              ? "cursor-not-allowed opacity-70"
              : "cursor-pointer hover:bg-[oklch(var(--color-ink)/0.07)]"
        )}
      >
        <PermGlyph state={state} />
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
        <div className="hidden max-h-[65vh] overflow-auto border border-[oklch(var(--color-line))] bg-[oklch(var(--color-surface-1))] md:block">
          {/* Design A6:表头 56、类别头 44、权限行 48(格内开关仍是 44 的点击区)。 */}
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="h-14">
                <th className="sticky top-0 left-0 z-40 w-[280px] min-w-[240px] border-b border-[oklch(var(--color-line-strong))] bg-[oklch(var(--color-surface-1))] px-4 text-left text-2xs font-normal text-[oklch(var(--color-ink-subtle))] shadow-[2px_0_6px_oklch(0_0_0/0.06)]">
                  {t("permissions.matrix.codename_col")}
                </th>
                {roleNames.map((r) => (
                  <th
                    key={r}
                    className="sticky top-0 z-30 min-w-[96px] border-b border-l border-[oklch(var(--color-line-strong))] border-l-[oklch(var(--color-line))] bg-[oklch(var(--color-surface-1))] px-2 text-center font-medium text-[oklch(var(--color-ink))] shadow-[0_2px_6px_oklch(0_0_0/0.08)]"
                  >
                    <div>{roleLabel(roleMeta, r)}</div>
                    <div className="font-mono text-2xs font-normal text-[oklch(var(--color-ink-muted))]">{r}</div>
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
          <label className="flex min-h-(--control-h-md) items-center gap-2 rounded-control border border-[oklch(var(--color-line-strong))] bg-[oklch(var(--color-surface-1))] pl-3 text-sm">
            <span className="text-2xs text-[oklch(var(--color-ink-muted))]">{t("permissions.matrix.role_picker")}</span>
            <select
              aria-label={t("permissions.matrix.role_picker")}
              value={role}
              onChange={(e) => onMobileRoleChange(e.target.value)}
              className="min-h-(--control-h-md) flex-1 bg-transparent px-2 text-sm font-medium"
            >
              {roleNames.map((r) => (
                <option key={r} value={r}>
                  {r} · {roleLabel(roleMeta, r)}
                </option>
              ))}
            </select>
          </label>
          {shown.map(({ category, perms, visible }) => (
            <section key={category} aria-label={category} className="mt-3 border-y border-[oklch(var(--color-line))] bg-[oklch(var(--color-surface-1))]">
              <h3 className="flex h-9 items-center justify-between bg-[oklch(var(--color-surface-2))] px-4 text-2xs uppercase font-semibold text-[oklch(var(--color-ink-muted))]">
                <span>{category}</span>
                <span className="font-mono font-normal">{categoryTally(perms, role)}</span>
              </h3>
              <ul>
                {visible.map((perm) => (
                  <li key={perm.id} className="flex min-h-12 items-center justify-between gap-3 border-t border-[oklch(var(--color-line))] px-4 py-0.5">
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-[oklch(var(--color-ink))]">{perm.name}</span>
                      <span className="block font-mono text-2xs text-[oklch(var(--color-ink-muted))]">{perm.codename}</span>
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
  const { t } = useI18n();
  return (
    <>
      {/* 类别头(Design A6):44 高、s2 底、「类别 · 条数」;每列是「已授 / 总数」,ADMIN 列写「全部」。
          `top-14` 对着表头那一行的 h-14。 */}
      <tr className="h-11">
        <th
          scope="colgroup"
          className="sticky top-14 left-0 z-30 bg-[oklch(var(--color-surface-2))] px-4 text-left text-2xs font-semibold text-[oklch(var(--color-ink-muted))] shadow-[2px_0_6px_oklch(0_0_0/0.06)]"
        >
          {category} · {perms.length}
        </th>
        {roleNames.map((role) => (
          <td
            key={role}
            className="sticky top-14 z-20 border-l border-[oklch(var(--color-line))] bg-[oklch(var(--color-surface-2))] px-2 text-center font-mono text-2xs text-[oklch(var(--color-ink-muted))]"
          >
            {role === ADMIN_ROLE_NAME ? t("filter.all") : categoryTally(perms, role)}
          </td>
        ))}
      </tr>
      {visible.map((perm) => {
        // 有未保存 / 失败 / 冲突格的行整行 4% 墨底,让人在宽矩阵里找到改过的那几行。
        const touched = roleNames.some((role) => {
          const key = matrixCellKey(role, perm.id);
          return info.pending(key) || info.failure(key) !== null || info.conflict(key);
        });
        return (
        <tr key={perm.id} data-touched={touched || undefined} className={`group h-12 ${touched ? "bg-[oklch(var(--color-ink)/0.04)]" : ROW_HOVER}`}>
          <th
            scope="row"
            className="sticky left-0 z-10 border-t border-[oklch(var(--color-line))] bg-[oklch(var(--color-surface-1))] px-4 text-left font-normal shadow-[2px_0_6px_oklch(0_0_0/0.06)]"
          >
            <div className="text-sm font-medium text-[oklch(var(--color-ink))]">{perm.name}</div>
            <div className="font-mono text-2xs text-[oklch(var(--color-ink-muted))]">{perm.codename}</div>
          </th>
          {roleNames.map((role) => (
            <td key={role} className="border-t border-l border-[oklch(var(--color-line))] p-0 text-center">
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
        );
      })}
    </>
  );
}

/** The legend draws each mark at 20px; the cells draw them at 44. */
const SMALL: Partial<Record<CellState, string>> = {
  grant: "size-5 text-xs ring-1",
  revoke: "size-5 text-xs ring-1",
  failed: "size-5 text-xs",
  conflict: "size-5 text-xs ring-1",
  deny: "h-5 w-auto px-1",
};

/** ■ 已授 □ 未授 ＋ − 未保存 ! 失败 ◇ 冲突 始终 禁授 */
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
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[oklch(var(--color-ink-muted))]">
      {items.map(([state, key]) => (
        <li key={state} className="flex items-center gap-1">
          {state !== "lock" && <PermGlyph state={state} className={SMALL[state]} />}
          {state === "grant" && <PermGlyph state="revoke" className={SMALL.revoke} />}
          {t(key)}
        </li>
      ))}
    </ul>
  );
}
