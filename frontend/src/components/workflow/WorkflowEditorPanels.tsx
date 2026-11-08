"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import type { Edge, Node } from "@xyflow/react";
import { getLocale } from "@soulledger/core/platform";
import { MissingValue } from "@/src/components/ui/DomainValue";
import { TAB_BASE, TAB_ON, TAB_OFF } from "@/src/lib/tabClasses";
import type { TemplateSigner, WorkflowNodeKind } from "@soulledger/core/api";
import {
  AUTO_ROUTE_GLYPH,
  FLOW_ISSUE_CODES,
  KIND_GLYPH,
  ROLE_GLYPH,
  branchOf,
  isAutoRoute,
  kindOf,
  whenOf,
  type Branch,
  type FlowIssue,
  type NodeRole,
} from "@/src/components/workflow/workflowValidation";
import { whenText } from "@/src/components/workflow/workflowConditions";
import { courtLabel } from "@soulledger/core/domain/courts";
import { originRegionLabel } from "@soulledger/core/domain/originRegion";

/**
 * The three panes around the canvas in design C · 03: 节点库 (left), 属性 +
 * 校验 (right), 模板预览 · 线性 (bottom). All three are plain DOM outside the
 * xyflow canvas — none of them is inside `canvasRef`, so the `E` shortcut
 * never fires from here.
 *
 * At < 1024 px the editor drops the canvas and the palette and keeps the other
 * two: that is the read-only view. The preview's chips are what select a node
 * there, since there is no canvas to click.
 */

type TFunc = (key: string, params?: Record<string, string>) => string;

/** v3 区块标签: 11px, uppercase, 0.1em (the `text-2xs` token carries the tracking), ink-subtle. */
const LABEL = "text-2xs uppercase text-[oklch(var(--color-ink-subtle))]";

/**
 * The node KINDS — design C · 03's palette (□ 审批 · ⧉ 会签 · ✉ 通知 · ■ 结束).
 *
 * It used to be the five `NodeType` members, because a stage was the only
 * thing a node could differ in. Kind is now what changes the engine's
 * behaviour, so it is what the palette places; the stage (`NodeType`) is set in
 * the node form. The canvas's other two entries are not kinds here and are not
 * listed: ▷ 开始 is whichever node is first, and ◇ 条件 is a condition on an
 * edge (see the inspector's 出口 · 条件) — both are derived, as the card's
 * glyph already shows.
 */
// AUTO_ROUTE(第四十七批 W-1):不是一种 kind —— 放下的是 NOTIFY 加 `data.autoRoute`,三条出口未连。排在结束之前。
export const PALETTE_TYPES = ["APPROVAL", "COUNTERSIGN", "NOTIFY", "AUTO_ROUTE", "END"] as const;
export type PaletteType = (typeof PALETTE_TYPES)[number];

/** The MIME type a palette drag carries, so a drop of anything else is ignored. */
export const PALETTE_DRAG_TYPE = "application/x-soulledger-node-type";

/**
 * 「节点库 Palette」. Click (or Enter) appends a node of that kind exactly like
 * 「添加节点」; dragging one onto the canvas drops it where it lands.
 */
/**
 * ONE tab stop, arrow keys inside (roving tabindex). Five buttons in the tab
 * order would sit between the toolbar and the canvas, and
 * `e2e/workflow.spec.ts` bounds the walk from the template-name field to the
 * first card at 12 presses — the palette would spend five of them.
 */
