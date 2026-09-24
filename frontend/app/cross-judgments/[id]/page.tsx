"use client";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { crossTenantJudgmentsApi } from "@soulledger/core/api";
import { useTenant } from "@/src/contexts/TenantContext";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { Skeleton } from "@/components/ui/skeleton";
import { DomainEnum } from "@/src/components/ui/DomainValue";
import { PageShell } from "@/src/components/ui/PageShell";
import { Button } from "@/src/components/ui/Button";
import { badgeVariants, type BadgeTone } from "@/src/components/ui/Badge";
import { LedgerHeading } from "@/src/components/souls/detail/SoulLedgerSections";
import { CrossJudgmentStops } from "@/src/components/cross-judgments/CrossJudgmentStops";
import { CrossJudgmentSeatForm } from "@/src/components/cross-judgments/CrossJudgmentSeatForm";

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

/** 规范 v1 §1.2:状态 = 颜色 + 字形。未知状态给「?」。 */
const STATUS_GLYPH: Record<string, string> = {
  PROPOSED: "◐",
  ACTIVE: "▸",
  CONCLUDED: "■",
  CANCELLED: "×",
};

/** 结论的字形与字色,与灵魂详情「丙 · 审判」的判决同一套(✓ / ✕)。 */
const CONCLUSION_GLYPH: Record<string, string> = { PASS: "✓", FAIL: "✕" };

