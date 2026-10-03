"use client";

import { useRef, useState, type ReactNode } from "react";
import type { Edge, Node } from "@xyflow/react";
import { MissingValue } from "@/src/components/ui/DomainValue";
import { TAB_BASE, TAB_ON, TAB_OFF } from "@/src/lib/tabClasses";
import type { TemplateSigner, WorkflowNodeKind } from "@soulledger/core/api";
import {
  FLOW_ISSUE_CODES,
  KIND_GLYPH,
  ROLE_GLYPH,
  branchOf,
  kindOf,
  whenOf,
  type Branch,
  type FlowIssue,
  type NodeRole,
} from "@/src/components/workflow/workflowValidation";
import { whenText } from "@/src/components/workflow/workflowConditions";

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
export const PALETTE_TYPES = ["APPROVAL", "COUNTERSIGN", "NOTIFY", "END"] as const;
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
  const move = (to: number) => {
    const next = (to + PALETTE_TYPES.length) % PALETTE_TYPES.length;
    setActive(next);
    refs.current[next]?.focus();
  };
  return (
    /* v3 A1: 176 wide on surface-1, 16/12 padding. Four 48-high drag blocks, then
       the role legend — roles cannot be dragged, they are read off the edges.
       The hint is a footer OUTSIDE the scrolling part (用户 2026-10-02): it used to be the
       last item of one scrolling column, pinned with `mt-auto`, and at 1440×900 the column
       was ~100px taller than the box — so the hint sat below the box's bottom edge. */
    <nav
      aria-label={t("workflow.editor.palette")}
      className="flex flex-col min-h-0 border-r border-[oklch(var(--color-line))] bg-[oklch(var(--color-surface-1))]"
    >
      <div data-palette-scroll="" className="flex flex-col gap-3 px-3 py-4 min-h-0 flex-1 overflow-y-auto">
        <div className={LABEL}>{t("workflow.editor.palette")}</div>
        <ul className="flex flex-col gap-2">
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
                className="w-full h-12 px-3 flex items-center gap-2 text-left text-sm text-[oklch(var(--color-ink))] border border-[oklch(var(--color-line-strong))] bg-[oklch(var(--color-surface-1))] hover:bg-[oklch(var(--color-surface-2))] cursor-grab"
              >
                <span aria-hidden="true" className="w-4 text-center">
                  {KIND_GLYPH[type]}
                </span>
                <span className="flex-1">{t(`workflow.editor.kind.${type}`)}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className={`${LABEL} mt-2`}>{t("workflow.editor.roles_title")}</div>
        <ul className="flex flex-col gap-2">
          {(Object.keys(ROLE_GLYPH) as NodeRole[]).map((role) => (
            <li key={role} className="flex items-center gap-2 text-xs text-[oklch(var(--color-ink-muted))]">
              <span aria-hidden="true" className="w-4 text-center text-md text-[oklch(var(--color-ink))]">
                {ROLE_GLYPH[role]}
              </span>
              {t(`workflow.editor.role_legend.${role}`)}
            </li>
          ))}
        </ul>
        <p className="text-2xs normal-case tracking-normal text-[oklch(var(--color-ink-subtle))]">{t("workflow.editor.roles_note")}</p>
      </div>
      {children && (
        <p
          data-palette-hint=""
          className="shrink-0 px-3 py-3 border-t border-[oklch(var(--color-line))] text-xs text-[oklch(var(--color-ink-muted))]"
        >
          {children}
        </p>
      )}
    </nav>
  );
}

function nodeName(node: Node | undefined, t: TFunc): string {
  const label = typeof node?.data.label === "string" ? node.data.label.trim() : "";
  return label || t("workflow.editor.unnamed");
}

/** "N3「楚江王 · 初审」" — how a node is named in the issue list and exits. */
function nodeRef(nodes: readonly Node[], id: string, t: TFunc): string {
  const idx = nodes.findIndex((n) => n.id === id);
  if (idx < 0) return t("workflow.editor.template_level");
  return `N${idx + 1}「${nodeName(nodes[idx], t)}」`;
}

