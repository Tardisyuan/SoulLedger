"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation } from "@tanstack/react-query";
import { judgmentApi, soulsApi, type Soul } from "@/lib/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";

interface JudgmentDetail {
  id: string;
  soul: string;
  soul_name: string;
  civilization: string;
  court: string;
  evidence_json: Record<string, unknown> | null;
  confession: string | null;
  verdict: "PASSED" | "FAILED" | "PURGATORY" | "RETRY" | null;
  notes: string | null;
  is_final: boolean;
  created_at: string;
  concluded_at: string | null;
}

interface PageProps {
  params: { id: string };
}

const VERDICT_CONFIG: Record<string, { bg: string; text: string; border: string }> = {
  PASSED: { bg: "bg-amber-500/15", text: "text-amber-400", border: "border-amber-500/30" },
  FAILED: { bg: "bg-red-600/15", text: "text-red-400", border: "border-red-600/30" },
  PURGATORY: { bg: "bg-blue-500/15", text: "text-blue-400", border: "border-blue-500/30" },
  RETRY: { bg: "bg-purple-500/15", text: "text-purple-400", border: "border-purple-500/30" },
};

const CIVILIZATION_ICONS: Record<string, string> = {
  CHINESE: "CN",
  EUROPEAN: "EU",
  EGYPTIAN: "EG",
};