export function WorkflowPalette({
  t,
  onAdd,
  children,
}: {
  t: TFunc;
  onAdd: (type: PaletteType) => void;
  /** The canvas hint, pinned under the list. */
  children?: ReactNode;
}) {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  // 两个编辑器可能同时挂着(见 WorkflowEditor 的 formId),提示的 id 不能写死。
  const hintId = useId();
  const move = (to: number) => {
    const next = (to + PALETTE_TYPES.length) % PALETTE_TYPES.length;
    setActive(next);
    refs.current[next]?.focus();
  };
  return (
    /* v4 第十四批 §1: 200 wide (a 56 icon column at 1024–1279, names on hover, still draggable). Drag items
       ≥ 36 high with 6 between (44 on touch), then the role legend in 28-high rows — read-only, roles cannot be
       dragged, they are read off the edges. The hint is a footer OUTSIDE the scrolling part (用户 2026-10-02): it
       used to be the last item of one scrolling column, pinned with `mt-auto`, and at 1440×900 the column was
       ~100px taller than the box — so the hint sat below the box's bottom edge. */
    <nav
      aria-label={t("workflow.editor.palette")}
      className="flex flex-col min-h-0 border-r border-[oklch(var(--color-line))] bg-[oklch(var(--color-surface-1))]"
    >
      <div data-palette-scroll="" className="flex flex-col gap-3 px-3 max-xl:px-2 py-4 min-h-0 flex-1 overflow-y-auto">
        <div className={`${LABEL} max-xl:sr-only`}>{t("workflow.editor.palette")}</div>
        <ul className="flex flex-col gap-[6px]">
          {PALETTE_TYPES.map((type, i) => (
            <li key={type}>
              <button
                ref={(el) => {
                  refs.current[i] = el;
                }}
                type="button"
                tabIndex={i === active ? 0 : -1}
                onFocus={() => setActive(i)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") move(i + 1);
                  else if (e.key === "ArrowUp") move(i - 1);
                  else if (e.key === "Home") move(0);
                  else if (e.key === "End") move(PALETTE_TYPES.length - 1);
                  else return;
                  e.preventDefault();
                }}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(PALETTE_DRAG_TYPE, type);
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => onAdd(type)}
                aria-describedby={type === "AUTO_ROUTE" ? hintId : undefined}
                title={t(`workflow.editor.kind.${type}`)}
                className="peer w-full min-h-9 pointer-coarse:min-h-11 px-3 max-xl:px-0 max-xl:justify-center flex items-center gap-2 text-left text-sm text-[oklch(var(--color-ink))] rounded-control border border-[oklch(var(--color-line))] bg-[oklch(var(--color-surface-1))] hover:border-[oklch(var(--color-ink-muted))] hover:bg-[oklch(var(--color-surface-2))] cursor-grab"
              >
                <span aria-hidden="true" className="w-4 text-center">
                  {type === "AUTO_ROUTE" ? AUTO_ROUTE_GLYPH : KIND_GLYPH[type]}
                </span>
                <span className="flex-1 max-xl:sr-only">{t(`workflow.editor.kind.${type}`)}</span>
              </button>
              {/* W-2:只在悬停 / 键盘聚焦时出现 —— 它是唯一不需要审批人的节点。画在按钮下方而不是右侧浮层:
                  这一栏是滚动容器,浮出去会被裁掉。56 宽的图标列里放不下,那里只有按钮的 title。 */}
              {type === "AUTO_ROUTE" && (
                <p
                  id={hintId}
                  role="tooltip"
                  className="hidden peer-hover:block peer-focus-visible:block max-xl:hidden! mt-1 rounded-panel px-2 py-1 text-xs text-[oklch(var(--color-ink-muted))] border border-[oklch(var(--color-line))]"
                >
                  {t("workflow.editor.palette_hint.AUTO_ROUTE")}
                </p>
              )}
            </li>
          ))}
        </ul>
        <div className="flex flex-col max-xl:hidden">
          <div className={`${LABEL} mt-2 mb-1`}>{t("workflow.editor.roles_title")}</div>
          <ul className="flex flex-col">
            {(Object.keys(ROLE_GLYPH) as NodeRole[]).map((role) => (
              <li key={role} className="flex h-7 items-center gap-2 text-xs text-[oklch(var(--color-ink-muted))]">
                <span aria-hidden="true" className="w-4 text-center text-md text-[oklch(var(--color-accent))]">
                  {ROLE_GLYPH[role]}
                </span>
                {t(`workflow.editor.role_legend.${role}`)}
              </li>
            ))}
          </ul>
          <p className="text-2xs normal-case tracking-normal text-[oklch(var(--color-ink-subtle))]">{t("workflow.editor.roles_note")}</p>
        </div>
      </div>
      {children && (
        <p
          data-palette-hint=""
          className="shrink-0 px-3 py-3 border-t border-[oklch(var(--color-line))] text-xs text-[oklch(var(--color-ink-muted))] max-xl:hidden"
        >
          {children}
        </p>
      )}
    </nav>
  );
}