export function issueText(issue: FlowIssue, nodes: readonly Node[], t: TFunc): string {
  return t(`workflow.editor.issue.${issue.code}`, {
    node: nodeRef(nodes, issue.nodeId, t),
    branch: issue.branch ? t(`workflow.editor.branch.${issue.branch}`) : "",
    count: String(issue.count ?? 0),
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

/** The inspector's four tabs, v3 A1: 节点 / 出口 / 问题 N / 版本. */
export const INSPECTOR_TABS = ["node", "exits", "issues", "version"] as const;
export type InspectorTab = (typeof INSPECTOR_TABS)[number];

/**
 * 「检查器 Inspector」, v3 A1: 360 wide, four tabs. Properties are read here and
 * edited in the node modal (the 编辑 button, or `E` on the canvas): that modal
 * is where the approver-role options are loaded and the fields are validated,
 * and a second form for the same fields would be two places to keep in step.
 *
 * The tab is the editor's state, not this component's: 「! 校验 · N」 in the
 * toolbar opens 问题, and a click on a card opens 节点.
 */
export function WorkflowInspector({
  t,
  nodes,
  edges,
  roles,
  issues,
  selectedId,
  onSelect,
  nodeForm,
  validationId,
  tab,
  onTab,
  nodeExtras,
  exits,
  version,
}: {
  t: TFunc;
  nodes: readonly Node[];
  edges: readonly Edge[];
  roles: ReadonlyMap<string, NodeRole>;
  issues: readonly FlowIssue[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** The 节点 tab's edit form (v3 A1). Absent in the read-only view, which lists the fields instead. */
  nodeForm?: (node: Node) => ReactNode;
  validationId: string;
  tab: InspectorTab;
  onTab: (tab: InspectorTab) => void;
  /** Sections about the selected node that talk to the API (approver preview). */
  nodeExtras?: (node: Node) => ReactNode;
  /** The 出口 tab's body for the selected node. */
  exits?: (node: Node) => ReactNode;
  /** The 版本 tab's body. */
  version?: ReactNode;
}) {
  const idx = nodes.findIndex((n) => n.id === selectedId);
  const node = idx >= 0 ? nodes[idx] : undefined;
  const role = node ? roles.get(node.id) ?? "step" : "step";
  const field = (label: string, value: string, mono = false) => (
    <>
      <dt className="py-1 text-xs text-[oklch(var(--color-ink-muted))]">{label}</dt>
      <dd className={`py-1 text-sm text-[oklch(var(--color-ink))] break-words min-w-0 ${mono ? "font-mono" : ""}`}>
        {value || <MissingValue kind="unrecorded" />}
      </dd>
    </>
  );
  const failing = new Set(issues.map((i) => i.code));
  const tabLabel = (k: InspectorTab) =>
    k === "issues" ? `${t("workflow.editor.tab.issues")} ${issues.length}` : t(`workflow.editor.tab.${k}`);
  const empty = <p className="text-sm text-[oklch(var(--color-ink-muted))]">{t("workflow.editor.inspector_empty")}</p>;

  return (
    <aside
      aria-label={t("workflow.editor.inspector")}
      className="flex flex-col min-h-0 bg-[oklch(var(--color-surface-1))] border-l border-[oklch(var(--color-line))] max-lg:border-l-0 max-lg:border-t"
    >
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
            className={`${TAB_BASE} ${tab === k ? TAB_ON : TAB_OFF} flex-1 h-12 ${
              k === "issues" && issues.length > 0 ? "text-[oklch(var(--color-danger))]!" : ""
            }`}
          >
            {tabLabel(k)}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`${validationId}-panel`}
        aria-labelledby={`${validationId}-tab-${tab}`}
        className="flex flex-col gap-4 p-4 overflow-y-auto min-h-0"
      >
        {tab === "node" &&
          (node ? (
            <>
              <div>
                <h2 className="text-lg text-[oklch(var(--color-ink))] break-words">
                  <span aria-hidden="true">{KIND_GLYPH[kindOf(node)]} </span>
                  {nodeName(node, t)}
                </h2>
                <p className="text-xs text-[oklch(var(--color-ink-muted))]">
                  <span aria-hidden="true">{ROLE_GLYPH[role]} </span>
                  {t(`workflow.editor.role.${role}`)} · <span className="font-mono">N{idx + 1}</span>
                </p>
              </div>
              {nodeForm?.(node)}
              {/* Read-only: every field as text. Editable: the form above
                  carries the fields, and only the two routes stay as text —
                  they are edges, edited on the canvas and in 出口. */}
              <dl className="grid grid-cols-[72px_minmax(0,1fr)] gap-x-3">
                {!nodeForm && (
                  <>
                    {field(t("workflow.editor.node_name"), nodeName(node, t))}
                    {field(t("workflow.editor.kind_label"), `${KIND_GLYPH[kindOf(node)]} ${t(`workflow.editor.kind.${kindOf(node)}`)}`)}
                    {field(t("workflow.editor.node_type"), String(node.data.nodeType ?? ""), true)}
                    {field(t("workflow.editor.court_code"), String(node.data.courtCode ?? ""))}
                    {field(
                      t("workflow.editor.approver_type"),
                      node.data.approverType ? t(`workflow.approver_types.${String(node.data.approverType)}`) : ""
                    )}
                    {field(t("workflow.editor.approver_role"), String(node.data.approverRole ?? ""), true)}
                    {kindOf(node) === "COUNTERSIGN" && field(t("workflow.editor.signers"), signersText(node, t))}
                    {field(t("workflow.editor.timeout.label"), timeoutText(node, t))}
                  </>
                )}
                {field(t("workflow.editor.branch.pass"), exitText("pass", node, nodes, edges, t))}
                {kindOf(node) !== "END" &&
                  kindOf(node) !== "NOTIFY" &&
                  field(t("workflow.editor.branch.fail"), exitText("fail", node, nodes, edges, t))}
              </dl>
              {nodeExtras?.(node)}
            </>
          ) : (
            empty
          ))}

        {tab === "exits" && (node ? exits?.(node) : empty)}

        {tab === "issues" && (
          <section id={validationId} tabIndex={-1} aria-label={t("workflow.editor.issues", { n: String(issues.length) })}>
            {issues.length === 0 ? (
              <p className="text-sm text-[oklch(var(--color-ink-muted))]">{t("workflow.editor.issues_none")}</p>
            ) : (
              <>
                <h2 className="text-lg text-[oklch(var(--color-ink))]">
                  {t("workflow.editor.issues_blocking", { n: String(issues.length) })}
                </h2>
                <p className="text-xs text-[oklch(var(--color-ink-muted))]">{t("workflow.editor.issues_hint")}</p>
                <ul className="mt-3 flex flex-col">
                  {issues.map((issue) => (
                    <li
                      key={`${issue.nodeId}-${issue.code}-${issue.branch ?? ""}-${issue.edgeId ?? ""}`}
                      className="border-b border-[oklch(var(--color-line))]"
                    >
                      <button
                        type="button"
                        aria-current={issue.nodeId !== "" && issue.nodeId === selectedId ? "true" : undefined}
                        onClick={() => issue.nodeId && onSelect(issue.nodeId)}
                        className="w-full flex gap-2 px-2 py-3 text-left hover:bg-[oklch(var(--color-surface-2))] aria-[current=true]:bg-[oklch(var(--color-ink)/0.07)]"
                      >
                        <span aria-hidden="true" className="font-semibold text-[oklch(var(--color-danger))]">
                          !
                        </span>
                        <span className="flex flex-col min-w-0">
                          <span className="text-sm font-medium text-[oklch(var(--color-ink))]">{issueText(issue, nodes, t)}</span>
                          <span className="font-mono text-2xs normal-case tracking-normal text-[oklch(var(--color-ink-subtle))]">
                            {issue.code}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <p className="mt-3 text-xs text-[oklch(var(--color-ink-muted))]">
              {t("workflow.editor.issues_checks", {
                total: String(FLOW_ISSUE_CODES.length),
                passed: String(FLOW_ISSUE_CODES.filter((c) => !failing.has(c)).length),
              })}
            </p>
          </section>
        )}

        {tab === "version" && version}
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
 * 「线性预览」, v3 A1: one 44-high line under the canvas, never wrapping. The
 * nodes in `node_order`, which is the path the engine takes when every node
 * passes and no edge says otherwise; each chip selects its node. A node with
 * issues is danger and carries `!` — glyph and colour, never colour alone.
 * The count at the right end is of what is drawn: nodes and edges.
 */
export function WorkflowLinearPreview({
  t,
  nodes,
  edgeCount,
  roles,
  issueNodes,
  selectedId,
  onSelect,
}: {
  t: TFunc;
  nodes: readonly Node[];
  edgeCount: number;
  roles: ReadonlyMap<string, NodeRole>;
  issueNodes: ReadonlySet<string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <section
      aria-label={t("workflow.editor.preview")}
      className="flex items-center gap-3 h-11 shrink-0 px-4 border-t border-[oklch(var(--color-line))] bg-[oklch(var(--color-surface-1))] text-xs whitespace-nowrap overflow-x-auto"
    >
      <span className={LABEL}>{t("workflow.editor.preview")}</span>
      {nodes.length === 0 ? (
        <span className="text-[oklch(var(--color-ink-muted))]">{t("workflow.editor.preview_empty")}</span>
      ) : (
        <ol className="flex items-center h-full">
          {nodes.map((n, i) => {
            const role = roles.get(n.id) ?? "step";
            const bad = issueNodes.has(n.id);
            return (
              <li key={n.id} className="flex items-center h-full">
                <button
                  type="button"
                  aria-pressed={n.id === selectedId}
                  onClick={() => onSelect(n.id)}
                  className={`h-full px-2 hover:bg-[oklch(var(--color-surface-2))] aria-pressed:bg-[oklch(var(--color-ink)/0.07)] aria-pressed:font-medium ${
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
      <span className="ml-auto pl-4 font-mono text-[oklch(var(--color-ink-muted))]">
        {t("workflow.editor.preview_count", { nodes: String(nodes.length), edges: String(edgeCount) })}
      </span>
    </section>
  );
}

/**
 * The read-only flow below 1024 (v3 A1 · 393): one row per node in order. The
 * left column is the node's ROLE glyph, the name carries its KIND glyph, the
 * right column its court (and k/n for 会签); the second line says where each
 * outcome goes. A row selects its node, which the inspector below then shows.
 */
export function WorkflowReadOnlyList({
  t,
  nodes,
  edges,
  roles,
  issueNodes,
  selectedId,
  onSelect,
}: {
  t: TFunc;
  nodes: readonly Node[];
  edges: readonly Edge[];
  roles: ReadonlyMap<string, NodeRole>;
  issueNodes: ReadonlySet<string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <section aria-label={t("workflow.editor.preview")} className="flex flex-col gap-2">
      <div className={LABEL}>{t("workflow.editor.flow_count", { n: String(nodes.length) })}</div>
      {nodes.length === 0 ? (
        <p className="text-sm text-[oklch(var(--color-ink-muted))]">{t("workflow.editor.preview_empty")}</p>
      ) : (
        <ol className="bg-[oklch(var(--color-surface-1))] border border-[oklch(var(--color-line))]">
          {nodes.map((n) => {
            const role = roles.get(n.id) ?? "step";
            const kind = kindOf(n);
            const bad = issueNodes.has(n.id);
            const signers = Array.isArray(n.data.signers) ? n.data.signers.length : 0;
            const right = [
              typeof n.data.courtCode === "string" ? n.data.courtCode : "",
              kind === "COUNTERSIGN" && signers > 0
                ? `${typeof n.data.threshold === "number" ? n.data.threshold : signers}/${signers}`
                : "",
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <li key={n.id} className="border-b last:border-b-0 border-[oklch(var(--color-line))]">
                <button
                  type="button"
                  aria-pressed={n.id === selectedId}
                  onClick={() => onSelect(n.id)}
                  className="w-full grid grid-cols-[20px_minmax(0,1fr)_auto] gap-x-2 px-3 py-3 text-left hover:bg-[oklch(var(--color-surface-2))] aria-pressed:bg-[oklch(var(--color-ink)/0.07)]"
                >
                  <span aria-hidden="true" className="text-[oklch(var(--color-ink-muted))]">
                    {ROLE_GLYPH[role]}
                  </span>
                  <span
                    className={`text-sm font-medium break-words ${
                      bad ? "text-[oklch(var(--color-danger))]" : "text-[oklch(var(--color-ink))]"
                    }`}
                  >
                    <span aria-hidden="true">{KIND_GLYPH[kind]} </span>
                    {bad && <span aria-hidden="true">! </span>}
                    {nodeName(n, t)}
                  </span>
                  <span className="font-mono text-xs text-[oklch(var(--color-ink-muted))]">{right}</span>
                  <span className="col-start-2 col-span-2 text-xs text-[oklch(var(--color-ink-muted))] break-words">
                    {t("workflow.editor.branch.pass")} {exitText("pass", n, nodes, edges, t)}
                    {kind !== "END" && kind !== "NOTIFY" && (
                      <>
                        {" · "}
                        {t("workflow.editor.branch.fail")} {exitText("fail", n, nodes, edges, t)}
                      </>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
      <p className="text-xs text-[oklch(var(--color-ink-muted))]">{t("workflow.editor.glyph_legend")}</p>
    </section>
  );
}
