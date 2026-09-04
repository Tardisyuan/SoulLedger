"use client";
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { crossTenantJudgmentsApi } from "@soulledger/core/api";
import { useTenant } from "@/src/contexts/TenantContext";
import { useI18n } from "@/src/contexts/I18nContext";
import { Skeleton } from "@/components/ui/skeleton";
import { DomainEnum } from "@/src/components/ui/DomainValue";
import { PageShell } from "@/src/components/ui/PageShell";
import { Button } from "@/src/components/ui/Button";
import { badgeVariants, type BadgeTone } from "@/src/components/ui/Badge";
import { User } from "lucide-react";

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

  const [judgment, setJudgment] = useState<import("@soulledger/core/api").CrossTenantJudgment | null>(null);
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
    // `t` is used for the last-resort error copy above. Including it means the
    // effect below re-runs — i.e. re-fetches — when `t` changes identity, and
    // that is bounded rather than open-ended: I18nContext memoises `t` on
    // `[locale, loadedBundles]`, so it moves once when a non-default locale's
    // lazy bundle arrives and once per language switch. Measured on this page
    // with the real I18nProvider: 1 GET at zh-Hans, 2 at en (mount + bundle),
    // 3 at en after one switch to zh-Hans. Not a loop.
  }, [id, t]);

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
      <PageShell
      density="document" variant="prose" title={t("crossJudgments.title")} backLink={backLink}>
        <p className="text-04 text-[hsl(var(--color-status-error))]">{error}</p>
      </PageShell>
    );
  }

  return (
    <PageShell
      density="document"
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
        {/* THE FOURTH SERIF SITE. `app/fonts.ts` states the rule — Source Serif 4
           appears only on things a person said, and names four: the classical
           corpus, the confession, the grounds of a judgment, **and the joint
           opinion of a cross-civilization tribunal**. Measured 2026-09-02, the
           app had three. This page — whose entire subject is four cosmologies
           reasoning in prose — carried none, and set the opinion at
           `text-ink-muted`, the weight of a subtitle.

           `text-05` and full ink, matching the other three sites exactly. */}
      {loading ? (
        <Skeleton className="h-4 w-full mb-6" />
      ) : judgment?.description && (
        <p className="font-serif text-05 text-[hsl(var(--color-ink))] mb-6">{judgment.description}</p>
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
            {judgment.participants.map((p: import("@soulledger/core/api").CrossTenantJudgmentParticipant, i: number) => (
              <div key={i} className="flex items-center gap-3 bg-[hsl(var(--color-surface-2))] px-4 py-2">
                <User aria-hidden="true" className="w-5 h-5 text-[hsl(var(--color-ink-subtle))] shrink-0" />
                <div>
                  <p className="text-04 font-medium text-[hsl(var(--color-ink))]">{p.participant_actor_name || p.participant_actor}</p>
                  {/* `DomainEnum`,不是裸成员。`p.role` 是
                      `ParticipantRole`(ADVISOR / CO_JUDGE / CHAIRMAN),而三份
                      bundle 里**一个 participant-role 键都没有** —— 页面上印的
                      一直是 SCREAMING_SNAKE 原样,正是 §4.6 要消除的那种。
                      键已补进 `crossJudgments.participant_roles`。 */}
                  <p className="text-02 text-[hsl(var(--color-ink-subtle))] flex items-center gap-1">
                    <span>{p.participant_tenant}</span>
                    {/* 中点,不是 em dash。em dash 是 §4.6 里「缺失值」的
                        专用字形,`domainDisplayContract` 会把它当成手写的缺失
                        标记报红 —— 而这里它只是两个存在的值之间的分隔符。 */}
                    <span aria-hidden="true">·</span>
                    <DomainEnum
                      namespace="crossJudgments.participant_roles"
                      value={p.role}
                    />
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
          {/* `DomainEnum`, not the bare member. Twenty lines above, this same
              file spends five lines arguing that `p.role` must not reach the
              screen as SCREAMING_SNAKE — and then printed `PASS` / `FAIL`
              verbatim at text-06 bold, as the conclusion of a
              cross-civilization tribunal. It was the largest text on the panel
              and the only untranslated string on the page.
              `crossJudgments.conclusion_types` now carries both members in all
              three bundles; the raw value stays reachable in `title`.

              The model's own field is a bare `CharField(null=True)` whose
              help_text reads "PASS or FAIL" — the choices live only in the
              serializer — so an unrecognised member is genuinely possible.
              `DomainEnum` renders that italic with the raw value in `title`,
              and renders nothing-recorded as `MissingValue`; the old ternary
              silently painted both cases as ordinary ink. */}
          <p className={`text-06 font-bold ${
            judgment.conclusion_type === "PASS" ? "text-[hsl(var(--color-status-success))]" :
            judgment.conclusion_type === "FAIL" ? "text-[hsl(var(--color-status-error))]" : "text-[hsl(var(--color-ink))]"
          }`}>
            <DomainEnum
              namespace="crossJudgments.conclusion_types"
              value={judgment.conclusion_type}
            />
          </p>
        </div>
      )}
    </PageShell>
  );
}
