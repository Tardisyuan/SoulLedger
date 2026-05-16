"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation } from "@tanstack/react-query";
import { judgmentApi, soulsApi, type Soul } from "@/lib/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";

interface JudgmentDetail {
  id: string;
  soul: string;
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

const VERDICT_COLORS: Record<string, string> = {
  PASSED: "bg-amber-500/20 text-amber-400",
  FAILED: "bg-red-600/20 text-red-400",
  PURGATORY: "bg-blue-500/20 text-blue-400",
  RETRY: "bg-purple-500/20 text-purple-400",
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
      <div className="text-[hsl(var(--color-ink))] flex items-center justify-center py-12">
        <div className="text-[hsl(var(--color-ink-muted))]">{t("judgment.detail.loading")}</div>
      </div>
    );
  }

  if (error || !judgment) {
    return (
      <div className="text-[hsl(var(--color-ink))] flex flex-col items-center justify-center gap-4 py-12">
        <div className="text-red-400">{t("judgment.detail.not_found")}</div>
        <a href="/judgment" className="text-amber-400 hover:text-amber-300">
          {t("judgment.detail.back_to_list")}
        </a>
      </div>
    );
  }

  return (
    <div className="text-[hsl(var(--color-ink))]">
      {/* Page header */}
      <div className="h-12 flex items-center px-6 gap-4 border-b border-[hsl(var(--color-hairline))]/50">
        <a href="/judgment" className="text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-ink))] text-sm">
          ← {t("judgment.detail.back_to_list")}
        </a>
        <h1 className="text-lg font-bold text-[hsl(var(--color-accent))] flex-1">{t("judgment.title")}</h1>
        {judgment.is_final && (
          <span className="px-2 py-0.5 rounded text-xs font-bold bg-[hsl(var(--color-surface-3))] text-[hsl(var(--color-ink-muted))]">
            {t("judgment.detail.final")}
          </span>
        )}
        <div className="text-[hsl(var(--color-ink-muted))] text-sm">
          {new Date(judgment.created_at).toLocaleDateString()}
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        {/* Soul Info */}
        <div className="bg-[hsl(var(--color-surface-1))] rounded-lg p-5 border border-[hsl(var(--color-hairline))]">
          <h2 className="text-sm font-semibold text-[hsl(var(--color-ink-muted))] uppercase mb-3">
            {t("judgment.detail.soul_info")}
          </h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-[hsl(var(--color-ink-muted))]">{t("judgment.detail.soul_name")}</dt>
              <dd className="text-[hsl(var(--color-ink))] font-medium">{soulData?.name || judgment.soul}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[hsl(var(--color-ink-muted))]">{t("judgment.detail.civilization")}</dt>
              <dd className="text-[hsl(var(--color-ink))]">{judgment.civilization}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[hsl(var(--color-ink-muted))]">{t("judgment.detail.court")}</dt>
              <dd className="text-[hsl(var(--color-ink))]">{judgment.court}</dd>
            </div>
          </dl>
        </div>

        {/* Evidence */}
        {judgment.evidence_json && Object.keys(judgment.evidence_json).length > 0 && (
          <div className="bg-[hsl(var(--color-surface-1))] rounded-lg p-5 border border-[hsl(var(--color-hairline))]">
            <h2 className="text-sm font-semibold text-[hsl(var(--color-ink-muted))] uppercase mb-3">
              {t("judgment.detail.evidence")}
            </h2>
            <div className="bg-[hsl(var(--color-surface-2))] rounded p-3 text-sm font-mono text-[hsl(var(--color-ink))] overflow-auto">
              <pre>{JSON.stringify(judgment.evidence_json, null, 2)}</pre>
            </div>
          </div>
        )}

        {/* Confession */}
        {judgment.confession && (
          <div className="bg-[hsl(var(--color-surface-1))] rounded-lg p-5 border border-[hsl(var(--color-hairline))]">
            <h2 className="text-sm font-semibold text-[hsl(var(--color-ink-muted))] uppercase mb-3">
              {t("judgment.detail.confession")}
            </h2>
            <p className="text-sm text-[hsl(var(--color-ink))] italic">"{judgment.confession}"</p>
          </div>
        )}

        {/* Current Verdict (if final) */}
        {judgment.is_final && judgment.verdict && (
          <div className="bg-[hsl(var(--color-surface-1))] rounded-lg p-5 border border-[hsl(var(--color-hairline))]">
            <h2 className="text-sm font-semibold text-[hsl(var(--color-ink-muted))] uppercase mb-3">
              {t("judgment.detail.verdict")}
            </h2>
            <div className="flex items-center gap-3">
              <span
                className={`px-3 py-1.5 rounded text-sm font-bold ${
                  VERDICT_COLORS[judgment.verdict] || "bg-[hsl(var(--color-surface-3))] text-[hsl(var(--color-ink-muted))]"
                }`}
              >
                {judgment.verdict}
              </span>
              {judgment.concluded_at && (
                <span className="text-xs text-[hsl(var(--color-ink-muted))]">
                  {t("judgment.detail.concluded_at")}:{" "}
                  {new Date(judgment.concluded_at).toLocaleString()}
                </span>
              )}
            </div>
            {judgment.notes && (
              <div className="mt-3 pt-3 border-t border-[hsl(var(--color-hairline))]">
                <p className="text-sm text-[hsl(var(--color-ink-muted))]">"{t("judgment.detail.notes")}:"</p>
                <p className="text-sm text-[hsl(var(--color-ink))] mt-1">{judgment.notes}</p>
              </div>
            )}
          </div>
        )}

        {/* Conclude Form (if not final) */}
        {!judgment.is_final && (
          <div className="bg-[hsl(var(--color-surface-1))] rounded-lg p-5 border border-[hsl(var(--color-hairline))]">
            <h2 className="text-sm font-semibold text-[hsl(var(--color-ink-muted))] uppercase mb-3">
              {t("judgment.detail.render_verdict")}
            </h2>

            {/* Verdict Radio Buttons */}
            <div className="space-y-2 mb-4">
              {[
                { key: "PASSED", label: t("judgment.verdicts.passed"), color: "border-amber-500/50 hover:bg-amber-500/10" },
                { key: "FAILED", label: t("judgment.verdicts.failed"), color: "border-red-600/50 hover:bg-red-600/10" },
                { key: "PURGATORY", label: t("judgment.verdicts.purgatory"), color: "border-blue-500/50 hover:bg-blue-500/10" },
                { key: "RETRY", label: t("judgment.verdicts.retry"), color: "border-purple-500/50 hover:bg-purple-500/10" },
              ].map((opt) => (
                <label
                  key={opt.key}
                  className={`flex items-center gap-3 p-3 rounded border cursor-pointer transition-colors ${
                    selectedVerdict === opt.key
                      ? opt.color + " bg-opacity-20 border-2"
                      : "border-[hsl(var(--color-hairline))] hover:bg-[hsl(var(--color-surface-2))]"
                  }`}
                >
                  <input
                    type="radio"
                    name="verdict"
                    value={opt.key}
                    checked={selectedVerdict === opt.key}
                    onChange={(e) => setSelectedVerdict(e.target.value)}
                    className="accent-amber-500"
                  />
                  <span className="text-sm font-medium text-[hsl(var(--color-ink))]">{opt.label}</span>
                </label>
              ))}
            </div>

            {/* Notes Textarea */}
            <div className="mb-4">
              <label className="block text-sm text-[hsl(var(--color-ink-muted))] mb-2">
                {t("judgment.detail.notes")}
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={4}
                className="w-full bg-[hsl(var(--color-surface-2))] border border-[hsl(var(--color-hairline))] rounded p-3 text-sm text-[hsl(var(--color-ink))] placeholder:text-[hsl(var(--color-ink-subtle))] focus:outline-none focus:border-[hsl(var(--color-accent))]/50"
                placeholder={t("judgment.detail.notes_placeholder")}
              />
            </div>

            {/* Conclude Button */}
            <button
              onClick={handleConclude}
              disabled={concludeMutation.isPending}
              className="w-full py-2.5 px-4 bg-[hsl(var(--color-accent))] hover:bg-[hsl(var(--color-accent))] disabled:opacity-50 rounded-md text-sm font-medium transition-colors text-black"
            >
              {concludeMutation.isPending
                ? t("judgment.detail.concluding")
                : t("judgment.detail.conclude")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
