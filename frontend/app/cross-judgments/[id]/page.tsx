"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { crossTenantJudgmentsApi } from "@/lib/api";
import { useTenant } from "@/src/contexts/TenantContext";
import { useI18n } from "@/src/contexts/I18nContext";
import { Skeleton } from "@/src/components/ui/skeleton";

export default function CrossJudgmentDetailPage() {
  const { t } = useI18n();
  const { user } = useTenant();
  const params = useParams();
  const router = useRouter();
  const id = params.id;

  const [judgment, setJudgment] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user || !id) return;
    loadData();
  }, [user, id]);

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const res = await crossTenantJudgmentsApi.get(id as string);
      setJudgment(res.data);
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  if (error && !judgment) {
    return (
      <div className="p-6">
        <button
          onClick={() => router.back()}
          className="mb-4 text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-accent))] text-sm"
        >
          ← Back
        </button>
        <div className="text-red-400">{error}</div>
      </div>
    );
  }

  const statusColors: Record<string, string> = {
    PROPOSED: "bg-yellow-500/20 text-yellow-400",
    ACTIVE: "bg-blue-500/20 text-blue-400",
    CONCLUDED: "bg-green-500/20 text-green-400",
    CANCELLED: "bg-gray-500/20 text-gray-400",
  };

  return (
    <div className="p-6">
      <button
        onClick={() => router.back()}
        className="mb-4 text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-accent))] text-sm"
      >
        ← Back
      </button>

      <div className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] rounded-lg p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            {loading ? (
              <>
                <Skeleton className="h-8 w-64 mb-2" />
                <Skeleton className="h-4 w-32" />
              </>
            ) : (
              <>
                <h1 className="text-2xl font-bold text-[hsl(var(--color-ink))]">{judgment?.title}</h1>
                <p className="text-[hsl(var(--color-ink-subtle))] mt-1">
                  Initiated by: {judgment?.initiating_tenant}
                </p>
              </>
            )}
          </div>
          {loading ? (
            <Skeleton className="h-6 w-20" />
          ) : (
            <span className={`px-3 py-1 rounded text-sm font-medium ${statusColors[judgment?.status] || "bg-gray-500/20"}`}>
              {judgment?.status}
            </span>
          )}
        </div>

        {loading ? (
          <Skeleton className="h-4 w-full mb-6" />
        ) : judgment?.description && (
          <p className="text-[hsl(var(--color-ink-muted))] mb-6">{judgment.description}</p>
        )}

        {/* Participants */}
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-[hsl(var(--color-ink))] mb-3">Participants</h2>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : judgment?.participants && judgment.participants.length > 0 ? (
            <div className="space-y-2">
              {judgment.participants.map((p: any, i: number) => (
                <div key={i} className="flex items-center gap-3 bg-[hsl(var(--color-surface-2))] rounded-lg px-4 py-2">
                  <span className="text-lg">👤</span>
                  <div>
                    <p className="font-medium text-[hsl(var(--color-ink))]">{p.participant_actor_name || p.participant_actor}</p>
                    <p className="text-xs text-[hsl(var(--color-ink-subtle))]">
                      {p.participant_tenant} — {p.role}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[hsl(var(--color-ink-muted))]">No participants yet</p>
          )}
        </div>

        {/* Conclusion (if concluded) */}
        {!loading && judgment?.status === "CONCLUDED" && (
          <div className="bg-[hsl(var(--color-surface-2))] rounded-lg p-4">
            <h2 className="text-lg font-semibold text-[hsl(var(--color-ink))] mb-2">Verdict</h2>
            <p className={`text-lg font-bold ${
              judgment.conclusion_type === "PASS" ? "text-green-400" :
              judgment.conclusion_type === "FAIL" ? "text-red-400" : "text-[hsl(var(--color-ink))]"
            }`}>
              {judgment.conclusion_type}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