export default function JudgmentDetailPage({ params }: PageProps) {
  const { id } = params;
  const router = useRouter();
  const { t } = useI18n();
  const { showToast } = useToast();
  const [selectedVerdict, setSelectedVerdict] = useState<string>("");
  const [notes, setNotes] = useState("");

  const { data: judgment, isLoading, error } = useQuery({
    queryKey: ["judgment", id],
    queryFn: () => judgmentApi.get(id).then((res) => res.data as JudgmentDetail),
  });

  const { data: soulData } = useQuery({
    queryKey: ["soul", judgment?.soul],
    queryFn: () => soulsApi.get(judgment!.soul).then((res) => res.data as Soul),
    enabled: !!judgment?.soul,
  });

  const concludeMutation = useMutation({
    mutationFn: (payload: { verdict: string; notes: string }) =>
      judgmentApi.conclude(id, payload),
    onSuccess: () => {
      showToast(t("judgment.detail.conclude_success"), "success");
      router.push("/judgment");
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.error || t("judgment.detail.conclude_error"), "error");
    },
  });

  useEffect(() => {
    if (judgment) {
      setNotes(judgment.notes || "");
      if (judgment.verdict) {
        setSelectedVerdict(judgment.verdict);
      }
    }
  }, [judgment]);

  function handleConclude() {
    if (!selectedVerdict) {
      showToast(t("judgment.detail.select_verdict"), "error");
      return;
    }
    concludeMutation.mutate({ verdict: selectedVerdict, notes });
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-[hsl(var(--color-ink-muted))]">{t("judgment.detail.loading")}</div>
      </div>
    );
  }

  if (error || !judgment) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-20">
        <div className="text-red-400 text-lg">{t("judgment.detail.not_found")}</div>
        <a href="/judgment" className="text-[hsl(var(--color-accent))] hover:underline text-sm">
          {t("judgment.detail.back_to_list")}
        </a>
      </div>
    );
  }

  const verdictCfg = judgment.verdict ? VERDICT_CONFIG[judgment.verdict] : null;
  const civIcon = CIVILIZATION_ICONS[judgment.civilization] || "??";

  return (
    <div className="text-[hsl(var(--color-ink))] max-w-5xl mx-auto px-6 py-6 space-y-6">
      {/* Back link */}
      <a
        href="/judgment"
        className="inline-flex items-center gap-1 text-sm text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-ink))] transition-colors"
      >
        ← {t("judgment.detail.back_to_list")}
      </a>

      {/* Title row */}
      <div className="flex items-center gap-4">
        <h1 className="text-xl font-bold text-[hsl(var(--color-accent))] flex-1">
          {t("judgment.title")}
        </h1>
        {judgment.is_final && (
          <span className="px-2.5 py-1 rounded text-xs font-bold bg-[hsl(var(--color-surface-3))] text-[hsl(var(--color-ink-muted))] border border-[hsl(var(--color-hairline))]">
            {t("judgment.detail.final")}
          </span>
        )}
        <span className="text-xs text-[hsl(var(--color-ink-subtle))]">
          {new Date(judgment.created_at).toLocaleDateString()}
        </span>
      </div>

      {/* Main grid: sidebar + content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left sidebar — soul info + metadata */}
        <div className="lg:col-span-1 space-y-4">
          {/* Soul card */}
          <div className="bg-[hsl(var(--color-surface-1))] rounded-lg border border-[hsl(var(--color-hairline))] overflow-hidden">
            <div className="px-4 py-3 border-b border-[hsl(var(--color-hairline))] flex items-center gap-3">
              <span className="w-8 h-8 rounded-full bg-[hsl(var(--color-surface-3))] flex items-center justify-center text-xs font-bold text-[hsl(var(--color-ink-muted))]">
                {civIcon}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-[hsl(var(--color-ink))] truncate">
                  {soulData?.name || judgment.soul_name || judgment.soul}
                </div>
                <div className="text-xs text-[hsl(var(--color-ink-subtle))]">
                  {t(`souls.civilizations.${judgment.civilization}`)}
                </div>
              </div>
            </div>
            <div className="px-4 py-3 space-y-2.5 text-sm">
              <div className="flex justify-between">
                <span className="text-[hsl(var(--color-ink-muted))]">{t("judgment.detail.court")}</span>
                <span className="text-[hsl(var(--color-ink))]">{judgment.court || "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[hsl(var(--color-ink-muted))]">{t("judgment.detail.soul_name")}</span>
                <span className="text-[hsl(var(--color-ink))] text-right truncate max-w-[140px]" title={judgment.soul}>
                  {soulData?.name || judgment.soul_name || "—"}
                </span>
              </div>
            </div>
          </div>

          {/* Verdict badge (if final) */}
          {judgment.is_final && verdictCfg && (
            <div className={`rounded-lg border p-4 ${verdictCfg.bg} ${verdictCfg.border}`}>
              <div className="text-xs font-medium text-[hsl(var(--color-ink-muted))] uppercase mb-2">
                {t("judgment.detail.verdict")}
              </div>
              <div className={`text-lg font-bold ${verdictCfg.text}`}>
                {t(`judgment.verdicts.${judgment.verdict}`)}
              </div>
              {judgment.concluded_at && (
                <div className="text-xs text-[hsl(var(--color-ink-subtle))] mt-2">
                  {new Date(judgment.concluded_at).toLocaleString()}
                </div>
              )}
              {judgment.notes && (
                <div className="mt-3 pt-3 border-t border-current/10">
                  <p className="text-xs text-[hsl(var(--color-ink-muted))] mb-1">{t("judgment.detail.notes")}:</p>
                  <p className="text-sm text-[hsl(var(--color-ink))]">{judgment.notes}</p>
                </div>
              )}
            </div>
          )}

          {/* Pending indicator */}
          {!judgment.is_final && (
            <div className="rounded-lg border border-[hsl(38,92%,50%,0.3)] bg-[hsl(38,92%,50%,0.08)] p-4">
              <div className="text-xs font-medium text-[hsl(var(--color-ink-muted))] uppercase mb-1">
                {t("judgment.detail.verdict")}
              </div>
              <div className="text-sm font-bold text-[hsl(38,92%,50%)]">
                {t("judgment.pending")}
              </div>
            </div>
          )}
        </div>

        {/* Right main content */}
        <div className="lg:col-span-2 space-y-4">
          {/* Evidence */}
          {judgment.evidence_json && Object.keys(judgment.evidence_json).length > 0 && (
            <div className="bg-[hsl(var(--color-surface-1))] rounded-lg border border-[hsl(var(--color-hairline))] overflow-hidden">
              <div className="px-5 py-3 border-b border-[hsl(var(--color-hairline))]">
                <h2 className="text-sm font-semibold text-[hsl(var(--color-ink-muted))] uppercase">
                  {t("judgment.detail.evidence")}
                </h2>
              </div>
              <div className="p-4">
                <pre className="bg-[hsl(var(--color-surface-2))] rounded p-4 text-xs font-mono text-[hsl(var(--color-ink))] overflow-auto max-h-64">
                  {JSON.stringify(judgment.evidence_json, null, 2)}
                </pre>
              </div>
            </div>
          )}

          {/* Confession */}
          {judgment.confession && (
            <div className="bg-[hsl(var(--color-surface-1))] rounded-lg border border-[hsl(var(--color-hairline))] overflow-hidden">
              <div className="px-5 py-3 border-b border-[hsl(var(--color-hairline))]">
                <h2 className="text-sm font-semibold text-[hsl(var(--color-ink-muted))] uppercase">
                  {t("judgment.detail.confession")}
                </h2>
              </div>
              <div className="p-5">
                <p className="text-sm text-[hsl(var(--color-ink))] italic leading-relaxed">
                  &ldquo;{judgment.confession}&rdquo;
                </p>
              </div>
            </div>
          )}

          {/* Empty state for evidence/confession */}
          {(!judgment.evidence_json || Object.keys(judgment.evidence_json).length === 0) && !judgment.confession && (
            <div className="bg-[hsl(var(--color-surface-1))] rounded-lg border border-[hsl(var(--color-hairline))] p-8 text-center">
              <p className="text-sm text-[hsl(var(--color-ink-subtle))]">
                {t("judgment.no_evidence")}
              </p>
            </div>
          )}

          {/* Conclude form (if not final) */}
          {!judgment.is_final && (
            <div className="bg-[hsl(var(--color-surface-1))] rounded-lg border border-[hsl(var(--color-hairline))] overflow-hidden">
              <div className="px-5 py-3 border-b border-[hsl(var(--color-hairline))]">
                <h2 className="text-sm font-semibold text-[hsl(var(--color-ink-muted))] uppercase">
                  {t("judgment.detail.render_verdict")}
                </h2>
              </div>
              <div className="p-5 space-y-4">
                {/* Verdict options as cards */}
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { key: "PASSED", label: t("judgment.verdicts.passed"), color: "border-amber-500/40 hover:bg-amber-500/10", activeColor: "border-amber-500 bg-amber-500/15 ring-1 ring-amber-500/30" },
                    { key: "FAILED", label: t("judgment.verdicts.failed"), color: "border-red-600/40 hover:bg-red-600/10", activeColor: "border-red-600 bg-red-600/15 ring-1 ring-red-600/30" },
                    { key: "PURGATORY", label: t("judgment.verdicts.purgatory"), color: "border-blue-500/40 hover:bg-blue-500/10", activeColor: "border-blue-500 bg-blue-500/15 ring-1 ring-blue-500/30" },
                    { key: "RETRY", label: t("judgment.verdicts.retry"), color: "border-purple-500/40 hover:bg-purple-500/10", activeColor: "border-purple-500 bg-purple-500/15 ring-1 ring-purple-500/30" },
                  ].map((opt) => (
                    <label
                      key={opt.key}
                      className={`flex items-center gap-3 p-3.5 rounded-lg border cursor-pointer transition-all ${
                        selectedVerdict === opt.key
                          ? opt.activeColor
                          : `border-[hsl(var(--color-hairline))] ${opt.color}`
                      }`}
                    >
                      <input
                        type="radio"
                        name="verdict"
                        value={opt.key}
                        checked={selectedVerdict === opt.key}
                        onChange={(e) => setSelectedVerdict(e.target.value)}
                        className="sr-only"
                      />
                      <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                        selectedVerdict === opt.key ? "border-current" : "border-[hsl(var(--color-ink-subtle))]"
                      }`}>
                        {selectedVerdict === opt.key && (
                          <span className="w-2 h-2 rounded-full bg-current" />
                        )}
                      </span>
                      <span className="text-sm font-medium text-[hsl(var(--color-ink))]">{opt.label}</span>
                    </label>
                  ))}
                </div>

                {/* Notes */}
                <div>
                  <label className="block text-sm text-[hsl(var(--color-ink-muted))] mb-2">
                    {t("judgment.detail.notes")}
                  </label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={4}
                    className="w-full bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded-lg p-3 text-sm text-[hsl(var(--color-ink))] placeholder:text-[hsl(var(--color-ink-subtle))] focus:outline-none focus:border-[hsl(var(--color-accent))]/50 resize-none"
                    placeholder={t("judgment.detail.notes_placeholder")}
                  />
                </div>

                {/* Submit */}
                <RequirePermission permissions="judgment.conclude">
                  <button
                    onClick={handleConclude}
                    disabled={concludeMutation.isPending || !selectedVerdict}
                    className="w-full py-2.5 px-4 bg-[hsl(var(--color-accent))] hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-all text-black"
                  >
                  {concludeMutation.isPending
                    ? t("judgment.detail.concluding")
                    : t("judgment.detail.conclude")}
                </button>
                </RequirePermission>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
