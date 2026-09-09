"use client";

import { Modal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { SelectField, TextField } from "@/src/components/ui/Field";

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
        <TextField
          id={approverRoleId}
          label={t("workflow.editor.approver_role")}
          type="text"
          value={editData.approver_role}
          onChange={(e) =>
            setEditData({ ...editData, approver_role: e.target.value })
          }
          placeholder={t("workflow.editor.approver_placeholder")}
        />
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
