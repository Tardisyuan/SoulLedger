"use client";

import { use, useEffect, useId, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { judgmentApi, soulsApi } from "@soulledger/core/api";
import { judgmentKeys, soulKeys } from "@soulledger/core/query_keys";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { DomainEnum, DomainText, IdentifierChip, MissingValue } from "@/src/components/ui/DomainValue";
import {
  JudgmentGroundsPanel,
  JudgmentSectionHead,
} from "@/src/components/judgment/JudgmentGroundsPanel";
import { JudgmentEvidenceColumn } from "@/src/components/judgment/JudgmentEvidenceColumn";
import { JudgmentEvidenceAdmission } from "@/src/components/judgment/JudgmentEvidenceAdmission";
import {
  DraftConflictBanner,
  DraftStatusLine,
  useDraftAutosave,
} from "@/src/components/judgment/JudgmentDraftAutosave";
import { PageShell } from "@/src/components/ui/PageShell";
import { PageSpinner } from "@/src/components/ui/Spinner";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { QueryError } from "@/src/components/ui/PageError";
import { Button } from "@/src/components/ui/Button";
import { Badge } from "@/src/components/ui/Badge";
import { reincarnationApi, type ConcludeJudgmentPayload, type Reincarnation } from "@soulledger/core/api";
import { SoulReadingPanel } from "@/src/components/souls/SoulReadingPanel";
import { CitationChips, ConcludedBalance, Kbd, PrecedentsPanel, QueueBar, StatuteSearch } from "@/src/components/judgment/JudgmentDesk";
import { useHotkeys } from "@/src/lib/hotkeys";
import { verdictGlyph } from "@/src/lib/verdictGlyph";
import type { SentenceRequestChanges } from "@soulledger/core/api/sentence-plans";
import { useTenant } from "@/src/contexts/TenantContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import { AmendmentPlanChanges } from "@/src/components/sentence-plan/AmendmentPlanChanges";
import {
  EMPTY_DRAFT,
  draftIsEmpty,
  draftToChanges,
  type ChangesDraft,
} from "@/src/components/sentence-plan/PlanChangesEditor";
import { REFUSAL_CODES } from "@/src/components/sentence-plan/sentencePlanDisplay";
import { OpenCrossJudgment } from "@/src/components/cross-judgments/OpenCrossJudgment";
import {
  EMPTY_PLACEMENT,
  JudgmentPlacement,
  PLACEMENT_REFUSALS,
  placementFor,
  type Placement,
} from "@/src/components/judgment/JudgmentPlacement";
import { useJudgmentNextAfter, useJudgmentPrevious } from "@soulledger/core/hooks/useJudgments";

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
 * ── STRUCTURE: 卷 | 判 | 据 (规范 v1 第三类 A·01) ────────────────────────
 * Three columns, read left to right as one hearing: 卷 is the dossier
 * (identity, 功过 with its double-ruled total, prior lives, the confession);
 * 判 is the ruling (丙 evidence, the seal band, the verdict bar, 丁 the verdict
 * text, 戊 the plan changes on an amendment, then 落判); 据 is the grounds
 * (cited articles and the statute search). At 393px they stack in that order.
 * The four verdicts are still four clauses of one choice, now a key-capped
 * VerdictBar: 1–4 choose, ⌘⏎ concludes (`src/lib/hotkeys.ts`). The other
 * three stay fully legible: a verdict is compared against the ones not given.
 *
 * Wired to the backend since the claim / evidence / draft round: 丙 is the
 * current life's merit and demerit records with an admission toggle (Space on
 * the focused row; not admitting asks for a reason) and the server's admitted
 * balance; 丁 autosaves (`useDraftAutosave`) and stops on a 409 with the
 * server's version on screen rather than overwriting it; 据 carries 先例; the
 * QueueBar takes S to defer (the queue's own key, 第三类 F 组).
 *
 * 戊 · 发落 (original judgments): destination and term, from
 * `judgmentApi.destinations` filtered by the chosen verdict — nothing chosen
 * sends nothing, i.e. automatic routing. K opens 「上一件」 (`/judgment/previous/`),
 * J 「下一件」 (`/judgment/next/?after=`, the same order walked forward).
 *
 * Still left out rather than faked: the 5-second undo (the user decided
 * against it — `conclude/` stays immediate).
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
  PASSED: "text-[oklch(var(--color-verdict-passed))]",
  FAILED: "text-[oklch(var(--color-verdict-failed))]",
  PURGATORY: "text-[oklch(var(--color-verdict-purgatory))]",
  RETRY: "text-[oklch(var(--color-verdict-retry))]",
};

