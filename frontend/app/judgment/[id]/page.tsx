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
import {
  CitationChips,
  CiteFromCorpus,
  ConcludedBalance,
  Kbd,
  PrecedentsPanel,
  QueueBar,
  StatuteSearch,
  VERDICT_KEY_CLASS,
  VerdictKeyContent,
} from "@/src/components/judgment/JudgmentDesk";
import { Seal } from "@/src/components/plaque/Seal";
import {
  CivMotif,
  JudgmentConfirmLayer,
  MaterialDock,
  type DeskMaterial,
} from "@/src/components/judgment/JudgmentDeskStage";
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
  placementFromDraft,
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
 * ── STRUCTURE: v3 审判台(第 7 轮原型 `JudgmentDesk`) ───────────────────
 * 聚焦视图三栏:灵魂(身份、功过、前世)| 当前这一判(展示字号的判决、四个裁决键、
 * 「进入盖印确认」)| 草稿(丁 判词、戊 发落、审批流、开联审)。下面是资料舱
 * (`MaterialDock`):供词 / 功过记录(丙 证据采信)/ 律条引用(引用签、依据、检索、先例)。
 * F 展开全案:资料舱三栏并置,判收成右侧窄栏;Esc 或再按 F 回来。落判不在页面上而在
 * 盖印确认层(`JudgmentConfirmLayer`):主按钮或 ⌘⏎ 进层,层里「盖印并结案」或再一下 ⌘⏎
 * 才发 `conclude/`;成功后同一层落印。768 以下单栏:判 → 资料舱 → 草稿 → 灵魂,案卷导航跳到后两者。
 * The four verdicts are still four clauses of one choice: 1–4 choose
 * (`src/lib/hotkeys.ts`). The other three stay fully legible: a verdict is
 * compared against the ones not given.
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
 * 没选过、也没有存过草稿的案子,中轴先落在「待定」上(v3 原型 `useState<Verdict>("待定")`,
 * 2026-10-01 用户拍板照 v3)。它是 `Verdict.PURGATORY`,`conclude/` 的四个合法值之一,每个文明的
 * 发落都有它的去处(`apps/disposition/services.py`:待定 = 结论未定,留在候审处)。
 * 预选不算「动过」:不触发自动保存,存过的草稿裁决仍然优先。
 */
const DEFAULT_VERDICT: VerdictMember = "PURGATORY";

/*
 * 规范 v2 补足 B8:判决不靠颜色区分 —— 四个裁决键同一个幽灵样式(`VERDICT_KEY_CLASS`,与审判队列共用),
 * 字形 + 文字。v3 把「选中」画成墨底反白(原型 `verdict-selector button.selected`):中性,不是第六处
 * 主色;✕ 也是墨色,冷玫红只给系统出错。键帽数字跟着反白(`[&_kbd]:text-current`)。
 * 原型的选中项还上移 6px —— 那是 74px 高的键;这里的键按控件尺寸规定是 40px,上移不画。
 */
