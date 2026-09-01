"use client";

import { useState } from "react";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { soulsApi } from "@/lib/api";
import type { SoulDateProblem, SoulRecordEntry } from "@/lib/api/souls";

interface DateProblemsPanelProps {
  soulId: string;
  /** soul.date_problems — the soul's own dates against each other. */
  soulProblems: SoulDateProblem[];
  /** Already-fetched records (each carries its own date_problems); no
   * extra request is made here. */
  records: SoulRecordEntry[];
  /** Called after a successful acknowledge/unacknowledge to refetch. */
  onChanged: () => void;
}

interface Occurrence {
  severity: "error" | "warning";
  code: string;
  message: string;
  recordId?: string;
  recordLabel?: string;
  acknowledged?: boolean;
  acknowledgedBy?: string | null;
  acknowledgedAt?: string | null;
}

const KNOWN_CODE_ORDER = ["death_before_birth", "implausible_lifespan", "event_before_birth", "event_after_death"];

/**
 * Every date problem on this soul — its own birth/death against each other,
 * plus each record's event date against the soul — grouped by code, ERRORs
 * before WARNINGs. Renders nothing at all when there are zero problems: an
 * absence of warnings is not a claim of correctness, so there is
 * deliberately no reassuring "all clear" state here (unlike most panels on
 * this page, which show an empty-state message).
 *
 * Only `event_after_death` carries an acknowledge/revoke action — it is
 * the one WARNING-severity code this app knows about; the other three are
 * ERRORs that the write path already refuses before they can be persisted
 * (see apps/souls/serializers.py `_reject_errors`), so a soul only ever
 * carries one through legacy data, and there is nothing to acknowledge
 * about a date that should never have been saved.
 */
export function DateProblemsPanel({ soulId, soulProblems, records, onChanged }: DateProblemsPanelProps) {
  const { t, formatDateTime } = useI18n();
  const { showToast } = useToast();
  const [busyRecordId, setBusyRecordId] = useState<string | null>(null);
  const [expandedCodes, setExpandedCodes] = useState<Record<string, boolean>>({});

  const occurrences: Occurrence[] = [
    ...soulProblems.map((p) => ({ severity: p.severity, code: p.code, message: p.message })),
    ...records.flatMap((r) =>
      (r.date_problems ?? []).map((p) => ({
        severity: p.severity,
        code: p.code,
        message: p.message,
        recordId: r.id,
        recordLabel: r.description || r.category,
        acknowledged: p.acknowledged,
        acknowledgedBy: p.acknowledged_by,
        acknowledgedAt: p.acknowledged_at,
      }))
    ),
  ];

  if (occurrences.length === 0) return null;

  const groups = new Map<string, Occurrence[]>();
  for (const occ of occurrences) {
    const list = groups.get(occ.code) ?? [];
    list.push(occ);
    groups.set(occ.code, list);
  }
  const sortedCodes = [...groups.keys()].sort((a, b) => {
    const severityA = groups.get(a)![0].severity;
    const severityB = groups.get(b)![0].severity;
    if (severityA !== severityB) return severityA === "error" ? -1 : 1;
    const orderA = KNOWN_CODE_ORDER.indexOf(a);
    const orderB = KNOWN_CODE_ORDER.indexOf(b);
    if (orderA !== orderB) return (orderA === -1 ? 99 : orderA) - (orderB === -1 ? 99 : orderB);
    return a.localeCompare(b);
  });

  async function runAckAction(recordId: string, action: "acknowledge" | "unacknowledge") {
    setBusyRecordId(recordId);
    try {
      if (action === "acknowledge") {
        await soulsApi.acknowledgeDateWarning(soulId, recordId);
      } else {
        await soulsApi.unacknowledgeDateWarning(soulId, recordId);
      }
      onChanged();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      showToast(
        err?.response?.data?.error || err?.message || t("souls.detail.date_problems.ack_error"),
        "error"
      );
    } finally {
      setBusyRecordId(null);
    }
  }

  return (
    <div className="bg-[hsl(var(--color-surface-1))] p-5 border border-[hsl(var(--color-hairline))]">
      <h2 className="text-01 text-[hsl(var(--color-ink-muted))] uppercase mb-3">
        {t("souls.detail.date_problems.title")}
      </h2>
      <div className="space-y-2">
        {sortedCodes.map((code) => {
          const group = groups.get(code)!;
          const severity = group[0].severity;
          const isOpen = expandedCodes[code] ?? false;
          return (
            <div key={code} className="border border-[hsl(var(--color-hairline))]">
              <button
                type="button"
                onClick={() => setExpandedCodes((s) => ({ ...s, [code]: !isOpen }))}
                aria-expanded={isOpen}
                className="w-full flex items-center justify-between px-3 py-2 text-left"
              >
                <span className="flex items-center gap-2 text-03">
                  <span
                    aria-hidden="true"
                    className={
                      severity === "error"
                        ? "text-[hsl(var(--color-status-error))]"
                        : "text-[hsl(var(--color-status-warning))]"
                    }
                  >
                    {severity === "error" ? "⊘" : "△"}
                  </span>
                  <span className="text-[hsl(var(--color-ink))]">
                    {t(`souls.detail.date_problems.codes.${code}`)}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="bg-[hsl(var(--color-surface-3))] text-[hsl(var(--color-ink))] text-02 px-1.5 py-0.5">
                    {group.length}
                  </span>
                  <span className="text-[hsl(var(--color-ink-subtle))] text-02" aria-hidden="true">
                    {isOpen ? "▲" : "▼"}
                  </span>
                </span>
              </button>
              {isOpen && (
                <div className="px-3 pb-3 space-y-3 border-t border-[hsl(var(--color-hairline))] pt-2">
                  {group.map((occ, idx) => (
                    <div key={`${occ.recordId ?? "soul"}-${idx}`} className="text-03 text-[hsl(var(--color-ink-muted))] space-y-1">
                      {occ.recordLabel && (
                        <div className="text-[hsl(var(--color-ink))] font-medium">{occ.recordLabel}</div>
                      )}
                      <p>{occ.message}</p>
                      {occ.code === "event_after_death" && occ.recordId && (
                        <div className="pt-1">
                          {occ.acknowledged ? (
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-[hsl(var(--color-ink-subtle))]">
                                {t("souls.detail.date_problems.acknowledged_by", {
                                  user: occ.acknowledgedBy || "",
                                  date: occ.acknowledgedAt ? formatDateTime(occ.acknowledgedAt) : "",
                                })}
                              </span>
                              <RequirePermission permissions="soul.update">
                                <button
                                  type="button"
                                  onClick={() => runAckAction(occ.recordId!, "unacknowledge")}
                                  disabled={busyRecordId === occ.recordId}
                                  className="px-2 py-0.5 border border-[hsl(var(--color-hairline))] hover:bg-[hsl(var(--color-surface-2))] text-[hsl(var(--color-ink-muted))] disabled:opacity-50 transition-colors"
                                >
                                  {t("souls.detail.date_problems.revoke")}
                                </button>
                              </RequirePermission>
                            </div>
                          ) : (
                            <RequirePermission permissions="soul.update">
                              <button
                                type="button"
                                onClick={() => runAckAction(occ.recordId!, "acknowledge")}
                                disabled={busyRecordId === occ.recordId}
                                className="px-2 py-0.5 border border-[hsl(var(--color-hairline))] hover:bg-[hsl(var(--color-surface-2))] text-[hsl(var(--color-ink-muted))] disabled:opacity-50 transition-colors"
                              >
                                {t("souls.detail.date_problems.acknowledge")}
                              </button>
                            </RequirePermission>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
