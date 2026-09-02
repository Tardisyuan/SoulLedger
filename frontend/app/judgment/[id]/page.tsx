"use client";

import { use, useEffect, useId, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { judgmentApi, soulsApi } from "@soulledger/core/api";
import { judgmentKeys, soulKeys } from "@/lib/query_keys";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { DomainEnum, DomainText, IdentifierChip, MissingValue } from "@/src/components/ui/DomainValue";
import {
  JudgmentGroundsPanel,
  JudgmentSectionHead,
} from "@/src/components/judgment/JudgmentGroundsPanel";
import { JudgmentEvidenceColumn } from "@/src/components/judgment/JudgmentEvidenceColumn";
import { PageShell } from "@/src/components/ui/PageShell";
import { PageSpinner } from "@/src/components/ui/Spinner";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { QueryError } from "@/src/components/ui/PageError";
import { Button } from "@/src/components/ui/Button";
import { Badge } from "@/src/components/ui/Badge";
import { toHanNumeral } from "@soulledger/core/config/civilizationSigil";

/**
 * 判决书 —— the judgment detail page.
 *
 * This page is the product's climax and rendered as a generic settings form:
 * the four verdicts were a `grid-cols-2` of radio cards painted
 * `border-amber-500/40` / `border-red-600/40` / `border-blue-500/40` /
 * `border-purple-500/40`, the confession was `<p className="italic">` in a pair
 * of quotes, and the evidence was `JSON.stringify` in a `<pre>`.
 *
 * ── THE FOUR VERDICT TOKENS, AND WHY THE PALETTE WAS A DEFECT ─────────────
 * `app/globals.css` says on the block that declares
 * `--color-verdict-{passed,failed,purgatory,retry}` why each value is what it
 * is: passed is GREEN and not the accent amber "so a passed verdict stops
 * rendering in the same colour as every button", and retry moved from 270° to
 * 330° because 270° sat 15° from `--color-status-disposed`. The radio cards
 * broke both at once — `amber-500` put PASSED back on the button colour and
 * `purple-500` put RETRY back beside DISPOSED — and being raw Tailwind they
 * did not follow the theme either. Every verdict colour here is now the token.
 *
 * ── STRUCTURE: 案号 / 主文 / 事实 / 理由 / 附引条文 ─────────────────────────
 * The four verdicts are not a radio group; they are the MAIN CLAUSE of a
 * judgment, so they are four numbered clauses (一 / 二 / 三 / 四) and the
 * ordered one carries a 3px seal rule. The other three stay fully legible: a
 * verdict is compared against the ones not given, and folding them away would
 * have the page assert only one was ever available.
 *
 * ── WHAT THE DESIGN ASKED FOR AND THE PAYLOAD CANNOT PROVIDE ──────────────
 * Written down rather than invented — a judgment printing a number nobody
 * recorded is the exact failure this codebase keeps finding:
 *   * A CASE NUMBER (`JDG-0042`). `JudgmentSerializer` has no such field; the
 *     identity is a UUID, and `JDG-` + a slice of it would be a case number
 *     that looks issued and was not. So this page's title is the SOUL'S NAME
 *     and the id sits once in the header sub-line, copyable — which is what
 *     all four clauses of IDENTIFIER_POLICY ask for anyway.
 *   * 刑期 (a sentence term) and 会审比数 (a panel vote). No fields.
 *   * 去向 — the realm a verdict routes to. Real, but not on this endpoint:
 *     `judgment.queue.realm_options_hint` says the realm is routed from the
 *     verdict, and the options ride only on `/judgment/next/`. A clause row
 *     carries no destination rather than one filled from a second request.
 *   * 中文名 beside the verdict name, and a gloss per verdict. The bundles
 *     carry one label per member and this pass may not add keys.
 */

type VerdictMember = "PASSED" | "FAILED" | "PURGATORY" | "RETRY";

/** The main clauses, in order: the two that end the matter, the one that
 *  suspends it, the one that sends it back. */
const VERDICTS: readonly VerdictMember[] = ["PASSED", "FAILED", "PURGATORY", "RETRY"];

/**
 * Verdict → ink. `--color-verdict-*`, never `--color-status-*`: the two alias
 * to identical triples today and are separate layers on purpose, which is what
 * `src/__tests__/statusTokenLayering.test.ts` keeps visible.
 */
const VERDICT_INK: Record<VerdictMember, string> = {
  PASSED: "text-[hsl(var(--color-verdict-passed))]",
  FAILED: "text-[hsl(var(--color-verdict-failed))]",
  PURGATORY: "text-[hsl(var(--color-verdict-purgatory))]",
  RETRY: "text-[hsl(var(--color-verdict-retry))]",
};

/** The clause rule. Only a row's LEFT edge has width, so all-sides is safe. */
const VERDICT_EDGE: Record<VerdictMember, string> = {
  PASSED: "border-[hsl(var(--color-verdict-passed))]",
  FAILED: "border-[hsl(var(--color-verdict-failed))]",
  PURGATORY: "border-[hsl(var(--color-verdict-purgatory))]",
  RETRY: "border-[hsl(var(--color-verdict-retry))]",
};

/**
 * The band's top edge, per-side rather than reusing `VERDICT_EDGE`: the band
 * has TWO live borders (3px above, 1px below) and an all-sides `border-color`
 * would paint the bottom one too, leaving the winner to the order Tailwind
 * happens to emit `border-{color}` and `border-b-{color}` in.
 */
const VERDICT_SEAL: Record<VerdictMember, string> = {
  PASSED: "border-t-[hsl(var(--color-verdict-passed))]",
  FAILED: "border-t-[hsl(var(--color-verdict-failed))]",
  PURGATORY: "border-t-[hsl(var(--color-verdict-purgatory))]",
  RETRY: "border-t-[hsl(var(--color-verdict-retry))]",
};

/**
 * THE SEAL BAND'S BOX, and the whole reason it is a constant.
 *
 * The band must not change height when a verdict lands: a page that reflows at
 * the moment of judgment moves everything below it under the reader's eye.
 * `h-[124px]` is a FIXED height, not a minimum, so no content can grow it —
 * 56px (text-08 at line-height 1) + 8 + 18px (text-02 at 1.5) = 82px of content
 * against 124 − 32 (py-4) − 4 (borders, border-box) = 88px of room; the pending
 * state puts one 16px line in the same box. `border-t-3` over `border-b` reads
 * as a stamp pressed DOWN, heavy edge first. Only the top border's COLOUR
 * varies between the two states — every class in the box model is in this one
 * string, so the states cannot drift apart in height without it changing.
 */
const SEAL_BAND = "h-[124px] flex items-center gap-6 border-t-3 border-b border-b-hairline";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function JudgmentDetailPage({ params }: PageProps) {
  const { id } = use(params);
  const router = useRouter();
  const { t, formatDate, formatDateTime } = useI18n();
  const { showToast } = useToast();
  const [selectedVerdict, setSelectedVerdict] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [createWorkflow, setCreateWorkflow] = useState(false);
  const createWorkflowId = useId();
  const notesId = useId();
  const clausesId = useId();
  const firstClauseRef = useRef<HTMLInputElement>(null);

  // Both keys come from the factories. They were `["judgment", id]` and
  // `["soul", judgment?.soul]` — singular, so they diverged from
  // `judgmentKeys.detail` / `soulKeys.detail` at the FIRST segment and no
  // invalidation could ever reach them. The soul one is the visible loss: the
  // WS soul handler invalidates `soulKeys.all`, which prefix-matches
  // `["souls","detail",id]` and matched nothing at `["soul", id]`, so a state
  // change pushed while a judge had this page open left the soul panel stale.
  const { data: judgment, isLoading, error, refetch } = useQuery({
    queryKey: judgmentKeys.detail(id),
    queryFn: () => judgmentApi.get(id).then((res) => res.data),
  });

  const { data: soulData } = useQuery({
    // `?? ""` never runs a request: `enabled` gates it on the same value.
    queryKey: soulKeys.detail(judgment?.soul ?? ""),
    queryFn: () => soulsApi.get(judgment!.soul).then((res) => res.data),
    enabled: !!judgment?.soul,
  });

  const concludeMutation = useMutation({
    mutationFn: (payload: { verdict: string; notes: string; create_workflow: boolean }) =>
      judgmentApi.conclude(id, payload),
    onSuccess: () => {
      showToast(t("judgment.detail.conclude_success"), "success");
      router.push("/judgment");
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { error?: string } } };
      showToast(e?.response?.data?.error || t("judgment.detail.conclude_error"), "error");
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
    concludeMutation.mutate({ verdict: selectedVerdict, notes, create_workflow: createWorkflow });
  }

  /* A known route, so a link and not a router.back() button. */
  const backLink = (
    <Link
      href="/judgment"
      className="text-02 text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-ink))] transition-colors"
    >
      {t("judgment.detail.back_to_list")}
    </Link>
  );

  if (isLoading) {
    return <PageSpinner label={t("judgment.detail.loading")} />;
  }

  // `error` used to be OR'd into the not-found branch, so a 500 or a
  // cross-tenant 403 rendered "审判未找到" — a sentence that says the record
  // does not exist, about a record that may well exist and simply could not be
  // fetched. Retry is the useful offer for the first case and misleading for
  // the second, which is why they are two branches.
  if (error) {
    return (
      <PageShell
      density="document" variant="page" title={t("judgment.title")} backLink={backLink}>
        <QueryError onRetry={() => refetch()} />
      </PageShell>
    );
  }

  if (!judgment) {
    return (
      <PageShell
      density="document" variant="page" title={t("judgment.title")} backLink={backLink}>
        <EmptyState
          title={t("judgment.detail.not_found")}
          action={
            <Link href="/judgment" className="text-03 text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-ink))] transition-colors">
              {t("common.back_to_list")}
            </Link>
          }
        />
      </PageShell>
    );
  }

  const isFinal = judgment.is_final;
  const ordered = (judgment.verdict ?? "") as VerdictMember | "";
  const soulName = soulData?.name || judgment.soul_name;

  /**
   * Hoisted out of the JSX on purpose, and not for tidiness.
   *
   * §4.6's contract rule looks for the nearest `title=` above an enum render,
   * and PageShell's own `title` prop sits a line or two from anything put in
   * `eyebrow` / `subtitle` / `actions`. An enum rendered inline in a shell slot
   * can therefore be read against `title={t("…")}` — a translation, which is
   * exactly the "title that says nothing" the rule rejects. Naming the node
   * first puts distance between the two and leaves the assertion at full
   * strength; weakening a guard to fit a layout is the wrong trade.
   */
  const eyebrow = (
    <span className="inline-flex items-center gap-3">
      {t("judgment.title")}
      {/* IDENTIFIER_POLICY, all four clauses: the entity this page is about,
          once, in the header sub-line, after the human name, and copyable. */}
      <IdentifierChip id={judgment.id} variant="inline" />
    </span>
  );

  const civilisation = (
    <DomainEnum namespace="souls.civilizations" value={judgment.civilization} />
  );

  const subtitle = (
    <span className="inline-flex flex-wrap items-center gap-2">
      {civilisation}
      <span aria-hidden="true" className="text-[hsl(var(--color-ink-tertiary))]">·</span>
      <span className="font-mono tabular-nums">{formatDate(judgment.created_at)}</span>
    </span>
  );

  return (
    <PageShell
      density="document"
      variant="page"
      backLink={backLink}
      eyebrow={eyebrow}
      /* Clause 4: the id never substitutes for a name — a judgment with no
         recorded soul name reads as unrecorded, not as its primary key. */
      title={<DomainText value={soulName} />}
      subtitle={subtitle}
    >
      {/* ── 落印带 · one element, one box, two states. See SEAL_BAND. ────── */}
      <div
        data-seal-band=""
        data-sealed={isFinal ? "true" : "false"}
        className={`${SEAL_BAND} ${
          isFinal && ordered ? VERDICT_SEAL[ordered] : "border-t-hairline-strong"
        }`}
      >
        {isFinal && ordered ? (
          <>
            <div className="min-w-0 flex-1">
              <p className={`text-08 ${VERDICT_INK[ordered]}`}>
                <DomainEnum namespace="judgment.verdicts" value={judgment.verdict} />
              </p>
              {/* 主审 · 结案时间. 印记 / 会审比数 have no fields — file header. */}
              <p className="text-02 font-mono text-[hsl(var(--color-ink-subtle))] mt-2 truncate">
                <DomainText value={judgment.judge_name} />
                <span aria-hidden="true" className="mx-2 text-[hsl(var(--color-ink-tertiary))]">·</span>
                {judgment.concluded_at ? (
                  <span className="tabular-nums">{formatDateTime(judgment.concluded_at)}</span>
                ) : (
                  <MissingValue kind="unrecorded" />
                )}
              </p>
            </div>
            <Badge tone="neutral" className="shrink-0">
              {t("judgment.detail.final")}
            </Badge>
          </>
        ) : (
          <>
            <p className="text-01 uppercase text-[hsl(var(--color-ink-subtle))] flex-1">{t("judgment.pending")}</p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="shrink-0"
              onClick={() => firstClauseRef.current?.focus()}
            >
              {t("judgment.detail.render_verdict")}
            </Button>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-10 mt-10 lg:grid-cols-[1fr_340px]">
        {/* ── 主文 ──────────────────────────────────────────────────────── */}
        <section className="min-w-0">
          <JudgmentSectionHead id={clausesId} title={t("judgment.detail.verdict")} />

          {/* `ml-[-3px]` hangs the seal rule outside the text column instead of
              indenting the clause carrying it; every row reserves the same 3px
              transparent border, so marking one moves nothing. `role="group"`
              only while the clauses are choosable — four radios sharing a
              `name` are a group to the browser but nothing names that group;
              on a decided case there is nothing to choose. */}
          <ol
            className="ml-[-3px] mt-4 divide-y divide-[hsl(var(--color-hairline))]"
            {...(isFinal ? {} : { role: "group", "aria-labelledby": clausesId })}
          >
            {VERDICTS.map((member, index) => {
              const isOrdered = ordered === member;
              const isChosen = selectedVerdict === member;
              const marked = isFinal ? isOrdered : isChosen;
              const clause = (
                <>
                  <span className="font-mono tabular-nums text-02 text-[hsl(var(--color-ink-tertiary))]">
                    {toHanNumeral(index + 1)}
                  </span>
                  <span className={`text-05 ${marked ? VERDICT_INK[member] : "text-[hsl(var(--color-ink))]"}`}>
                    <DomainEnum namespace="judgment.verdicts" value={member} />
                  </span>
                </>
              );
              const row = `grid grid-cols-[44px_1fr] items-center gap-3 border-l-3 py-3 pl-3 ${
                marked ? VERDICT_EDGE[member] : "border-transparent"
              }`;

              return (
                <li key={member}>
                  {isFinal ? (
                    <div className={row} aria-current={isOrdered ? "true" : undefined}>
                      {clause}
                    </div>
                  ) : (
                    /* The radio is `sr-only`, so the global `:focus-visible`
                       outline lands on a 1px clipped box nobody sees. The label
                       carries the ring instead, on the same `--color-focus`
                       token globals.css:459 uses. Selection is never
                       colour-only either: the 3px rule is there or it is not. */
                    <label
                      className={`${row} cursor-pointer hover:bg-[hsl(var(--color-surface-2))] focus-within:outline-solid focus-within:outline-2 focus-within:outline-[hsl(var(--color-focus))]`}
                    >
                      <input
                        ref={index === 0 ? firstClauseRef : undefined}
                        type="radio"
                        name="verdict"
                        value={member}
                        checked={isChosen}
                        onChange={(event) => setSelectedVerdict(event.target.value)}
                        className="sr-only"
                      />
                      {clause}
                    </label>
                  )}
                </li>
              );
            })}
          </ol>
        </section>

        {/* ── 元信息表 ───────────────────────────────────────────────────── */}
        <aside className="min-w-0">
          <JudgmentSectionHead title={t("judgment.detail.soul_info")} />
          <dl className="mt-4 divide-y divide-[hsl(var(--color-hairline))]">
            <MetaRow label={t("judgment.detail.soul_name")}>
              <DomainText value={soulName} />
            </MetaRow>
            <MetaRow label={t("judgment.detail.civilization")}>{civilisation}</MetaRow>
            <MetaRow label={t("judgment.detail.court")}>
              <DomainText value={judgment.court} />
            </MetaRow>
            <MetaRow label={t("judgment.created")}>
              <span className="font-mono tabular-nums">{formatDate(judgment.created_at)}</span>
            </MetaRow>
            <MetaRow label={t("judgment.detail.concluded_at")}>
              {judgment.concluded_at ? (
                <span className="font-mono tabular-nums">{formatDateTime(judgment.concluded_at)}</span>
              ) : (
                <MissingValue kind="unrecorded" />
              )}
            </MetaRow>
          </dl>
        </aside>
      </div>

      {/* ── 事实 | 理由 ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-10 mt-10 md:grid-cols-2">
        <JudgmentEvidenceColumn evidence={judgment.evidence_json} />

        <section className="min-w-0">
          <JudgmentSectionHead title={t("judgment.detail.confession")} />

          {/* SERIF = WORDS SOMEONE SAID; SANS = WORDS THE COURT WROTE. That
              contrast replaces the `italic` + curly quotes this paragraph used
              to carry: a confession in italic reads as an aside, and italic is
              then unavailable for what italic is for. */}
          {judgment.confession ? (
            <p className="font-serif text-05 text-[hsl(var(--color-ink))] mt-4">{judgment.confession}</p>
          ) : (
            <p className="text-04 text-[hsl(var(--color-ink-subtle))] mt-4">
              <MissingValue kind="unrecorded" />
            </p>
          )}

          <div className="mt-10">
            <JudgmentSectionHead title={t("judgment.detail.notes")} />
          </div>

          {isFinal ? (
            /* The bench's own sentence, so sans — the other half of the rule. */
            judgment.notes ? (
              <p className="font-sans text-04 text-[hsl(var(--color-ink))] mt-4">{judgment.notes}</p>
            ) : (
              <p className="text-04 text-[hsl(var(--color-ink-subtle))] mt-4">
                <MissingValue kind="unrecorded" />
              </p>
            )
          ) : (
            <>
              <label htmlFor={notesId} className="sr-only">
                {t("judgment.detail.notes")}
              </label>
              <textarea
                id={notesId}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={5}
                placeholder={t("judgment.detail.notes_placeholder")}
                className="block w-full mt-4 border border-[hsl(var(--color-hairline))] bg-[hsl(var(--color-surface-1))] px-3 py-2 font-sans text-04 text-[hsl(var(--color-ink))] placeholder:text-[hsl(var(--color-ink-subtle))] transition-[border-color] duration-state focus-visible:border-[hsl(var(--color-accent))] resize-y"
              />
            </>
          )}
        </section>
      </div>

      {/* ── 附引条文 ─────────────────────────────────────────────────────── */}
      {/* Shown once the case is decided — INCLUDING when it cited nothing,
          which is the informative case: a concluded verdict with no stated
          basis is a fact to show, not a box to hide. On an open case, only
          once grounds exist, so a pending proceeding grows no empty panel. */}
      {(isFinal || (judgment.citations?.length ?? 0) > 0) && (
        <JudgmentGroundsPanel citations={judgment.citations ?? []} />
      )}

      {/* ── 结案 ─────────────────────────────────────────────────────────── */}
      {!isFinal && (
        <div className="mt-10 border-t-2 border-[hsl(var(--color-ink-subtle))] pt-6 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex items-start gap-2 min-w-0">
            <input
              id={createWorkflowId}
              type="checkbox"
              checked={createWorkflow}
              onChange={(event) => setCreateWorkflow(event.target.checked)}
              className="mt-1 h-4 w-4 shrink-0 accent-[hsl(var(--color-accent))]"
            />
            <label htmlFor={createWorkflowId} className="cursor-pointer min-w-0">
              <span className="text-03 text-[hsl(var(--color-ink))] block">{t("judgment.detail.create_workflow")}</span>
              <span className="text-02 text-[hsl(var(--color-ink-subtle))] block mt-1 max-w-prose">
                {t("judgment.detail.create_workflow_hint")}
              </span>
            </label>
          </div>

          <RequirePermission permissions="judgment.execute">
            <Button
              type="button"
              variant="primary"
              size="lg"
              className="shrink-0"
              onClick={handleConclude}
              loading={concludeMutation.isPending}
              disabled={!selectedVerdict}
            >
              {concludeMutation.isPending
                ? t("judgment.detail.concluding")
                : t("judgment.detail.conclude")}
            </Button>
          </RequirePermission>
        </div>
      )}
    </PageShell>
  );
}

/** `76px 标签 | 值`, one hairline apart. */
function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[76px_1fr] items-baseline gap-3 py-2">
      <dt className="text-01 uppercase text-[hsl(var(--color-ink-subtle))]">{label}</dt>
      <dd className="text-03 text-[hsl(var(--color-ink))] min-w-0 wrap-break-word">{children}</dd>
    </div>
  );
}

