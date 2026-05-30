"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation } from "@tanstack/react-query";
import { workflowApi, type ApprovalWorkflow, type ApprovalNode } from "@/lib/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import Link from "next/link";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";

const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-[hsl(var(--color-status-warning)/0.2)] text-[hsl(var(--color-status-warning))] border-[hsl(var(--color-status-warning)/0.5)]",
  APPROVED: "bg-[hsl(var(--color-status-success)/0.2)] text-[hsl(var(--color-status-success))] border-[hsl(var(--color-status-success)/0.5)]",
  REJECTED: "bg-[hsl(var(--color-status-error)/0.2)] text-[hsl(var(--color-status-error))] border-[hsl(var(--color-status-error)/0.5)]",
  SKIPPED: "bg-[hsl(var(--color-status-lost)/0.2)] text-[hsl(var(--color-status-lost))] border-[hsl(var(--color-status-lost)/0.5)]",
  ESCALATED: "bg-[hsl(var(--color-verdict-retry)/0.2)] text-[hsl(var(--color-verdict-retry))] border-[hsl(var(--color-verdict-retry)/0.5)]",
};

const VERDICT_COLORS: Record<string, string> = {
  PASSED: "bg-[hsl(var(--color-status-success)/0.2)] text-[hsl(var(--color-status-success))]",
  FAILED: "bg-[hsl(var(--color-status-error)/0.2)] text-[hsl(var(--color-status-error))]",
  CONFIRMED: "bg-[hsl(var(--color-status-success)/0.2)] text-[hsl(var(--color-status-success))]",
  REJECTED: "bg-[hsl(var(--color-status-error)/0.2)] text-[hsl(var(--color-status-error))]",
  SKIPPED: "bg-[hsl(var(--color-status-lost)/0.2)] text-[hsl(var(--color-status-lost))]",
};

const NODE_TYPE_KEYS: Record<string, string> = {
  TRIAL: "workflow.node_type.trial",
  EVALUATION: "workflow.node_type.evaluation",
  APPEAL: "workflow.node_type.appeal",
  FINAL: "workflow.node_type.final",
  EXECUTION: "workflow.node_type.execution",
};

