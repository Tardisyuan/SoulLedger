"use client";

import { use, useEffect, useId, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { crossTenantJudgmentsApi, judgmentApi, soulsApi } from "@soulledger/core/api";
import { judgmentKeys, soulKeys } from "@soulledger/core/query_keys";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { DomainEnum, DomainText, IdentifierChip, MissingValue } from "@/src/components/ui/DomainValue";
import {
  JudgmentGroundsPanel,
  JudgmentSectionHead,
} from "@/src/components/judgment/JudgmentGroundsPanel";
import { JudgmentComments } from "@/src/components/judgment/JudgmentComments";
import { CaseAttachments } from "@/src/components/judgment/CaseAttachments";
import { CaseAttachmentsPrintList } from "@/src/components/judgment/CaseAttachmentsPrintList";
import { JudgmentEvidenceColumn } from "@/src/components/judgment/JudgmentEvidenceColumn";
import { JudgmentEvidenceAdmission } from "@/src/components/judgment/JudgmentEvidenceAdmission";
import { OffenceField, WangsiPanel, untimelyLine } from "@/src/components/judgment/DiyuCaseFields";
import {
  DraftConflictBanner,
  DraftStatusLine,
  DraftSavedAt,
  useDraftAutosave,
} from "@/src/components/judgment/JudgmentDraftAutosave";
import { PageShell } from "@/src/components/ui/PageShell";
import { PrintFrame } from "@/src/components/print/PrintFrame";
import { PageSpinner } from "@/src/components/ui/Spinner";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { QueryError } from "@/src/components/ui/PageError";
import { Button, buttonVariants } from "@/src/components/ui/Button";
import { Badge } from "@/src/components/ui/Badge";
import { reincarnationApi, type ConcludeJudgmentPayload, type Reincarnation } from "@soulledger/core/api";
import { isAtCityGod } from "@soulledger/core/domain/cityGods";
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
  VERDICT_KEY_COMPACT,
  VerdictKeyContent,
} from "@/src/components/judgment/JudgmentDesk";
import { Seal } from "@/src/components/plaque/Seal";
import {
  CivMotif,
  JudgmentConfirmLayer,
  MaterialDock,
  type DeskMaterial,
} from "@/src/components/judgment/JudgmentDeskStage";
import { useHotkeys, useShortcutHelp } from "@/src/lib/hotkeys";
import { FROM_PARAM, sourceFrom, withFrom } from "@/src/lib/backSource";
import { verdictGlyph } from "@/src/lib/verdictGlyph";
import type { SentenceRequestChanges } from "@soulledger/core/api/sentence-plans";
import { isHeldUntilFatedDate } from "@soulledger/core/domain/dates";
import { useTenant } from "@/src/contexts/TenantContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import { useMenuButtonConfig } from "@/src/hooks/useMenuButtonConfig";
import { AmendmentPlanChanges } from "@/src/components/sentence-plan/AmendmentPlanChanges";
import { NegativeConfessionPanel } from "@/src/components/judgment/NegativeConfessionPanel";
import {
  EMPTY_DRAFT,
  draftIsEmpty,
  draftToChanges,
  type ChangesDraft,
} from "@/src/components/sentence-plan/PlanChangesEditor";
import { REFUSAL_CODES } from "@/src/components/sentence-plan/sentencePlanDisplay";
import { OpenCrossJudgment } from "@/src/components/cross-judgments/OpenCrossJudgment";
import { FlowStationPicker, useFlowPreview } from "@/src/components/workflow/segments/FlowStationPicker";
import { segmentRefusalOf, segmentRefusalText } from "@soulledger/core/domain/workflowSegments";
import { CrossJudgmentBlockedNotice, isCrossJudgmentOpen } from "@/src/components/judgment/CrossJudgmentBlockedNotice";
import {
  EMPTY_PLACEMENT,
  JudgmentPlacement,
  PLACEMENT_REFUSALS,
  placementFor,
  placementFromDraft,
  type Placement,
} from "@/src/components/judgment/JudgmentPlacement";
import { useArchiveJudgment, useCaseAttachments, useJudgmentNextAfter, useJudgmentPrevious, useUnarchiveJudgment, useUndeferJudgment } from "@soulledger/core/hooks/useJudgments";
import { ArchiveBanner, ArchiveDialog } from "@/src/components/archive/ArchiveParts";
import { claimRefusalMessage } from "@/src/components/judgment/JudgmentClaimDialogs";
import { usePlaque } from "@/src/components/plaque/Plaque";
import { useHall } from "@/src/components/plaque/useHall";

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

