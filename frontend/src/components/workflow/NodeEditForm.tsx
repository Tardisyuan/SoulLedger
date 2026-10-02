"use client";

import type { Node } from "@xyflow/react";
import { useRoleOptions } from "@/src/components/users/RoleName";
import type { TemplateSigner, WorkflowNodeKind, WorkflowTimeoutAction } from "@soulledger/core/api";

type TFunc = (key: string, params?: Record<string, string>) => string;

type NodeType = "TRIAL" | "EVALUATION" | "APPEAL" | "FINAL" | "EXECUTION";
type ApproverType = "ACTOR" | "ROLE" | "SYSTEM";

// Node data stored in React Flow nodes (camelCase for data field)
export interface NodeDataUpdates {
  label?: string;
  nodeType?: string;
  courtCode?: string;
  approverRole?: string;
  approverType?: string;
  kind?: WorkflowNodeKind;
  signers?: TemplateSigner[];
  threshold?: number | null;
  timeoutHours?: number | null;
  timeoutAction?: WorkflowTimeoutAction | "";
  timeoutRole?: string;
  rejectTo?: string | null;
}

/** "" -> null, otherwise a positive integer or null — the number inputs below. */
function positiveOrNull(raw: string): number | null {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** The id of the form's first field — what `E` on a card focuses. */
export const nodeNameFieldId = (formId: string) => `${formId}-node-name`;

/** v3 A1 field: 44 high, radius 4, 1px line-strong; focus = 1px ink + 2px focus/.35. */
const CONTROL =
  "h-(--control-h-sm) min-w-0 px-2 rounded-control border border-[oklch(var(--color-line-strong))] bg-[oklch(var(--color-surface-1))] text-sm text-[oklch(var(--color-ink))] focus-visible:border-[oklch(var(--color-ink))] focus-visible:shadow-[0_0_0_2px_oklch(var(--color-focus)/0.35)]";
const LABEL = "pt-3 text-xs text-[oklch(var(--color-ink-muted))]";

/**
 * The inspector's 节点 tab as a form, v3 A1 (用户 10-02: follow the Design —
 * this replaced the 「编辑节点」 modal). A `72px 1fr` grid, label left.
 *
 * NO DRAFT STATE. Every change writes straight to the node (`onChange` is the
 * editor's `updateNodeData`), so the 问题 tab, the card's `!` and the save
 * gate follow the form as it is typed — the modal held a copy and nothing
 * else saw an edit until 保存. The modal's save-time shaping (signers and
 * threshold only for 会签, the escalation role only for ESCALATE) moved to
 * `getTemplateNodes`, so switching 类别 back and forth no longer loses the
 * signers typed under 会签.
 */
export function NodeEditForm({
  node,
  formId,
  onChange,
  rejectOptions,
  t,
}: {
  node: Node;
  formId: string;
  onChange: (id: string, updates: NodeDataUpdates) => void;
  /** The nodes 驳回到 may name: those EARLIER than this one, as `N2「名」`. */
  rejectOptions: { value: string; label: string }[];
  t: TFunc;
}) {
  const d = node.data;
  const kind = ((d.kind as WorkflowNodeKind | undefined) || "APPROVAL") as WorkflowNodeKind;
  const approverRole = (d.approverRole as string) || "";
  const signers = (d.signers as TemplateSigner[] | undefined) ?? [];
  const threshold = (d.threshold as number | null | undefined) ?? null;
  const timeoutHours = (d.timeoutHours as number | null | undefined) ?? null;
  const timeoutAction = (d.timeoutAction as WorkflowTimeoutAction | "" | undefined) || "";
  const set = (updates: NodeDataUpdates) => onChange(node.id, updates);
  const id = (k: string) => `${formId}-${k}`;

  // The role table, not free text. A role name typed by hand was a contract
  // nobody checked: the placeholder said "e.g. JUDGE, OVERSEER" and OVERSEER
  // is not a role. A value already saved on the node that the table does not
  // know (older templates, a role deleted since) is kept as its own option
  // rather than silently replaced by the first one on save.
  const roleOptions = useRoleOptions(t);
  const placeholder = { value: "", label: t("workflow.editor.approver_placeholder") };
  const approverRoleOptions = [
    placeholder,
    ...roleOptions,
    ...(approverRole && !roleOptions.some((o) => o.value === approverRole)
      ? [{ value: approverRole, label: approverRole }]
      : []),
  ];
  const roleSelectOptions = [placeholder, ...roleOptions];
  const nodeTypeOptions = (["TRIAL", "EVALUATION", "APPEAL", "FINAL", "EXECUTION"] as const).map((v) => ({
    value: v,
    label: t(`workflow.node_type.${v.toLowerCase()}`),
  }));
  const approverTypeOptions = (["ROLE", "ACTOR", "SYSTEM"] as const).map((v) => ({
    value: v,
    label: t(`workflow.approver_types.${v}`),
  }));
  const kindOptions = (["APPROVAL", "COUNTERSIGN", "NOTIFY", "END"] as const).map((k) => ({
    value: k,
    label: t(`workflow.editor.kind.${k}`),
  }));
  const timeoutActionOptions = [
    { value: "", label: t("workflow.editor.timeout.none") },
    ...(["ESCALATE", "AUTO_REJECT", "NOTIFY"] as const).map((a) => ({
      value: a,
      label: t(`workflow.editor.timeout.action.${a}`),
    })),
  ];
  const rejectToOptions = [{ value: "", label: t("workflow.editor.reject_to_none") }, ...rejectOptions];

  const options = (opts: { value: string; label: string }[]) =>
    opts.map((o) => (
      <option key={o.value} value={o.value}>
        {o.label}
      </option>
    ));
  const setSigners = (next: TemplateSigner[]) => set({ signers: next });

  return (
    <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-x-3 gap-y-2" data-testid="node-form">
      <label htmlFor={nodeNameFieldId(formId)} className={LABEL}>
        {t("workflow.editor.node_name")}
      </label>
      <input
        id={nodeNameFieldId(formId)}
        type="text"
        className={`${CONTROL} font-medium`}
        value={(d.label as string) ?? ""}
        onChange={(e) => set({ label: e.target.value })}
      />

      <label htmlFor={id("node-kind")} className={LABEL}>
        {t("workflow.editor.kind_label")}
      </label>
      <select
        id={id("node-kind")}
        className={CONTROL}
        value={kind}
        onChange={(e) => set({ kind: e.target.value as WorkflowNodeKind })}
      >
        {options(kindOptions)}
      </select>

      <label htmlFor={id("node-type")} className={LABEL}>
        {t("workflow.editor.node_type")}
      </label>
      <select
        id={id("node-type")}
        className={CONTROL}
        value={(d.nodeType as NodeType) ?? "TRIAL"}
        onChange={(e) => set({ nodeType: e.target.value })}
      >
        {options(nodeTypeOptions)}
      </select>

      <label htmlFor={id("court-code")} className={LABEL}>
        {t("workflow.editor.court_code")}
      </label>
      <input
        id={id("court-code")}
        type="text"
        className={CONTROL}
        value={(d.courtCode as string) || ""}
        placeholder={t("workflow.editor.court_placeholder")}
        onChange={(e) => set({ courtCode: e.target.value })}
      />

      <label htmlFor={id("approver-type")} className={LABEL}>
        {t("workflow.editor.approver_type")}
      </label>
      <select
        id={id("approver-type")}
        className={CONTROL}
        value={(d.approverType as ApproverType) || "ROLE"}
        onChange={(e) => set({ approverType: e.target.value })}
      >
        {options(approverTypeOptions)}
      </select>

      <label htmlFor={id("approver-role")} className={LABEL}>
        {t("workflow.editor.approver_role")}
      </label>
      <select
        id={id("approver-role")}
        className={CONTROL}
        value={approverRole}
        onChange={(e) => set({ approverRole: e.target.value })}
      >
        {options(approverRoleOptions)}
      </select>

      {kind === "COUNTERSIGN" && (
        /* 会签: each signer is a label (a name, probed like a node label) or a
           role. The backend resolves each with `_resolve_approver`, the same
           resolver a one-person node gets. */
        <>
          <span className={LABEL}>{t("workflow.editor.signers")}</span>
          <div className="flex flex-col gap-2 min-w-0">
            {signers.map((signer, idx) => (
              <div key={idx} className="flex gap-1 min-w-0">
                <input
                  id={id(`signer-${idx}-label`)}
                  aria-label={t("workflow.editor.signer_label", { n: String(idx + 1) })}
                  type="text"
                  className={`${CONTROL} flex-1`}
                  value={signer.label}
                  onChange={(e) =>
                    setSigners(signers.map((s, i) => (i === idx ? { ...s, label: e.target.value } : s)))
                  }
                />
                <select
                  id={id(`signer-${idx}-role`)}
                  aria-label={`${t("workflow.editor.signer_label", { n: String(idx + 1) })} · ${t("workflow.editor.approver_role")}`}
                  className={`${CONTROL} w-24`}
                  value={signer.approver_role}
                  onChange={(e) =>
                    setSigners(
                      signers.map((s, i) =>
                        i === idx
                          ? { ...s, approver_role: e.target.value, approver_type: e.target.value ? "ROLE" : "ACTOR" }
                          : s
                      )
                    )
                  }
                >
                  {options(roleSelectOptions)}
                </select>
                <button
                  type="button"
                  aria-label={`${t("workflow.editor.signer_remove")} ${t("workflow.editor.signer_label", { n: String(idx + 1) })}`}
                  className="h-(--control-h-sm) w-11 shrink-0 rounded-control text-[oklch(var(--color-ink-muted))] hover:bg-[oklch(var(--color-surface-2))]"
                  onClick={() => setSigners(signers.filter((_, i) => i !== idx))}
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              type="button"
              className="self-start h-(--control-h-sm) px-3 rounded-control border border-[oklch(var(--color-line-strong))] text-sm text-[oklch(var(--color-ink))] hover:bg-[oklch(var(--color-surface-2))]"
              onClick={() => setSigners([...signers, { label: "", approver_type: "ROLE", approver_role: "" }])}
            >
              ＋ {t("workflow.editor.signer_add")}
            </button>
          </div>

          <label htmlFor={id("threshold")} className={LABEL}>
            {t("workflow.editor.threshold")}
          </label>
          <div className="flex flex-col gap-1 min-w-0">
            <span className="flex items-center gap-2">
              <input
                id={id("threshold")}
                type="number"
                min={1}
                aria-describedby={id("threshold-hint")}
                className={`${CONTROL} w-14 font-mono`}
                value={threshold ?? ""}
                onChange={(e) => set({ threshold: positiveOrNull(e.target.value) })}
              />
              <span className="font-mono text-sm text-[oklch(var(--color-ink-muted))]">/ {signers.length}</span>
            </span>
            <p id={id("threshold-hint")} className="text-xs text-[oklch(var(--color-ink-muted))]">
              {t("workflow.editor.threshold_hint")}
            </p>
          </div>
        </>
      )}

      {kind !== "END" && kind !== "NOTIFY" && (
        <>
          <label htmlFor={id("reject-to")} className={LABEL}>
            {t("workflow.editor.reject_to")}
          </label>
          <select
            id={id("reject-to")}
            className={CONTROL}
            value={(d.rejectTo as string | null | undefined) ?? ""}
            onChange={(e) => set({ rejectTo: e.target.value || null })}
          >
            {options(rejectToOptions)}
          </select>

          <label htmlFor={id("timeout-hours")} className={LABEL}>
            {t("workflow.editor.timeout.label")}
          </label>
          <div className="flex flex-col gap-1 min-w-0">
            <span className="flex items-center gap-1 min-w-0">
              <input
                id={id("timeout-hours")}
                type="number"
                min={1}
                aria-label={t("workflow.editor.timeout.hours")}
                className={`${CONTROL} w-[72px] font-mono`}
                value={timeoutHours ?? ""}
                onChange={(e) => set({ timeoutHours: positiveOrNull(e.target.value) })}
              />
              <span aria-hidden="true" className="font-mono text-sm text-[oklch(var(--color-ink-muted))]">
                h
              </span>
              <select
                id={id("timeout-action")}
                aria-label={t("workflow.editor.timeout.action_label")}
                className={`${CONTROL} flex-1`}
                value={timeoutAction}
                onChange={(e) => set({ timeoutAction: e.target.value as WorkflowTimeoutAction | "" })}
              >
                {options(timeoutActionOptions)}
              </select>
            </span>
            {timeoutAction === "ESCALATE" && (
              <select
                id={id("timeout-role")}
                aria-label={t("workflow.editor.timeout.role")}
                className={CONTROL}
                value={(d.timeoutRole as string | undefined) || ""}
                onChange={(e) => set({ timeoutRole: e.target.value })}
              >
                {options(roleSelectOptions)}
              </select>
            )}
            {/* Said where the field is, because it is the one thing about a
                timeout an operator cannot see from the value: it fires only
                when the 5-minutely `workflow.process_timeouts_for_tenant` job
                runs, i.e. only where beat and a worker run. */}
            <p className="text-xs text-[oklch(var(--color-ink-muted))]">{t("workflow.editor.timeout.hint")}</p>
          </div>
        </>
      )}
    </div>
  );
}