export default function WorkflowDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { t } = useI18n();
  const { showToast } = useToast();

  const [selectedVerdict, setSelectedVerdict] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [activeTab, setActiveTab] = useState<"nodes" | "history">("nodes");

  // Fetch workflow detail
  const { data: workflow, isLoading, error, refetch } = useQuery({
    queryKey: ["workflow", id],
    queryFn: () => workflowApi.get(id).then((res) => res.data as ApprovalWorkflow),
  });

  // Approve node mutation
  const approveMutation = useMutation({
    mutationFn: (payload: { node_id: string; verdict: string; notes: string }) =>
      workflowApi.approveNode(id, payload.node_id, { verdict: payload.verdict, notes: payload.notes }),
    onSuccess: () => {
      showToast(t("workflow.detail.approve_success"), "success");
      setSelectedVerdict("");
      setNotes("");
      refetch();
    },
    onError: (err: { response?: { data?: { error?: string } }; message?: string }) => {
      showToast(err?.response?.data?.error || t("workflow.detail.approve_error"), "error");
    },
  });

  // Advance mutation
  const advanceMutation = useMutation({
    mutationFn: () => workflowApi.advance(id),
    onSuccess: () => {
      showToast(t("workflow.detail.advance_success"), "success");
      refetch();
    },
    onError: (err: { response?: { data?: { error?: string } }; message?: string }) => {
      showToast(err?.response?.data?.error || t("workflow.detail.advance_error"), "error");
    },
  });

  const currentNode = workflow?.current_node_detail;
  const sortedNodes = workflow?.nodes?.slice().sort((a, b) => a.node_order - b.node_order) || [];

  function handleApproveNode() {
    if (!currentNode) return;
    if (!selectedVerdict) {
      showToast(t("workflow.detail.select_verdict"), "error");
      return;
    }
    approveMutation.mutate({
      node_id: currentNode.id,
      verdict: selectedVerdict,
      notes,
    });
  }

  if (isLoading) {
    return (
      <div className="text-[hsl(var(--color-ink))] flex items-center justify-center py-12">
        <div className="text-[hsl(var(--color-ink-muted))]">{t("workflow.detail.loading")}</div>
      </div>
    );
  }

  if (error || !workflow) {
    return (
      <div className="text-[hsl(var(--color-ink))] flex flex-col items-center justify-center gap-4 py-12">
        <div className="text-[hsl(var(--color-status-error))]">{t("workflow.detail.not_found")}</div>
        <Link href="/workflow" className="text-[hsl(var(--color-accent))] hover:text-[hsl(var(--color-accent-hover))]">
          {t("workflow.detail.back_to_list")}
        </Link>
      </div>
    );
  }

  const statusColor = STATUS_COLORS[workflow.status] || STATUS_COLORS.PENDING;

  return (
    <div className="text-[hsl(var(--color-ink))]">
      {/* Page header */}
      <div className="h-12 flex items-center px-6 gap-4 border-b border-[hsl(var(--color-hairline))]/50">
        <Link href="/workflow" className="text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-ink))] text-sm">
          ← {t("workflow.detail.back_to_list")}
        </Link>
        <h1 className="text-lg font-bold text-[hsl(var(--color-ink))] flex-1">{workflow.workflow_name}</h1>
        <span className={`px-2 py-0.5 rounded text-xs font-bold border ${statusColor}`}>
          {workflow.status}
        </span>
        {workflow.is_appeal && (
          <span className="px-2 py-0.5 rounded text-xs bg-[hsl(var(--color-verdict-retry)/0.2)] text-[hsl(var(--color-verdict-retry))]">
            {t("workflow.detail.appeal")}
          </span>
        )}
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        {/* Workflow Info Card */}
        <div className="bg-[hsl(var(--color-surface-1))] rounded-lg p-5 border border-[hsl(var(--color-hairline))]">
          <h2 className="text-sm font-semibold text-[hsl(var(--color-ink-muted))] uppercase mb-3">
            {t("workflow.detail.info")}
          </h2>
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-[hsl(var(--color-ink-muted))]">{t("workflow.detail.soul")}</dt>
              <dd className="text-[hsl(var(--color-ink))] font-medium">{workflow.soul_name || workflow.soul}</dd>
            </div>
            <div>
              <dt className="text-[hsl(var(--color-ink-muted))]">{t("workflow.detail.case_type")}</dt>
              <dd className="text-[hsl(var(--color-ink))]">{workflow.case_type}</dd>
            </div>
            <div>
              <dt className="text-[hsl(var(--color-ink-muted))]">{t("workflow.detail.judgment_verdict")}</dt>
              <dd className="text-[hsl(var(--color-ink))]">{workflow.judgment_verdict || "—"}</dd>
            </div>
            <div>
              <dt className="text-[hsl(var(--color-ink-muted))]">{t("workflow.detail.priority")}</dt>
              <dd className="text-[hsl(var(--color-ink))]">
                {workflow.priority === 0 ? t("workflow.detail.normal") :
                 workflow.priority === 1 ? t("workflow.detail.urgent") :
                 t("workflow.detail.critical")}
              </dd>
            </div>
            <div>
              <dt className="text-[hsl(var(--color-ink-muted))]">{t("workflow.detail.created_at")}</dt>
              <dd className="text-[hsl(var(--color-ink))]">{new Date(workflow.created_at).toLocaleString()}</dd>
            </div>
            <div>
              <dt className="text-[hsl(var(--color-ink-muted))]">{t("workflow.detail.completed_at")}</dt>
              <dd className="text-[hsl(var(--color-ink))]">{workflow.completed_at ? new Date(workflow.completed_at).toLocaleString() : "—"}</dd>
            </div>
          </dl>
        </div>

        {/* Current Node Action Card */}
        {currentNode && workflow.status !== "COMPLETED" && (
          <div className="bg-[hsl(var(--color-surface-1))] rounded-lg p-5 border border-[hsl(var(--color-hairline))]">
            <h2 className="text-sm font-semibold text-[hsl(var(--color-accent))] uppercase mb-3">
              {t("workflow.detail.current_node")}
            </h2>
            <div className="mb-4 p-3 bg-[hsl(var(--color-surface-2))] rounded border border-[hsl(var(--color-hairline))]">
              <div className="font-medium text-[hsl(var(--color-ink))]">{currentNode.node_name}</div>
              <div className="text-xs text-[hsl(var(--color-ink-muted))] mt-1">
                {t(NODE_TYPE_KEYS[currentNode.node_type]) || currentNode.node_type} · {currentNode.court_code}
              </div>
              <div className="text-xs text-[hsl(var(--color-ink-subtle))] mt-1">
                {t("workflow.detail.order")}: {currentNode.node_order}
              </div>
            </div>

            {/* Verdict Selection */}
            <div className="space-y-2 mb-4">
              <label className="block text-sm text-[hsl(var(--color-ink-muted))] mb-2">
                {t("workflow.detail.select_verdict")}
              </label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { key: "PASSED", label: t("workflow.verdicts.passed") },
                  { key: "FAILED", label: t("workflow.verdicts.failed") },
                  { key: "CONFIRMED", label: t("workflow.verdicts.confirmed") },
                  { key: "REJECTED", label: t("workflow.verdicts.rejected") },
                  { key: "SKIPPED", label: t("workflow.verdicts.skipped") },
                ].map((opt) => (
                  <label
                    key={opt.key}
                    className={`flex items-center gap-2 p-2 rounded border cursor-pointer transition-colors text-sm ${
                      selectedVerdict === opt.key
                        ? "border-[hsl(var(--color-accent))] bg-[hsl(var(--color-accent))]/10"
                        : "border-[hsl(var(--color-hairline))] hover:bg-[hsl(var(--color-surface-2))]"
                    }`}
                  >
                    <input
                      type="radio"
                      name="verdict"
                      value={opt.key}
                      checked={selectedVerdict === opt.key}
                      onChange={(e) => setSelectedVerdict(e.target.value)}
                      className="accent-[hsl(var(--color-accent))]"
                    />
                    <span className="text-[hsl(var(--color-ink))]">{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Notes */}
            <div className="mb-4">
              <label className="block text-sm text-[hsl(var(--color-ink-muted))] mb-2">
                {t("workflow.detail.notes")}
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="w-full bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded p-3 text-sm text-[hsl(var(--color-ink))] placeholder:text-[hsl(var(--color-ink-subtle))] focus:outline-none focus:border-[hsl(var(--color-accent))]/50"
                placeholder={t("workflow.detail.notes_placeholder")}
              />
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3">
              <RequirePermission permissions="workflow.approve">
                <button
                  onClick={handleApproveNode}
                  disabled={approveMutation.isPending}
                  className="flex-1 py-2.5 px-4 bg-[hsl(var(--color-accent))] hover:bg-[hsl(var(--color-accent-hover))] disabled:opacity-50 rounded-md text-sm font-medium transition-colors text-black"
                >
                  {approveMutation.isPending
                    ? t("workflow.detail.processing")
                    : t("workflow.detail.submit_decision")}
                </button>
              </RequirePermission>
              <RequirePermission permissions="workflow.advance">
                <button
                  onClick={() => advanceMutation.mutate()}
                  disabled={advanceMutation.isPending}
                  className="py-2.5 px-4 bg-[hsl(var(--color-surface-2))] hover:bg-[hsl(var(--color-surface-3))] disabled:opacity-50 rounded-md text-sm font-medium transition-colors text-[hsl(var(--color-ink))] border border-[hsl(var(--color-hairline))]"
                >
                  {advanceMutation.isPending
                    ? t("workflow.detail.advancing")
                    : t("workflow.detail.advance")}
                </button>
              </RequirePermission>
            </div>
          </div>
        )}

        {/* Completed State */}
        {workflow.status === "COMPLETED" && (
          <div className="bg-[hsl(var(--color-status-success)/0.1)] rounded-lg p-5 border border-[hsl(var(--color-status-success)/0.3)]">
            <h2 className="text-sm font-semibold text-[hsl(var(--color-status-success))] uppercase mb-2">
              {t("workflow.detail.completed")}
            </h2>
            <p className="text-sm text-[hsl(var(--color-ink-muted))]">
              {t("workflow.detail.completed_message")}
            </p>
            {workflow.completed_at && (
              <p className="text-xs text-[hsl(var(--color-ink-subtle))] mt-2">
                {t("workflow.detail.completed_at")}: {new Date(workflow.completed_at).toLocaleString()}
              </p>
            )}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 border-b border-[hsl(var(--color-hairline))]/50">
          <button
            onClick={() => setActiveTab("nodes")}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === "nodes"
                ? "text-[hsl(var(--color-accent))] border-[hsl(var(--color-accent))]"
                : "text-[hsl(var(--color-ink-muted))] border-transparent hover:text-[hsl(var(--color-ink))]"
            }`}
          >
            {t("workflow.detail.nodes")} ({sortedNodes.length})
          </button>
          <button
            onClick={() => setActiveTab("history")}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === "history"
                ? "text-[hsl(var(--color-accent))] border-[hsl(var(--color-accent))]"
                : "text-[hsl(var(--color-ink-muted))] border-transparent hover:text-[hsl(var(--color-ink))]"
            }`}
          >
            {t("workflow.detail.history")}
          </button>
        </div>

        {/* Nodes Tab */}
        {activeTab === "nodes" && (
          <div className="space-y-3">
            {sortedNodes.map((node, idx) => {
              const isCurrent = workflow.current_node === node.id;
              const isPast = node.status !== "PENDING";
              const nodeColor = STATUS_COLORS[node.status] || STATUS_COLORS.PENDING;

              return (
                <div
                  key={node.id}
                  className={`bg-[hsl(var(--color-surface-1))] rounded-lg p-4 border ${
                    isCurrent ? "border-[hsl(var(--color-accent))]/50 shadow-lg shadow-[hsl(var(--color-accent))]/10" : "border-[hsl(var(--color-hairline))]"
                  }`}
                >
                  <div className="flex items-start gap-4">
                    {/* Node indicator */}
                    <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${nodeColor}`}>
                      {isPast ? (
                        <span className="text-xs">{node.verdict?.[0] || "D"}</span>
                      ) : (
                        <span>{idx + 1}</span>
                      )}
                    </div>

                    {/* Node details */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-[hsl(var(--color-ink))]">{node.node_name}</span>
                        {isCurrent && (
                          <span className="px-1.5 py-0.5 rounded text-xs bg-[hsl(var(--color-accent))]/20 text-[hsl(var(--color-accent))] border border-[hsl(var(--color-accent))]/30">
                            {t("workflow.detail.current")}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-[hsl(var(--color-ink-muted))] mt-1">
                        {t(NODE_TYPE_KEYS[node.node_type]) || node.node_type} · {node.court_code || "—"}
                      </div>

                      {/* Verdict and notes for completed nodes */}
                      {isPast && (
                        <div className="mt-3 pt-3 border-t border-[hsl(var(--color-hairline))]/50">
                          <div className="flex items-center gap-2 mb-2">
                            <span className={`px-2 py-0.5 rounded text-xs font-bold ${VERDICT_COLORS[node.verdict ?? ""] || ""}`}>
                              {node.verdict}
                            </span>
                            {node.decided_at && (
                              <span className="text-xs text-[hsl(var(--color-ink-subtle))]">
                                {new Date(node.decided_at).toLocaleString()}
                              </span>
                            )}
                          </div>
                          {node.notes && (
                            <p className="text-sm text-[hsl(var(--color-ink-muted))] italic">&ldquo;{node.notes}&rdquo;</p>
                          )}
                          {node.approver && (
                            <p className="text-xs text-[hsl(var(--color-ink-subtle))] mt-1">
                              {t("workflow.detail.approver")}: {node.approver}
                            </p>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Status badge */}
                    <span className={`px-2 py-0.5 rounded text-xs font-medium border ${nodeColor}`}>
                      {node.status}
                    </span>
                  </div>

                  {/* Connector line */}
                  {idx < sortedNodes.length - 1 && (
                    <div className="ml-4 mt-2 pl-4 border-l-2 border-[hsl(var(--color-hairline))]/50 h-4" />
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* History Tab */}
        {activeTab === "history" && (
          <div className="space-y-3">
            {sortedNodes
              .filter((n) => n.status !== "PENDING")
              .sort((a, b) => {
                const aTime = a.decided_at ? new Date(a.decided_at).getTime() : 0;
                const bTime = b.decided_at ? new Date(b.decided_at).getTime() : 0;
                return aTime - bTime;
              })
              .map((node) => (
                <div key={node.id} className="bg-[hsl(var(--color-surface-1))] rounded-lg p-4 border border-[hsl(var(--color-hairline))]">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-[hsl(var(--color-ink))]">{node.node_name}</span>
                    <span className={`px-2 py-0.5 rounded text-xs font-bold ${VERDICT_COLORS[node.verdict ?? ""] || ""}`}>
                      {node.verdict}
                    </span>
                  </div>
                  <div className="text-xs text-[hsl(var(--color-ink-muted))]">
                    {t("workflow.detail.decided_at")}: {node.decided_at ? new Date(node.decided_at).toLocaleString() : "—"}
                  </div>
                  {node.notes && (
                    <p className="text-sm text-[hsl(var(--color-ink-muted))] mt-2 italic">&ldquo;{node.notes}&rdquo;</p>
                  )}
                  {node.approver && (
                    <p className="text-xs text-[hsl(var(--color-ink-subtle))] mt-1">
                      {t("workflow.detail.approver")}: {node.approver}
                    </p>
                  )}
                </div>
              ))}
            {sortedNodes.filter((n) => n.status !== "PENDING").length === 0 && (
              <div className="text-center text-[hsl(var(--color-ink-subtle))] py-8">
                {t("workflow.detail.no_history")}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}