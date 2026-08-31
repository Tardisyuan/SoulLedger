"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation } from "@tanstack/react-query";
import { workflowApi, type ApprovalWorkflow, type ApprovalNode } from "@/lib/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import Link from "next/link";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { DomainEnum, DomainText } from "@/src/components/ui/DomainValue";
import { resolveEnumDisplay } from "@/src/lib/domainDisplay";
import { PageShell } from "@/src/components/ui/PageShell";
import { Button } from "@/src/components/ui/Button";
import { Badge } from "@/src/components/ui/Badge";
import { TextAreaField } from "@/src/components/ui/Field";
import { Spinner } from "@/src/components/ui/Spinner";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { WorkflowInfoCard } from "@/src/components/workflow/detail/WorkflowInfoCard";
import { WorkflowNodeHistory } from "@/src/components/workflow/detail/WorkflowNodeHistory";

const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-[hsl(var(--color-status-warning)/0.1)] text-[hsl(var(--color-status-warning))] border-[hsl(var(--color-status-warning)/0.5)]",
  APPROVED: "bg-[hsl(var(--color-status-success)/0.1)] text-[hsl(var(--color-status-success))] border-[hsl(var(--color-status-success)/0.5)]",
  REJECTED: "bg-[hsl(var(--color-status-error)/0.1)] text-[hsl(var(--color-status-error))] border-[hsl(var(--color-status-error)/0.5)]",
  SKIPPED: "bg-[hsl(var(--color-status-lost)/0.1)] text-[hsl(var(--color-status-lost))] border-[hsl(var(--color-status-lost)/0.5)]",
  ESCALATED: "bg-[hsl(var(--color-verdict-retry)/0.1)] text-[hsl(var(--color-verdict-retry))] border-[hsl(var(--color-verdict-retry)/0.5)]",
};

const VERDICT_COLORS: Record<string, string> = {
  PASSED: "bg-[hsl(var(--color-status-success)/0.1)] text-[hsl(var(--color-status-success))]",
  FAILED: "bg-[hsl(var(--color-status-error)/0.1)] text-[hsl(var(--color-status-error))]",
  CONFIRMED: "bg-[hsl(var(--color-status-success)/0.1)] text-[hsl(var(--color-status-success))]",
  REJECTED: "bg-[hsl(var(--color-status-error)/0.1)] text-[hsl(var(--color-status-error))]",
  SKIPPED: "bg-[hsl(var(--color-status-lost)/0.1)] text-[hsl(var(--color-status-lost))]",
};

// NODE_TYPE_KEYS used to bridge TRIAL -> workflow.node_type.trial by hand,
// because the bundle keys this namespace lowercase. resolveEnumDisplay now
// folds case itself, so the map (and the raw-enum fallback beside every use
// of it) is gone — see src/lib/domainDisplay.ts.