/** 埃及称心的结案拒绝(apps/judgment/weighing.py),各有一句译文 `judgment.weighing.errors.*`。 */
const WEIGHING_REFUSALS = ["verdict_contradicts_weighing", "wavering_has_no_destination", "wavering_with_open_cross"] as const;

/*
 * 规范 v2 补足 B8:判决不靠颜色区分 —— 四个裁决键同一个幽灵样式(`VERDICT_KEY_CLASS`,与审判队列共用),
 * 字形 + 文字。v3 把「选中」画成墨底反白(原型 `verdict-selector button.selected`):中性,不是第六处
 * 主色;✕ 也是墨色,冷玫红只给系统出错。键帽数字跟着反白(`[&_kbd]:text-current`)。
 * 2026-10-01 键改成 v3 的约 74px 高之后,原型「选中项上移 6px」也一起照做(`VERDICT_LIFT`):
 * translateY(0 → −6px)+ raised 阴影,160ms(键本身的 `duration-fast`);减少动态效果时全局把
 * 时长压到 1ms,即瞬时到位。单列的案卷视图不上移(v3 `.is-compact .selected { transform: none }`),
 * 已结案的「所判」一格也不上移 —— 那不是此刻的选择。
 */
const VERDICT_CHOSEN =
  "bg-[oklch(var(--color-ink))] text-[oklch(var(--color-surface-1))] hover:bg-[oklch(var(--color-ink))] [&_kbd]:text-current";
const VERDICT_LIFT = "-translate-y-1.5 shadow-raised";

const NO_LIVES: Reincarnation[] = [];

interface PageProps {
  params: Promise<{ id: string }>;
}

const DESK_SHORTCUTS = [
  { key: "1–4", label: "shortcuts.pick_verdict" },
  { key: "⌘/Ctrl ⏎", label: "shortcuts.conclude" },
  { key: "F", label: "shortcuts.toggle_case" },
  { key: "J / K", label: "shortcuts.next_prev_case" },
] as const;

