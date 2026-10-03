"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  workflowApi,
  requiresReasonForSoul,
  REJECTION_REASON_FOR_SOUL_MAX,
  type ApprovalWorkflow,
  type ApprovalNode,
} from "@soulledger/core/api";
import { workflowKeys } from "@soulledger/core/query_keys";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import Link from "next/link";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { DomainEnum, DomainText } from "@/src/components/ui/DomainValue";
import { resolveEnumDisplay } from "@/src/lib/domainDisplay";
import { PageShell } from "@/src/components/ui/PageShell";
import { TAB_BASE, TAB_ON, TAB_OFF } from "@/src/lib/tabClasses";
import { QueryError } from "@/src/components/ui/PageError";
import { Button } from "@/src/components/ui/Button";
import { Badge } from "@/src/components/ui/Badge";
import { TextAreaField } from "@/src/components/ui/Field";
import { Spinner } from "@/src/components/ui/Spinner";
import { WorkflowInfoCard } from "@/src/components/workflow/detail/WorkflowInfoCard";
import { WorkflowNodeHistory } from "@/src/components/workflow/detail/WorkflowNodeHistory";
import { WorkflowLinearPreview } from "@/src/components/workflow/detail/WorkflowLinearPreview";
import { usePermissions } from "@/src/hooks/usePermissions";
import { KIND_GLYPH } from "@/src/components/workflow/workflowValidation";
import { usePlaque } from "@/src/components/plaque/Plaque";
import { useHall } from "@/src/components/plaque/useHall";

const STATUS_COLORS: Record<string, string> = {
  PENDING: "text-[oklch(var(--color-status-warning))] border-[oklch(var(--color-status-warning))]",
  APPROVED: "text-[oklch(var(--color-status-success))] border-[oklch(var(--color-status-success))]",
  REJECTED: "text-[oklch(var(--color-status-error))] border-[oklch(var(--color-status-error))]",
  SKIPPED: "text-[oklch(var(--color-status-lost))] border-[oklch(var(--color-status-lost))]",
  ESCALATED: "text-[oklch(var(--color-verdict-retry))] border-[oklch(var(--color-verdict-retry))]",
  // 通知 / 结束: the engine went through it and nobody decided — SKIPPED's register.
  TRAVERSED: "text-[oklch(var(--color-status-lost))] border-[oklch(var(--color-status-lost))]",
};

const VERDICT_COLORS: Record<string, string> = {
  PASSED: "text-[oklch(var(--color-status-success))] border-[oklch(var(--color-status-success))]",
  FAILED: "text-[oklch(var(--color-status-error))] border-[oklch(var(--color-status-error))]",
  CONFIRMED: "text-[oklch(var(--color-status-success))] border-[oklch(var(--color-status-success))]",
  REJECTED: "text-[oklch(var(--color-status-error))] border-[oklch(var(--color-status-error))]",
  SKIPPED: "text-[oklch(var(--color-status-lost))] border-[oklch(var(--color-status-lost))]",
};

/**
 * 规范 v1 §1.2:状态 = 颜色 + 字形。两张表与上面两张颜色表同键;未知成员给「?」。
 * 判决的 ✓ / ✕ 与灵魂详情「丙 · 审判」同形(src/lib/verdictGlyph.ts)。
 */
