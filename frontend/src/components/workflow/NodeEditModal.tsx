"use client";

import { Modal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { SelectField, TextField } from "@/src/components/ui/Field";
import { useRoleOptions } from "@/src/components/users/RoleName";
import type { TemplateSigner, WorkflowNodeKind, WorkflowTimeoutAction } from "@soulledger/core/api";

type TFunc = (key: string, params?: Record<string, string>) => string;

export interface NodeEditData {
  id: string;
  node_name: string;
  node_type: "TRIAL" | "EVALUATION" | "APPEAL" | "FINAL" | "EXECUTION";
  court_code: string;
  approver_role: string;
  approver_type: "ACTOR" | "ROLE" | "SYSTEM";
  kind: WorkflowNodeKind;
  signers: TemplateSigner[];
  threshold: number | null;
  timeout_hours: number | null;
  timeout_action: WorkflowTimeoutAction | "";
  timeout_role: string;
  reject_to: string | null;
}

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

/**
 * The node editor's modal form.
 *
 * `formId` is threaded in rather than a `useId()` of its own: the ids it builds
 * are the ones the <label htmlFor> pairs point at, and the editor's toolbar
 * derives a sibling id from the same prefix. A second `useId()` here would
 * still pair correctly but would stop the two halves of one form sharing one
 * namespace — which is the thing the prefix exists for when several
 * WorkflowEditors are mounted at once.
 */
export function NodeEditModal({
  isOpen,
  onClose,
  formId,
  editData,
  setEditData,
  onSave,
  rejectOptions,
  t,
}: {
  isOpen: boolean;
  onClose: () => void;
  formId: string;
  editData: NodeEditData | null;
  setEditData: (data: NodeEditData) => void;
  onSave: (id: string, updates: NodeDataUpdates) => void;
  /** The nodes 驳回到 may name: those EARLIER than this one, as `N2「名」`. */
  rejectOptions: { value: string; label: string }[];
  t: TFunc;
}) {
  const kindId = `${formId}-node-kind`;
  const thresholdId = `${formId}-threshold`;
  const timeoutHoursId = `${formId}-timeout-hours`;
  const timeoutActionId = `${formId}-timeout-action`;
  const timeoutRoleId = `${formId}-timeout-role`;
  const rejectToId = `${formId}-reject-to`;
  const nodeNameId = `${formId}-node-name`;
  const nodeTypeId = `${formId}-node-type`;
  const courtCodeId = `${formId}-court-code`;
  const approverTypeId = `${formId}-approver-type`;
  const approverRoleId = `${formId}-approver-role`;

  const nodeTypeOptions = [
    { value: "TRIAL", label: t("workflow.node_type.trial") },
    { value: "EVALUATION", label: t("workflow.node_type.evaluation") },
    { value: "APPEAL", label: t("workflow.node_type.appeal") },
    { value: "FINAL", label: t("workflow.node_type.final") },
    { value: "EXECUTION", label: t("workflow.node_type.execution") },
  ];
  // The role table, not free text. A role name typed by hand was a
  // contract nobody checked: the placeholder said "e.g. JUDGE, OVERSEER"
  // and OVERSEER is not a role. A value already saved on the node that the
  // table does not know (older templates, a role deleted since) is kept as
  // its own option rather than silently replaced by the first one on save.
  // `editData` is null while the modal is closed and the hook still has to
  // run then (hooks cannot be conditional), hence the optional chain.
  const roleOptions = useRoleOptions(t);
  const legacyRole = editData?.approver_role ?? "";
  const approverRoleOptions = [
    { value: "", label: t("workflow.editor.approver_placeholder") },
    ...roleOptions,
    ...(legacyRole && !roleOptions.some((o) => o.value === legacyRole)
      ? [{ value: legacyRole, label: legacyRole }]
      : []),
  ];

  const approverTypeOptions = [
    { value: "ROLE", label: t("workflow.approver_types.ROLE") },
    { value: "ACTOR", label: t("workflow.approver_types.ACTOR") },
    { value: "SYSTEM", label: t("workflow.approver_types.SYSTEM") },
  ];

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
  const roleSelectOptions = [{ value: "", label: t("workflow.editor.approver_placeholder") }, ...roleOptions];

  const setSigner = (idx: number, patch: Partial<TemplateSigner>) => {
    if (!editData) return;
    setEditData({
      ...editData,
      signers: editData.signers.map((sg, i) => (i === idx ? { ...sg, ...patch } : sg)),
    });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("workflow.editor.edit_node")}
    >
    {editData && (
      /*
       * Five hand-wired label+control pairs became `Field`, and the two buttons
       * became `Button`.
       *
       * Two things change visibly, and both are the primitive's answer rather
       * than a fresh preference:
       *
       *   - The controls sat on `--color-surface-2`, which is what
       *     `Dialog.Popup` itself is painted with — an input the same colour as
       *     the panel behind it, told apart only by its hairline. `fieldControl`
       *     uses `surface-1`, as the other six modals' inputs already did.
       *   - `focus:border-…` becomes `focus-visible:border-…`. Two of the five
       *     controls are a `<select>`, and that is precisely the case
       *     `Field.tsx:32-44` argues: `:focus-visible` keeps matching a mouse
       *     click into a text box and stops matching one on a select, so the
       *     border stays where it was informative and leaves where it was noise.
       *
       * These controls have no error state and none is invented — passing no
       * `error` leaves `aria-invalid` and the error span off, exactly as before.
       * `type="button"` is now explicit on both buttons: `Button` deliberately
       * does not default it (see its docstring), and neither of these is a
       * submit — this modal holds no `<form>` at all.
       */
      <div className="space-y-4">
        <SelectField
          id={kindId}
          label={t("workflow.editor.kind_label")}
          value={editData.kind}
          onChange={(e) => setEditData({ ...editData, kind: e.target.value as WorkflowNodeKind })}
          options={kindOptions}
        />
        <TextField
          id={nodeNameId}
          label={t("workflow.editor.node_name")}
          type="text"
          value={editData.node_name}
          onChange={(e) =>
            setEditData({ ...editData, node_name: e.target.value })
          }
        />
        <SelectField
          id={nodeTypeId}
          label={t("workflow.editor.node_type")}
          value={editData.node_type}
          onChange={(e) =>
            setEditData({
              ...editData,
              node_type: e.target.value as NodeEditData["node_type"],
            })
          }
          options={nodeTypeOptions}
        />
        <TextField
          id={courtCodeId}
          label={t("workflow.editor.court_code")}
          type="text"
          value={editData.court_code}
          onChange={(e) =>
            setEditData({ ...editData, court_code: e.target.value })
          }
          placeholder={t("workflow.editor.court_placeholder")}
        />
        <SelectField
          id={approverTypeId}
          label={t("workflow.editor.approver_type")}
          value={editData.approver_type}
          onChange={(e) =>
            setEditData({
              ...editData,
              approver_type: e.target.value as NodeEditData["approver_type"],
            })
          }
          options={approverTypeOptions}
        />
        <SelectField
          id={approverRoleId}
          label={t("workflow.editor.approver_role")}
          value={editData.approver_role}
          onChange={(e) =>
            setEditData({ ...editData, approver_role: e.target.value })
          }
          options={approverRoleOptions}
        />
        {editData.kind === "COUNTERSIGN" && (
          /* 会签: each signer is a label (a name, probed like a node label) or a
             role. The backend resolves each with `_resolve_approver`, the same
             resolver a one-person node gets. */
          <fieldset className="space-y-2 border border-[oklch(var(--color-line))] p-3">
            <legend className="px-1 text-xs font-medium text-[oklch(var(--color-ink-muted))]">
              {t("workflow.editor.signers")}
            </legend>
            {editData.signers.map((signer, idx) => (
              <div key={idx} className="flex items-end gap-2">
                <TextField
                  id={`${formId}-signer-${idx}-label`}
                  label={t("workflow.editor.signer_label", { n: String(idx + 1) })}
                  type="text"
                  value={signer.label}
                  onChange={(e) => setSigner(idx, { label: e.target.value })}
                  className="flex-1"
                />
                <SelectField
                  id={`${formId}-signer-${idx}-role`}
                  label={t("workflow.editor.approver_role")}
                  value={signer.approver_role}
                  onChange={(e) =>
                    setSigner(idx, { approver_role: e.target.value, approver_type: e.target.value ? "ROLE" : "ACTOR" })
                  }
                  options={roleSelectOptions}
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() =>
                    setEditData({ ...editData, signers: editData.signers.filter((_, i) => i !== idx) })
                  }
                >
                  {t("workflow.editor.signer_remove")}
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                setEditData({
                  ...editData,
                  signers: [...editData.signers, { label: "", approver_type: "ROLE", approver_role: "" }],
                })
              }
            >
              + {t("workflow.editor.signer_add")}
            </Button>
            <TextField
              id={thresholdId}
              label={t("workflow.editor.threshold")}
              description={t("workflow.editor.threshold_hint")}
              type="number"
              min={1}
              value={editData.threshold ?? ""}
              onChange={(e) => setEditData({ ...editData, threshold: positiveOrNull(e.target.value) })}
            />
          </fieldset>
        )}
        {editData.kind !== "END" && editData.kind !== "NOTIFY" && (
          <>
            <div className="flex items-end gap-2">
              <TextField
                id={timeoutHoursId}
                label={t("workflow.editor.timeout.hours")}
                type="number"
                min={1}
                value={editData.timeout_hours ?? ""}
                onChange={(e) => setEditData({ ...editData, timeout_hours: positiveOrNull(e.target.value) })}
                className="w-28"
              />
              <SelectField
                id={timeoutActionId}
                label={t("workflow.editor.timeout.action_label")}
                value={editData.timeout_action}
                onChange={(e) =>
                  setEditData({ ...editData, timeout_action: e.target.value as NodeEditData["timeout_action"] })
                }
                options={timeoutActionOptions}
              />
            </div>
            {editData.timeout_action === "ESCALATE" && (
              <SelectField
                id={timeoutRoleId}
                label={t("workflow.editor.timeout.role")}
                value={editData.timeout_role}
                onChange={(e) => setEditData({ ...editData, timeout_role: e.target.value })}
                options={roleSelectOptions}
              />
            )}
            {/* Said where the field is, because it is the one thing about a
                timeout an operator cannot see from the value: it fires only
                when the 5-minutely `workflow.process_timeouts_for_tenant` job
                runs, i.e. only where beat and a worker run. */}
            <p className="text-xs text-[oklch(var(--color-ink-muted))]">{t("workflow.editor.timeout.hint")}</p>
            <SelectField
              id={rejectToId}
              label={t("workflow.editor.reject_to")}
              value={editData.reject_to ?? ""}
              onChange={(e) => setEditData({ ...editData, reject_to: e.target.value || null })}
              options={rejectToOptions}
            />
          </>
        )}
        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={() => {
              onSave(editData.id, {
                label: editData.node_name,
                nodeType: editData.node_type,
                courtCode: editData.court_code,
                approverRole: editData.approver_role,
                approverType: editData.approver_type,
                kind: editData.kind,
                signers: editData.kind === "COUNTERSIGN" ? editData.signers : [],
                threshold: editData.kind === "COUNTERSIGN" ? editData.threshold : null,
                timeoutHours: editData.timeout_hours,
                timeoutAction: editData.timeout_action,
                timeoutRole: editData.timeout_action === "ESCALATE" ? editData.timeout_role : "",
                rejectTo: editData.reject_to,
              });
              onClose();
            }}
          >
            {t("common.save")}
          </Button>
        </div>
      </div>
    )}    </Modal>
  );
}