export default function JudgmentDetailPage({ params }: PageProps) {
  const { id } = use(params);
  /** 来源队列(链接上的 `?from=`,见 src/lib/backSource.ts);没写就是审判列表。J / K 带着它走。 */
  const from = sourceFrom(useSearchParams()?.get(FROM_PARAM));
  const back = from ?? "/judgment";
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
  // 案卷附件(W4):只为页脚那句「附件原件见系统」知道有没有附件;与区块里是同一个查询(react-query 合并请求)。
  const canReadAttachments = hasPermission("judgment.read");
  const hasAttachments = (useCaseAttachments(id, { enabled: canReadAttachments }).data?.count ?? 0) > 0;
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

  /* 挂着的跨域审判(第四十批 W-a):载入时就看它结束没有 —— 没结束,结案按钮置灰、上面一句为什么。
     与跨域审判详情页同一把缓存键。原审判在发起方(原属)这边,读得到。 */
  const crossId = judgment?.cross_judgment_id ?? null;
  const { data: cross } = useQuery({
    queryKey: ["cross-judgments", "detail", crossId],
    queryFn: () => crossTenantJudgmentsApi.get(crossId!).then((res) => res.data),
    enabled: !!crossId && !judgment?.is_final,
  });
  /* 第四十三批:原审判挂着还没结束的跨域审判时不再挡结案 —— 结案必须生成审批流程,跨域审判并进流程里(外域按顺序
     接在后面)。勾选框锁成勾上。只有不是原审判的(加减项审判)仍按旧规矩挡。 */
  const crossOpen = isCrossJudgmentOpen(cross);
  const crossForced = crossOpen && (judgment?.kind ?? "ORIGINAL") === "ORIGINAL";
  const crossBlocked = crossOpen && !crossForced;
  /* 埃及:每件案子都称心(docs/02 §5,2026-10-27)。天平给的裁决是唯一能落的「通过 / 不通过」,「待定 / 重审」=
     天平摇摆、另开一次称量、不发落;原审判的称心流程必走,走完才执行。服务端同样拒收。 */
  const weighing = judgment?.admitted_balance?.weighing ?? null;
  const weighedCase = judgment?.judgment_method === "HEART_WEIGHING" && judgment?.kind !== "AMENDMENT";
  const weighingForced = weighedCase && (judgment?.kind ?? "ORIGINAL") === "ORIGINAL";
  const withWorkflow = createWorkflow || crossForced || weighingForced;
  /** W-1a 选站:确认层第 2 步里取消勾选的站(站序)。确认层的步数也在这里(⌘⏎ 按步走)。 */
  const [skipOrders, setSkipOrders] = useState<Set<string>>(new Set());
  const [confirmStep, setConfirmStep] = useState<1 | 2>(1);
  /* 第四十五批:本域的流程没有一站能跳过(希腊常规流程)时不进选站那一步 ——「结案」还是「结案」,没有「下一步」。
     与第 2 步的选站列表同一个 query。没取到之前照旧走两步。 */
  const flowPreview = useFlowPreview({ judgment: id }, withWorkflow && !!judgment && !judgment.is_final);
  const noPick = flowPreview.data?.nothing_to_pick === true;
  /** 提交时才被 409 `cross_judgment_open` 挡下(并发):确认层里换成同一句话。 */
  const [crossRefused, setCrossRefused] = useState(false);

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
      if (code === "cross_judgment_open" && crossId) {
        setCrossRefused(true);
        queryClient.invalidateQueries({ queryKey: ["cross-judgments", "detail", crossId] });
        return;
      }
      if (code && (REFUSAL_CODES as readonly string[]).includes(code)) {
        showToast(t(`sentence_plan.errors.${code}`), "error");
        return;
      }
      if (code && (WEIGHING_REFUSALS as readonly string[]).includes(code)) {
        showToast(t(`judgment.weighing.errors.${code}`), "error");
        return;
      }
      // 第四十三批的选站拒绝(终审 / 驳回目标 / 跨域审判要流程):译好的一句,不是后端的英文。
      const segmentRefusal = segmentRefusalText(t, segmentRefusalOf(err));
      if (segmentRefusal) {
        showToast(segmentRefusal, "error");
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
        setSelectedVerdict(judgment.draft_verdict || judgment.admitted_balance?.weighing?.weighed_verdict || DEFAULT_VERDICT);
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

  /** 埃及:天平给了「通过」就不能判「不通过」,反之亦然(待定 / 重审 = 天平摇摆,总可以选)。 */
  function contradictsScale(member: string) {
    return !!weighing && (member === "PASSED" || member === "FAILED") && member !== weighing.weighed_verdict;
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
      create_workflow: withWorkflow,
      ...(withWorkflow && skipOrders.size ? { skip_node_orders: [...skipOrders].map(Number) } : {}),
      ...(planChanges ? { plan_changes: planChanges } : {}),
      ...(isOriginal ? placementFor(placement, selectedVerdict) : {}),
    });
  }

  const canExecute = hasPermission("judgment.execute");
  // 城隍初审中(第五十三批 J-1):十殿不能认领、暂缓、结案(服务端 409 `at_city_god`),按钮置灰并说原因。
  const atCityGod = isAtCityGod(judgment?.city_god_status);
  const buttonOn = useMenuButtonConfig();
  const archiveMutation = useArchiveJudgment();
  const unarchiveMutation = useUnarchiveJudgment();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const undefer = useUndeferJudgment();

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
    setCrossRefused(false);
    setConfirmStep(1);
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
    if (contradictsScale(member)) return; // 快捷键也不能选天平没给的裁决
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
  useShortcutHelp(DESK_SHORTCUTS, deskOpen);
  useHotkeys(
    {
      ...Object.fromEntries(
        VERDICTS.map((member, i) => [String(i + 1), () => { if (!confirming) chooseVerdict(member); }])
      ),
      "mod+Enter": () => {
        if (!canExecute || atCityGod || !selectedVerdict || concludeMutation.isPending || crossBlocked || crossRefused) return;
        if (confirming && withWorkflow && !noPick && confirmStep === 1) setConfirmStep(2);
        else if (confirming) handleConclude();
        else openConfirm();
      },
    },
    deskOpen
  );
  /* F 展开 / 收起全案,Esc 回聚焦(原型:单栏不响应 F)。确认层开着时都不接 —— Esc 归层自己。 */
  useHotkeys(
    {
      f: () => {
        const wide = typeof window.matchMedia !== "function" || window.matchMedia("(min-width: 769px)").matches;
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

  /* A known route, so a link and not a router.back() button — the source queue when the link said so. */
  const backLink = (
    <Link
      href={back}
      className="text-xs text-[oklch(var(--color-ink-muted))] hover:text-[oklch(var(--color-ink))] transition-colors"
    >
      {t("judgment.detail.back_to_list")}
    </Link>
  );

  // 身份带:题「审判台」(v3 `pageTitle`;面包屑末段是「详情」)。右栏是案号(v3 `identity-case`),
  // 可复制,本页只这一处(用户 2026-10-02;CASE_NUMBER_POLICY)—— 页头 eyebrow 不再重复。
  // 殿名:这个案子的殿;案子没记殿(`court` 是空串)就写刑名司。
  const hall = useHall(judgment?.court || t("plaque.office.trials"));
  usePlaque({ title: t("plaque.desk"), hall, caseNumber: judgment?.case_number });

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
            <Link href={back} className="text-sm text-[oklch(var(--color-ink-muted))] hover:text-[oklch(var(--color-ink))] transition-colors">
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
      {/* 枉死(第五十一批 F-3):候审期间多一行「枉死 · 候至 日期 · 在枉死城」,到期后收成「枉死」;
          申诉属实提前释放后是「枉死 · 日期 已提前释放」(第五十七批 D-2b)。枉死城块头写同一句。 */}
      {judgment.untimely && (
        <span data-testid="desk-untimely" className="basis-full text-[oklch(var(--color-ink))]">
          {untimelyLine(judgment, t, formatDate)}
        </span>
      )}
      {/* 埃及入殿前(review P2-9):木乃伊 70 天期间带「候至 日期」,到期后只留阶段名。 */}
      {judgment.duat_stage && (
        <span data-testid="desk-duat" className="basis-full text-[oklch(var(--color-ink))]">
          <DomainEnum namespace="judgment.duat_stage" value={judgment.duat_stage} />
          {isHeldUntilFatedDate(judgment) && ` · ${t("judgment.held_until", { date: judgment.held_until as string })}`}
        </span>
      )}
      {atCityGod && (
        <span data-testid="desk-at-city-god" className="basis-full flex flex-wrap items-center gap-2 text-[oklch(var(--color-ink))]">
          <Badge tone="warning">{t("judgment.at_city_god")}</Badge>
          {judgment.city_god_name} · <DomainEnum namespace="cityGodCases.status" value={judgment.city_god_status} />
        </span>
      )}
      {judgment.city_god_status === "SENT_ON" && judgment.sent_on_at && (
        <span data-testid="desk-sent-on" className="basis-full text-[oklch(var(--color-ink-muted))]">
          <span aria-hidden="true">▷ </span>
          {t("cityGodCases.sent_on_line", { city_god: judgment.city_god_name ?? "", date: formatDateTime(judgment.sent_on_at) })}
          {judgment.city_god_note && <span className="block pl-4 text-[oklch(var(--color-ink))]">{judgment.city_god_note}</span>}
        </span>
      )}
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

  const showPlacement =
    !isFinal && isOriginal && canExecute && !(weighedCase && (selectedVerdict === "PURGATORY" || selectedVerdict === "RETRY"));
  const offenceField =
    judgment.civilization === "CHINESE" ? <OffenceField judgment={judgment} editable={!isFinal && canExecute} /> : null;

  const materials: Record<DeskMaterial, { label: string; node: ReactNode }> = {
    confession: {
      label: t("judgment.detail.confession"),
      node: (
        <>
          {/* 案由(`summary`):官员写的概述,与下面灵魂的供词是两回事。未结案且持 judgment.execute 才可改;其余只读,空则不画。 */}
          {!isFinal && canExecute ? (
            <CaseSummaryField id={id} value={judgment.summary ?? ""} />
          ) : judgment.summary ? (
            <div className="mb-4">
              <p className="text-2xs uppercase text-[oklch(var(--color-ink-subtle))]">{t("officer_app.case.summary")}</p>
              <p className="mt-1 max-w-[72ch] whitespace-pre-wrap text-sm text-[oklch(var(--color-ink))]">{judgment.summary}</p>
            </div>
          ) : null}
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
          {/* 埃及称心:四十二条否定告白逐条记录(2026-10-28)。不称心的案子组件自己不画。 */}
          {judgment.judgment_method === "HEART_WEIGHING" && (
            <NegativeConfessionPanel judgmentId={judgment.id} canRecord={canExecute} />
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
    {!isFinal && <QueueBar judgmentId={judgment.id} canDefer={canExecute && !atCityGod} />}
    {/* 语料页「插入审判台」带着 ?cite= 进来:确认后引用;并记下这是最后打开的未结案。 */}
    <CiteFromCorpus judgment={judgment} canCite={canEditGrounds} onCite={(statuteId) => citeMutation.mutate(statuteId)} />
    <PrintFrame hall={hall} reference={judgment.case_number} referenceLabel={t("print.case_no")} note={hasAttachments ? t("case.attachments.print_footer") : undefined}>
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
        previousId || nextId || isFinal ? (
          <span className="inline-flex items-center gap-4">
            {/* 有裁决的审判不能删,只能归档(后端 `archive` 只收有裁决的)。 */}
            {judgment.verdict && !judgment.is_archived && canExecute && buttonOn("judgment.archive") && (
              <Button type="button" variant="secondary" size="sm" onClick={() => setArchiveOpen(true)}>
                {t("records.archive.confirm")}
              </Button>
            )}
            {/* 判词(结案后的文书)可以打印;未结案的草稿不是文书,不给入口。 */}
            {isFinal && (
              <Button type="button" variant="secondary" size="sm" onClick={() => window.print()}>
                {t("print.button")}
              </Button>
            )}
            {previousId && (
              <Link ref={previousLink} href={withFrom(`/judgment/${previousId}`, from)} className={CURSOR_LINK}>
                <Kbd>K</Kbd>
                {t("judgment.desk.previous")}
              </Link>
            )}
            {nextId && (
              <Link ref={nextLink} href={withFrom(`/judgment/${nextId}`, from)} className={CURSOR_LINK}>
                <Kbd>J</Kbd>
                {t("judgment.desk.next")}
              </Link>
            )}
          </span>
        ) : undefined
      }
    >
      <ArchiveBanner
        record={judgment}
        onUnarchive={canExecute ? () => unarchiveMutation.mutate(id) : undefined}
        pending={unarchiveMutation.isPending}
      />
      <ArchiveDialog
        isOpen={archiveOpen}
        name={judgment.case_number}
        onClose={() => setArchiveOpen(false)}
        onConfirm={(reason) => archiveMutation.mutate({ id, reason }, { onSuccess: () => setArchiveOpen(false) })}
        isPending={archiveMutation.isPending}
      />
      {/* 案卷导航(原型 `mobile-case-nav` / `tablet-draft-trigger`)。≤767 单栏:两个锚点,内容一直在文档流里。
          768–1279 两栏:「草稿与批注」是开关(v3 平板,2026-10-01 拍板),收起时草稿栏只是 hidden ——
          判词、发落、自动保存都还在。收着的时候有没存上的改动或 409 冲突,开关上挂 ◐ / !,不会悄悄漏掉。 */}
      {!fullCase && (
        <nav
          aria-label={t("judgment.desk.case_nav")}
          className={`mb-4 flex h-(--control-h-sm) items-stretch gap-1 border-b border-[oklch(var(--color-line))] text-sm xl:hidden ${isFinal ? "md:hidden" : ""}`}
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
          className={`min-w-0 scroll-mt-28 ${fullCase ? "hidden" : "order-4 md:order-1"}`}
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
            {/* v3 灵魂栏:所在界域(案子挂的那一站 `realm_id`,没挂写「未记录」)· 审判方式 · 世次 / 种类。 */}
            <MetaRow label={t("judgment.detail.current_realm")}>
              <DomainText value={judgment.realm_name} />
            </MetaRow>
            <MetaRow label={t("judgment.detail.method")}>
              <DomainEnum namespace="judgment.methods" value={judgment.judgment_method} />
            </MetaRow>
            <MetaRow label={t("judgment.claim.col_cycle_kind")}>
              <span data-testid="desk-life-kind">
                {judgment.cycle == null ? <MissingValue kind="unrecorded" /> : t("souls.detail.life_number", { n: String(judgment.cycle + 1) })}
                {" / "}
                <DomainEnum namespace="judgment.claim.kinds" value={judgment.kind} />
              </span>
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
          {/* 枉死城(第五十七批 D-2):只在枉死的案子上,放在身份这一组下面。未结案且持 judgment.execute 才可改。 */}
          {judgment.untimely && <WangsiPanel judgment={judgment} editable={!isFinal && canExecute} />}

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
          data-print-ruling=""
          className={`relative isolate min-w-0 overflow-clip py-6 text-center ${
            fullCase ? "order-2 border border-[oklch(var(--color-line))] px-4 md:self-start" : "order-1 md:order-2 md:py-8"
          }`}
        >
          <CivMotif />
          {judgment.deferred_at && !isFinal && (
            <p data-testid="deferred-note" className="mb-4 border-l-3 border-[oklch(var(--color-warning))] pl-3 text-left text-sm text-[oklch(var(--color-ink-muted))]">
              {t("judgment.desk.deferred_note", { reason: judgment.defer_reason ?? "" })}
              {canExecute && (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="ml-3"
                  data-testid="undefer"
                  loading={undefer.isPending}
                  onClick={() =>
                    undefer.mutate(judgment.id, {
                      onSuccess: () => showToast(t("judgment.claim.done_undefer"), "success"),
                      onError: (err) => showToast(claimRefusalMessage(err, t), "error"),
                    })
                  }
                >
                  {t("judgment.claim.undefer")}
                </Button>
              )}
            </p>
          )}
          <h2 id={clausesId} className="text-2xs uppercase text-[oklch(var(--color-ink-subtle))]">
            {t("judgment.desk.current_ruling")}
          </h2>

          {isFinal && ordered ? (
            <div className="mt-6 flex flex-col items-center gap-3">
              {/* 进页时已结案:印就是落定的样子,不播。这一次会话里落的判在确认层里盖过了。 */}
              <Seal size={72} court={judgment.court ?? undefined} className="shrink-0" />
              <p data-testid="current-ruling" className={`font-title ${fullCase ? "text-xl font-semibold" : "text-display-lg"} text-[oklch(var(--color-ink))]`}>
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
                className={`mt-6 font-title ${fullCase ? "text-xl font-semibold" : "text-display-lg"} text-[oklch(var(--color-ink))]`}
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
                <p data-print-hide="" className="mx-auto mt-3 max-w-prose text-xs text-[oklch(var(--color-ink-muted))]">{t("judgment.desk.ruling_hint")}</p>
              )}
            </>
          )}

          {/* ── 裁决键组:字形 + 文字,不靠颜色;选中 = 墨底反白(v3)。 ── */}
          {/* `role="group"` only while the clauses are choosable — four radios
              sharing a `name` are a group to the browser but nothing names that
              group; on a decided case there is nothing to choose. */}
          <ol
            data-testid="verdict-bar"
            data-print-hide=""
            className={`mx-auto mt-6 grid max-w-[540px] gap-2 text-left ${fullCase ? "grid-cols-1" : "grid-cols-2 sm:grid-cols-4"}`}
            {...(isFinal ? {} : { role: "group", "aria-labelledby": clausesId })}
          >
            {VERDICTS.map((member, index) => {
              const isOrdered = ordered === member;
              const isChosen = selectedVerdict === member;
              const offScale = !isFinal && contradictsScale(member);
              const marked = isFinal ? isOrdered : isChosen;
              const clause = <VerdictKeyContent code={member} keyHint={String(index + 1)} />;
              const tile = `${VERDICT_KEY_CLASS} ${fullCase ? VERDICT_KEY_COMPACT : ""} ${
                marked ? VERDICT_CHOSEN : "bg-[oklch(var(--color-surface-1))]"
              } ${marked && !isFinal && !fullCase ? VERDICT_LIFT : ""}`;

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
                      title={offScale ? t("judgment.weighing.contradicts") : undefined}
                      className={`${tile} ${offScale ? "cursor-not-allowed opacity-40" : "cursor-pointer"} focus-within:outline-solid focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[oklch(var(--color-focus))]`}
                    >
                      <input
                        type="radio"
                        name="verdict"
                        value={member}
                        checked={isChosen}
                        disabled={offScale}
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

          {/* 埃及:天平此刻的读数(按本案采信的证据)与结案时托特记下的结果。 */}
          {weighing && !isFinal && (
            <p data-testid="weighing-scale" className="mx-auto mt-3 max-w-[540px] text-center text-xs text-[oklch(var(--color-ink-subtle))]">
              {t("judgment.weighing.scale", { weight: String(weighing.heart_weight), counterweight: String(weighing.counterweight) })}
              {" · "}
              {t("judgment.weighing.gives", { verdict: t(`judgment.verdicts.${weighing.weighed_verdict.toLowerCase()}`) })}
              <span className="mt-1 block">{t("judgment.weighing.wavering_hint")}</span>
            </p>
          )}
          {isFinal && judgment.weighing_result && (
            <p data-testid="weighing-recorded" className="mx-auto mt-3 max-w-[540px] text-center text-xs text-[oklch(var(--color-ink-subtle))]">
              {t("judgment.weighing.recorded", {
                result: t(`judgment.weighing.result.${judgment.weighing_result}`),
                weight: String(judgment.heart_weight ?? 0),
              })}
            </p>
          )}

          {/* ── 进入盖印确认:落判在确认层里,不在这里 ─────────────────────── */}
          {!isFinal && (
            <div data-print-hide="" className="mt-6 flex flex-col items-center gap-2">
              {crossBlocked && crossId && <CrossJudgmentBlockedNotice crossId={crossId} cross={cross} />}
              <RequirePermission permissions="judgment.execute">
                <Button
                  type="button"
                  variant="primary"
                  size="lg"
                  className={`gap-2 ${fullCase ? "w-full" : "min-w-60"}`}
                  onClick={openConfirm}
                  disabled={!selectedVerdict || crossBlocked || atCityGod}
                >
                  {t("judgment.desk.to_confirm")}
                  <Kbd>⌘⏎</Kbd>
                </Button>
              </RequirePermission>
              {atCityGod && (
                <p data-testid="desk-at-city-god-reason" className="text-sm text-[oklch(var(--color-ink-muted))]">
                  {t("judgment.error.at_city_god")}{" "}
                  <Link href={`/city-god-cases?city_god=${judgment.city_god ?? ""}`} className="underline underline-offset-2">
                    {t("cityGodCases.go_to_review")}
                  </Link>
                </p>
              )}
              <p className="text-2xs text-[oklch(var(--color-ink-subtle))]">{t("judgment.desk.irreversible")}</p>
            </div>
          )}
        </section>

        {/* ── 丁 · 判词 / 戊 · 发落 / 审批流 · 联审 ─────────────────────────── */}
        <section
          id="desk-draft"
          aria-label={t("judgment.desk.nav_draft")}
          className={`min-w-0 scroll-mt-28 ${
            fullCase
              ? "hidden"
              : `order-3 md:col-span-2 xl:order-3 xl:col-span-1 ${
                  /* 已结案没有可编辑的东西,判词照常摊开;未结案在 768–1279 收着,打开后排在资料舱上面。 */
                  isFinal ? "md:order-4" : draftOpen ? "md:order-3" : "md:order-4 md:max-xl:hidden"
                }`
          }`}
        >
          <JudgmentSectionHead
            mark="丁"
            title={t("souls.detail.ledger.verdict_words")}
            meta={!isFinal && !draft.conflict ? <DraftSavedAt savedAt={judgment.draft_saved_at} /> : undefined}
          />
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
              {!draft.conflict && <DraftStatusLine status={draft.status} saves={draft.saves} />}
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

          {/* ── 戊 · 发落:原审判选目的地与刑期;加减项审判的发落是计划改动。地府的罪目在最上面(第五十七批 D-1)。 ── */}
          {showPlacement ? (
            <JudgmentPlacement
              lead={offenceField}
              noTerm={judgment.civilization === "EGYPTIAN"}
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
          ) : (
            /* 没有发落一节(已结案、不能改、加减项)时,罪目只读一行,照样在这里。 */
            offenceField && <div className="mt-6">{offenceField}</div>
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
            <div data-print-hide="" className="mt-6 flex flex-col gap-4 border-t border-[oklch(var(--color-line))] pt-4">
              <div className="flex items-start gap-2 min-w-0">
                <input
                  id={createWorkflowId}
                  type="checkbox"
                  checked={withWorkflow}
                  disabled={crossForced || weighingForced}
                  onChange={(event) => setCreateWorkflow(event.target.checked)}
                  className="mt-1 h-4 w-4 shrink-0 accent-[oklch(var(--color-accent))]"
                />
                <label htmlFor={createWorkflowId} className="cursor-pointer min-w-0">
                  <span className="text-sm text-[oklch(var(--color-ink))] block">{t("judgment.detail.create_workflow")}</span>
                  <span className="text-xs text-[oklch(var(--color-ink-subtle))] block mt-1 max-w-prose">
                    {weighingForced
                      ? t("judgment.weighing.workflow_forced")
                      : crossForced
                        ? t("workflow.pick.cross_forced")
                        : t("judgment.detail.create_workflow_hint")}
                  </span>
                </label>
              </div>
              {/* 已挂着联审就不再给「开联审」(一份审判只能有一场,服务端会拒),换成去那一场的链接,谁都看得到。 */}
              {judgment.cross_judgment_id ? (
                <Link
                  href={`/cross-judgments/${judgment.cross_judgment_id}`}
                  data-testid="judgment-cross-link"
                  className={`${buttonVariants({ variant: "secondary", size: "sm" })} self-start`}
                >
                  {t("sentence_plan.cross.view")}
                </Link>
              ) : (
                canOpenCross && <OpenCrossJudgment judgmentId={judgment.id} soulName={soulName} />
              )}
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
        {/* 评议:与资料舱同级的次要信息,默认收起;写不写只看 judgment.read(服务端同一码名),结案后照样可写。 */}
        {/* 案卷附件(W4):评议区上面一节。两个 order-last 按 DOM 顺序排,所以放在评议之前。 */}
        {canReadAttachments && (
          <div className="min-w-0 md:col-span-2 xl:col-span-3 order-last">
            <CaseAttachments judgmentId={id} canWrite={canExecute} />
          </div>
        )}
        <JudgmentComments id={id} canWrite={hasPermission("judgment.read")} concludedAt={judgment.concluded_at} />
        {/* 打印时正文之后的「附件清单」一页;屏幕上不显示。 */}
        <div className="min-w-0 md:col-span-2 xl:col-span-3 order-last">
          <CaseAttachmentsPrintList judgmentId={id} enabled={canReadAttachments} />
        </div>
      </div>
    </PageShell>
    </PrintFrame>
    {!isFinal || concludeMutation.isSuccess ? (
      <JudgmentConfirmLayer
        open={confirming}
        onClose={() => setConfirming(false)}
        verdict={selectedVerdict}
        court={judgment.court}
        withWorkflow={withWorkflow}
        step={confirmStep}
        onStep={setConfirmStep}
        stations={
          withWorkflow && !isFinal && !noPick ? (
            <FlowStationPicker params={{ judgment: id }} skipped={skipOrders} onChange={setSkipOrders} />
          ) : undefined
        }
        pending={concludeMutation.isPending}
        done={concludeMutation.isSuccess}
        stampKey={stamp}
        onConfirm={handleConclude}
        refusal={crossRefused && crossId ? <CrossJudgmentBlockedNotice crossId={crossId} cross={cross} /> : undefined}
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

/** 案由输入框:失焦时存(只在改动过时),存成后让详情与列表失效。 */
function CaseSummaryField({ id, value }: { id: string; value: string }) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const fieldId = useId();
  const [text, setText] = useState(value);
  const save = useMutation({
    mutationFn: (summary: string) => judgmentApi.update(id, { summary }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: judgmentKeys.all }),
    onError: () => showToast(t("common.error"), "error"),
  });
  return (
    <div className="mb-4">
      <label htmlFor={fieldId} className="text-2xs uppercase text-[oklch(var(--color-ink-subtle))]">
        {t("officer_app.case.summary")}
      </label>
      <textarea
        id={fieldId}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          if (text !== value) save.mutate(text);
        }}
        rows={3}
        className="block w-full mt-1 rounded-control border border-[oklch(var(--color-line-strong))] bg-[oklch(var(--color-surface-1))] px-3 py-2 text-sm text-[oklch(var(--color-ink))] transition-[border-color] duration-state focus-visible:border-[oklch(var(--color-ink))] resize-y"
      />
    </div>
  );
}