const STATUS_GLYPH: Record<string, string> = {
  // 审批流本身的状态(页头徽章)与节点状态共用这张表;前四个只出现在审批流上。
  IN_PROGRESS: "▸",
  APPEAL: "↺",
  EXCEPTION: "!",
  COMPLETED: "■",
  PENDING: "◐",
  APPROVED: "✓",
  REJECTED: "✕",
  SKIPPED: "»",
  ESCALATED: "↑",
  TRAVERSED: "→",
};
const VERDICT_GLYPH: Record<string, string> = {
  PASSED: "✓",
  FAILED: "✕",
  CONFIRMED: "✓",
  REJECTED: "✕",
  SKIPPED: "»",
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
  const { hasPermission } = usePermissions();

  // Falling back to the raw enum was the §4.6 leak in miniature: a status
  // the bundle didn't cover printed "IN_PROGRESS" at the user.
  const statusLabel = (status?: string | null) =>
    resolveEnumDisplay(t, "workflow.status", status).label ?? t("common.value.unrecorded");

  const [selectedVerdict, setSelectedVerdict] = useState<string>("");
  const [notes, setNotes] = useState("");
  // Rebirth applications only: the reason the SOUL will read. `notes` stays internal.
  const [reasonForSoul, setReasonForSoul] = useState("");
  const [reasonForSoulError, setReasonForSoulError] = useState("");
  const [activeTab, setActiveTab] = useState<"nodes" | "history">("nodes");
  const [escalateOpen, setEscalateOpen] = useState(false);
  const [escalateReason, setEscalateReason] = useState("");

  // Fetch workflow detail.
  //
  // `workflowKeys.detail(id)`, not `["workflow", id]`. It was the latter, and
  // the WS handler for WORKFLOW_APPROVED / _REJECTED invalidates
  // `["workflows","detail",id]` — singular vs plural, diverging at the FIRST
  // segment, so it matched nothing. An approver sitting on this page, which is
  // the single most likely page to be open when the event fires, saw nothing
  // change.
  const { data: workflow, isLoading, error, refetch } = useQuery({
    queryKey: workflowKeys.detail(id),
    queryFn: () => workflowApi.get(id).then((res) => res.data),
    staleTime: 0,
  });

  // Any node that was rejected makes the outcome a rejection, however many
  // others passed: the ten courts divide the decision, they do not vote.
  const hasRejection = (workflow?.nodes ?? []).some(
    (n: { status?: string }) => n.status === "REJECTED"
  );

  // Approve node mutation
  const approveMutation = useMutation({
    mutationFn: (payload: { node_id: string; verdict: string; notes: string; rejection_reason_for_soul?: string }) =>
      workflowApi.approveNode(id, payload.node_id, {
        verdict: payload.verdict,
        notes: payload.notes,
        ...(payload.rejection_reason_for_soul !== undefined
          ? { rejection_reason_for_soul: payload.rejection_reason_for_soul }
          : {}),
      }),
    onSuccess: () => {
      showToast(t("workflow.detail.approve_success"), "success");
      setSelectedVerdict("");
      setNotes("");
      setReasonForSoul("");
      setReasonForSoulError("");
      refetch();
    },
    onError: (err: { response?: { status?: number; data?: { error?: string } }; message?: string }) => {
      // The backend's one field-shaped refusal here: land it beside the field, not in a toast.
      if (err?.response?.status === 400 && err.response.data?.error === "rejection_reason_for_soul is required") {
        setReasonForSoulError(t("workflow.detail.reason_for_soul_required"));
        return;
      }
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
  // By `case_type` from the serializer — never by the workflow's name.
  const needsReasonForSoul = requiresReasonForSoul(workflow?.case_type, selectedVerdict);

  // 身份带(A1 实例):题「审批实例」,右栏「<流程名> vN · 第 k / n 步」。版本只在跑的是已发布
  // 模板时有;没有当前节点(已结束)就不写步数。
  const stepIndex = currentNode ? sortedNodes.findIndex((n) => n.id === currentNode.id) : -1;
  // 殿名:当前节点的殿(A1「酆都 · 第三殿」);已结束、没有当前节点就写规制司。
  const hall = useHall(currentNode?.court_code || t("plaque.office.rules"));
  usePlaque({
    title: t("plaque.workflow_instance"),
    hall,
    meta: workflow
      ? [
          workflow.template_version_number ? `${workflow.workflow_name} v${workflow.template_version_number}` : workflow.workflow_name,
          stepIndex >= 0 ? t("plaque.step", { k: String(stepIndex + 1), n: String(sortedNodes.length) }) : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : undefined,
  });

  function handleApproveNode() {
    if (!currentNode) return;
    if (!selectedVerdict) {
      showToast(t("workflow.detail.select_verdict"), "error");
      return;
    }
    if (needsReasonForSoul && !reasonForSoul.trim()) {
      setReasonForSoulError(t("workflow.detail.reason_for_soul_required"));
      return;
    }
    approveMutation.mutate({
      node_id: currentNode.id,
      verdict: selectedVerdict,
      notes,
      ...(needsReasonForSoul ? { rejection_reason_for_soul: reasonForSoul.trim() } : {}),
    });
  }

  const backLink = (
    <Link href="/workflow" className="text-sm text-[oklch(var(--color-ink-muted))] hover:text-[oklch(var(--color-ink))]">
      {t("workflow.detail.back_to_list")}
    </Link>
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-3 py-8 text-sm text-[oklch(var(--color-ink-muted))]">
        <Spinner label={t("workflow.detail.loading")} />
        {t("workflow.detail.loading")}
      </div>
    );
  }

  // Split from the not-found branch below. `error || !workflow` told an
  // approver whose request 500'd, or who lacked permission on this tenant,
  // that the workflow "was not found" — a claim about the record's existence
  // made on evidence that says nothing about it.
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-8">
        <QueryError onRetry={() => refetch()} />
        <Link href="/workflow" className="text-sm text-[oklch(var(--color-accent-ink))] hover:underline">
          {t("workflow.detail.back_to_list")}
        </Link>
      </div>
    );
  }

  if (!workflow) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-8">
        <div className="text-sm text-[oklch(var(--color-status-error))]">{t("workflow.detail.not_found")}</div>
        <Link href="/workflow" className="text-sm text-[oklch(var(--color-accent-ink))] hover:underline">
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
    <Badge className={statusColor} glyph={STATUS_GLYPH[workflow.status] ?? "?"}>
      <DomainEnum namespace="workflow.status" value={workflow.status} />
    </Badge>
  );

  // 「待我处理」: the one place civilization colour enters this page (用户 10-02) —
  // a 3 px bar on the current node's row, when this operator is the one who can
  // decide it. `workflow.approve` is the gate the 提交判决 button sits behind.
  const waitingOnMe = workflow.status !== "COMPLETED" && hasPermission("workflow.approve");
  // 最近一步: the node decided last, by `decided_at`.
  const lastDecided = sortedNodes
    .filter((n) => n.decided_at)
    .sort((a, b) => new Date(b.decided_at!).getTime() - new Date(a.decided_at!).getTime())[0];
  const decidedCount = sortedNodes.filter((n) => n.status !== "PENDING").length;
  const signatures = currentNode?.signatures_json ?? [];

  return (
    /* v3 A1 实例详情: three columns — nodes 300 · current node · info 320, gap 24.
       Below 1024 they stack in reading order: current node first. */
    <PageShell
      variant="full"
      title={workflow.workflow_name}
      backLink={backLink}
      actions={
        <div className="flex items-center gap-2">
          {statusBadge}
          {workflow.is_appeal && (
            <Badge className="text-[oklch(var(--color-verdict-retry))] border-[oklch(var(--color-verdict-retry))]" glyph="↺">
              {t("workflow.detail.appeal")}
            </Badge>
          )}
        </div>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)_320px] gap-6">
        {/* ── 1 · 节点 / 历史 ── */}
        <section className="min-w-0 self-start bg-[oklch(var(--color-surface-1))] border border-[oklch(var(--color-line))] max-lg:order-2">
          {/* Tabs — and these deliberately do NOT go into PageShell's `tabs`
              slot: they partition this column, not the page. The decision form
              beside them belongs to the workflow as a whole and is identical
              under either tab. */}
          <div className="flex border-b border-[oklch(var(--color-line))]">
            <button
              type="button"
              onClick={() => setActiveTab("nodes")}
              className={`${TAB_BASE} ${activeTab === "nodes" ? TAB_ON : TAB_OFF} h-12 flex-1`}
            >
              {t("workflow.detail.nodes")} ({sortedNodes.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("history")}
              className={`${TAB_BASE} ${activeTab === "history" ? TAB_ON : TAB_OFF} h-12 flex-1`}
            >
              {t("workflow.detail.history")} · <span className="font-mono">{decidedCount}</span>
            </button>
          </div>

          {activeTab === "nodes" && (
            <>
              <ol>
                {sortedNodes.map((node) => {
                  const isCurrent = workflow.current_node === node.id && workflow.status !== "COMPLETED";
                  const isPast = node.status !== "PENDING";
                  const nodeStatusLabel = statusLabel(node.status);
                  return (
                    <li
                      key={node.id}
                      aria-current={isCurrent ? "step" : undefined}
                      className={`relative grid grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-x-2 min-h-16 px-3 py-2 border-b last:border-b-0 border-[oklch(var(--color-line))] ${
                        isCurrent
                          ? "bg-[oklch(var(--color-ink)/0.07)] font-medium text-[oklch(var(--color-ink))]"
                          : isPast
                            ? "text-[oklch(var(--color-ink-muted))]"
                            : "text-[oklch(var(--color-ink-subtle))]"
                      }`}
                    >
                      {isCurrent && waitingOnMe && (
                        <span
                          aria-hidden="true"
                          title={t("workflow.detail.waiting_on_me")}
                          className="absolute inset-y-0 left-0 w-[3px] bg-[oklch(var(--color-main))]"
                        />
                      )}
                      <span aria-hidden="true" className="text-center">
                        {isPast ? VERDICT_GLYPH[node.verdict ?? ""] ?? STATUS_GLYPH[node.status] ?? "?" : isCurrent ? "◐" : "·"}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm break-words">{node.node_name}</span>
                        <span className="block text-xs font-normal text-[oklch(var(--color-ink-muted))]">
                          <DomainEnum namespace="workflow.node_type" value={node.node_type} /> · <DomainText value={node.court_code} />
                          {" · "}
                          <span title={node.status}>
                            {nodeStatusLabel}
                          </span>
                        </span>
                      </span>
                      <span className="font-mono text-xs">
                        {isPast ? (
                          node.decided_at ? formatDateTime(node.decided_at) : ""
                        ) : isCurrent ? (
                          node.kind === "COUNTERSIGN" && node.required_verdicts ? (
                            `${(node.signatures_json ?? []).filter((s) => s.passed).length} / ${node.required_verdicts}`
                          ) : (
                            t("workflow.detail.current")
                          )
                        ) : (
                          t("workflow.detail.not_reached")
                        )}
                      </span>
                    </li>
                  );
                })}
              </ol>
              <p className="px-3 py-2 text-2xs normal-case tracking-normal text-[oklch(var(--color-ink-subtle))] border-t border-[oklch(var(--color-line))]">
                {t("workflow.detail.row_legend")}
              </p>
            </>
          )}

          {activeTab === "history" && (
            <div className="px-3">
              <WorkflowNodeHistory nodes={sortedNodes} verdictColors={VERDICT_COLORS} verdictGlyphs={VERDICT_GLYPH} />
            </div>
          )}
        </section>

        {/* ── 2 · 当前节点 ── */}
        <div className="min-w-0 flex flex-col gap-6 max-lg:order-1">
          {currentNode && workflow.status !== "COMPLETED" && (
            <section className="flex flex-col gap-4 px-6 py-6 bg-[oklch(var(--color-surface-1))] border border-[oklch(var(--color-line))]">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-title text-lg text-[oklch(var(--color-ink))] break-words">
                    <span aria-hidden="true">{KIND_GLYPH[currentNode.kind ?? "APPROVAL"]} </span>
                    {currentNode.node_name}
                  </h2>
                  <p className="text-xs text-[oklch(var(--color-ink-muted))]">
                    <DomainText value={currentNode.court_code} /> · <DomainEnum namespace="workflow.node_type" value={currentNode.node_type} />
                    {" · "}
                    {t("workflow.detail.order")} <span className="font-mono">{currentNode.node_order}</span>
                  </p>
                </div>
                {currentNode.timeout_hours ? (
                  <span className="font-mono text-xs text-[oklch(var(--color-ink-muted))]">
                    {t("workflow.editor.timeout.summary", {
                      hours: String(currentNode.timeout_hours),
                      action: currentNode.timeout_action ? t(`workflow.editor.timeout.action.${currentNode.timeout_action}`) : "",
                    })}
                  </span>
                ) : null}
              </div>

              {/* 会签人: who has signed so far (`signatures_json`). Signers not yet
                  signed are not in the API, so they are not drawn. */}
              {signatures.length > 0 && (
                <ul className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] border border-[oklch(var(--color-line))]">
                  {signatures.map((s, i) => (
                    <li key={i} className="flex flex-col gap-1 px-3 py-2 border-l first:border-l-0 border-[oklch(var(--color-line))]">
                      <span className="text-xs text-[oklch(var(--color-ink-muted))]">{s.user_name}</span>
                      <span className="text-sm text-[oklch(var(--color-ink))]">
                        <span aria-hidden="true">{VERDICT_GLYPH[s.verdict] ?? "?"} </span>
                        <DomainEnum namespace="workflow.verdicts" value={s.verdict} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {/* 判决键, v3 A1: 74 high, glyph over text, equal widths; the
                  chosen one 2 px ink. Still a radio group underneath — the
                  inputs are visually hidden, the labels are the keys. All five
                  verdicts stay (the drawing shows four). */}
              <fieldset>
                <legend className="mb-2 text-2xs uppercase text-[oklch(var(--color-ink-subtle))]">
                  {t("workflow.detail.select_verdict")}
                </legend>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                  {[
                    { key: "PASSED", label: t("workflow.verdicts.passed") },
                    { key: "FAILED", label: t("workflow.verdicts.failed") },
                    { key: "CONFIRMED", label: t("workflow.verdicts.confirmed") },
                    { key: "REJECTED", label: t("workflow.verdicts.rejected") },
                    { key: "SKIPPED", label: t("workflow.verdicts.skipped") },
                  ].map((opt) => {
                    const on = selectedVerdict === opt.key;
                    return (
                      <label
                        key={opt.key}
                        className={`relative flex flex-col items-center justify-center gap-1 h-[74px] cursor-pointer bg-[oklch(var(--color-surface-1))] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[oklch(var(--color-focus))] ${
                          on
                            ? "border-2 border-[oklch(var(--color-ink))] font-medium"
                            : "border border-[oklch(var(--color-line-strong))] hover:bg-[oklch(var(--color-surface-2))]"
                        }`}
                      >
                        <input
                          type="radio"
                          name="verdict"
                          value={opt.key}
                          aria-label={opt.label}
                          checked={on}
                          onChange={(e) => setSelectedVerdict(e.target.value)}
                          className="absolute inset-0 opacity-0 cursor-pointer"
                        />
                        <span aria-hidden="true" className="text-xl leading-none text-[oklch(var(--color-ink))]">
                          {VERDICT_GLYPH[opt.key]}
                        </span>
                        <span className="text-md text-[oklch(var(--color-ink))]">{opt.label}</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              <TextAreaField
                label={t("workflow.detail.notes")}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder={t("workflow.detail.notes_placeholder")}
              />

              {needsReasonForSoul && (
                <TextAreaField
                  label={t("workflow.detail.reason_for_soul")}
                  description={t("workflow.detail.reason_for_soul_hint")}
                  required
                  value={reasonForSoul}
                  onChange={(e) => {
                    setReasonForSoul(e.target.value);
                    setReasonForSoulError("");
                  }}
                  maxLength={REJECTION_REASON_FOR_SOUL_MAX}
                  rows={3}
                  error={reasonForSoulError || undefined}
                />
              )}

              <div className="flex flex-wrap items-center gap-2">
                <RequirePermission permissions="workflow.approve">
                  <Button type="button" variant="primary" onClick={handleApproveNode} loading={approveMutation.isPending}>
                    {approveMutation.isPending ? t("workflow.detail.processing") : t("workflow.detail.submit_decision")}
                  </Button>
                </RequirePermission>
                <RequirePermission permissions="workflow.advance">
                  <Button type="button" variant="secondary" onClick={() => advanceMutation.mutate()} loading={advanceMutation.isPending}>
                    {advanceMutation.isPending ? t("workflow.detail.advancing") : t("workflow.detail.advance")}
                  </Button>
                </RequirePermission>
                {/* 越级推进。MODERATOR 持有 `workflow.escalate` 而**不**持有
                    approve/advance —— 这是 ROLE_PERMISSIONS 刻意的安排:越级要留痕,
                    所以理由是必填的,而这道门与上面两道互不重叠。 */}
                <RequirePermission permissions="workflow.escalate">
                  <Button type="button" variant="ghost" onClick={() => setEscalateOpen((v) => !v)} aria-expanded={escalateOpen}>
                    {t("workflow.detail.escalate")}
                  </Button>
                </RequirePermission>
              </div>

              {escalateOpen && (
                <RequirePermission permissions="workflow.escalate">
                  <div className="space-y-2">
                    <TextAreaField
                      id="escalate-reason"
                      label={t("workflow.detail.escalate_reason_label")}
                      value={escalateReason}
                      onChange={(e) => setEscalateReason(e.target.value)}
                      placeholder={t("workflow.detail.escalate_reason_placeholder")}
                      rows={3}
                    />
                    <div className="flex justify-end">
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
                  </div>
                </RequirePermission>
              )}
            </section>
          )}

          {/* Completed State — coloured by what the nodes decided, not by the
              fact that they are all decided. `complete_node` advances on any
              verdict, so a soul rejected at every court finishes COMPLETED, the
              same status as one approved everywhere; the nodes can tell them
              apart, the status field cannot. */}
          {workflow.status === "COMPLETED" && (
            <section className="px-6 py-6 bg-[oklch(var(--color-surface-1))] border border-[oklch(var(--color-line))]">
              <h2
                className={`text-2xs uppercase tracking-widest ${
                  hasRejection ? "text-[oklch(var(--color-status-error))]" : "text-[oklch(var(--color-status-success))]"
                }`}
              >
                <span aria-hidden="true">{hasRejection ? "✕" : "✓"} </span>
                {hasRejection ? t("workflow.detail.completed_with_rejection") : t("workflow.detail.completed")}
              </h2>
              <p className="py-2 text-sm text-[oklch(var(--color-ink-muted))]">
                {hasRejection ? t("workflow.detail.completed_with_rejection_message") : t("workflow.detail.completed_message")}
              </p>
              {workflow.completed_at && (
                <p className="text-xs text-[oklch(var(--color-ink-subtle))]">
                  {t("workflow.detail.completed_at")}: <span className="font-mono">{formatDateTime(workflow.completed_at)}</span>
                </p>
              )}
            </section>
          )}

          {/* 最近一步 */}
          {lastDecided && (
            <section className="px-6 py-4 bg-[oklch(var(--color-surface-1))] border border-[oklch(var(--color-line))]">
              <div className="mb-2 text-2xs uppercase text-[oklch(var(--color-ink-subtle))]">{t("workflow.detail.last_step")}</div>
              <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-1">
                <span className="font-mono text-xs text-[oklch(var(--color-ink-muted))]">{formatDateTime(lastDecided.decided_at!)}</span>
                <span className="text-sm text-[oklch(var(--color-ink))]">
                  {lastDecided.node_name} · <span aria-hidden="true">{VERDICT_GLYPH[lastDecided.verdict ?? ""] ?? "?"} </span>
                  <DomainEnum namespace="workflow.verdicts" value={lastDecided.verdict} />
                </span>
                {lastDecided.notes && (
                  <p className="col-start-2 font-serif text-md leading-6 text-[oklch(var(--color-ink))] break-words">{lastDecided.notes}</p>
                )}
              </div>
            </section>
          )}

          {/* The whole flow, as a line; the current node marked while it runs. */}
          <WorkflowLinearPreview
            nodes={sortedNodes}
            currentNodeId={workflow.status !== "COMPLETED" ? workflow.current_node ?? null : null}
            endLabel={statusLabel("COMPLETED")}
            label={t("workflow.detail.nodes")}
          />
        </div>

        {/* ── 3 · 信息 ── */}
        <div className="min-w-0 self-start max-lg:order-3">
          <WorkflowInfoCard workflow={workflow} statusLabel={statusLabel} statusGlyph={STATUS_GLYPH[workflow.status] ?? "?"} />
        </div>
      </div>
    </PageShell>
  );
}