/**
 * VerdictBar 的选中态(规范 v1 §2.9):s2 底 + 下沿 3 px 裁决色。画成 inset 阴影 —— 那是一条线,
 * 不是高度(eslint 的 PAGE_SHADOW 只放行 inset);四格因此同高,选中不挪动任何东西。
 * 选中从不只靠颜色:单选框本身被选中,且字形(✓ ✕ ◇ ↺)始终在。
 */
const VERDICT_MARK: Record<VerdictMember, string> = {
  PASSED: "bg-[oklch(var(--color-surface-2))] shadow-[inset_0_-3px_0_oklch(var(--color-verdict-passed))]",
  FAILED: "bg-[oklch(var(--color-surface-2))] shadow-[inset_0_-3px_0_oklch(var(--color-verdict-failed))]",
  PURGATORY: "bg-[oklch(var(--color-surface-2))] shadow-[inset_0_-3px_0_oklch(var(--color-verdict-purgatory))]",
  RETRY: "bg-[oklch(var(--color-surface-2))] shadow-[inset_0_-3px_0_oklch(var(--color-verdict-retry))]",
};

/**
 * The band's top edge, per-side rather than all-sides: the band
 * has TWO live borders (3px above, 1px below) and an all-sides `border-color`
 * would paint the bottom one too, leaving the winner to the order Tailwind
 * happens to emit `border-{color}` and `border-b-{color}` in.
 */
const VERDICT_SEAL: Record<VerdictMember, string> = {
  PASSED: "border-t-[oklch(var(--color-verdict-passed))]",
  FAILED: "border-t-[oklch(var(--color-verdict-failed))]",
  PURGATORY: "border-t-[oklch(var(--color-verdict-purgatory))]",
  RETRY: "border-t-[oklch(var(--color-verdict-retry))]",
};

/**
 * THE SEAL BAND'S BOX, and the whole reason it is a constant.
 *
 * The band must not change height when a verdict lands: a page that reflows at
 * the moment of judgment moves everything below it under the reader's eye.
 * `h-[124px]` is a FIXED height, not a minimum, so no content can grow it —
 * 56px (text-xl at line-height 1) + 8 + 18px (text-xs at 1.5) = 82px of content
 * against 124 − 32 (py-4) − 4 (borders, border-box) = 88px of room; the pending
 * state puts one 16px line in the same box. `border-t-3` over `border-b` reads
 * as a stamp pressed DOWN, heavy edge first. Only the top border's COLOUR
 * varies between the two states — every class in the box model is in this one
 * string, so the states cannot drift apart in height without it changing.
 */
const SEAL_BAND = "h-[124px] flex items-center gap-6 border-t-3 border-b border-b-hairline";

