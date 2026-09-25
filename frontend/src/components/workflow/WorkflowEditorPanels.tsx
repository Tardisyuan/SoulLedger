"use client";

import { useRef, useState, type ReactNode } from "react";
import type { Edge, Node } from "@xyflow/react";
import { MissingValue } from "@/src/components/ui/DomainValue";
import type { TemplateSigner, WorkflowNodeKind } from "@soulledger/core/api";
import {
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

const SECTION_HEAD =
  "font-mono text-2xs tracking-wide text-[oklch(var(--color-ink-subtle))] pb-1 border-b border-[oklch(var(--color-block))]";

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
    <nav aria-label={t("workflow.editor.palette")} className="flex flex-col py-3 border-r border-[oklch(var(--color-line))] bg-[oklch(var(--color-canvas))] overflow-y-auto">
      <div className={`${SECTION_HEAD} px-3`}>{t("workflow.editor.palette")}</div>
      <ul>
        {PALETTE_TYPES.map((type, i) => (
          <li key={type} className="border-b border-[oklch(var(--color-rule))]">
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
              className="w-full h-9 px-3 flex items-center gap-2 text-left text-sm text-[oklch(var(--color-ink))] hover:bg-[oklch(var(--color-surface-2))] cursor-grab"
            >
              <span aria-hidden="true" className="w-4 text-center font-mono">
                {KIND_GLYPH[type]}
              </span>
              <span className="flex-1">{t(`workflow.editor.kind.${type}`)}</span>
            </button>
          </li>
        ))}
      </ul>
      {children && <p className="mt-auto px-3 pt-4 text-xs text-[oklch(var(--color-ink-muted))]">{children}</p>}
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

/**
 * 「属性面板 Inspector」 + 「校验标 IssueMark」 list. Properties are read here and
 * edited in the node modal (the 编辑 button, or `E` on the canvas): that modal
 * is where the approver-role options are loaded and the fields are validated,
 * and a second form for the same six fields would be two places to keep in
 * step.
 */
export function WorkflowInspector({
  t,
  nodes,
  edges,
  roles,
  issues,
  selectedId,
  onSelect,
  onEdit,
  validationId,
  nodeExtras,
  footer,
}: {
  t: TFunc;
  nodes: readonly Node[];
  edges: readonly Edge[];
  roles: ReadonlyMap<string, NodeRole>;
  issues: readonly FlowIssue[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Absent in the read-only view. */
  onEdit?: (id: string) => void;
  validationId: string;
  /** Sections about the selected node that talk to the API (approver preview, exit conditions). */
  nodeExtras?: (node: Node) => ReactNode;
  /** Template-level sections under the issue list (version history). */
  footer?: ReactNode;
}) {
  const idx = nodes.findIndex((n) => n.id === selectedId);
  const node = idx >= 0 ? nodes[idx] : undefined;
  const role = node ? roles.get(node.id) ?? "step" : "step";
  const field = (label: string, value: string, mono = false) => (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-medium text-[oklch(var(--color-ink-muted))]">{label}</dt>
      <dd className={`text-sm text-[oklch(var(--color-ink))] break-words ${mono ? "font-mono" : ""}`}>{value || <MissingValue kind="unrecorded" />}</dd>
    </div>
  );

  return (
    <aside
      aria-label={t("workflow.editor.inspector")}
      className="flex flex-col gap-4 p-4 bg-[oklch(var(--color-surface-1))] border-l border-[oklch(var(--color-line))] overflow-y-auto max-lg:border-l-0 max-lg:border-t"
    >
      <section>
        <div className={`${SECTION_HEAD} flex justify-between`}>
          <span>
            {t("workflow.editor.inspector")}
            {node && (
              <>
                {" · "}
                <span aria-hidden="true">{ROLE_GLYPH[role]}</span> {t(`workflow.editor.role.${role}`)}
              </>
            )}
          </span>
          {node && <span>N{idx + 1}</span>}
        </div>
        {node ? (
          <>
            <dl className="mt-3 flex flex-col gap-3">
              {field(t("workflow.editor.node_name"), nodeName(node, t))}
              {field(t("workflow.editor.node_type"), String(node.data.nodeType ?? ""), true)}
              {field(t("workflow.editor.court_code"), String(node.data.courtCode ?? ""))}
              {field(
                t("workflow.editor.approver_type"),
                node.data.approverType ? t(`workflow.approver_types.${String(node.data.approverType)}`) : ""
              )}
              {field(t("workflow.editor.approver_role"), String(node.data.approverRole ?? ""), true)}
              {field(t("workflow.editor.kind_label"), `${KIND_GLYPH[kindOf(node)]} ${t(`workflow.editor.kind.${kindOf(node)}`)}`)}
              {kindOf(node) === "COUNTERSIGN" &&
                field(t("workflow.editor.signers"), signersText(node, t))}
              {field(t("workflow.editor.timeout.label"), timeoutText(node, t))}
              {field(t("workflow.editor.branch.pass"), exitText("pass", node, nodes, edges, t))}
              {kindOf(node) !== "END" &&
                kindOf(node) !== "NOTIFY" &&
                field(t("workflow.editor.branch.fail"), exitText("fail", node, nodes, edges, t))}
            </dl>
            {onEdit && (
              <button
                type="button"
                onClick={() => onEdit(node.id)}
                className="mt-3 h-8 px-3 inline-flex items-center gap-2 border border-[oklch(var(--color-block))] text-sm font-medium text-[oklch(var(--color-ink))] hover:bg-[oklch(var(--color-surface-2))]"
              >
                {t("workflow.editor.edit_node")}
                <kbd className="font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">E</kbd>
              </button>
            )}
          </>
        ) : (
          <p className="mt-3 text-sm text-[oklch(var(--color-ink-muted))]">{t("workflow.editor.inspector_empty")}</p>
        )}
      </section>

      {node && nodeExtras?.(node)}

      <section id={validationId} tabIndex={-1} aria-label={t("workflow.editor.issues", { n: String(issues.length) })}>
        <div className={SECTION_HEAD}>{t("workflow.editor.issues", { n: String(issues.length) })}</div>
        {issues.length === 0 ? (
          <p className="py-1.5 text-sm text-[oklch(var(--color-ink-muted))]">{t("workflow.editor.issues_none")}</p>
        ) : (
          <ul>
            {issues.map((issue) => (
              <li key={`${issue.nodeId}-${issue.code}-${issue.branch ?? ""}-${issue.edgeId ?? ""}`} className="border-b border-[oklch(var(--color-rule))]">
                <button
                  type="button"
                  onClick={() => issue.nodeId && onSelect(issue.nodeId)}
                  className="w-full py-1.5 text-left text-sm text-[oklch(var(--color-danger))] hover:underline"
                >
                  <span aria-hidden="true">! </span>
                  {issueText(issue, nodes, t)}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {footer}
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
 * 「模板预览 · 线性」: the nodes in `node_order`, which is the path the engine
 * takes when every node passes and no edge says otherwise. Each chip selects
 * its node. Branch nodes are mono (they carry a condition), nodes with issues
 * are danger-bordered, the end node dashed — the same three marks as the
 * canvas, so the two read as one thing.
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
    <section aria-label={t("workflow.editor.preview")} className="px-4 pt-2 pb-3 border-t border-[oklch(var(--color-block))] bg-[oklch(var(--color-canvas))]">
      <div className="font-mono text-2xs tracking-wide text-[oklch(var(--color-ink-subtle))]">{t("workflow.editor.preview")}</div>
      {nodes.length === 0 ? (
        <p className="mt-1.5 text-sm text-[oklch(var(--color-ink-muted))]">{t("workflow.editor.preview_empty")}</p>
      ) : (
        <ol className="mt-1.5 flex flex-wrap items-center gap-1.5 text-sm">
          {nodes.map((n, i) => {
            const role = roles.get(n.id) ?? "step";
            const bad = issueNodes.has(n.id);
            return (
              <li key={n.id} className="flex items-center gap-1.5">
                <button
                  type="button"
                  aria-pressed={n.id === selectedId}
                  onClick={() => onSelect(n.id)}
                  className={`px-2 py-0.5 border max-lg:min-h-11 ${
                    bad
                      ? "border-[oklch(var(--color-danger))] text-[oklch(var(--color-danger))]"
                      : role === "end"
                        ? "border-dashed border-[oklch(var(--color-line-strong))] text-[oklch(var(--color-ink-muted))]"
                        : "border-[oklch(var(--color-line))] text-[oklch(var(--color-ink))]"
                  } ${role === "branch" ? "font-mono text-xs" : ""} aria-pressed:bg-[oklch(var(--color-surface-2))] aria-pressed:shadow-[inset_3px_0_0_oklch(var(--color-ink))]`}
                >
                  <span aria-hidden="true" className="font-mono">
                    {glyphFor(n, role)}{" "}
                  </span>
                  {bad && <span aria-hidden="true">! </span>}
                  {nodeName(n, t)}
                </button>
                {i < nodes.length - 1 && (
                  <span aria-hidden="true" className="text-[oklch(var(--color-ink-subtle))]">
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
