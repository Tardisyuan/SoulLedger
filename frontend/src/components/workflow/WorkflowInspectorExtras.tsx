"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Edge, Node } from "@xyflow/react";
import {
  workflowApi,
  type ApproverAssignment,
  type ConditionClause,
  type ConditionFact,
  type ConditionOp,
} from "@soulledger/core/api";
import { workflowKeys } from "@soulledger/core/query_keys";
import {
  FACTS,
  FACT_KEYS,
  defaultClause,
  opsFor,
  whenText,
} from "@/src/components/workflow/workflowConditions";
import { branchOf, whenOf } from "@/src/components/workflow/workflowValidation";

/**
 * The inspector's three data-bearing sections, kept out of
 * `WorkflowEditorPanels.tsx` because they talk to the API and it does not:
 *
 *   - 审批人预览  who the node's approver resolves to (`approver-preview/`)
 *   - 出口 · 条件  the node's PASS exits, with the condition each carries
 *   - 版本        the template's version history, read-only
 */

type TFunc = (key: string, params?: Record<string, string>) => string;

/** v3 区块标签: 11px, uppercase, 0.1em (in the `text-2xs` token), ink-subtle. */
const SECTION_HEAD = "text-2xs uppercase text-[oklch(var(--color-ink-subtle))]";
const CONTROL =
  "h-(--control-h-sm) px-2 rounded-control bg-[oklch(var(--color-surface-1))] border border-[oklch(var(--color-line-strong))] text-sm text-[oklch(var(--color-ink))] focus-visible:border-[oklch(var(--color-ink))]";

function assignmentText(a: ApproverAssignment, t: TFunc): string {
  if (a.approver_type === "ACTOR" && a.actor) {
    return `${a.actor.name_zh || a.actor.name} · ${a.actor.role}`;
  }
  if (a.approver_type === "ROLE" && a.role) return t("workflow.editor.preview_approver.role", { role: a.role });
  return t("workflow.editor.preview_approver.nobody");
}

function usersText(a: ApproverAssignment, t: TFunc): string {
  if (a.user_count === 0) return t("workflow.editor.preview_approver.no_accounts");
  const names = a.users.map((u) => u.display_name).join("、");
  return t("workflow.editor.preview_approver.accounts", { n: String(a.user_count), names });
}

/**
 * Who `_resolve_approver` picks for this node — the backend resolves it with
 * the resolver that builds the workflow, so this is not a second opinion.
 *
 * It reads the SAVED working copy (the draft, else the published graph): an
 * edit not yet saved is not what the server can resolve, and pretending
 * otherwise would show a preview for a node that does not exist there. Hence
 * `saved` — false for a node added or changed since the last save, and the
 * section then says so instead of querying.
 */
export function ApproverPreviewSection({
  t,
  templateId,
  nodeId,
  civilization,
  saved,
}: {
  t: TFunc;
  templateId?: string;
  nodeId: string;
  civilization: string;
  saved: boolean;
}) {
  const enabled = Boolean(templateId) && saved;
  const { data, isLoading, isError } = useQuery({
    queryKey: workflowKeys.templates.approverPreview(templateId ?? "", nodeId, civilization),
    queryFn: async () => (await workflowApi.templates.approverPreview(templateId!, { node: nodeId, civilization })).data,
    enabled,
  });

  let body: React.ReactNode;
  if (!enabled) body = t("workflow.editor.preview_approver.save_first");
  else if (isLoading) body = t("workflow.editor.preview_approver.loading");
  else if (isError || !data) body = t("workflow.editor.preview_approver.failed");
  else if (data.kind === "COUNTERSIGN") {
    body = (
      <ul className="flex flex-col gap-1">
        {data.signers.map((s, i) => (
          <li key={i}>
            <span className="text-[oklch(var(--color-ink))]">{s.label || `#${i + 1}`}</span>
            {" → "}
            {assignmentText(s, t)}
            <span className="block text-xs text-[oklch(var(--color-ink-muted))]">{usersText(s, t)}</span>
          </li>
        ))}
      </ul>
    );
  } else {
    body = (
      <>
        <span className="text-[oklch(var(--color-ink))]">{assignmentText(data, t)}</span>
        <span className="block text-xs text-[oklch(var(--color-ink-muted))]">{usersText(data, t)}</span>
      </>
    );
  }

  return (
    <section aria-label={t("workflow.editor.preview_approver.title")}>
      <div className={SECTION_HEAD}>
        {t("workflow.editor.preview_approver.title")} · {t(`workflow.civilizations.${civilization}`)}
      </div>
      <div className="mt-2 text-sm text-[oklch(var(--color-ink-muted))]">{body}</div>
    </section>
  );
}

