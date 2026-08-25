"use client";
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { crossTenantJudgmentsApi } from "@/lib/api";
import { useTenant } from "@/src/contexts/TenantContext";
import { useI18n } from "@/src/contexts/I18nContext";
import { Skeleton } from "@/components/ui/skeleton";
import { DomainEnum } from "@/src/components/ui/DomainValue";
import { PageShell } from "@/src/components/ui/PageShell";
import { Button } from "@/src/components/ui/Button";
import { badgeVariants, type BadgeTone } from "@/src/components/ui/Badge";

/**
 * Case state → badge tone, the same table the list page carries.
 *
 * Restated rather than imported for the reason `Badge` restates
 * `ENUM_TONE_CLASSES`: an import here would make a detail route depend on a
 * list route's module, which is an edge nobody wants to keep pointing the
 * right way. It is a tone map and not a token map so that
 * `src/__tests__/statusTokenLayering.test.ts` keeps reading a domain
 * enumeration as a domain enumeration — see the note on the list page.
 */
const STATUS_TONES: Record<string, BadgeTone> = {
  PROPOSED: "warning",
  ACTIVE: "info",
  CONCLUDED: "success",
  CANCELLED: "neutral",
};

export default function CrossJudgmentDetailPage() {
  const { t } = useI18n();
  const { user } = useTenant();
  const params = useParams();
  const router = useRouter();
  const id = params.id;

  const [judgment, setJudgment] = useState<import("@/lib/api").CrossTenantJudgment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await crossTenantJudgmentsApi.get(id as string);
      setJudgment(res.data);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } }; message?: string };
      setError(err?.response?.data?.detail || err?.message || t("crossJudgments.failed_to_load"));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!user || !id) return;
    loadData();
  }, [user, id, loadData]);

  /* The back control is a <Button variant="ghost">, not a bare `←`: it calls
     router.back() rather than navigating to a known route, so it is a control
     and not a link, and PageShell's own note asks for one of the two. */
  const backLink = (
    <Button variant="ghost" size="sm" onClick={() => router.back()}>
      {t("common.back")}
    </Button>
  );

  if (error && !judgment) {
    return (
      <PageShell variant="prose" title={t("crossJudgments.title")} backLink={backLink}>
        <p className="text-04 text-[hsl(var(--color-status-error))]">{error}</p>
      </PageShell>
    );
  }

  return (
    <PageShell
      variant="prose"
      backLink={backLink}
      title={loading ? <Skeleton className="h-8 w-64" /> : judgment?.title}
      subtitle={
        loading ? (
          <Skeleton className="h-4 w-32" />
        ) : (
          <>
            {t("crossJudgments.initiated_by")}: {judgment?.initiating_tenant}
          </>
        )
      }
      actions={
        loading ? (
          <Skeleton className="h-6 w-20" />
        ) : (
          <DomainEnum
            namespace="crossJudgments.states"
            value={judgment?.status}
            className={badgeVariants({ tone: STATUS_TONES[judgment?.status ?? ""] ?? "neutral" })}
          />
        )
      }
    >
      {loading ? (
        <Skeleton className="h-4 w-full mb-6" />
      ) : judgment?.description && (
        <p className="text-04 text-[hsl(var(--color-ink-muted))] mb-6">{judgment.description}</p>
      )}

      {/* Participants */}
      <div className="mb-6">
        <h2 className="text-06 font-semibold text-[hsl(var(--color-ink))] mb-3">{t("crossJudgments.participants")}</h2>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : judgment?.participants && judgment.participants.length > 0 ? (
          <div className="space-y-2">
            {judgment.participants.map((p: import("@/lib/api").CrossTenantJudgmentParticipant, i: number) => (
              <div key={i} className="flex items-center gap-3 bg-[hsl(var(--color-surface-2))] px-4 py-2">
                <span className="text-05" aria-hidden="true">👤</span>
                <div>
                  <p className="text-04 font-medium text-[hsl(var(--color-ink))]">{p.participant_actor_name || p.participant_actor}</p>
                  <p className="text-02 text-[hsl(var(--color-ink-subtle))]">
                    {p.participant_tenant} — {p.role}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-04 text-[hsl(var(--color-ink-muted))]">{t("crossJudgments.no_participants")}</p>
        )}
      </div>

      {/* Conclusion (if concluded) */}
      {!loading && judgment?.status === "CONCLUDED" && (
        <div className="bg-[hsl(var(--color-surface-2))] p-4">
          <h2 className="text-06 font-semibold text-[hsl(var(--color-ink))] mb-2">{t("crossJudgments.verdict")}</h2>
          <p className={`text-06 font-bold ${
            judgment.conclusion_type === "PASS" ? "text-[hsl(var(--color-status-success))]" :
            judgment.conclusion_type === "FAIL" ? "text-[hsl(var(--color-status-error))]" : "text-[hsl(var(--color-ink))]"
          }`}>
            {judgment.conclusion_type}
          </p>
        </div>
      )}
    </PageShell>
  );
}
