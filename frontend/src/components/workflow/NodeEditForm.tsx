"use client";

import { useState } from "react";
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
        {t("workflow.editor.field.name")}
      </label>
      <input
        id={nodeNameFieldId(formId)}
        type="text"
        className={`${CONTROL} font-medium`}
        value={(d.label as string) ?? ""}
        onChange={(e) => set({ label: e.target.value })}
      />

      <label htmlFor={id("node-kind")} className={LABEL}>
        {t("workflow.editor.field.kind")}
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
        {t("workflow.editor.field.stage")}
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
        {t("workflow.editor.field.court")}
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
        {t("workflow.editor.field.approver")}
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
        {t("workflow.editor.field.role")}
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
          <label htmlFor={id("signer-input")} className={LABEL}>
            {t("workflow.editor.field.signers")}
          </label>
          <SignerTags
            inputId={id("signer-input")}
            signers={signers}
            onChange={setSigners}
            roleOptions={roleOptions}
            t={t}
          />

          <label htmlFor={id("threshold")} className={LABEL}>
            {t("workflow.editor.field.threshold")}
          </label>
          <div className="flex flex-col gap-1 min-w-0">
            <span className="flex items-center gap-2">
              <input
                id={id("threshold")}
                type="number"
                min={1}
                aria-describedby={signers.length > 0 ? id("threshold-rule") : undefined}
                className={`${CONTROL} w-14 font-mono`}
                value={threshold ?? ""}
                onChange={(e) => set({ threshold: positiveOrNull(e.target.value) })}
              />
              <span className="font-mono text-sm text-[oklch(var(--color-ink-muted))]">
                {t("workflow.editor.threshold_of", { n: String(signers.length) })}
              </span>
            </span>
            {/* 「3 人中任 2 人通过即放行」. A blank threshold means every signer
                (the backend's rule), so it reads k = n. Out-of-range values
                are the 问题 tab's to name, not this line's. */}
            {signers.length > 0 && (
              <p id={id("threshold-rule")} className="text-xs text-[oklch(var(--color-ink-muted))]">
                {t("workflow.editor.threshold_rule", {
                  n: String(signers.length),
                  k: String(threshold ?? signers.length),
                })}
              </p>
            )}
          </div>
        </>
      )}

      {kind !== "END" && kind !== "NOTIFY" && (
        <>
          <label htmlFor={id("reject-to")} className={LABEL}>
            {t("workflow.editor.field.reject_to")}
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

/** A signer as its chip reads: the name, the role, or both. */
function signerText(s: TemplateSigner, roleLabel: (v: string) => string): string {
  const role = s.approver_role ? roleLabel(s.approver_role) : "";
  return [s.label, role].filter(Boolean).join(" · ") || "?";
}

/**
 * 会签人 as a tag field, v3 A1: 「宋帝王 ✕」 chips inside one field.
 *
 * Same data as before — each signer is a free-text name (`ACTOR`, resolved
 * by name like a node label) or a role (`ROLE`); the backend's
 * `_resolve_approver` takes either. Typing a name + Enter adds a name chip;
 * picking from the role menu inside the field adds a role chip; ✕ or
 * Backspace in the empty input removes one. A stored signer carrying both a
 * name and a role (older templates) shows as one chip with both.
 */
function SignerTags({
  inputId,
  signers,
  onChange,
  roleOptions,
  t,
}: {
  inputId: string;
  signers: TemplateSigner[];
  onChange: (next: TemplateSigner[]) => void;
  roleOptions: { value: string; label: string }[];
  t: TFunc;
}) {
  const [draft, setDraft] = useState("");
  const roleLabel = (v: string) => roleOptions.find((o) => o.value === v)?.label ?? v;
  const addName = () => {
    const label = draft.trim();
    if (!label) return;
    onChange([...signers, { label, approver_type: "ACTOR", approver_role: "" }]);
    setDraft("");
  };
  return (
    <div className="flex flex-wrap items-center gap-1 min-w-0 min-h-(--control-h-sm) px-1 py-1 rounded-control border border-[oklch(var(--color-line-strong))] bg-[oklch(var(--color-surface-1))] focus-within:border-[oklch(var(--color-ink))] focus-within:shadow-[0_0_0_2px_oklch(var(--color-focus)/0.35)]">
      <ul className="contents" aria-label={t("workflow.editor.signers")}>
        {signers.map((sg, idx) => {
          const text = signerText(sg, roleLabel);
          return (
            <li
              key={idx}
              className="inline-flex items-center gap-1 h-8 pl-2 rounded-control bg-[oklch(var(--color-surface-2))] text-xs text-[oklch(var(--color-ink))]"
            >
              {text}
              <button
                type="button"
                aria-label={t("workflow.editor.signer_remove_named", { name: text })}
                onClick={() => onChange(signers.filter((_, i) => i !== idx))}
                className="h-8 w-8 text-[oklch(var(--color-ink-muted))] hover:text-[oklch(var(--color-ink))]"
              >
                ✕
              </button>
            </li>
          );
        })}
      </ul>
      <input
        id={inputId}
        type="text"
        value={draft}
        placeholder={signers.length === 0 ? t("workflow.editor.signer_placeholder") : undefined}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            addName();
          } else if (e.key === "Backspace" && draft === "" && signers.length > 0) {
            e.preventDefault();
            onChange(signers.slice(0, -1));
          }
        }}
        onBlur={addName}
        className="flex-1 min-w-16 h-8 px-1 bg-transparent text-sm text-[oklch(var(--color-ink))] outline-none placeholder:text-[oklch(var(--color-ink-subtle))]"
      />
      <select
        aria-label={t("workflow.editor.signer_add_role")}
        value=""
        onChange={(e) => {
          if (e.target.value) onChange([...signers, { label: "", approver_type: "ROLE", approver_role: e.target.value }]);
        }}
        className="h-8 w-20 shrink-0 px-1 rounded-control bg-transparent text-xs text-[oklch(var(--color-ink-muted))]"
      >
        <option value="">＋ {t("workflow.editor.field.role")}</option>
        {roleOptions.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
