"use client";

import { Modal } from "@/src/components/ui/Modal";

type TFunc = (key: string, params?: Record<string, string>) => string;

export interface NodeEditData {
  id: string;
  node_name: string;
  node_type: "TRIAL" | "EVALUATION" | "APPEAL" | "FINAL" | "EXECUTION";
  court_code: string;
  approver_role: string;
  approver_type: "ACTOR" | "ROLE" | "SYSTEM";
}

// Node data stored in React Flow nodes (camelCase for data field)
export interface NodeDataUpdates {
  label?: string;
  nodeType?: string;
  courtCode?: string;
  approverRole?: string;
  approverType?: string;
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
  t,
}: {
  isOpen: boolean;
  onClose: () => void;
  formId: string;
  editData: NodeEditData | null;
  setEditData: (data: NodeEditData) => void;
  onSave: (id: string, updates: NodeDataUpdates) => void;
  t: TFunc;
}) {
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

  const approverTypeOptions = [
    { value: "ROLE", label: t("workflow.approver_types.ROLE") },
    { value: "ACTOR", label: t("workflow.approver_types.ACTOR") },
    { value: "SYSTEM", label: t("workflow.approver_types.SYSTEM") },
  ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("workflow.editor.edit_node")}
    >
    {editData && (
      <div className="space-y-4">
        <div>
          <label htmlFor={nodeNameId} className="block text-02 font-medium text-[hsl(var(--color-ink))] mb-1">{t("workflow.editor.node_name")}</label>
          <input
            id={nodeNameId}
            type="text"
            value={editData.node_name}
            onChange={(e) =>
              setEditData({ ...editData, node_name: e.target.value })
            }
            className="w-full px-3 py-2 bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded text-[hsl(var(--color-ink))] focus:outline-none focus:border-[hsl(var(--color-accent))]"
          />
        </div>
        <div>
          <label htmlFor={nodeTypeId} className="block text-02 font-medium text-[hsl(var(--color-ink))] mb-1">{t("workflow.editor.node_type")}</label>
          <select
            id={nodeTypeId}
            value={editData.node_type}
            onChange={(e) =>
              setEditData({
                ...editData,
                node_type: e.target.value as NodeEditData["node_type"],
              })
            }
            className="w-full px-3 py-2 bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded text-[hsl(var(--color-ink))] focus:outline-none focus:border-[hsl(var(--color-accent))]"
          >
            {nodeTypeOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={courtCodeId} className="block text-02 font-medium text-[hsl(var(--color-ink))] mb-1">{t("workflow.editor.court_code")}</label>
          <input
            id={courtCodeId}
            type="text"
            value={editData.court_code}
            onChange={(e) =>
              setEditData({ ...editData, court_code: e.target.value })
            }
            placeholder={t("workflow.editor.court_placeholder")}
            className="w-full px-3 py-2 bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded text-[hsl(var(--color-ink))] placeholder-[hsl(var(--color-ink-subtle))] focus:outline-none focus:border-[hsl(var(--color-accent))]"
          />
        </div>
        <div>
          <label htmlFor={approverTypeId} className="block text-02 font-medium text-[hsl(var(--color-ink))] mb-1">{t("workflow.editor.approver_type")}</label>
          <select
            id={approverTypeId}
            value={editData.approver_type}
            onChange={(e) =>
              setEditData({
                ...editData,
                approver_type: e.target.value as NodeEditData["approver_type"],
              })
            }
            className="w-full px-3 py-2 bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded text-[hsl(var(--color-ink))] focus:outline-none focus:border-[hsl(var(--color-accent))]"
          >
            {approverTypeOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={approverRoleId} className="block text-02 font-medium text-[hsl(var(--color-ink))] mb-1">{t("workflow.editor.approver_role")}</label>
          <input
            id={approverRoleId}
            type="text"
            value={editData.approver_role}
            onChange={(e) =>
              setEditData({ ...editData, approver_role: e.target.value })
            }
            placeholder={t("workflow.editor.approver_placeholder")}
            className="w-full px-3 py-2 bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded text-[hsl(var(--color-ink))] placeholder-[hsl(var(--color-ink-subtle))] focus:outline-none focus:border-[hsl(var(--color-accent))]"
          />
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-[hsl(var(--color-surface-3))] hover:bg-[hsl(var(--color-surface-4))] text-[hsl(var(--color-ink))] text-03 rounded transition-colors"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={() => {
              onSave(editData.id, {
                label: editData.node_name,
                nodeType: editData.node_type,
                courtCode: editData.court_code,
                approverRole: editData.approver_role,
                approverType: editData.approver_type,
              });
              onClose();
            }}
            className="px-4 py-2 bg-[hsl(var(--color-accent))] hover:bg-[hsl(var(--color-accent-hover))] text-black text-03 font-medium rounded transition-colors"
          >
            {t("common.save")}
          </button>
        </div>
      </div>
    )}    </Modal>
  );
}