export default function CrossJudgmentDetailPage() {
  const { t } = useI18n();
  const { user } = useTenant();
  const params = useParams();
  const router = useRouter();
  const id = params.id;

  /**
   * ON THE QUERY CACHE, like the other two detail pages.
   *
   * This was `useState` + `useEffect` + a hand-written `loadData`, and it was
   * the last of the three detail routes still doing that. `app/souls/[id]`
   * carries a long note describing the same shape as a defect, and
   * `app/judgment/[id]` has been on `useQuery` since before either.
   *
   * WHAT THIS DOES NOT FIX, said plainly because the obvious reading is wrong.
   * It is tempting to write that the page could not hear WebSocket pushes.
   * It cannot, but nothing pushes: `lib/events/event_registry.ts`'s
   * `BACKEND_EVENT_TYPES` has no cross-tenant judgment event in it, and
   * nothing in the frontend invalidates `["cross-judgments"]`. So this domain
   * has no realtime to be cut off from, and calling this a realtime fix would
   * be a sentence nobody had checked.
   *
   * What it does buy: one cache entry the list route already shares, refetch
   * on mount and focus, an error state that does not need three `useState`s to
   * carry, and — the reason it is worth doing at all — a page that will hear
   * an invalidation on the day this domain gets one, instead of being the one
   * place that has to be remembered separately.
   *
   * The `t`-in-deps refetch this replaces was measured and documented as
   * bounded rather than a loop (1 GET at zh-Hans, 2 at en, 3 after a switch).
   * It is gone regardless: `t` is read at render now, not inside the fetch.
   */
  const {
    data: judgment,
    isPending: loading,
    error: loadError,
  } = useQuery({
    queryKey: ["cross-judgments", "detail", id],
    queryFn: () => crossTenantJudgmentsApi.get(id as string).then((res) => res.data),
    // `isPending` stays true while this is false, which is what the old
    // `useState(true)` did before the effect had a user to fetch for.
    enabled: !!user && !!id,
  });

  const error = loadError
    ? (loadError as { response?: { data?: { detail?: string } }; message?: string })?.response
        ?.data?.detail ||
      (loadError as { message?: string })?.message ||
      t("crossJudgments.failed_to_load")
    : "";

  /**
   * ACTIVATION IS A BUTTON, NOT A SIDE EFFECT (BD-06, 2026-09-12).
   *
   * The backend used to flip PROPOSED -> ACTIVE the moment the first
   * participant was seated, and then refused the second one — so a "joint"
   * judgment could hold one participant. Now the initiating tenant convenes
   * the bench explicitly. The button shows only when this tenant *can*: it
   * initiated the case, the case is still PROPOSED, and someone is seated —
   * the same three conditions the server enforces (403 / 400 otherwise), so
   * a visible button is one that will succeed.
   *
   * `initiating_tenant_code` against `user.tenant.code`: both are the tenant
   * code string, and the detail serializer carries the code precisely so a
   * client does not need the numeric id to answer "is this mine".
   */
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const activateMutation = useMutation({
    mutationFn: () => crossTenantJudgmentsApi.activate(id as string),
    onSuccess: () => {
      showToast(t("crossJudgments.activated_success"), "success");
      queryClient.invalidateQueries({ queryKey: ["cross-judgments"] });
    },
    onError: () => {
      showToast(t("crossJudgments.activate_error"), "error");
    },
  });
  const canActivate =
    !!judgment &&
    judgment.status === "PROPOSED" &&
    !!user?.tenant?.code &&
    user.tenant.code === judgment.initiating_tenant_code &&
    judgment.participants.length > 0;

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
      density="document" variant="page" title={t("crossJudgments.title")} backLink={backLink}>
        <p role="alert" className="text-sm text-[oklch(var(--color-danger))]">
          <span aria-hidden="true">! </span>
          {error}
        </p>
      </PageShell>
    );
  }

  return (
    <PageShell
      density="document"
      variant="page"
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
          <div className="flex items-center gap-3">
            {canActivate && (
              <Button
                size="sm"
                title={t("crossJudgments.activate_hint")}
                loading={activateMutation.isPending}
                onClick={() => activateMutation.mutate()}
              >
                {t("crossJudgments.activate")}
              </Button>
            )}
            <span className={badgeVariants({ tone: STATUS_TONES[judgment?.status ?? ""] ?? "neutral" })}>
              <span aria-hidden="true">{STATUS_GLYPH[judgment?.status ?? ""] ?? "?"}</span>
              <DomainEnum namespace="crossJudgments.states" value={judgment?.status} />
            </span>
          </div>
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

           `text-md` and full ink, matching the other three sites exactly. */}
      {loading ? (
        <Skeleton className="h-4 w-full mb-6" />
      ) : judgment?.description && (
        <blockquote className="max-w-[72ch] mb-2 pl-3 border-l-2 border-[oklch(var(--color-ink))] font-serif text-quote text-[oklch(var(--color-ink))] text-pretty">
          {judgment.description}
        </blockquote>
      )}

      {/* 规范 v1 详情页原型:两栏账页(393 px 折单栏),区块标压线,行线代替卡片。 */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.3fr] gap-x-10">
        <div className="min-w-0">
          <LedgerHeading
            mark="甲"
            title={t("crossJudgments.participants")}
            count={loading ? undefined : judgment?.participants.length}
          />
          {loading ? (
            <div className="space-y-2 pt-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : judgment?.participants && judgment.participants.length > 0 ? (
            <ul className="text-sm">
              {judgment.participants.map((p: import("@soulledger/core/api").CrossTenantJudgmentParticipant, i: number) => (
                <li
                  key={i}
                  className="grid grid-cols-[1fr_auto] gap-x-3 py-1.5 border-b border-[oklch(var(--color-rule))]"
                >
                  <span
                    title={p.participant_actor_name || p.participant_actor || undefined}
                    className="min-w-0 truncate font-medium text-[oklch(var(--color-ink))]"
                  >
                    {p.participant_actor_name || p.participant_actor}
                  </span>
                  {/* `DomainEnum`,不是裸成员。`p.role` 是
                      `ParticipantRole`(ADVISOR / CO_JUDGE / CHAIRMAN),而三份
                      bundle 里**一个 participant-role 键都没有** —— 页面上印的
                      一直是 SCREAMING_SNAKE 原样,正是 §4.6 要消除的那种。
                      键已补进 `crossJudgments.participant_roles`。 */}
                  <span className="text-xs text-[oklch(var(--color-ink-subtle))] flex items-center gap-1">
                    <span className="font-mono">{p.participant_tenant}</span>
                    {/* 中点,不是 em dash。em dash 是 §4.6 里「缺失值」的
                        专用字形,`domainDisplayContract` 会把它当成手写的缺失
                        标记报红 —— 而这里它只是两个存在的值之间的分隔符。 */}
                    <span aria-hidden="true">·</span>
                    <DomainEnum
                      namespace="crossJudgments.participant_roles"
                      value={p.role}
                    />
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-2 text-sm text-[oklch(var(--color-ink-muted))]">{t("crossJudgments.no_participants")}</p>
          )}

          {/* Conclusion (if concluded) */}
          {!loading && judgment?.status === "CONCLUDED" && (
            <section>
              <LedgerHeading mark="乙" title={t("crossJudgments.verdict")} />
              {/* `DomainEnum`, not the bare member. Twenty lines above, this same
                  file spends five lines arguing that `p.role` must not reach the
                  screen as SCREAMING_SNAKE — and then printed `PASS` / `FAIL`
                  verbatim at text-md bold, as the conclusion of a
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
              <p className={`py-2 text-md font-semibold ${
                judgment.conclusion_type === "PASS" ? "text-[oklch(var(--color-success))]" :
                judgment.conclusion_type === "FAIL" ? "text-[oklch(var(--color-danger))]" : "text-[oklch(var(--color-ink))]"
              }`}>
                <span aria-hidden="true">{CONCLUSION_GLYPH[judgment.conclusion_type ?? ""] ?? "?"} </span>
                <DomainEnum
                  namespace="crossJudgments.conclusion_types"
                  value={judgment.conclusion_type}
                />
              </p>
            </section>
          )}
        </div>

        <div className="min-w-0">
          {/* 发起方请各文明入席(PROPOSED;按租户代码,N3=(a) 带站 / 顾问不带)。 */}
          {!loading && judgment && <CrossJudgmentSeatForm judgment={judgment} />}

          {/* 挂了原审判的联审定下受刑计划的各站(docs/ARCHITECTURE-sentence-plan.md §2.1)。 */}
          {!loading && judgment?.judgment && <CrossJudgmentStops judgment={judgment} />}
        </div>
      </div>
    </PageShell>
  );
}