export function nodeName(node: Node | undefined, t: TFunc): string {
  const english = getLocale() === "en" && typeof node?.data.labelEn === "string" ? node.data.labelEn.trim() : "";
  const label = typeof node?.data.label === "string" ? node.data.label.trim() : "";
  return english || label || t("workflow.editor.unnamed");
}

/** "N3「楚江王 · 初审」" — how a node is named in the issue list and exits. */
function nodeRef(nodes: readonly Node[], id: string, t: TFunc): string {
  const idx = nodes.findIndex((n) => n.id === id);
  if (idx < 0) return t("workflow.editor.template_level");
  return `N${idx + 1}「${nodeName(nodes[idx], t)}」`;
}

export function issueText(issue: FlowIssue, nodes: readonly Node[], t: TFunc, locale?: string): string {
  return t(`workflow.editor.issue.${issue.code}`, {
    node: nodeRef(nodes, issue.nodeId, t),
    branch: issue.branch ? t(`workflow.editor.branch.${issue.branch}`) : "",
    count: String(issue.count ?? 0),
    region: issue.region ? originRegionLabel(t, issue.region, locale) : "",
  });
}

/**
 * Where each outcome goes, in the engine's own terms. An edge wins; without
 * one, PASS goes to the next node by order (or completes the flow on the
 * last) and FAIL ends it as rejected — `complete_node`'s two defaults.
 */
function exitText(branch: Branch, node: Node, nodes: readonly Node[], edges: readonly Edge[], t: TFunc): string {
  const routed = edges.filter((e) => e.source === node.id && branchOf(e) === branch);
  const rejectTo = typeof node.data.rejectTo === "string" ? node.data.rejectTo : "";
  if (branch === "fail" && rejectTo) return t("workflow.editor.exit.reject_to", { node: nodeRef(nodes, rejectTo, t) });
  if (routed.length > 0)
    return routed
      .map((e) => {
        const when = whenOf(e);
        return `→ ${nodeRef(nodes, e.target, t)}${when?.length ? ` (${whenText(when, t)})` : ""}`;
      })
      .join(" · ");
  if (kindOf(node) === "END") return t("workflow.editor.exit.pass_end");
  if (branch === "fail") return t("workflow.editor.exit.fail_default");
  const idx = nodes.findIndex((n) => n.id === node.id);
  return idx < nodes.length - 1
    ? t("workflow.editor.exit.pass_default", { node: nodeRef(nodes, nodes[idx + 1].id, t) })
    : t("workflow.editor.exit.pass_end");
}

/**
 * The inspector's two tabs (Design v4 第十四批 §3, 取舍 2): 属性 (the old 节点 and 出口 tabs, one above the other)
 * and 问题 N. 版本 moved into the template bar's version dropdown.
 */
export const INSPECTOR_TABS = ["props", "issues"] as const;
export type InspectorTab = (typeof INSPECTOR_TABS)[number];

/** v4 section rule: each section of 属性 after the form opens with a line. */
const SECTION = "flex flex-col gap-3 border-t border-[oklch(var(--color-line))] pt-4";

/**
 * 「检查器 Inspector」, v4 第十四批: 360 wide, two 44-high tabs. 属性 edits the selected node in place (the form,
 * then 出口, then 审批人预览); with nothing selected it shows the empty hint and the template's linear preview.
 * 问题 lists every failing check as a card; a card selects its node and puts it in the middle of the canvas.
 *
 * The tab is the editor's state, not this component's: 「! 校验 · N」 in the template bar opens 问题, and a
 * click on a card opens 属性.
 */