const VERDICT_CHOSEN =
  "bg-[oklch(var(--color-ink))] text-[oklch(var(--color-surface-1))] hover:bg-[oklch(var(--color-ink))] [&_kbd]:text-current";

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
  /** 本次会话里落过几次判;0 = 进页时已结案,印直接是落定的样子,不播。 */
  const [stamp, setStamp] = useState(0);
  const [planDraft, setPlanDraft] = useState<ChangesDraft>(EMPTY_DRAFT);
  const [placement, setPlacement] = useState<Placement>(EMPTY_PLACEMENT);
  /** v3 审判台的三种样子:聚焦(默认)、全案(F)、盖印确认层(盖在两者之上)。 */
  const [view, setView] = useState<"focus" | "case">("focus");
  const [confirming, setConfirming] = useState(false);
  const [material, setMaterial] = useState<DeskMaterial>("evidence");
  /** 769–1279 草稿栏收在「草稿与批注」开关后(v3 平板);收起时仍挂着,判词与自动保存都不丢。 */
  const [draftOpen, setDraftOpen] = useState(false);
  const previousLink = useRef<HTMLAnchorElement>(null);
  const nextLink = useRef<HTMLAnchorElement>(null);
  const { user } = useTenant();
  const { hasPermission } = usePermissions();
  const createWorkflowId = useId();
  const notesId = useId();
  const clausesId = useId();

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
     * The seal drop (`JudgmentConfirmLayer`, 320ms ease-drop) is designed for
     * one moment, and navigating away on success meant no operator had ever
     * seen it happen — the old seal band flipped to its sealed state on a page
     * that was already being torn down. A judgment is the one thing in this application
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
      setStamp((n) => n + 1); // 落判即盖印:落印带翻成结案态时,印按这一次的 key 落下
      queryClient.invalidateQueries({ queryKey: judgmentKeys.all });
      showToast(t("judgment.detail.conclude_success"), "success");
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { error?: string; code?: string } } };
      // An amendment's plan changes refused (same transaction, nothing written): say which rule, translated.
      const code = e?.response?.data?.code;
      // 发落被拒:画在 戊 那一节(placementRefusal),并重取占用 —— realm_full 说明手上的数字旧了。
      if (code && (PLACEMENT_REFUSALS as readonly string[]).includes(code)) {
        setConfirming(false); // 拒绝写在 戊 那一节里,确认层盖着它就看不见
        setDraftOpen(true); // 平板上 戊 收着的话,也一并展开
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
  /** And for 戊 · 发落: the saved draft's destination / term seed it until the operator changes them. */
  const placementTouched = useRef(false);

  useEffect(() => {
    if (judgment) {
      if (!notesTouched.current) setNotes(judgment.notes || "");
      if (judgment.verdict) {
        setSelectedVerdict(judgment.verdict);
      } else if (!verdictTouched.current) {
        setSelectedVerdict(judgment.draft_verdict || DEFAULT_VERDICT);
      }
      const savedPlacement = placementFromDraft(judgment);
      if (!placementTouched.current && savedPlacement) setPlacement(savedPlacement);
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

  /** 加减项审判(情况 1)的改动:没改动 → undefined(不生成请求);有改动却不完整 → null,并已提示。 */
  function amendmentChanges(): SentenceRequestChanges | undefined | null {
    if (!isAmendment || draftIsEmpty(planDraft)) return undefined;
    const changes = draftToChanges(planDraft);
    if (changes === null) showToast(t("sentence_plan.errors.invalid_changes"), "error");
    return changes;
  }

  function handleConclude() {
    if (!selectedVerdict) {
      showToast(t("judgment.detail.select_verdict"), "error");
      return;
    }
    // 加减项审判(情况 1):改动随裁决一起交,系统生成一条请求给原审判官;没改动就不带(不生成请求)。
    const planChanges = amendmentChanges();
    if (planChanges === null) return;
    concludeMutation.mutate({
      verdict: selectedVerdict,
      notes,
      create_workflow: createWorkflow,
      ...(planChanges ? { plan_changes: planChanges } : {}),
      ...(isOriginal ? placementFor(placement, selectedVerdict) : {}),
    });
  }

  const canExecute = hasPermission("judgment.execute");

  /** 主按钮 / ⌘⏎:先进确认层,落判在层里。与落判同一道门:选了裁决才进。 */
  function openConfirm() {
    if (!selectedVerdict) {
      showToast(t("judgment.detail.select_verdict"), "error");
      return;
    }
    // 改动不完整就不进层:先在 戊 改好,再走盖印。平板上草稿栏收着,就把它打开。
    if (amendmentChanges() === null) {
      setDraftOpen(true);
      return;
    }
    concludeMutation.reset(); // 每次进层从头来:上一次的结果(含被拒)不属于这一次
    setConfirming(true);
  }

  /* 丁 · 判词自动保存。只在动过之后存;409 停下并把对方的版本交给冲突条(见 useDraftAutosave)。 */
  const draft = useDraftAutosave({
    judgmentId: id,
    notes,
    verdict: selectedVerdict,
    placement,
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

  /* 裁决键 1–4 选定;⌘⏎ 第一下进确认层,层里再一下落判。焦点在判词框里时 1–4 不接(那是在写字),⌘⏎ 接。
     两下都过同一道门:持 judgment.execute、已选裁决、不在提交中。确认层开着时 1–4 不改裁决 ——
     层上写着的就是要落的那一个。 */
  const deskOpen = !!judgment && !judgment.is_final;
  useHotkeys(
    {
      ...Object.fromEntries(
        VERDICTS.map((member, i) => [String(i + 1), () => { if (!confirming) chooseVerdict(member); }])
      ),
      "mod+Enter": () => {
        if (!canExecute || !selectedVerdict || concludeMutation.isPending) return;
        if (confirming) handleConclude();
        else openConfirm();
      },
    },
    deskOpen
  );
  /* F 展开 / 收起全案,Esc 回聚焦(原型:单栏不响应 F)。确认层开着时都不接 —— Esc 归层自己。 */
  useHotkeys(
    {
      f: () => {
        const wide = typeof window.matchMedia !== "function" || window.matchMedia("(min-width: 768px)").matches;
        if (wide) setView((v) => (v === "case" ? "focus" : "case"));
      },
      ...(view === "case" ? { Escape: () => setView("focus") } : {}),
    },
    !!judgment && !confirming
  );

  /* K 上一件:与 `next/` 同一队列;打字时不接(useHotkeys)。结案后也能回看上一件。 */
  const { data: previous } = useJudgmentPrevious(id);
  const previousId = previous?.judgment?.id ?? null;
  useHotkeys({ k: () => previousLink.current?.click() }, !!previousId && !confirming);
  /* J 下一件:同一队列、同一顺序往后一步(我认领在前,再先进先出,暂缓不在其中);与 K 同样的规矩。 */
  const { data: nextCase } = useJudgmentNextAfter(id);
  const nextId = nextCase?.judgment?.id ?? null;
  useHotkeys({ j: () => nextLink.current?.click() }, !!nextId && !confirming);

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
    "inline-flex items-center gap-2 font-mono text-xs text-[oklch(var(--color-ink-muted))] hover:text-[oklch(var(--color-ink))]";
  const fullCase = view === "case";
  /* 版式(v3 第 7 轮 `JudgmentDesk`):≥1280 三栏 灵魂 | 当前这一判 | 草稿;768–1279 两栏,草稿落到资料舱下面;
     <768 单栏,顺序是 判 → 资料舱 → 草稿 → 灵魂(原型的手机版:案卷导航 + 判 + 资料),灵魂与草稿由导航跳到。
     全案(F)时只剩资料舱三栏并置 + 右侧窄栏的判。一份 DOM,只换栏与顺序:判词、检索框里的字都不丢。 */
  const deskGrid = fullCase
    ? "grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,1fr)_240px]"
    : "grid grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)_300px]";
  const notesShown = isFinal ? judgment.notes : notes;

  const materials: Record<DeskMaterial, { label: string; node: ReactNode }> = {
    confession: {
      label: t("judgment.detail.confession"),
      node: (
        <>
          {/* SERIF = WORDS SOMEONE SAID. That contrast replaces the `italic` +
              curly quotes this paragraph used to carry: a confession in italic
              reads as an aside, and italic is then unavailable for what italic
              is for. */}
          {judgment.confession ? (
            <p className="max-w-[72ch] font-serif text-md font-normal text-[oklch(var(--color-ink))]">{judgment.confession}</p>
          ) : (
            <p className="text-sm text-[oklch(var(--color-ink-subtle))]">
              <MissingValue kind="unrecorded" />
            </p>
          )}
          {/* 全案时草稿栏收起,判词在供词下面读(原型「判官批注」)。 */}
          {fullCase && notesShown && (
            <div className="mt-6 border-t border-[oklch(var(--color-line))] pt-3">
              <p className="text-2xs uppercase text-[oklch(var(--color-ink-subtle))]">{t("souls.detail.ledger.verdict_words")}</p>
              <blockquote className="mt-2 font-serif text-md font-normal text-[oklch(var(--color-ink))] whitespace-pre-wrap">
                {notesShown}
              </blockquote>
            </div>
          )}
        </>
      ),
    },
    evidence: {
      label: t("judgment.desk.tab_evidence"),
      node: (
        <>
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
        </>
      ),
    },
    law: {
      label: t("judgment.desk.tab_law"),
      node: (
        <>
          {!isFinal && (
            <CitationChips
              citations={citations}
              onRemove={canEditGrounds ? (statuteId) => unciteMutation.mutate(statuteId) : undefined}
            />
          )}
          {/* 据 · 依据条文. Shown once the case is decided — INCLUDING when it cited nothing,
              which is the informative case: a concluded verdict with no stated
              basis is a fact to show, not a box to hide. On an open case, only
              once grounds exist, so a pending proceeding grows no empty panel. */}
          {(isFinal || citations.length > 0) && (
            <div className="mt-4">
              <JudgmentGroundsPanel citations={citations} />
            </div>
          )}
          {/* 据 · 检索:只在未结案时有事可做(引用一条律条)。 */}
          {!isFinal && (
            <div className="mt-6">
              <JudgmentSectionHead title={t("judgment.desk.statute_search")} />
              <StatuteSearch
                civilization={judgment.civilization}
                cited={citedIds}
                onCite={canEditGrounds ? (statuteId) => citeMutation.mutate(statuteId) : undefined}
              />
              <PrecedentsPanel judgmentId={judgment.id} />
            </div>
          )}
        </>
      ),
    },
  };

  return (
    <>
    {!isFinal && <QueueBar judgmentId={judgment.id} canDefer={canExecute} />}
    {/* 语料页「插入审判台」带着 ?cite= 进来:确认后引用;并记下这是最后打开的未结案。 */}
    <CiteFromCorpus judgment={judgment} canCite={canEditGrounds} onCite={(statuteId) => citeMutation.mutate(statuteId)} />
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
      {/* 案卷导航(原型 `mobile-case-nav` / `tablet-draft-trigger`)。≤767 单栏:两个锚点,内容一直在文档流里。
          768–1279 两栏:「草稿与批注」是开关(v3 平板,2026-10-01 拍板),收起时草稿栏只是 hidden ——
          判词、发落、自动保存都还在。收着的时候有没存上的改动或 409 冲突,开关上挂 ◐ / !,不会悄悄漏掉。 */}
      {!fullCase && (
        <nav
          aria-label={t("judgment.desk.case_nav")}
          className={`mb-4 flex h-10 items-stretch gap-1 border-b border-[oklch(var(--color-line))] text-sm xl:hidden ${isFinal ? "md:hidden" : ""}`}
        >
          <a href="#desk-soul" className="inline-flex items-center px-3 text-[oklch(var(--color-ink-muted))] hover:text-[oklch(var(--color-ink))] md:hidden">
            {t("judgment.queue.identity")}
          </a>
          <a href="#desk-draft" className="inline-flex items-center px-3 text-[oklch(var(--color-ink-muted))] hover:text-[oklch(var(--color-ink))] md:hidden">
            {t("judgment.desk.nav_draft")}
          </a>
          {!isFinal && (
            <button
              type="button"
              data-testid="draft-toggle"
              aria-expanded={draftOpen}
              aria-controls="desk-draft"
              onClick={() => setDraftOpen((open) => !open)}
              className={`hidden items-center gap-2 px-3 md:inline-flex ${
                draftOpen
                  ? "font-semibold text-[oklch(var(--color-ink))] shadow-[inset_0_-2px_0_oklch(var(--color-ink))]"
                  : "text-[oklch(var(--color-ink-muted))] hover:text-[oklch(var(--color-ink))]"
              }`}
            >
              {t("judgment.desk.nav_draft")}
              {draft.conflict ? (
                <span data-testid="draft-toggle-mark" title={t("judgment.desk.draft_conflict")}>
                  <span aria-hidden="true">!</span>
                  <span className="sr-only">{t("judgment.desk.draft_conflict")}</span>
                </span>
              ) : draft.unsaved ? (
                <span data-testid="draft-toggle-mark" title={t("judgment.desk.draft_unsaved")}>
                  <span aria-hidden="true">◐</span>
                  <span className="sr-only">{t("judgment.desk.draft_unsaved")}</span>
                </span>
              ) : null}
            </button>
          )}
        </nav>
      )}
      <div data-testid="judgment-desk" data-view={view} className={deskGrid}>
        {/* ── 灵魂 · 身份 / 功过 / 前世 ───────────────────────────────────── */}
        <section
          id="desk-soul"
          aria-label={t("judgment.queue.case")}
          className={`min-w-0 scroll-mt-16 ${fullCase ? "hidden" : "order-4 md:order-1"}`}
        >
          <JudgmentSectionHead mark="甲" title={t("judgment.detail.soul_info")} />
          <p className="mt-3 text-lg text-[oklch(var(--color-ink))] wrap-break-word">
            <DomainText value={soulName} />
          </p>
          <dl className="mt-3 divide-y divide-[oklch(var(--color-rule))]">
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
                  <li key={life.id} className="py-2 border-b border-[oklch(var(--color-rule))] text-sm">
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
        </section>

        {/* ── 判 · 当前这一判 / 裁决键 / 进入盖印确认 ───────────────────────── */}
        <section
          aria-labelledby={clausesId}
          data-testid="current-decision"
          className={`relative isolate min-w-0 overflow-clip py-6 text-center ${
            fullCase ? "order-2 border border-[oklch(var(--color-line))] px-4 md:self-start" : "order-1 md:order-2 md:py-8"
          }`}
        >
          <CivMotif />
          {judgment.deferred_at && !isFinal && (
            <p data-testid="deferred-note" className="mb-4 border-l-3 border-[oklch(var(--color-warning))] pl-3 text-left text-sm text-[oklch(var(--color-ink-muted))]">
              {t("judgment.desk.deferred_note", { reason: judgment.defer_reason ?? "" })}
            </p>
          )}
          <h2 id={clausesId} className="text-2xs uppercase text-[oklch(var(--color-ink-subtle))]">
            {t("judgment.desk.current_ruling")}
          </h2>

          {isFinal && ordered ? (
            <div className="mt-6 flex flex-col items-center gap-3">
              {/* 进页时已结案:印就是落定的样子,不播。这一次会话里落的判在确认层里盖过了。 */}
              <Seal size={72} court={judgment.court ?? undefined} className="shrink-0" />
              <p data-testid="current-ruling" className={`${fullCase ? "text-xl" : "text-display-lg"} text-[oklch(var(--color-ink))]`}>
                <span aria-hidden="true" className="mr-3 font-normal">{verdictGlyph(ordered)}</span>
                <DomainEnum namespace="judgment.verdicts" value={judgment.verdict} />
              </p>
              {/* 主审 · 结案时间. 印记 / 会审比数 have no fields — file header. */}
              <p
                className="max-w-full truncate font-mono text-xs text-[oklch(var(--color-ink-subtle))]"
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
              <Badge tone="neutral">{t("judgment.detail.final")}</Badge>
            </div>
          ) : (
            <>
              {/* 展示数字(DESIGN.md:当前判决 = text-display-lg)。换判时旧字形不留,新字形 160ms 淡入。 */}
              <p
                data-testid="current-ruling"
                aria-live="polite"
                className={`mt-6 ${fullCase ? "text-xl" : "text-display-lg"} text-[oklch(var(--color-ink))]`}
              >
                <span key={selectedVerdict} className="inline-block transition-opacity duration-fast ease-enter starting:opacity-0">
                  {/* 总有一个裁决:没选过时是预选的「待定」(DEFAULT_VERDICT)。空串只在详情到达前的那一帧。 */}
                  {selectedVerdict && (
                    <>
                      <span aria-hidden="true" className="mr-3 font-normal">{verdictGlyph(selectedVerdict as VerdictMember)}</span>
                      <DomainEnum namespace="judgment.verdicts" value={selectedVerdict} />
                    </>
                  )}
                </span>
              </p>
              {!fullCase && (
                <p className="mx-auto mt-3 max-w-prose text-xs text-[oklch(var(--color-ink-muted))]">{t("judgment.desk.ruling_hint")}</p>
              )}
            </>
          )}

          {/* ── 裁决键组:字形 + 文字,不靠颜色;选中 = 墨底反白(v3)。 ── */}
          {/* `role="group"` only while the clauses are choosable — four radios
              sharing a `name` are a group to the browser but nothing names that
              group; on a decided case there is nothing to choose. */}
          <ol
            data-testid="verdict-bar"
            className={`mx-auto mt-6 grid max-w-[540px] gap-2 text-left ${fullCase ? "grid-cols-1" : "grid-cols-2 sm:grid-cols-4"}`}
            {...(isFinal ? {} : { role: "group", "aria-labelledby": clausesId })}
          >
            {VERDICTS.map((member, index) => {
              const isOrdered = ordered === member;
              const isChosen = selectedVerdict === member;
              const marked = isFinal ? isOrdered : isChosen;
              const clause = <VerdictKeyContent code={member} keyHint={String(index + 1)} />;
              const tile = `${VERDICT_KEY_CLASS} ${marked ? VERDICT_CHOSEN : "bg-[oklch(var(--color-surface-1))]"}`;

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
                      className={`${tile} cursor-pointer focus-within:outline-solid focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[oklch(var(--color-focus))]`}
                    >
                      <input
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

          {/* ── 进入盖印确认:落判在确认层里,不在这里 ─────────────────────── */}
          {!isFinal && (
            <div className="mt-6 flex flex-col items-center gap-2">
              <RequirePermission permissions="judgment.execute">
                <Button
                  type="button"
                  variant="primary"
                  size="lg"
                  className={`gap-2 ${fullCase ? "w-full" : "min-w-60"}`}
                  onClick={openConfirm}
                  disabled={!selectedVerdict}
                >
                  {t("judgment.desk.to_confirm")}
                  <Kbd>⌘⏎</Kbd>
                </Button>
              </RequirePermission>
              <p className="text-2xs text-[oklch(var(--color-ink-subtle))]">{t("judgment.desk.irreversible")}</p>
            </div>
          )}
        </section>

        {/* ── 丁 · 判词 / 戊 · 发落 / 审批流 · 联审 ─────────────────────────── */}
        <section
          id="desk-draft"
          aria-label={t("judgment.desk.nav_draft")}
          className={`min-w-0 scroll-mt-16 ${
            fullCase
              ? "hidden"
              : `order-3 md:col-span-2 xl:order-3 xl:col-span-1 ${
                  /* 已结案没有可编辑的东西,判词照常摊开;未结案在 768–1279 收着,打开后排在资料舱上面。 */
                  isFinal ? "md:order-4" : draftOpen ? "md:order-3" : "md:order-4 md:max-xl:hidden"
                }`
          }`}
        >
          <JudgmentSectionHead mark="丁" title={t("souls.detail.ledger.verdict_words")} />
          {isFinal ? (
            /* 判词是「有人说过的话」,所以衬线(规范 v1 表态 1:判词、忏悔录、古典语料)。 */
            judgment.notes ? (
              <blockquote className="mt-3 pl-3 border-l-2 border-[oklch(var(--color-ink))] font-serif text-md font-normal text-[oklch(var(--color-ink))] max-w-[72ch]">
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
              {/* 衬线输入 QuoteInput:判词是正被说出的话,所以输入框本身用衬线、字号 text-md font-normal。 */}
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
                className="block w-full mt-3 rounded-control border border-[oklch(var(--color-line-strong))] bg-[oklch(var(--color-surface-1))] px-3 py-2 font-serif text-md font-normal text-[oklch(var(--color-ink))] placeholder:text-[oklch(var(--color-ink-subtle))] transition-[border-color] duration-state focus-visible:border-[oklch(var(--color-ink))] resize-y"
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
                    setSelectedVerdict(theirs.draft_verdict ?? DEFAULT_VERDICT);
                    setPlacement(placementFromDraft(theirs) ?? EMPTY_PLACEMENT);
                  }}
                  onKeepMine={draft.keepMine}
                />
              )}
            </>
          )}

          {/* ── 戊 · 发落:原审判选目的地与刑期;加减项审判的发落是计划改动。 ── */}
          {!isFinal && isOriginal && canExecute && (
            <JudgmentPlacement
              judgmentId={judgment.id}
              verdict={selectedVerdict}
              value={placement}
              onChange={(next) => {
                concludeMutation.reset(); // 改了发落,上一次的拒绝就不再是这一份的
                placementTouched.current = true;
                setPlacement(next);
                draft.markEdited();
              }}
              refusal={placementRefusal}
              savedAt={draft.status === "idle" && !draft.conflict ? judgment.draft_saved_at : null}
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

          {!isFinal && (
            <div className="mt-6 flex flex-col gap-4 border-t border-[oklch(var(--color-line))] pt-4">
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
            </div>
          )}
        </section>

        {/* ── 资料舱 · 供词 / 功过记录 / 律条引用 ──────────────────────────── */}
        <div className={`min-w-0 ${fullCase ? "order-1" : `order-2 ${draftOpen && !isFinal ? "md:order-4" : "md:order-3"} md:col-span-2 xl:order-4 xl:col-span-3`}`}>
          <MaterialDock
            active={material}
            onActive={setMaterial}
            fullCase={fullCase}
            onToggleFullCase={() => setView(fullCase ? "focus" : "case")}
            panels={materials}
          />
        </div>
      </div>
    </PageShell>
    {!isFinal || concludeMutation.isSuccess ? (
      <JudgmentConfirmLayer
        open={confirming}
        onClose={() => setConfirming(false)}
        verdict={selectedVerdict}
        court={judgment.court}
        withWorkflow={createWorkflow}
        pending={concludeMutation.isPending}
        done={concludeMutation.isSuccess}
        stampKey={stamp}
        onConfirm={handleConclude}
      />
    ) : null}
    </>
  );
}

/** `76px 标签 | 值`, one rule apart. */
function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[76px_1fr] items-baseline gap-3 py-2">
      <dt className="text-2xs uppercase text-[oklch(var(--color-ink-subtle))]">{label}</dt>
      <dd className="text-sm text-[oklch(var(--color-ink))] min-w-0 wrap-break-word">{children}</dd>
    </div>
  );
}