const NO_LIVES: Reincarnation[] = [];

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function JudgmentDetailPage({ params }: PageProps) {
  const { id } = use(params);
  const { t, formatDate, formatDateTime } = useI18n();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [selectedVerdict, setSelectedVerdict] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [createWorkflow, setCreateWorkflow] = useState(false);
  const [planDraft, setPlanDraft] = useState<ChangesDraft>(EMPTY_DRAFT);
  const [placement, setPlacement] = useState<Placement>(EMPTY_PLACEMENT);
  const previousLink = useRef<HTMLAnchorElement>(null);
  const nextLink = useRef<HTMLAnchorElement>(null);
  const { user } = useTenant();
  const { hasPermission } = usePermissions();
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
    mutationFn: (payload: ConcludeJudgmentPayload) => judgmentApi.conclude(id, payload),
    /* THE PAGE STAYS. It used to `router.push("/judgment")` here.
     *
     * `SEAL_BAND` above is 120 lines of design for one moment — a fixed
     * `h-[124px]` so the page cannot reflow as the verdict lands, `border-t-3`
     * over `border-b` so the rule reads as a stamp pressed down, a colour per
     * verdict — and navigating away on success meant no operator had ever seen
     * it happen. The band flipped to its sealed state on a page that was
     * already being torn down. A judgment is the one thing in this application
     * that is supposed to leave a record you can look at; sending the judge to
     * a list the instant they render it is the opposite of that.
     *
     * Invalidating the detail key is what flips `isFinal`, and every branch
     * this page has for a concluded judgment — the sealed band, the ordered
     * clause, the citations block, the hidden verdict form — is already
     * written and already tested. `judgmentKeys.all` also covers the list
     * behind the back link, which is now the only way out and should be right
     * when it is reached. */
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: judgmentKeys.all });
      showToast(t("judgment.detail.conclude_success"), "success");
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { error?: string; code?: string } } };
      // An amendment's plan changes refused (same transaction, nothing written): say which rule, translated.
      const code = e?.response?.data?.code;
      // 发落被拒:画在 戊 那一节(placementRefusal),并重取占用 —— realm_full 说明手上的数字旧了。
      if (code && (PLACEMENT_REFUSALS as readonly string[]).includes(code)) {
        queryClient.invalidateQueries({ queryKey: [...judgmentKeys.all, "destinations", id] });
        return;
      }
      if (code && (REFUSAL_CODES as readonly string[]).includes(code)) {
        showToast(t(`sentence_plan.errors.${code}`), "error");
        return;
      }
      showToast(e?.response?.data?.error || t("judgment.detail.conclude_error"), "error");
    },
  });

  /**
   * Whether the operator has typed in the notes box. A ref, not state: it
   * changes nothing on screen, it only decides who owns the field.
   *
   * The effect below runs on every new `judgment` object, and that is every
   * refetch — a window refocus, a network recovery, the realtime layer
   * invalidating `judgmentKeys.all` on any judgment push. Unguarded, it wrote
   * the server's `notes` over whatever the judge was in the middle of typing
   * (FL-06). The server is the source until the field is touched; after that
   * the field is the operator's. `JudgmentDetailPage.notesDraft.test.tsx`
   * holds both halves.
   */
  const notesTouched = useRef(false);
  /** Same rule for the chosen verdict: the saved draft's choice seeds it until the operator picks one. */
  const verdictTouched = useRef(false);

  useEffect(() => {
    if (judgment) {
      if (!notesTouched.current) setNotes(judgment.notes || "");
      if (judgment.verdict) {
        setSelectedVerdict(judgment.verdict);
      } else if (!verdictTouched.current && judgment.draft_verdict) {
        setSelectedVerdict(judgment.draft_verdict);
      }
    }
  }, [judgment]);

  const isAmendment = judgment?.kind === "AMENDMENT" && !!judgment?.amends_plan_id;
  const isOriginal = (judgment?.kind ?? "ORIGINAL") === "ORIGINAL";
  const myTenant = user?.tenant?.code ?? null;
  const soulHome = soulData?.home_tenant?.code ?? soulData?.tenant_code ?? null;
  /* 开联审(§2.1):原属的 ORIGINAL 审判,持 cross_judgment.create;按钮只在未结案的结案区里。服务端再判一次。 */
  const canOpenCross =
    !!judgment &&
    (judgment.kind ?? "ORIGINAL") === "ORIGINAL" &&
    hasPermission("cross_judgment.create") &&
    myTenant !== null &&
    myTenant === soulHome;

  function handleConclude() {
    if (!selectedVerdict) {
      showToast(t("judgment.detail.select_verdict"), "error");
      return;
    }
    // 加减项审判(情况 1):改动随裁决一起交,系统生成一条请求给原审判官;没改动就不带(不生成请求)。
    let planChanges: SentenceRequestChanges | undefined;
    if (isAmendment && !draftIsEmpty(planDraft)) {
      const changes = draftToChanges(planDraft);
      if (changes === null) {
        showToast(t("sentence_plan.errors.invalid_changes"), "error");
        return;
      }
      planChanges = changes;
    }
    concludeMutation.mutate({
      verdict: selectedVerdict,
      notes,
      create_workflow: createWorkflow,
      ...(planChanges ? { plan_changes: planChanges } : {}),
      ...(isOriginal ? placementFor(placement, selectedVerdict) : {}),
    });
  }

  const canExecute = hasPermission("judgment.execute");

  /* 丁 · 判词自动保存。只在动过之后存;409 停下并把对方的版本交给冲突条(见 useDraftAutosave)。 */
  const draft = useDraftAutosave({
    judgmentId: id,
    notes,
    verdict: selectedVerdict,
    enabled: !!judgment && !judgment.is_final && canExecute,
  });
  const chooseVerdict = (member: string) => {
    verdictTouched.current = true;
    setSelectedVerdict(member);
    draft.markEdited();
  };

  /* 卷 · 乙 功过 与 前世:与灵魂账页同一对端点、同一对键(`soulKeys` 之下),所以两页共享缓存,
     别处推来的 `soulKeys.all` 失效也够得到这里。 */
  const soulId = judgment?.soul ?? "";
  const { data: ledgerData } = useQuery({
    queryKey: soulKeys.ledger(soulId),
    queryFn: () => soulsApi.karma(soulId).then((res) => res.data),
    enabled: !!soulId,
    staleTime: 30_000,
  });
  const { data: priorLives = NO_LIVES } = useQuery({
    queryKey: [...soulKeys.all, "reincarnations", soulId],
    queryFn: async (): Promise<Reincarnation[]> => (await reincarnationApi.list({ soul: soulId })).data.results,
    enabled: !!soulId,
    staleTime: 30_000,
  });

  /* 据 · 引用 / 撤回:`/judgment/{id}/citations/`,持 judgment.execute。成功后整族失效 ——
     详情里的 `citations` 与语料页的 `citation_count` 都挂在 `judgmentKeys.all` 下。 */
  const groundsChanged = () => queryClient.invalidateQueries({ queryKey: judgmentKeys.all });
  const citeMutation = useMutation({
    mutationFn: (statuteId: string) => judgmentApi.cite(id, statuteId),
    onSuccess: groundsChanged,
    onError: () => showToast(t("judgment.desk.cite_error"), "error"),
  });
  const unciteMutation = useMutation({
    mutationFn: (statuteId: string) => judgmentApi.uncite(id, statuteId),
    onSuccess: groundsChanged,
    onError: () => showToast(t("judgment.desk.cite_error"), "error"),
  });

  /* 裁决键 1–4 选定、⌘⏎ 落判。焦点在判词框里时 1–4 不接(那是在写字),⌘⏎ 接。
     落判与按钮同一个门:持 judgment.execute、已选裁决、不在提交中。 */
  const deskOpen = !!judgment && !judgment.is_final;
  useHotkeys(
    {
      ...Object.fromEntries(VERDICTS.map((member, i) => [String(i + 1), () => chooseVerdict(member)])),
      "mod+Enter": () => {
        if (canExecute && selectedVerdict && !concludeMutation.isPending) handleConclude();
      },
    },
    deskOpen
  );

  /* K 上一件:与 `next/` 同一队列;打字时不接(useHotkeys)。结案后也能回看上一件。 */
  const { data: previous } = useJudgmentPrevious(id);
  const previousId = previous?.judgment?.id ?? null;
  useHotkeys({ k: () => previousLink.current?.click() }, !!previousId);
  /* J 下一件:同一队列、同一顺序往后一步(我认领在前,再先进先出,暂缓不在其中);与 K 同样的规矩。 */
  const { data: nextCase } = useJudgmentNextAfter(id);
  const nextId = nextCase?.judgment?.id ?? null;
  useHotkeys({ j: () => nextLink.current?.click() }, !!nextId);

  /* A known route, so a link and not a router.back() button. */
  const backLink = (
    <Link
      href="/judgment"
      className="text-xs text-[oklch(var(--color-ink-muted))] hover:text-[oklch(var(--color-ink))] transition-colors"
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
            <Link href="/judgment" className="text-sm text-[oklch(var(--color-ink-muted))] hover:text-[oklch(var(--color-ink))] transition-colors">
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
  const citations = judgment.citations ?? [];
  const citedIds = new Set(citations.map((c) => c.statute.id));
  const canEditGrounds = !isFinal && canExecute;
  const refusalCode = (concludeMutation.error as { response?: { data?: { code?: string } } } | null)?.response?.data
    ?.code;
  const placementRefusal =
    refusalCode && (PLACEMENT_REFUSALS as readonly string[]).includes(refusalCode) ? refusalCode : null;

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
      <span aria-hidden="true" className="text-[oklch(var(--color-ink-tertiary))]">·</span>
      <span className="font-mono tabular-nums">{formatDate(judgment.created_at)}</span>
    </span>
  );

  const CURSOR_LINK =
    "inline-flex items-center gap-1.5 font-mono text-xs text-[oklch(var(--color-ink-muted))] hover:text-[oklch(var(--color-ink))]";
  /* 三栏共用的栏距:桌面 28 px 内边、栏间一条结构线;393 下纵向堆叠,线改在栏的下沿。 */
  const COLUMN = "min-w-0 py-6 lg:px-6 border-b lg:border-b-0 border-[oklch(var(--color-line))]";

  return (
    <>
    {!isFinal && <QueueBar judgmentId={judgment.id} canDefer={canExecute} />}
    <PageShell
      density="document"
      variant="full"
      backLink={backLink}
      eyebrow={eyebrow}
      /* Clause 4: the id never substitutes for a name — a judgment with no
         recorded soul name reads as unrecorded, not as its primary key. */
      title={<DomainText value={soulName} />}
      subtitle={subtitle}
      actions={
        previousId || nextId ? (
          <span className="inline-flex items-center gap-4">
            {previousId && (
              <Link ref={previousLink} href={`/judgment/${previousId}`} className={CURSOR_LINK}>
                <Kbd>K</Kbd>
                {t("judgment.desk.previous")}
              </Link>
            )}
            {nextId && (
              <Link ref={nextLink} href={`/judgment/${nextId}`} className={CURSOR_LINK}>
                <Kbd>J</Kbd>
                {t("judgment.desk.next")}
              </Link>
            )}
          </span>
        ) : undefined
      }
    >
      <div
        data-testid="judgment-desk"
        className={`grid grid-cols-1 border-t border-[oklch(var(--color-block))] ${
          isFinal ? "lg:grid-cols-[300px_minmax(0,1fr)]" : "lg:grid-cols-[300px_minmax(0,1fr)_340px]"
        }`}
      >
        {/* ── 卷 · 身份 / 功过 / 前世 / 供词 ───────────────────────────────── */}
        <section aria-label={t("judgment.queue.case")} className={`${COLUMN} lg:pl-0 lg:border-r`}>
          <JudgmentSectionHead mark="甲" title={t("judgment.detail.soul_info")} />
          <dl className="divide-y divide-[oklch(var(--color-rule))]">
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

          {/* 乙 · 功过:`/souls/{id}/karma/` 的 reading,与灵魂账页同一个面板 —— 功过格是
              收 / 支 / 结 三列压双线,别的文明各按自己的读法,不硬套一个净额。 */}
          <div className="mt-6">
            <JudgmentSectionHead
              mark="乙"
              title={t("souls.detail.ledger.karma")}
              meta={
                isFinal && judgment.concluded_at
                  ? t("judgment.desk.concluded_on", { date: judgment.concluded_at.slice(5, 10) })
                  : undefined
              }
            />
            {/* 结案了:判决依据的是结案时的值,所以它在上、用双线收住;现值在下(第三类 F 组 2.3)。 */}
            {isFinal && judgment.admitted_balance?.balance != null && (
              <ConcludedBalance
                snapshot={judgment.admitted_balance.balance}
                current={judgment.admitted_balance.current_balance}
                recordedAfter={
                  judgment.concluded_at
                    ? (ledgerData?.records ?? []).filter(
                        (r) =>
                          (r.type === "MERIT" || r.type === "DEMERIT") &&
                          r.recorded_at > (judgment.concluded_at as string)
                      ).length
                    : 0
                }
              />
            )}
            {ledgerData?.reading ? (
              <div className="pt-2">
                <SoulReadingPanel
                  reading={ledgerData.reading}
                  meritScore={ledgerData.merit_score}
                  demeritScore={ledgerData.demerit_score}
                  karmicBalance={ledgerData.karmic_balance}
                />
              </div>
            ) : (
              <p className="py-2 text-sm text-[oklch(var(--color-ink-subtle))]">
                <MissingValue kind="unrecorded" />
              </p>
            )}
          </div>

          <div className="mt-6">
            <JudgmentSectionHead title={t("judgment.queue.prior_cycles")} meta={String(priorLives.length)} />
            {priorLives.length === 0 ? (
              <p className="py-2 text-sm text-[oklch(var(--color-ink-subtle))]">{t("judgment.queue.cycles_empty")}</p>
            ) : (
              <ul>
                {priorLives.map((life) => (
                  <li key={life.id} className="py-1.5 border-b border-[oklch(var(--color-rule))] text-sm">
                    <div className="flex justify-between gap-2">
                      <span>{t("judgment.queue.cycle")} {life.cycle_count}</span>
                      <span className="font-mono text-xs tabular-nums text-[oklch(var(--color-ink-subtle))]">
                        {formatDate(life.reincarnated_at)}
                      </span>
                    </div>
                    <div className="text-[oklch(var(--color-ink-muted))] truncate" title={life.new_identity || undefined}>
                      <DomainEnum namespace="reincarnation.forms" value={life.rebirth_form} />
                      {life.new_identity && ` · ${life.new_identity}`}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-6">
            <JudgmentSectionHead title={t("judgment.detail.confession")} />
            {/* SERIF = WORDS SOMEONE SAID. That contrast replaces the `italic` +
                curly quotes this paragraph used to carry: a confession in italic
                reads as an aside, and italic is then unavailable for what italic
                is for. */}
            {judgment.confession ? (
              <p className="font-serif text-quote text-[oklch(var(--color-ink))] mt-2">{judgment.confession}</p>
            ) : (
              <p className="text-sm text-[oklch(var(--color-ink-subtle))] mt-2">
                <MissingValue kind="unrecorded" />
              </p>
            )}
          </div>
        </section>

        {/* ── 判 · 证据 / 落印 / 裁决 / 判词 / 发落 ─────────────────────────── */}
        <section
          aria-label={t("judgment.detail.render_verdict")}
          className={`${COLUMN} ${isFinal ? "lg:pr-0" : "lg:border-r"}`}
        >
          {judgment.deferred_at && !isFinal && (
            <p data-testid="deferred-note" className="mb-4 border-l-3 border-[oklch(var(--color-warning))] pl-3 text-sm text-[oklch(var(--color-ink-muted))]">
              {t("judgment.desk.deferred_note", { reason: judgment.defer_reason ?? "" })}
            </p>
          )}
          <JudgmentEvidenceAdmission
            judgmentId={judgment.id}
            records={ledgerData?.records}
            admissions={judgment.evidence_admissions ?? []}
            balance={judgment.admitted_balance}
            canRule={!isFinal && canExecute}
          />
          {/* `evidence_json` is the case's own free-form record, separate from the ledger
              evidence above; shown only when the case carries any. */}
          {Object.keys(judgment.evidence_json ?? {}).length > 0 && (
            <div className="mt-6">
              <JudgmentEvidenceColumn evidence={judgment.evidence_json} mark="" />
            </div>
          )}

          {/* ── 落印带 · one element, one box, two states. See SEAL_BAND. ────── */}
          <div
            data-seal-band=""
            data-sealed={isFinal ? "true" : "false"}
            className={`mt-6 ${SEAL_BAND} transition-colors duration-settle ease-enter ${
              isFinal && ordered ? VERDICT_SEAL[ordered] : "border-t-hairline-strong"
            }`}
          >
            {isFinal && ordered ? (
              <>
                <div className="min-w-0 flex-1">
                  <p className={`text-xl ${VERDICT_INK[ordered]}`}>
                    <span aria-hidden="true">{verdictGlyph(ordered)} </span>
                    <DomainEnum namespace="judgment.verdicts" value={judgment.verdict} />
                  </p>
                  {/* 主审 · 结案时间. 印记 / 会审比数 have no fields — file header. */}
                  <p
                    className="text-xs font-mono text-[oklch(var(--color-ink-subtle))] mt-2 truncate"
                    title={
                      [judgment.judge_name, judgment.concluded_at && formatDateTime(judgment.concluded_at)]
                        .filter(Boolean)
                        .join(" · ") || undefined
                    }
                  >
                    <DomainText value={judgment.judge_name} />
                    <span aria-hidden="true" className="mx-2 text-[oklch(var(--color-ink-tertiary))]">·</span>
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
                <p className="text-2xs uppercase text-[oklch(var(--color-ink-subtle))] flex-1">{t("judgment.pending")}</p>
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

          {/* ── 裁决键组 VerdictBar ─────────────────────────────────────────── */}
          <JudgmentSectionHead id={clausesId} title={t("judgment.detail.verdict")} />
          {/* `role="group"` only while the clauses are choosable — four radios
              sharing a `name` are a group to the browser but nothing names that
              group; on a decided case there is nothing to choose. */}
          <ol
            data-testid="verdict-bar"
            className="grid grid-cols-2 lg:grid-cols-4 gap-2 mt-3"
            {...(isFinal ? {} : { role: "group", "aria-labelledby": clausesId })}
          >
            {VERDICTS.map((member, index) => {
              const isOrdered = ordered === member;
              const isChosen = selectedVerdict === member;
              const marked = isFinal ? isOrdered : isChosen;
              const clause = (
                <>
                  <Kbd>{index + 1}</Kbd>
                  <span aria-hidden="true" className={`font-mono text-md ${VERDICT_INK[member]}`}>
                    {verdictGlyph(member)}
                  </span>
                  <span className="font-medium text-[oklch(var(--color-ink))]">
                    <DomainEnum namespace="judgment.verdicts" value={member} />
                  </span>
                </>
              );
              const tile = `flex items-center gap-2 h-12 px-3 border border-[oklch(var(--color-block))] ${
                marked ? VERDICT_MARK[member] : ""
              }`;

              return (
                <li key={member}>
                  {isFinal ? (
                    <div className={`${tile} ${marked ? "" : "opacity-60"}`} aria-current={isOrdered ? "true" : undefined}>
                      {clause}
                    </div>
                  ) : (
                    /* The radio is `sr-only`, so the global `:focus-visible`
                       outline lands on a 1px clipped box nobody sees. The label
                       carries the ring instead, on the same `--color-focus`
                       token globals.css uses. */
                    <label
                      className={`${tile} cursor-pointer hover:bg-[oklch(var(--color-surface-2))] focus-within:outline-solid focus-within:outline-2 focus-within:outline-[oklch(var(--color-focus))]`}
                    >
                      <input
                        ref={index === 0 ? firstClauseRef : undefined}
                        type="radio"
                        name="verdict"
                        value={member}
                        checked={isChosen}
                        onChange={(event) => chooseVerdict(event.target.value)}
                        className="sr-only"
                      />
                      {clause}
                    </label>
                  )}
                </li>
              );
            })}
          </ol>

          {/* ── 丁 · 判词 ── */}
          <div className="mt-6">
            <JudgmentSectionHead mark="丁" title={t("souls.detail.ledger.verdict_words")} />
          </div>

          {isFinal ? (
            /* 判词是「有人说过的话」,所以衬线(规范 v1 表态 1:判词、忏悔录、古典语料)。
               这里原先是 sans,理由是「法庭自己写的字」;规范 v1 把判词划进了引文。 */
            judgment.notes ? (
              <blockquote className="mt-3 pl-3 border-l-2 border-[oklch(var(--color-ink))] font-serif text-quote text-[oklch(var(--color-ink))] max-w-[72ch]">
                {judgment.notes}
              </blockquote>
            ) : (
              <p className="text-sm text-[oklch(var(--color-ink-subtle))] mt-3">
                <MissingValue kind="unrecorded" />
              </p>
            )
          ) : (
            <>
              <label htmlFor={notesId} className="sr-only">
                {t("judgment.detail.notes")}
              </label>
              {/* 衬线输入 QuoteInput:判词是正被说出的话,所以输入框本身用衬线、字号 text-quote。 */}
              <textarea
                id={notesId}
                value={notes}
                onChange={(event) => {
                  notesTouched.current = true;
                  setNotes(event.target.value);
                  draft.markEdited();
                }}
                rows={4}
                placeholder={t("judgment.detail.notes_placeholder")}
                className="block w-full mt-3 border border-[oklch(var(--color-block))] bg-[oklch(var(--color-surface-1))] px-3 py-2 font-serif text-quote text-[oklch(var(--color-ink))] placeholder:text-[oklch(var(--color-ink-subtle))] transition-[border-color] duration-state focus-visible:border-[oklch(var(--color-accent))] resize-y"
              />
              {/* During a conflict the last saved time is the OTHER version's baseline, not this text's. */}
              {!draft.conflict && <DraftStatusLine status={draft.status} savedAt={judgment.draft_saved_at} />}
              {draft.conflict && (
                <DraftConflictBanner
                  current={draft.conflict}
                  onUseServer={() => {
                    const theirs = draft.acceptTheirs();
                    if (!theirs) return;
                    setNotes(theirs.notes);
                    setSelectedVerdict(theirs.draft_verdict ?? "");
                  }}
                  onKeepMine={draft.keepMine}
                />
              )}
            </>
          )}
          {!isFinal && (
            <CitationChips
              citations={citations}
              onRemove={canEditGrounds ? (statuteId) => unciteMutation.mutate(statuteId) : undefined}
            />
          )}

          {/* ── 戊 · 发落:原审判选目的地与刑期;加减项审判的发落是计划改动。 ── */}
          {!isFinal && isOriginal && canExecute && (
            <JudgmentPlacement
              judgmentId={judgment.id}
              verdict={selectedVerdict}
              value={placement}
              onChange={(next) => {
                concludeMutation.reset(); // 改了发落,上一次的拒绝就不再是这一份的
                setPlacement(next);
              }}
              refusal={placementRefusal}
            />
          )}
          {!isFinal && isAmendment && myTenant && (
            <AmendmentPlanChanges
              planId={judgment.amends_plan_id as string}
              tenantCode={myTenant}
              draft={planDraft}
              onChange={setPlanDraft}
            />
          )}

          {/* ── 落判 ─────────────────────────────────────────────────────── */}
          {!isFinal && (
            <div className="mt-6 border-t border-[oklch(var(--color-block))] pt-4 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="flex items-start gap-2 min-w-0">
                <input
                  id={createWorkflowId}
                  type="checkbox"
                  checked={createWorkflow}
                  onChange={(event) => setCreateWorkflow(event.target.checked)}
                  className="mt-1 h-4 w-4 shrink-0 accent-[oklch(var(--color-accent))]"
                />
                <label htmlFor={createWorkflowId} className="cursor-pointer min-w-0">
                  <span className="text-sm text-[oklch(var(--color-ink))] block">{t("judgment.detail.create_workflow")}</span>
                  <span className="text-xs text-[oklch(var(--color-ink-subtle))] block mt-1 max-w-prose">
                    {t("judgment.detail.create_workflow_hint")}
                  </span>
                </label>
              </div>

              {canOpenCross && <OpenCrossJudgment judgmentId={judgment.id} soulName={soulName} />}
              <RequirePermission permissions="judgment.execute">
                <Button
                  type="button"
                  variant="primary"
                  size="lg"
                  className="shrink-0 gap-2"
                  onClick={handleConclude}
                  loading={concludeMutation.isPending}
                  disabled={!selectedVerdict}
                >
                  {/* 第三类 F 组 2.8:勾上审批流后,这个不可撤回的按钮写明它会多做什么。 */}
                  {concludeMutation.isPending
                    ? t("judgment.detail.concluding")
                    : createWorkflow
                      ? t("judgment.detail.conclude_with_workflow")
                      : t("judgment.detail.conclude")}
                  <Kbd>⌘⏎</Kbd>
                </Button>
              </RequirePermission>
            </div>
          )}
        </section>

        {/* ── 据 · 检索:只在未结案时有事可做(引用一条律条),结案后这一栏不画。 ── */}
        {!isFinal && (
          <section aria-label={t("judgment.desk.statute_search")} className={`${COLUMN} lg:pr-0`}>
            <JudgmentSectionHead title={t("judgment.desk.statute_search")} />
            <StatuteSearch
              civilization={judgment.civilization}
              cited={citedIds}
              onCite={canEditGrounds ? (statuteId) => citeMutation.mutate(statuteId) : undefined}
            />
            <PrecedentsPanel judgmentId={judgment.id} />
          </section>
        )}
      </div>

      {/* ── 据 · 依据条文,全宽:条文行是「编号 | 正文 | 出处」三栏,塞进 340 px 的栏里会被压成竖排。
          Shown once the case is decided — INCLUDING when it cited nothing,
          which is the informative case: a concluded verdict with no stated
          basis is a fact to show, not a box to hide. On an open case, only
          once grounds exist, so a pending proceeding grows no empty panel. */}
      {(isFinal || citations.length > 0) && (
        <div className="mt-10">
          <JudgmentGroundsPanel citations={citations} />
        </div>
      )}
    </PageShell>
    </>
  );
}

/** `76px 标签 | 值`, one rule apart. */
function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[76px_1fr] items-baseline gap-3 py-1.5">
      <dt className="text-2xs uppercase text-[oklch(var(--color-ink-subtle))]">{label}</dt>
      <dd className="text-sm text-[oklch(var(--color-ink))] min-w-0 wrap-break-word">{children}</dd>
    </div>
  );
}