export function WorkflowInspector({
  t,
  locale,
  nodes,
  edges,
  roles,
  issues,
  selectedId,
  onSelect,
  onLocate,
  nodeForm,
  validationId,
  tab,
  onTab,
  nodeExtras,
  exits,
  preview,
  hideTabs = false,
}: {
  t: TFunc;
  /** 殿名按界面语言(`courtLabel`;库里中英混写)。 */
  locale?: string;
  nodes: readonly Node[];
  edges: readonly Edge[];
  roles: ReadonlyMap<string, NodeRole>;
  issues: readonly FlowIssue[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** 「定位 →」 on an issue card: select the node and centre the canvas on it. Falls back to `onSelect`. */
  onLocate?: (id: string) => void;
  /** 属性's edit form. Absent in the read-only view, which lists the fields instead. */
  nodeForm?: (node: Node) => ReactNode;
  validationId: string;
  tab: InspectorTab;
  onTab: (tab: InspectorTab) => void;
  /** Sections about the selected node that talk to the API (approver preview). */
  nodeExtras?: (node: Node) => ReactNode;
  /** 出口 · the selected node's exits, the second section of 属性. */
  exits?: (node: Node) => ReactNode;
  /** The template's linear preview: under the empty hint in 属性, and at the bottom of 问题. */
  preview?: ReactNode;
  /** The narrow view draws its own tabs (线性预览 / 问题 / 属性) and shows one panel of this at a time. */
  hideTabs?: boolean;
}) {
  const idx = nodes.findIndex((n) => n.id === selectedId);
  const node = idx >= 0 ? nodes[idx] : undefined;
  const role = node ? roles.get(node.id) ?? "step" : "step";
  // 自动分流(第四十五批):字形 ⇉,没有审批人;出口只在表单里按地域改,这里不再列一遍。
  const autoRoute = node ? isAutoRoute(node, edges) : false;
  const field = (label: string, value: string, mono = false) => (
    <>
      <dt className="py-1 text-xs text-[oklch(var(--color-ink-muted))]">{label}</dt>
      <dd className={`py-1 text-sm text-[oklch(var(--color-ink))] break-words min-w-0 ${mono ? "font-mono" : ""}`}>
        {value || <MissingValue kind="unrecorded" />}
      </dd>
    </>
  );
  const failing = new Set(issues.map((i) => i.code));
  const nodeIssues = node ? issues.filter((i) => i.nodeId === node.id) : [];
  const locate = onLocate ?? onSelect;
  const empty = <p className="text-sm text-[oklch(var(--color-ink-muted))]">{t("workflow.editor.inspector_empty")}</p>;
  const tag = "inline-flex h-6 items-center gap-1 rounded-control border border-[oklch(var(--color-line))] px-2 text-xs text-[oklch(var(--color-ink-muted))]";

  return (
    <aside
      aria-label={t("workflow.editor.inspector")}
      className="flex flex-col min-h-0 bg-[oklch(var(--color-surface-1))] border-l border-[oklch(var(--color-line))] max-lg:border-l-0"
    >
      {!hideTabs && (
        <div role="tablist" aria-label={t("workflow.editor.inspector")} className="flex shrink-0 border-b border-[oklch(var(--color-line))]">
          {INSPECTOR_TABS.map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              id={`${validationId}-tab-${k}`}
              aria-selected={tab === k}
              aria-controls={`${validationId}-panel`}
              onClick={() => onTab(k)}
              className={`${TAB_BASE} ${tab === k ? TAB_ON : TAB_OFF} flex-1 h-11 gap-2 ${tab === k ? "border-[oklch(var(--color-accent))]!" : ""}`}
            >
              {k === "issues" ? (
                <>
                  {t("workflow.editor.tab.issues")}{" "}
                  <span
                    className={`inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-control px-1 font-mono text-2xs ${
                      issues.length > 0
                        ? "bg-[oklch(var(--color-danger))] text-[oklch(var(--color-on-danger))]"
                        : "text-[oklch(var(--color-ink-muted))]"
                    }`}
                  >
                    {issues.length}
                  </span>
                </>
              ) : (
                t("workflow.editor.inspector")
              )}
            </button>
          ))}
        </div>
      )}

      <div
        role={hideTabs ? undefined : "tabpanel"}
        id={`${validationId}-panel`}
        aria-labelledby={hideTabs ? undefined : `${validationId}-tab-${tab}`}
        className="flex flex-col gap-4 px-4 py-[14px] overflow-y-auto min-h-0"
      >
        {tab === "props" &&
          (node ? (
            <>
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={tag}>
                    <span aria-hidden="true">{autoRoute ? AUTO_ROUTE_GLYPH : KIND_GLYPH[kindOf(node)]}</span>
                    {autoRoute ? t("workflow.editor.auto_route.kind") : t(`workflow.editor.kind.${kindOf(node)}`)}
                  </span>
                  <span className={tag}>
                    <span aria-hidden="true" className="text-[oklch(var(--color-accent))]">{ROLE_GLYPH[role]}</span>
                    {t(`workflow.editor.role.${role}`)}
                  </span>
                  <span className="ml-auto font-mono text-xs text-[oklch(var(--color-ink-muted))]">N{idx + 1}</span>
                </div>
                <h2 className="font-title text-lg text-[oklch(var(--color-ink))] break-words">{nodeName(node, t)}</h2>
              </div>
              {nodeIssues.length > 0 && (
                <div
                  data-node-issue-summary=""
                  className="flex gap-2 rounded-panel border border-[oklch(var(--color-danger)/0.35)] bg-[oklch(var(--color-danger)/0.1)] px-3 py-2 text-sm text-[oklch(var(--color-ink))]"
                >
                  <span aria-hidden="true" className="font-semibold text-[oklch(var(--color-danger))]">
                    !
                  </span>
                  <span>{t("workflow.editor.node_issue_summary", { n: String(nodeIssues.length) })}</span>
                </div>
              )}
              {nodeForm?.(node)}
              {/* Read-only: every field as text. Editable: the form above carries the fields, and only the two
                  routes stay as text — they are edges, edited on the canvas and in 出口 below. */}
              <dl className="grid grid-cols-[72px_minmax(0,1fr)] gap-x-3">
                {!nodeForm && (
                  <>
                    {field(t("workflow.editor.node_name"), nodeName(node, t))}
                    {field(t("workflow.editor.kind_label"), `${KIND_GLYPH[kindOf(node)]} ${t(`workflow.editor.kind.${kindOf(node)}`)}`)}
                    {field(t("workflow.editor.node_type"), String(node.data.nodeType ?? ""), true)}
                    {field(t("workflow.editor.court_code"), courtLabel(t, typeof node.data.courtCode === "string" ? node.data.courtCode : "", locale))}
                    {field(
                      t("workflow.editor.approver_type"),
                      node.data.approverType ? t(`workflow.approver_types.${String(node.data.approverType)}`) : ""
                    )}
                    {field(t("workflow.editor.approver_role"), String(node.data.approverRole ?? ""), true)}
                    {kindOf(node) === "COUNTERSIGN" && field(t("workflow.editor.signers"), signersText(node, t))}
                    {field(t("workflow.editor.timeout.label"), timeoutText(node, t))}
                  </>
                )}
                {!autoRoute && field(t("workflow.editor.branch.pass"), exitText("pass", node, nodes, edges, t))}
                {kindOf(node) !== "END" &&
                  kindOf(node) !== "NOTIFY" &&
                  field(t("workflow.editor.branch.fail"), exitText("fail", node, nodes, edges, t))}
              </dl>
              {/* 出口 · the old 出口 tab. An editable 自动分流 already carries its exits in the form above. */}
              {exits && !(autoRoute && nodeForm) && <div className={SECTION}>{exits(node)}</div>}
              {nodeExtras && <div className={SECTION}>{nodeExtras(node)}</div>}
            </>
          ) : (
            <>
              {empty}
              {preview}
            </>
          ))}

        {tab === "issues" && (
          <section id={validationId} tabIndex={-1} aria-label={t("workflow.editor.issues", { n: String(issues.length) })} className="flex flex-col gap-3">
            {issues.length === 0 ? (
              <p className="text-sm text-[oklch(var(--color-ink-muted))]">{t("workflow.editor.issues_none")}</p>
            ) : (
              <>
                <div className="rounded-panel border border-[oklch(var(--color-danger)/0.35)] bg-[oklch(var(--color-danger)/0.1)] px-3 py-2">
                  <h2 className="text-sm font-semibold text-[oklch(var(--color-ink))]">
                    <span aria-hidden="true" className="text-[oklch(var(--color-danger))]">! </span>
                    {t("workflow.editor.issues_blocking", { n: String(issues.length) })}
                  </h2>
                  <p className="text-xs text-[oklch(var(--color-ink-muted))]">{t("workflow.editor.issues_hint")}</p>
                </div>
                <ul className="flex flex-col gap-2">
                  {issues.map((issue) => {
                    const at = nodes.find((n) => n.id === issue.nodeId);
                    const current = issue.nodeId !== "" && issue.nodeId === selectedId;
                    return (
                      <li key={`${issue.nodeId}-${issue.code}-${issue.branch ?? ""}-${issue.edgeId ?? ""}-${issue.region ?? ""}`}>
                        <button
                          type="button"
                          aria-current={current ? "true" : undefined}
                          onClick={() => {
                            if (!issue.nodeId) return;
                            // 第四十七批 W-3:自动分流缺出口的那一行,选中节点并把焦点放到那条出口的下拉(在 属性 页签)。
                            if (issue.code === "auto_route_exit_missing" && issue.region) {
                              flushSync(() => {
                                locate(issue.nodeId);
                                onTab("props");
                              });
                              document.getElementById(`${issue.nodeId}-exit-${issue.region}`)?.focus();
                              return;
                            }
                            locate(issue.nodeId);
                          }}
                          className={`w-full min-h-[46px] pointer-coarse:min-h-11 grid grid-cols-[auto_minmax(0,1fr)_auto] gap-x-2 rounded-panel px-3 py-2 text-left hover:bg-[oklch(var(--color-surface-2))] ${
                            current
                              ? "border-[1.5px] border-[oklch(var(--color-danger))] bg-[oklch(var(--color-danger)/0.06)]"
                              : "border border-[oklch(var(--color-line))]"
                          }`}
                        >
                          <span aria-hidden="true" className="font-semibold text-[oklch(var(--color-danger))]">
                            !
                          </span>
                          <span className="flex flex-col min-w-0">
                            <span className="text-sm font-semibold text-[oklch(var(--color-ink))] break-words">
                              {at && <span aria-hidden="true">{isAutoRoute(at, edges) ? AUTO_ROUTE_GLYPH : KIND_GLYPH[kindOf(at)]} </span>}
                              {at ? nodeName(at, t) : t("workflow.editor.template_level")}
                            </span>
                            <span className="text-sm text-[oklch(var(--color-ink))]">{issueText(issue, nodes, t, locale)}</span>
                            <span className="font-mono text-2xs normal-case tracking-normal text-[oklch(var(--color-faint-text))]">
                              {issue.code}
                            </span>
                          </span>
                          {issue.nodeId && (
                            <span className="self-center whitespace-nowrap text-xs text-[oklch(var(--color-ink-muted))]">
                              {t("workflow.editor.locate")} →
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
            <p className="flex min-h-[46px] items-center gap-2 border-t border-[oklch(var(--color-line))] text-xs text-[oklch(var(--color-ink-muted))]">
              <span aria-hidden="true" className="text-[oklch(var(--color-success))]">✓</span>
              {t("workflow.editor.issues_checks", {
                total: String(FLOW_ISSUE_CODES.length),
                passed: String(FLOW_ISSUE_CODES.filter((c) => !failing.has(c)).length),
              })}
            </p>
            {preview}
          </section>
        )}
      </div>
    </aside>
  );
}

function signersText(node: Node, t: TFunc): string {
  const signers = (Array.isArray(node.data.signers) ? node.data.signers : []) as TemplateSigner[];
  if (signers.length === 0) return "";
  const who = signers.map((s) => s.label || s.approver_role || "?").join("、");
  const threshold = typeof node.data.threshold === "number" ? node.data.threshold : signers.length;
  return t("workflow.editor.signers_summary", { who, k: String(threshold), n: String(signers.length) });
}

function timeoutText(node: Node, t: TFunc): string {
  const hours = typeof node.data.timeoutHours === "number" ? node.data.timeoutHours : 0;
  const action = typeof node.data.timeoutAction === "string" ? node.data.timeoutAction : "";
  if (!hours || !action) return "";
  const role = typeof node.data.timeoutRole === "string" ? node.data.timeoutRole : "";
  return t("workflow.editor.timeout.summary", {
    hours: String(hours),
    action: t(`workflow.editor.timeout.action.${action}`) + (action === "ESCALATE" && role ? ` · ${role}` : ""),
  });
}

/** The glyph a card and a chip show: 会签 / 通知 / 结束 by kind, otherwise the derived role. */
export function glyphFor(node: Node, role: NodeRole): string {
  const kind: WorkflowNodeKind = kindOf(node);
  return kind === "APPROVAL" ? ROLE_GLYPH[role] : KIND_GLYPH[kind];
}

/**
 * 「线性预览」, v4 第十四批: no longer a strip under the canvas — it sits in the inspector, under 属性's empty
 * hint and at the bottom of 问题. The nodes in `node_order`, which is the path the engine takes when every node
 * passes and no edge says otherwise; each chip selects its node. A node with issues is danger and carries `!` —
 * glyph and colour, never colour alone. The node / edge count is in the template bar.
 */
export function WorkflowLinearPreview({
  t,
  nodes,
  roles,
  issueNodes,
  selectedId,
  onSelect,
}: {
  t: TFunc;
  nodes: readonly Node[];
  roles: ReadonlyMap<string, NodeRole>;
  issueNodes: ReadonlySet<string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <section aria-label={t("workflow.editor.preview")} className="flex flex-col gap-2 border-t border-[oklch(var(--color-line))] pt-3 text-xs">
      <span className={LABEL}>{t("workflow.editor.preview")}</span>
      {nodes.length === 0 ? (
        <span className="text-[oklch(var(--color-ink-muted))]">{t("workflow.editor.preview_empty")}</span>
      ) : (
        <ol className="flex flex-wrap items-center gap-y-1">
          {nodes.map((n, i) => {
            const role = roles.get(n.id) ?? "step";
            const bad = issueNodes.has(n.id);
            return (
              <li key={n.id} className="flex items-center">
                <button
                  type="button"
                  aria-pressed={n.id === selectedId}
                  onClick={() => onSelect(n.id)}
                  className={`min-h-7 pointer-coarse:min-h-11 rounded-control px-2 hover:bg-[oklch(var(--color-surface-2))] aria-pressed:bg-[oklch(var(--color-ink)/0.07)] aria-pressed:font-medium ${
                    bad ? "text-[oklch(var(--color-danger))]" : "text-[oklch(var(--color-ink))]"
                  }`}
                >
                  <span aria-hidden="true">{glyphFor(n, role)} </span>
                  {bad && <span aria-hidden="true">! </span>}
                  {nodeName(n, t)}
                </button>
                {i < nodes.length - 1 && (
                  <span aria-hidden="true" className="px-0.5 text-[oklch(var(--color-ink-subtle))]">
                    →
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/**
 * The read-only flow below 1024 (v4 第十四批 §5): the canvas's own node card, stacked full width, one per node in
 * order, with a vertical rule between them that names the exit taken. The card's first line is the ROLE glyph ·
 * KIND glyph and name, the court (and k/n for 会签) at the right; the second the display name; a node with issues
 * keeps its「!」and the short reason line. A card selects its node, and the narrow view then shows 属性.
 */
export function WorkflowReadOnlyList({
  t,
  locale,
  nodes,
  edges,
  roles,
  issueNodes,
  issues = [],
  selectedId,
  onSelect,
}: {
  t: TFunc;
  /** 殿名按界面语言(`courtLabel`;库里中英混写)。 */
  locale?: string;
  nodes: readonly Node[];
  edges: readonly Edge[];
  roles: ReadonlyMap<string, NodeRole>;
  issueNodes: ReadonlySet<string>;
  /** For each failing card's short reason (`issue_short.<code>`). */
  issues?: readonly FlowIssue[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <section aria-label={t("workflow.editor.preview")} className="flex flex-col gap-2">
      <div className={LABEL}>{t("workflow.editor.flow_count", { n: String(nodes.length) })}</div>
      {nodes.length === 0 ? (
        <p className="text-sm text-[oklch(var(--color-ink-muted))]">{t("workflow.editor.preview_empty")}</p>
      ) : (
        <ol className="flex flex-col">
          {nodes.map((n) => {
            const role = roles.get(n.id) ?? "step";
            const kind = kindOf(n);
            const bad = issueNodes.has(n.id);
            const code = issues.find((x) => x.nodeId === n.id)?.code;
            const signers = Array.isArray(n.data.signers) ? n.data.signers.length : 0;
            const right = [
              typeof n.data.courtCode === "string" ? courtLabel(t, n.data.courtCode, locale) : "",
              kind === "COUNTERSIGN" && signers > 0
                ? `${typeof n.data.threshold === "number" ? n.data.threshold : signers}/${signers}`
                : "",
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <li key={n.id} className="flex flex-col">
                <button
                  type="button"
                  aria-pressed={n.id === selectedId}
                  onClick={() => onSelect(n.id)}
                  className={`w-full min-h-11 flex flex-col rounded-panel px-3 pt-[9px] pb-[10px] text-left bg-[oklch(var(--color-surface-2))] [.light_&]:bg-[oklch(var(--color-surface-1))] [.light_&]:shadow-(--shadow-card) aria-pressed:outline-2 aria-pressed:outline-offset-2 aria-pressed:outline-[oklch(var(--color-accent))] ${
                    bad ? "border-[1.5px] border-[oklch(var(--color-danger))]" : "border border-[oklch(var(--color-line))]"
                  }`}
                >
                  {/* The name comes first in the DOM (it starts the button's accessible name) and second on screen. */}
                  <span className="order-2 mt-0.5 block text-sm leading-5 font-semibold break-words text-[oklch(var(--color-ink))]">
                    {nodeName(n, t)}
                    {bad && <span aria-hidden="true" className="text-[oklch(var(--color-danger))]"> !</span>}
                  </span>
                  <span className="order-1 flex items-center justify-between gap-2 text-xs leading-4 text-[oklch(var(--color-ink-muted))]">
                    <span>
                      <span aria-hidden="true" className="text-[oklch(var(--color-accent))]">{ROLE_GLYPH[role]}</span>{" "}
                      <span aria-hidden="true">{KIND_GLYPH[kind]}</span> {t(`workflow.editor.kind.${kind}`)}
                    </span>
                    <span className="font-mono">{right}</span>
                  </span>
                  {bad && (
                    <span className="order-3 mt-2 block border-t border-[oklch(var(--color-line))] pt-[6px] text-xs leading-4 text-[oklch(var(--color-danger))]">
                      {code && code !== "auto_route_exit_missing"
                        ? t(`workflow.editor.issue_short.${code}`)
                        : t("workflow.editor.node_issue_count", { n: String(issues.filter((x) => x.nodeId === n.id).length) })}
                    </span>
                  )}
                </button>
                {/* Under each card: a vertical rule and where this node's outcomes go. */}
                <span className="ml-6 border-l border-[oklch(var(--color-line-strong))] py-2 pl-3 text-xs text-[oklch(var(--color-ink-muted))] break-words">
                  {t("workflow.editor.branch.pass")} {exitText("pass", n, nodes, edges, t)}
                  {kind !== "END" && kind !== "NOTIFY" && (
                    <>
                      {" · "}
                      {t("workflow.editor.branch.fail")} {exitText("fail", n, nodes, edges, t)}
                    </>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      <p className="text-xs text-[oklch(var(--color-ink-muted))]">{t("workflow.editor.glyph_legend")}</p>
    </section>
  );
}