function ClauseRow({
  t,
  clause,
  onChange,
  onRemove,
  idPrefix,
}: {
  t: TFunc;
  clause: ConditionClause;
  onChange: (c: ConditionClause) => void;
  onRemove: () => void;
  idPrefix: string;
}) {
  const spec = FACTS[clause.fact];
  return (
    <div className="flex flex-wrap items-center gap-1">
      <select
        aria-label={t("workflow.editor.condition.fact_label")}
        className={CONTROL}
        value={clause.fact}
        onChange={(e) => onChange(defaultClause(e.target.value as ConditionFact))}
      >
        {FACT_KEYS.map((f) => (
          <option key={f} value={f}>
            {t(`workflow.editor.condition.fact.${f}`)}
          </option>
        ))}
      </select>
      <select
        aria-label={t("workflow.editor.condition.op_label")}
        className={CONTROL}
        value={clause.op}
        onChange={(e) => onChange({ ...clause, op: e.target.value as ConditionOp })}
      >
        {opsFor(clause.fact).map((op) => (
          <option key={op} value={op}>
            {t(`workflow.editor.condition.op.${op}`)}
          </option>
        ))}
      </select>
      {spec.kind === "number" ? (
        <input
          id={`${idPrefix}-value`}
          aria-label={t("workflow.editor.condition.value_label")}
          type="number"
          step={1}
          className={`${CONTROL} w-20`}
          value={typeof clause.value === "number" ? clause.value : 0}
          onChange={(e) => onChange({ ...clause, value: Number.parseInt(e.target.value || "0", 10) })}
        />
      ) : (
        <span role="group" aria-label={t("workflow.editor.condition.value_label")} className="flex flex-wrap gap-2">
          {spec.values.map((v) => {
            const on = Array.isArray(clause.value) && clause.value.includes(v);
            return (
              <label key={v} className="inline-flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => {
                    const cur = Array.isArray(clause.value) ? clause.value : [];
                    onChange({ ...clause, value: on ? cur.filter((x) => x !== v) : [...cur, v] });
                  }}
                />
                {clause.fact === "civilization" ? t(`workflow.civilizations.${v}`) : t(`judgment.verdicts.${v.toLowerCase()}`)}
              </label>
            );
          })}
        </span>
      )}
      <button
        type="button"
        onClick={onRemove}
        className="h-(--control-h-sm) px-2 text-xs text-[oklch(var(--color-danger))]"
        aria-label={t("workflow.editor.condition.remove_clause")}
      >
        ×
      </button>
    </div>
  );
}

/**
 * The 出口 tab, v3 A1: the node's PASS exits as cards, in the order the engine
 * tries them. A conditional edge is a BRANCH (taken when every clause holds,
 * tried before the default); an edge without one is the default 「否 · 默认」.
 * Editing writes `edge.data.when`, which is what `getTemplateNodes` turns into
 * `branches`.
 *
 * A card's header is a button: pressing it marks that exit active, and the
 * canvas draws the edge in ink, 2 px, label inverted — the one place the
 * canvas shows which line the inspector is talking about.
 */