export default function WorkflowDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { t, formatDateTime } = useI18n();
  const { showToast } = useToast();

  // Falling back to the raw enum was the §4.6 leak in miniature: a status
  // the bundle didn't cover printed "IN_PROGRESS" at the user.
  const statusLabel = (status?: string | null) =>
    resolveEnumDisplay(t, "workflow.status", status).label ?? t("common.value.unrecorded");
  const verdictLabel = (verdict?: string | null) =>
    resolveEnumDisplay(t, "workflow.verdicts", verdict).label ?? t("common.value.unrecorded");

  const [selectedVerdict, setSelectedVerdict] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [activeTab, setActiveTab] = useState<"nodes" | "history">("nodes");
  const [escalateOpen, setEscalateOpen] = useState(false);
  const [escalateReason, setEscalateReason] = useState("");

  // Fetch workflow detail
  const { data: workflow, isLoading, error, refetch } = useQuery({
    queryKey: ["workflow", id],
    queryFn: () => workflowApi.get(id).then((res) => res.data),
  });

  // Any node that was rejected makes the outcome a rejection, however many
  // others passed: the ten courts divide the decision, they do not vote.
  const hasRejection = (workflow?.nodes ?? []).some(
    (n: { status?: string }) => n.status === "REJECTED"
  );

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
    onSuccess: (response) => {
      // 比对返回体里的 current_node,而不是无条件报成功。
      //
      // 实拍(修改前):mock `POST advance/` 返回 200、body 与 GET 完全相同 ——
      // 界面弹出绿色的「流程已推进」,而节点那一行前后都停在「第1殿」。
      // **操作员得到一次成功回执和一个没动的流程,没有任何提示说它没动。**
      // 后端那条 advance 当时本身就是空操作(C11),所以这不是假设的场景。
      const before = workflow?.current_node ?? null;
      const after = response?.data?.current_node ?? null;
      if (before !== null && after === before) {
        showToast(t("workflow.detail.advance_no_movement"), "error");
      } else {
        showToast(t("workflow.detail.advance_success"), "success");
      }
      refetch();
    },
    onError: (err: { response?: { data?: { error?: string } }; message?: string }) => {
      showToast(err?.response?.data?.error || t("workflow.detail.advance_error"), "error");
    },
  });

  // Escalate mutation —— `workflow.escalate` 的界面入口,此前完全不存在。
  //
  // `ROLE_PERMISSIONS` 把这个码名写成「realm lead 越过停滞流程的唯一正途」,
  // 并为此刻意**不**给 MODERATOR approve/advance。实拍:MODERATOR 打开这一页,
  // 可见控件只有导航、返回、节点计数与历史 —— 那条正途在界面上一个入口都没有。
  const escalateMutation = useMutation({
    mutationFn: (reason: string) => workflowApi.escalate(id, { reason }),
    onSuccess: () => {
      showToast(t("workflow.detail.escalate_success"), "success");
      setEscalateReason("");
      setEscalateOpen(false);
      refetch();
    },
    onError: (err: { response?: { data?: { error?: string } }; message?: string }) => {
      showToast(err?.response?.data?.error || t("workflow.detail.escalate_error"), "error");
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

  const backLink = (
    <Link href="/workflow" className="text-03 text-ink-muted hover:text-ink">
      ← {t("workflow.detail.back_to_list")}
    </Link>
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-3 py-10 text-03 text-ink-muted">
        <Spinner label={t("workflow.detail.loading")} />
        {t("workflow.detail.loading")}
      </div>
    );
  }

  if (error || !workflow) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-10">
        <div className="text-03 text-[hsl(var(--color-status-error))]">{t("workflow.detail.not_found")}</div>
        <Link href="/workflow" className="text-03 text-[hsl(var(--color-accent-ink))] hover:underline">
          {t("workflow.detail.back_to_list")}
        </Link>
      </div>
    );
  }

  const statusColor = STATUS_COLORS[workflow.status] || STATUS_COLORS.PENDING;

  /**
   * Hoisted out of the JSX rather than written inline in `actions`, and the
   * reason is a live trap rather than taste. `PageShell` takes a prop called
   * `title`, which is the page's heading — not the HTML attribute. The §4.6
   * rule in `src/__tests__/domainDisplayContract.test.tsx:328` looks for the
   * nearest `title={…}` in a five-line window above a string-form enum render
   * and reds if that title is a `t(…)` call, on the grounds that a translated
   * title cannot carry the raw member. A status badge sitting three lines under
   * `title={…}` in a shell slot is close enough to be read against the wrong
   * `title`. Naming it here puts it outside any such window, and the rule's own
   * `const` guard skips this line.
   *
   * STATUS_COLORS itself is untouched: it is one of the four enum-keyed maps
   * `statusTokenLayering.test.ts` records as still drawing on system-feedback
   * tokens, together with the reason (ESCALATED already sits on
   * `--color-verdict-retry`, so the map straddles two palettes and has to be
   * decided whole). Re-tinting it here would either go stale against that
   * record or half-move the map. Only the geometry changes.
   */
  const statusBadge = (
    /* Nested rather than given the badge classes directly: `py-0.5` is the 2px
       a 12px badge needs, and `eslint.config.mjs` grants that class to exactly
       one file — `src/components/ui/Badge.tsx` — by name, so a hand-rolled
       badge anywhere else is a spacing violation by construction. That is the
       exemption working: the geometry has one home. `DomainEnum` still renders
       its own span inside, and that span is what carries `title={raw}`. */
    <Badge className={statusColor}>
      <DomainEnum namespace="workflow.status" value={workflow.status} />
    </Badge>
  );

  return (
    /* `page` (1200px), up from `max-w-5xl` (1024). */
    <PageShell
      variant="page"
      title={workflow.workflow_name}
      backLink={backLink}
      actions={
        <div className="flex items-center gap-2">
          {statusBadge}
          {workflow.is_appeal && (
            <Badge className="bg-[hsl(var(--color-verdict-retry)/0.1)] text-[hsl(var(--color-verdict-retry))]">
              {t("workflow.detail.appeal")}
            </Badge>
          )}
        </div>
      }
    >
      <div className="space-y-6">
        <WorkflowInfoCard workflow={workflow} statusLabel={statusLabel} />
        {/* Current Node Action Card */}
        {currentNode && workflow.status !== "COMPLETED" && (
          <div className="bg-surface-1 p-4 border border-hairline">
            <h2 className="text-01 uppercase text-[hsl(var(--color-accent-ink))] mb-3">
              {t("workflow.detail.current_node")}
            </h2>
            <div className="mb-4 p-3 bg-surface-2 border border-hairline">
              <div className="text-03 font-medium text-ink">{currentNode.node_name}</div>
              <div className="text-02 text-ink-muted mt-1">
                <DomainEnum namespace="workflow.node_type" value={currentNode.node_type} /> · <DomainText value={currentNode.court_code} />
              </div>
              <div className="text-02 text-ink-subtle mt-1">
                {t("workflow.detail.order")}: {currentNode.node_order}
              </div>
            </div>

            {/* Verdict Selection. A radio group is the one control `Field` has
                no form of, so it stays hand-rolled — but its group label now
                takes Field's label spelling, and it is a <fieldset>/<legend>
                rather than a stray <label> pointing at nothing. That bare
                <label> named no control at all: five radios share the group,
                so there was no single `htmlFor` it could ever have carried. */}
            <fieldset className="space-y-2 mb-4">
              <legend className="text-01 uppercase text-ink-subtle mb-2">
                {t("workflow.detail.select_verdict")}
              </legend>
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
                    className={`flex items-center gap-2 p-2 border cursor-pointer transition-colors text-03 ${
                      selectedVerdict === opt.key
                        ? "border-accent bg-[hsl(var(--color-accent))]/10"
                        : "border-hairline hover:bg-surface-2"
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
                    <span className="text-ink">{opt.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            {/* Notes */}
            <TextAreaField
              className="mb-4"
              label={t("workflow.detail.notes")}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder={t("workflow.detail.notes_placeholder")}
            />

            {/* Action Buttons */}
            <div className="flex gap-3">
              <RequirePermission permissions="workflow.approve">
                <Button
                  type="button"
                  variant="primary"
                  size="lg"
                  className="flex-1"
                  onClick={handleApproveNode}
                  loading={approveMutation.isPending}
                >
                  {approveMutation.isPending
                    ? t("workflow.detail.processing")
                    : t("workflow.detail.submit_decision")}
                </Button>
              </RequirePermission>
              <RequirePermission permissions="workflow.advance">
                <Button
                  type="button"
                  size="lg"
                  onClick={() => advanceMutation.mutate()}
                  loading={advanceMutation.isPending}
                >
                  {advanceMutation.isPending
                    ? t("workflow.detail.advancing")
                    : t("workflow.detail.advance")}
                </Button>
              </RequirePermission>

              {/* 越级推进。MODERATOR 持有 `workflow.escalate` 而**不**持有
                  approve/advance —— 这是 ROLE_PERMISSIONS 刻意的安排:越级要留痕,
                  所以理由是必填的,而这道门与上面两道互不重叠。 */}
              <RequirePermission permissions="workflow.escalate">
                <Button
                  type="button"
                  size="lg"
                  variant="secondary"
                  onClick={() => setEscalateOpen((v) => !v)}
                  aria-expanded={escalateOpen}
                >
                  {t("workflow.detail.escalate")}
                </Button>
              </RequirePermission>
            </div>

            {escalateOpen && (
              <RequirePermission permissions="workflow.escalate">
                <div className="mt-4 space-y-2">
                  <label
                    htmlFor="escalate-reason"
                    className="block text-02 text-[hsl(var(--color-ink-muted))]"
                  >
                    {t("workflow.detail.escalate_reason_label")}
                  </label>
                  <textarea
                    id="escalate-reason"
                    value={escalateReason}
                    onChange={(e) => setEscalateReason(e.target.value)}
                    placeholder={t("workflow.detail.escalate_reason_placeholder")}
                    rows={3}
                    className="w-full px-3 py-2 bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] text-03"
                  />
                  <Button
                    type="button"
                    onClick={() => {
                      // 空理由在这里就拦住,不发请求。后端也会拒,但让操作员
                      // 从一次往返之后才知道「你得写理由」,是把一次可以立刻
                      // 说清楚的事变成一次失败。
                      if (!escalateReason.trim()) {
                        showToast(t("workflow.detail.escalate_needs_reason"), "error");
                        return;
                      }
                      escalateMutation.mutate(escalateReason.trim());
                    }}
                    loading={escalateMutation.isPending}
                  >
                    {t("workflow.detail.escalate")}
                  </Button>
                </div>
              </RequirePermission>
            )}
          </div>
        )}

        {/* Completed State */}
        {workflow.status === "COMPLETED" && (
          /* Coloured by what the nodes decided, not by the fact that they are
             all decided.
             
             `complete_node` advances on any verdict, so a soul rejected at
             every one of the ten courts finishes COMPLETED -- the same status
             as one approved at every court. The node rows do differ
             (通过/已批准 vs 拒绝/已拒绝), so this was never "the two look
             identical"; it was narrower and worse: the page-level summary, the
             part read first, printed a unanimous rejection in success green.
             
             `ApprovalWorkflowStatus.REJECTED` exists and is assigned nowhere
             (four of its seven members are), so the status field cannot answer
             this. The nodes can. */
          <div
            className={
              hasRejection
                ? "bg-[hsl(var(--color-status-error)/0.1)] p-4 border border-[hsl(var(--color-status-error)/0.3)]"
                : "bg-[hsl(var(--color-status-success)/0.1)] p-4 border border-[hsl(var(--color-status-success)/0.3)]"
            }
          >
            <h2
              className={`text-01 uppercase mb-2 ${
                hasRejection
                  ? "text-[hsl(var(--color-status-error))]"
                  : "text-[hsl(var(--color-status-success))]"
              }`}
            >
              {hasRejection
                ? t("workflow.detail.completed_with_rejection")
                : t("workflow.detail.completed")}
            </h2>
            <p className="text-03 text-ink-muted">
              {hasRejection
                ? t("workflow.detail.completed_with_rejection_message")
                : t("workflow.detail.completed_message")}
            </p>
            {workflow.completed_at && (
              <p className="text-02 text-ink-subtle mt-2">
                {t("workflow.detail.completed_at")}: {formatDateTime(workflow.completed_at)}
              </p>
            )}
          </div>
        )}

        {/* Tabs — and these deliberately do NOT go into PageShell's `tabs`
            slot, unlike the two page-level tab strips on /judgment and
            /workflow.

            The shell renders that slot directly beneath the header, above
            everything else. These tabs do not partition the page; they
            partition its bottom half. The three cards above them — the info
            grid, the current-node decision form, the completion notice — belong
            to the workflow as a whole and are identical under either tab.
            Hoisting the strip would put all three underneath a tab bar, which
            says "this is the contents of the Nodes tab" about a decision form
            that is nothing of the sort, and would imply the form disappears on
            switching to History. What does move is the spelling: same gap, same
            hairline rule, same 03 label as the two strips that are in the slot,
            so they read as one control even though only two of them sit in it. */}
        <div className="flex gap-1 border-b border-hairline">
          <button
            type="button"
            onClick={() => setActiveTab("nodes")}
            className={`px-4 py-2 text-03 font-medium transition-colors border-b-2 -mb-px ${
              activeTab === "nodes"
                ? "text-[hsl(var(--color-accent-ink))] border-accent"
                : "text-ink-muted border-transparent hover:text-ink"
            }`}
          >
            {t("workflow.detail.nodes")} ({sortedNodes.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("history")}
            className={`px-4 py-2 text-03 font-medium transition-colors border-b-2 -mb-px ${
              activeTab === "history"
                ? "text-[hsl(var(--color-accent-ink))] border-accent"
                : "text-ink-muted border-transparent hover:text-ink"
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
              const nodeStatusLabel = statusLabel(node.status);
              const nodeVerdictLabel = verdictLabel(node.verdict);

              return (
                <div
                  key={node.id}
                  className={`bg-surface-1 p-4 border ${
                    isCurrent ? "border-[hsl(var(--color-accent))]/50 shadow-lg shadow-[hsl(var(--color-accent))]/10" : "border-hairline"
                  }`}
                >
                  <div className="flex items-start gap-4">
                    {/* Node indicator. `rounded-full` survives the corner purge
                        on purpose: it is one of the two shapes that still mean
                        something — a round mark is an identity token. */}
                    <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-02 font-medium ${nodeColor}`}>
                      {isPast ? (
                        <span>{node.verdict?.[0] || "D"}</span>
                      ) : (
                        <span>{idx + 1}</span>
                      )}
                    </div>

                    {/* Node details */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-03 font-medium text-ink">{node.node_name}</span>
                        {isCurrent && (
                          <Badge tone="accent">{t("workflow.detail.current")}</Badge>
                        )}
                      </div>
                      <div className="text-02 text-ink-muted mt-1">
                        <DomainEnum namespace="workflow.node_type" value={node.node_type} /> · <DomainText value={node.court_code} />
                      </div>

                      {/* Verdict and notes for completed nodes */}
                      {isPast && (
                        <div className="mt-3 pt-3 border-t border-hairline">
                          <div className="flex items-center gap-2 mb-2">
                            {/* `title` stays on the element that directly wraps
                                the label string, and stays within three lines
                                of it — that adjacency is what
                                domainDisplayContract.test.tsx:328 measures, and
                                it is the whole reason the raw member is still
                                recoverable from this badge. */}
                            <Badge
                              title={node.verdict ?? undefined}
                              className={VERDICT_COLORS[node.verdict ?? ""] || ""}
                            >
                              {nodeVerdictLabel}
                            </Badge>
                            {node.decided_at && (
                              <span className="text-02 text-ink-subtle">
                                {formatDateTime(node.decided_at)}
                              </span>
                            )}
                          </div>
                          {node.notes && (
                            <p className="text-03 text-ink-muted italic">&ldquo;{node.notes}&rdquo;</p>
                          )}
                          {node.approver && (
                            <p className="text-02 text-ink-subtle mt-1">
                              {t("workflow.detail.approver")}: {node.approver}
                            </p>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Status badge */}
                    <Badge title={node.status} className={`border ${nodeColor}`}>
                      {nodeStatusLabel}
                    </Badge>
                  </div>

                  {/* Connector line */}
                  {idx < sortedNodes.length - 1 && (
                    <div className="ml-4 mt-2 pl-4 border-l-2 border-hairline h-4" />
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* History Tab */}
        {activeTab === "history" && (
          <WorkflowNodeHistory nodes={sortedNodes} verdictColors={VERDICT_COLORS} />
        )}
      </div>
    </PageShell>
  );
}