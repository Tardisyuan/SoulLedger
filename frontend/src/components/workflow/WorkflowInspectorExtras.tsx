"use client";

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

const SECTION_HEAD =
  "font-mono text-2xs tracking-wide text-[oklch(var(--color-ink-subtle))] pb-1 border-b border-[oklch(var(--color-block))]";
const CONTROL =
  "h-8 px-2 bg-[oklch(var(--color-canvas))] border border-[oklch(var(--color-line))] text-sm text-[oklch(var(--color-ink))] focus-visible:border-[oklch(var(--color-accent))]";

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
        className="h-8 px-2 text-xs text-[oklch(var(--color-danger))]"
        aria-label={t("workflow.editor.condition.remove_clause")}
      >
        ×
      </button>
    </div>
  );
}

/**
 * The node's PASS exits and the condition on each. A conditional edge is a
 * BRANCH (taken when every clause holds, tried before the default); an edge
 * without one is the default 「否 · 默认」. Editing writes `edge.data.when`,
 * which is what `getTemplateNodes` turns into `branches`.
 */
export function ExitConditionsSection({
  t,
  node,
  nodes,
  edges,
  onChange,
}: {
  t: TFunc;
  node: Node;
  nodes: readonly Node[];
  edges: readonly Edge[];
  /** Absent in the read-only view. `undefined` clears the condition. */
  onChange?: (edgeId: string, when: ConditionClause[] | undefined) => void;
}) {
  const exits = edges.filter((e) => e.source === node.id && branchOf(e) === "pass");
  if (exits.length === 0) return null;
  const ref = (id: string) => {
    const idx = nodes.findIndex((n) => n.id === id);
    const label = idx >= 0 && typeof nodes[idx].data.label === "string" ? nodes[idx].data.label : "";
    return `N${idx + 1}「${label || t("workflow.editor.unnamed")}」`;
  };
  return (
    <section aria-label={t("workflow.editor.condition.title")}>
      <div className={SECTION_HEAD}>{t("workflow.editor.condition.title")}</div>
      <ul className="mt-2 flex flex-col gap-3">
        {exits.map((e) => {
          const when = whenOf(e);
          return (
            <li key={e.id} className="flex flex-col gap-1 text-sm">
              <span className="text-[oklch(var(--color-ink))]">
                → {ref(e.target)} ·{" "}
                <span className="font-mono text-xs">
                  {when === undefined
                    ? t("workflow.editor.condition.default")
                    : when.length === 0
                      ? t("workflow.editor.condition.empty")
                      : whenText(when, t)}
                </span>
              </span>
              {onChange && when !== undefined && (
                <div className="flex flex-col gap-1 pl-2 border-l border-[oklch(var(--color-line))]">
                  {when.map((c, i) => (
                    <ClauseRow
                      key={i}
                      t={t}
                      idPrefix={`${e.id}-${i}`}
                      clause={c}
                      onChange={(next) => onChange(e.id, when.map((x, j) => (j === i ? next : x)))}
                      onRemove={() => onChange(e.id, when.filter((_, j) => j !== i))}
                    />
                  ))}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="h-8 px-2 text-xs border border-[oklch(var(--color-line))]"
                      onClick={() => onChange(e.id, [...when, defaultClause()])}
                    >
                      + {t("workflow.editor.condition.add_clause")}
                    </button>
                    <button
                      type="button"
                      className="h-8 px-2 text-xs text-[oklch(var(--color-ink-muted))]"
                      onClick={() => onChange(e.id, undefined)}
                    >
                      {t("workflow.editor.condition.clear")}
                    </button>
                  </div>
                </div>
              )}
              {onChange && when === undefined && (
                <button
                  type="button"
                  className="self-start h-8 px-2 text-xs border border-[oklch(var(--color-line))]"
                  onClick={() => onChange(e.id, [defaultClause()])}
                >
                  {t("workflow.editor.condition.make")}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Read-only history, newest first. Nothing here writes. */
export function VersionHistorySection({ t, templateId }: { t: TFunc; templateId?: string }) {
  const { data } = useQuery({
    queryKey: workflowKeys.templates.versions(templateId ?? ""),
    queryFn: async () => (await workflowApi.templates.versions(templateId!)).data,
    enabled: Boolean(templateId),
  });
  if (!templateId || !Array.isArray(data) || data.length === 0) return null;
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