export function ExitConditionsSection({
  t,
  node,
  nodes,
  edges,
  onChange,
  onMove,
  onAdd,
  activeEdgeId,
  onActivate,
}: {
  t: TFunc;
  node: Node;
  nodes: readonly Node[];
  edges: readonly Edge[];
  /** Absent in the read-only view. `undefined` clears the condition. */
  onChange?: (edgeId: string, when: ConditionClause[] | undefined) => void;
  /** ↑ / ↓ among the conditional exits. Absent in the read-only view. */
  onMove?: (edgeId: string, step: -1 | 1) => void;
  /** 「＋ 加一条条件出口」 to `target`. Absent in the read-only view. */
  onAdd?: (source: string, target: string) => void;
  activeEdgeId?: string | null;
  onActivate?: (edgeId: string) => void;
}) {
  // In the order the engine tries them: the conditional exits (branches, in
  // edge order — the order that is saved), then the default (`on_pass`).
  const passEdges = edges.filter((e) => e.source === node.id && branchOf(e) === "pass");
  const exits = [
    ...passEdges.filter((e) => whenOf(e) !== undefined),
    ...passEdges.filter((e) => whenOf(e) === undefined),
  ];
  const conditionalCount = exits.length - passEdges.filter((e) => whenOf(e) === undefined).length;
  const targets = nodes.filter((n) => n.id !== node.id);
  const [addTarget, setAddTarget] = useState("");
  const chosenTarget = targets.some((n) => n.id === addTarget) ? addTarget : (targets[0]?.id ?? "");
  // 「否 · 默认」 only means something beside a 「是 · …」: a node with no
  // conditional exit has a plain 通过 exit, and is labelled as one.
  const branching = exits.some((e) => whenOf(e) !== undefined);
  const plain = (when: ConditionClause[] | undefined) => when === undefined && !branching;
  const ref = (id: string) => {
    const idx = nodes.findIndex((n) => n.id === id);
    const label = idx >= 0 && typeof nodes[idx].data.label === "string" ? nodes[idx].data.label : "";
    return `N${idx + 1}「${label || t("workflow.editor.unnamed")}」`;
  };
  const nodeLabel = typeof node.data.label === "string" && node.data.label.trim() ? node.data.label : t("workflow.editor.unnamed");
  return (
    <section aria-label={t("workflow.editor.condition.title")} className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg text-[oklch(var(--color-ink))] break-words">
          <span aria-hidden="true">◇ </span>
          {t("workflow.editor.exits_title", { node: nodeLabel })}
        </h2>
        <p className="text-xs text-[oklch(var(--color-ink-muted))]">{t("workflow.editor.exits_hint")}</p>
      </div>
      {exits.length === 0 ? (
        <p className="text-sm text-[oklch(var(--color-ink-muted))]">{t("workflow.editor.exits_none")}</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {exits.map((e, i) => {
            const when = whenOf(e);
            const active = e.id === activeEdgeId;
            return (
              <li
                key={e.id}
                className={`flex flex-col gap-2 border bg-[oklch(var(--color-surface-1))] ${
                  active ? "border-[oklch(var(--color-ink))]" : "border-[oklch(var(--color-line))]"
                }`}
              >
                <div className="flex items-stretch">
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => onActivate?.(e.id)}
                  className="flex-1 min-w-0 flex items-center gap-2 min-h-11 px-3 text-left text-sm text-[oklch(var(--color-ink))] hover:bg-[oklch(var(--color-surface-2))]"
                >
                  <span className="font-mono text-xs text-[oklch(var(--color-ink-subtle))]">{i + 1}</span>
                  <span className="flex-1 min-w-0 break-words">
                    {plain(when)
                      ? t("workflow.editor.branch.pass")
                      : when === undefined
                        ? t("workflow.editor.condition.no")
                        : t("workflow.editor.condition.yes")}{" "}
                    → {ref(e.target)}
                  </span>
                  {when === undefined && !plain(when) && (
                    <span className="font-mono text-xs text-[oklch(var(--color-ink-muted))]">{t("workflow.editor.condition.default")}</span>
                  )}
                </button>
                {onMove && when !== undefined && (
                  <>
                    <button
                      type="button"
                      aria-label={`${t("workflow.editor.exit_up")} ${i + 1}`}
                      disabled={i === 0}
                      onClick={() => onMove(e.id, -1)}
                      className="w-11 shrink-0 font-mono text-sm text-[oklch(var(--color-ink))] hover:bg-[oklch(var(--color-surface-2))] disabled:text-[oklch(var(--color-ink-subtle))] disabled:hover:bg-transparent"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label={`${t("workflow.editor.exit_down")} ${i + 1}`}
                      disabled={i === conditionalCount - 1}
                      onClick={() => onMove(e.id, 1)}
                      className="w-11 shrink-0 font-mono text-sm text-[oklch(var(--color-ink))] hover:bg-[oklch(var(--color-surface-2))] disabled:text-[oklch(var(--color-ink-subtle))] disabled:hover:bg-transparent"
                    >
                      ↓
                    </button>
                  </>
                )}
                </div>
                {when !== undefined && (
                  <div className="flex flex-col gap-1 px-3">
                    {when.length === 0 && (
                      <span className="font-mono text-xs text-[oklch(var(--color-ink-muted))]">{t("workflow.editor.condition.empty")}</span>
                    )}
                    {when.map((c, j) => (
                      <div key={j} className="flex flex-col gap-1">
                        {j > 0 && <span className="text-2xs text-[oklch(var(--color-ink-subtle))]">{t("workflow.editor.condition.and")}</span>}
                        {onChange ? (
                          <ClauseRow
                            t={t}
                            idPrefix={`${e.id}-${j}`}
                            clause={c}
                            onChange={(next) => onChange(e.id, when.map((x, k) => (k === j ? next : x)))}
                            onRemove={() => onChange(e.id, when.filter((_, k) => k !== j))}
                          />
                        ) : (
                          <span className="font-mono text-xs">{whenText([c], t)}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {onChange && (
                  <div className="flex flex-wrap gap-2 px-3">
                    {when !== undefined ? (
                      <>
                        <button
                          type="button"
                          className="h-(--control-h-sm) px-2 text-xs border border-[oklch(var(--color-line-strong))]"
                          onClick={() => onChange(e.id, [...when, defaultClause()])}
                        >
                          + {t("workflow.editor.condition.add_clause")}
                        </button>
                        <button
                          type="button"
                          className="h-(--control-h-sm) px-2 text-xs text-[oklch(var(--color-ink-muted))]"
                          onClick={() => onChange(e.id, undefined)}
                        >
                          {t("workflow.editor.condition.clear")}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="h-(--control-h-sm) px-2 text-xs border border-[oklch(var(--color-line-strong))]"
                        onClick={() => onChange(e.id, [defaultClause()])}
                      >
                        {t("workflow.editor.condition.make")}
                      </button>
                    )}
                  </div>
                )}
                {/* 连线标签: what the canvas prints on this line. */}
                <div className="flex items-center gap-2 px-3 pb-2 text-xs text-[oklch(var(--color-ink-muted))]">
                  <span>{t("workflow.editor.exit_label")}</span>
                  <span className="font-mono text-[oklch(var(--color-ink))] break-all">
                    {plain(when)
                      ? t("workflow.editor.branch.pass")
                      : when === undefined
                      ? `${t("workflow.editor.condition.no")} · ${t("workflow.editor.condition.default")}`
                      : `${t("workflow.editor.condition.yes")} · ${when.length ? whenText(when, t) : t("workflow.editor.condition.empty")}`}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {/* 「＋ 加一条条件出口」, dashed, 48 high (v3 A1). The target is picked
          here because a conditional exit is an edge, and an edge needs one. */}
      {onAdd && targets.length > 0 && (
        <div className="flex items-center gap-2 min-h-12 px-2 border border-dashed border-[oklch(var(--color-line-strong))]">
          <select
            aria-label={t("workflow.editor.exit_target")}
            className={`${CONTROL} flex-1 min-w-0`}
            value={chosenTarget}
            onChange={(ev) => setAddTarget(ev.target.value)}
          >
            {targets.map((n) => (
              <option key={n.id} value={n.id}>
                {ref(n.id)}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => onAdd(node.id, chosenTarget)}
            className="h-(--control-h-sm) px-3 shrink-0 text-sm text-[oklch(var(--color-ink))] hover:bg-[oklch(var(--color-surface-2))]"
          >
            ＋ {t("workflow.editor.exit_add")}
          </button>
        </div>
      )}
      <p className="text-xs text-[oklch(var(--color-ink-muted))]">{t("workflow.editor.exits_fixed")}</p>
    </section>
  );
}

/** Read-only history, newest first. Nothing here writes. */
export function VersionHistorySection({
  t,
  templateId,
  empty,
}: {
  t: TFunc;
  templateId?: string;
  /** What the 版本 tab shows while there is no history to list (a new or unsaved template). */
  empty?: React.ReactNode;
}) {
  const { data } = useQuery({
    queryKey: workflowKeys.templates.versions(templateId ?? ""),
    queryFn: async () => (await workflowApi.templates.versions(templateId!)).data,
    enabled: Boolean(templateId),
  });
  if (!templateId || !Array.isArray(data) || data.length === 0) return empty ?? null;
  return (
    <section aria-label={t("workflow.editor.version.history")}>
      <div className={SECTION_HEAD}>{t("workflow.editor.version.history")}</div>
      <ol className="mt-2 flex flex-col gap-1 text-sm">
        {data.map((v) => (
          <li key={v.id} className="flex justify-between gap-2">
            <span className="font-mono">v{v.number}</span>
            <span className="text-[oklch(var(--color-ink-muted))]">
              {t(`workflow.editor.version.status.${v.status}`)} · {t("workflow.nodes_count", { count: String(v.nodes.length) })}
            </span>
            <span className="text-xs text-[oklch(var(--color-ink-subtle))]">
              {(v.published_at ?? v.updated_at).slice(0, 10)}
              {v.published_by_name || v.saved_by_name ? ` · ${v.published_by_name ?? v.saved_by_name}` : ""}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
