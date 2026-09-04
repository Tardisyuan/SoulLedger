"use client";

import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useParams } from "next/navigation";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import type { ToastType } from "@/src/components/ui/Toast";
import {
  soulsApi,
  judgmentApi,
  reincarnationApi,
  eventsApi,
  Judgment,
  Disposition,
  Reincarnation,
  SoulEvent,
  SoulRecordEntry,
} from "@soulledger/core/api";
import { ledgerApi, type LedgerInheritance } from "@soulledger/core/api/ledger";
import { useSoul, useSoulLedger, useDeleteSoul } from "@soulledger/core/hooks/useSouls";
import { useJudgments } from "@soulledger/core/hooks/useJudgments";
import { useDispositions } from "@soulledger/core/hooks/useDispositions";
import { dispositionKeys, judgmentKeys, soulKeys } from "@soulledger/core/query_keys";
import { SoulEditModal } from "@/src/components/souls/SoulEditModal";
import { SoulKarmaLedgerCard } from "@/src/components/souls/SoulKarmaLedgerCard";
import { DEFAULT_REBIRTH_FORM, type RebirthFormValue } from "@/src/components/souls/RebirthFormSelect";
import { SoulInfoCard } from "@/src/components/souls/detail/SoulInfoCard";
import { SoulActionsCard } from "@/src/components/souls/detail/SoulActionsCard";
import { SoulHeaderActions } from "@/src/components/souls/detail/SoulHeaderActions";
import { SoulTimelineColumn } from "@/src/components/souls/detail/SoulTimelineColumn";
import { SoulDeleteModal } from "@/src/components/souls/detail/SoulDeleteModal";
import { DomainEnum, IdentifierChip } from "@/src/components/ui/DomainValue";
import { resolveEnumDisplay } from "@/src/lib/domainDisplay";
import { ConfirmDialog } from "@/src/components/ui/Modal";
import { Skeleton } from "@/components/ui/skeleton";
import { formatHistoricalDate } from "@/lib/utils";
import { PageShell } from "@/src/components/ui/PageShell";
import { soulStateBadgeClass } from "@/src/lib/soulStateBadge";

/** 详情页头上那两个徽章的形状。颜色由调用点给,形状只有一种。 */
const BADGE_SHAPE = "px-2 py-1 text-01";

// 「还没到」的那一份,每种一个模块级常量。
// 这不是洁癖:这些数组是 prop,`?? []` 每次渲染都造一个新数组,而下游
// (SoulLifecycleTimeline 里六个 useMemo、DateProblemsPanel)全都按引用比。
// 从 useState 换成派生值时,identity 的稳定性是**原来就有**的性质,不是新加的
// 优化 —— 不写这几行就是在这次改动里悄悄弄丢它。
const NO_RECORDS: SoulRecordEntry[] = [];
const NO_JUDGMENTS: Judgment[] = [];
const NO_DISPOSITIONS: Disposition[] = [];
const NO_REINCARNATIONS: Reincarnation[] = [];
const NO_EVENTS: SoulEvent[] = [];

/**
 * 七个请求里任何一个失败时,页面要显示的那句话。
 *
 * 逐字保留原来 `loadSoulData` 的 catch:先 `response.data.detail`,再
 * `message`,`||` 而不是 `??` —— 空字符串在这里要当作「没有」而不是「有一个空
 * 的」,那是原来的行为。
 */
function readErrorDetail(e: unknown): string | undefined {
  const err = e as { response?: { data?: { detail?: string } }; message?: string };
  return err?.response?.data?.detail || err?.message;
}

export default function SoulDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const router = useRouter();
  const { t, formatDate, locale } = useI18n();
  const { showToast } = useToast();
  // messages/*.json is out of scope for this change (see task boundary) — new
  // copy ships as a code-level fallback until an i18n pass adds the real keys.
  // t() returns the key itself (a truthy string) when a key is missing, so
  // `t(key) || fallback` never falls through; compare against the key instead.
  const tf = useCallback(
    (key: string, fallback: string, params?: Record<string, string>) => {
      if (t(key) === key) {
        return params
          ? Object.entries(params).reduce((s, [k, v]) => s.replaceAll(`{{${k}}}`, v), fallback)
          : fallback;
      }
      return t(key, params);
    },
    [t]
  );
  const [actionLoading, setActionLoading] = useState("");
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isOverflowMenuOpen, setIsOverflowMenuOpen] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  // The rebirth destination. Was not state at all: handleReincarnate posted a
  // literal "HUMAN", so every soul this app ever reincarnated went into 人道
  // no matter what the six-path enum offered. HUMAN stays the default — 人道
  // is 苦乐参半 and the ordinary case — but it is now a default, not a fact.
  const [rebirthForm, setRebirthForm] = useState<RebirthFormValue>(DEFAULT_REBIRTH_FORM);
  const [confirmMessage, setConfirmMessage] = useState("");
  const [confirmCallback, setConfirmCallback] = useState<(() => void) | null>(null);

  const deleteSoulMutation = useDeleteSoul();
  const queryClient = useQueryClient();

  // ── 这一页的服务端状态 ────────────────────────────────────────────────
  //
  // 这七份读取原本是七个 `useState`,由一个手写的 `loadSoulData()` 在
  // `useEffect` 里一次性灌满。那样写的代价不是重复,是**聋**:
  // `useMarkSoulDead` / `useTransitionSoul` / `useAddSoulRecord` /
  // `useUpdateSoul` 都在 onSuccess 里 invalidate `soulKeys.detail(id)` 或
  // `soulKeys.all`,`handleSoulStateChanged`(实时推送)两个都发 —— 而
  // 一个 `useState` 里的副本听不见任何 invalidate。页面只好自己补:
  // `handleEditSuccess() { loadSoulData(); }`,补的是它自己发起的那一次,
  // 别人发起的那些一次都补不到。所以一个法官开着这一页时,别处推来的状态变更
  // 就停在他屏幕上不动 —— 而 `eventInvalidationReachesCache.test.ts` 全程是绿的,
  // 因为它自己往 `soulKeys.detail` 上塞数据再问缓存收没收到,而不是问屏幕。
  //
  // 隔壁 `app/judgment/[id]/page.tsx:150-157` 早就是对的,并且在注释里写了理由。
  // 两个详情页里有一个在缓存上、另一个在缓存旁边,现在两个都在上面。
  //
  // 四份走 packages/core 的 hook(键都出自 `soulKeys` / `judgmentKeys` /
  // `dispositionKeys` 工厂);records / reincarnations / events 在包里没有对应
  // 的 hook,所以在这里就地 `useQuery` —— 键仍然挂在 `soulKeys.all` 前缀下,
  // 这样一次 `invalidateQueries({ queryKey: soulKeys.all })` 能同时够到它们。
  // 复数形式是刻意的:见 eventInvalidationReachesCache.test.ts 末尾那条
  // 「没有源文件用工厂族的单数形式做键」。
  const soulQuery = useSoul(id);
  const ledgerQuery = useSoulLedger(id);
  // SoulRecordEntry, not SoulRecord — the latter is an alias for Soul itself,
  // which is not what /souls/{id}/records/ returns. And /souls/{id}/records/
  // answers with a bare array (the @action returns serializer.data directly),
  // so there is no `.results` here — all four list endpoints below (judgments,
  // dispositions, reincarnations, events) ARE paginated, and it is the other
  // way round for them.
  const recordsQuery = useQuery({
    queryKey: [...soulKeys.all, "records", id],
    queryFn: async (): Promise<SoulRecordEntry[]> => (await soulsApi.records(id)).data,
    enabled: !!id,
    staleTime: 30_000,
  });
  const judgmentsQuery = useJudgments({ soul: id });
  const dispositionsQuery = useDispositions({ soul: id });
  const reincarnationsQuery = useQuery({
    queryKey: [...soulKeys.all, "reincarnations", id],
    queryFn: async (): Promise<Reincarnation[]> =>
      (await reincarnationApi.list({ soul: id })).data.results,
    enabled: !!id,
    staleTime: 30_000,
  });
  const eventsQuery = useQuery({
    queryKey: [...soulKeys.all, "events", id],
    queryFn: async (): Promise<SoulEvent[]> => (await eventsApi.list({ soul: id })).data.results,
    enabled: !!id,
    staleTime: 30_000,
  });

  const soul = soulQuery.data ?? null;
  const ledger = ledgerQuery.data ?? null;
  const records = recordsQuery.data ?? NO_RECORDS;
  const judgments = judgmentsQuery.data?.results ?? NO_JUDGMENTS;
  const dispositions = dispositionsQuery.data?.results ?? NO_DISPOSITIONS;
  const reincarnations = reincarnationsQuery.data ?? NO_REINCARNATIONS;
  const events = eventsQuery.data ?? NO_EVENTS;

  // `isLoading`,不是 `isPending`:后者在 `enabled: false` 时也是 true,那会让
  // 一个没有 id 的路由永远停在骨架屏上。语义和原来那个 `loading` 一致 ——
  // 七份里还有没到的就是「加载中」。差别只有一处,而且是往好的方向:后台
  // 重取(invalidate 之后那次)不再把已经画好的内容换回骨架。
  const loading =
    soulQuery.isLoading ||
    ledgerQuery.isLoading ||
    recordsQuery.isLoading ||
    judgmentsQuery.isLoading ||
    dispositionsQuery.isLoading ||
    reincarnationsQuery.isLoading ||
    eventsQuery.isLoading;

  const failure =
    soulQuery.error ??
    ledgerQuery.error ??
    recordsQuery.error ??
    judgmentsQuery.error ??
    dispositionsQuery.error ??
    reincarnationsQuery.error ??
    eventsQuery.error ??
    null;
  const error = failure ? readErrorDetail(failure) || t("souls.detail.loading") : "";

  /**
   * 「这个灵魂的服务端状态可能动了」—— 一处。
   *
   * 上面七份读取分属三个键族。`soulKeys.all` 前缀能够到其中五份(soul /
   * ledger / records / reincarnations / events),另外两份要各自的族。
   * 这不是 `loadSoulData` 换了个名字:它不取数据,它只把缓存标脏,于是**每一个
   * 在看这些键的组件**都会重取,而不只是这一页;并且没有在看的那些不会。
   */
  const refreshSoulViews = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: soulKeys.all });
    queryClient.invalidateQueries({ queryKey: judgmentKeys.all });
    queryClient.invalidateQueries({ queryKey: dispositionKeys.all });
  }, [queryClient]);

  // The three cosmologies do not share a mechanic, so this card cannot share a
  // name: CHINESE nets merit against demerit in a standing account, EGYPTIAN
  // weighs the heart once against a threshold, EUROPEAN judges then absolves.
  // `civilization` is UNKNOWN for a misconfigured tenant and undefined until
  // the soul loads; both land on the neutral label.
  const ledgerLabel = tf(`ledger.civ.${soul?.civilization}`, t("ledger.civ.UNKNOWN"));

  // 409 REBIRTH_NOT_APPLICABLE means this soul's cosmology is terminal
  // (Egyptian judgment ending at Aaru/Ammit, European ending at
  // Heaven/Hell/Purgatory-then-Heaven) — there is no next life, so that's
  // treated as a normal "no data" result (null) rather than a query error.
  // That keeps it out of retry and error-toast paths entirely.
  const inheritanceQuery = useQuery({
    queryKey: ["souls", "inheritance", id],
    queryFn: async (): Promise<LedgerInheritance | null> => {
      try {
        const res = await ledgerApi.inheritance(id);
        return res.data;
      } catch (e: unknown) {
        const err = e as { response?: { status?: number } };
        if (err?.response?.status === 409) {
          return null;
        }
        throw e;
      }
    },
    enabled: !!id,
    staleTime: 30_000,
  });

  async function handleDie() {
    if (!soul) return;
    setConfirmMessage(t("souls.detail.mark_dead_confirm", { name: soul.name }));
    setConfirmCallback(() => async () => {
      setActionLoading("die");
      try {
        await soulsApi.die(soul.id, {});
        // 直接调 API 而不是用 `useMarkSoulDead`,是有意的:那个 hook 的 onError
        // 走 `notify` 报一句固定文案,而这里要显示后端给的 `data.error`。
        // 它的 onSuccess 做的事就是下面这一行 —— 只是这里连判决/处置一起标脏,
        // 因为 Soul.die() 会顺手开一份判决(apps/souls/models.py)。
        refreshSoulViews();
      } catch (e: unknown) {
        const err = e as { response?: { data?: { error?: string } }; message?: string };
        showToast(err?.response?.data?.error || "Failed", "error");
      } finally {
        setActionLoading("");
      }
    });
    setIsConfirmOpen(true);
  }

  async function handleStartJudgment() {
    if (!soul) return;
    setActionLoading("judge");
    try {
      // Soul.die() already opens a judgment when it moves the soul to JUDGING
      // (apps/souls/models.py), so creating one here unconditionally left every
      // soul with a duplicate pending judgment alongside the real one. Reuse
      // the open judgment if there is one.
      const open = judgments.find((j) => !j.is_final);
      const id = open
        ? open.id
        : (await judgmentApi.create({ soul: soul.id, civilization: soul.civilization })).data.id;
      router.push(`/judgment/${id}`);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      showToast(err?.response?.data?.error || err?.message || "Failed", "error");
    } finally {
      setActionLoading("");
    }
  }

  async function handleReincarnate(dispositionId: string) {
    setActionLoading("reincarnate");
    try {
      await reincarnationApi.reborn({
        soul_id: soul?.id,
        disposition_id: dispositionId,
        new_identity: `${soul?.name} (rebirth)`,
        rebirth_form: rebirthForm,
      });
      // 同上:`useReborn` 只 invalidate `["souls"]`,而转生会写出一条新的
      // 处置执行记录,所以这里用三族全标脏的那一个。
      refreshSoulViews();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      showToast(err?.response?.data?.error || err?.message || "Failed", "error");
    } finally {
      setActionLoading("");
    }
  }

  function handleDeleteConfirm() {
    if (!soul) return;
    setIsDeleteModalOpen(true);
  }

  async function handleDelete() {
    if (!soul) return;
    try {
      await deleteSoulMutation.mutateAsync(soul.id);
      showToast(t("souls.detail.delete_success"), "success");
      router.push("/souls");
    } catch {
      // error handled by hook
    }
  }

  // Error state - only show when we have actual data fetch error, not during initial load
  if (error && !soul) {
    return (
      <PageShell
        variant="page"
        title={t("souls.detail.not_found")}
        backLink={
          <a href="/souls" className="text-03 text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-ink))]">
            ← {t("souls.detail.back_to_list")}
          </a>
        }
      >
        <p className="text-04 text-[hsl(var(--color-status-error))]">{error || t("souls.detail.not_found")}</p>
      </PageShell>
    );
  }

  // Generation badge: cycle_count on a reincarnation record is "how many
  // times this soul has already been reborn" (0-indexed relative to the
  // original life), so the soul's current life number is the highest one
  // plus one. A soul that has never reincarnated has no reincarnation
  // records at all — showing "Life 1" on every never-reincarnated soul
  // (the overwhelming majority) would just be noise, so the badge is
  // omitted rather than defaulting to 1.
  const generation = reincarnations.length > 0
    ? Math.max(...reincarnations.map((r) => r.cycle_count)) + 1
    : null;

  // birth_date is the soul's original birth (the identity in birth_name),
  // not the current life's — a reincarnated soul has no recorded birth date
  // for its current identity. death_date is the most recent life's death
  // (null while alive), so a single trailing "—" reads as "ongoing" rather
  // than as a second empty placeholder.
  const birthDisplay = formatHistoricalDate(soul?.birth_date, locale);
  const deathDisplay = formatHistoricalDate(soul?.death_date, locale);
  const dateRangeText = birthDisplay
    ? deathDisplay
      ? `${birthDisplay} — ${deathDisplay}`
      : `${birthDisplay} —`
    : null;

  // 下面这四块提到 `return` 之前存成 const,理由是机械的而不是审美的:
  // src/__tests__/domainDisplayContract.test.tsx 的 §4.6 规则找的是枚举渲染
  // **上方最近的 `title=`**,而 PageShell 有一个叫 `title` 的 **prop** ——
  // 它是页面标题,不是 HTML 属性。把带枚举的节点直接内联进 PageShell 的插槽,
  // 那个 prop 就成了窗口里最近的 `title=`,规则会判定「原始成员没走 title」
  // 而报红 —— 而且那不是误报,真正的 `title={soul?.current_state}` 确实在它
  // 够不到的地方。提出来之后,每个窗口里唯一的 `title=` 都是 HTML 属性。
  const backLink = (
    <a href="/souls" className="text-03 text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-ink))]">
      ← {t("souls.detail.back_to_list")}
    </a>
  );

  // 标题行:当前世的名字是这个灵魂今天被叫作什么,所以它是标题;状态与世数
  // 是两个已翻译的徽章,身边不再有裸枚举文本。
  const headerTitle = loading ? (
    <Skeleton className="h-8 w-48" />
  ) : (
    <span className="flex items-center gap-3 flex-wrap">
      <span>{soul?.name}</span>
      {/* §4.6 逐字:这个徽章曾经写着「ALIVE — 存活」,原始枚举和它的译名并排。
          枚举现在只住在 `title` 里 —— 排查的人看得见,读页面的人看不见。 */}
      <span
        title={soul?.current_state}
        className={`${BADGE_SHAPE} ${soulStateBadgeClass(soul?.current_state)}`}
      >
        {resolveEnumDisplay(t, "souls.states", soul?.current_state).label ?? t("common.value.unrecorded")}
      </span>
      {generation !== null && (
        <span className={`${BADGE_SHAPE} bg-[hsl(var(--color-status-reincarnating)/0.1)] text-[hsl(var(--color-status-reincarnating))]`}>
          {tf("souls.detail.generation", "Life {{n}}", { n: String(generation) })}
        </span>
      )}
    </span>
  );

  // 副标题:文明、这个灵魂出生时用的那个名字(只在它与标题不同时出现 ——
  // 同名就只是噪音)、属于那同一个出生身份的生卒区间,以及一个可复制的 ID。
  // `Skeleton` renders a <div>, and PageShell's subtitle slot renders a <p>.
  // React reported it by name: "In HTML, <div> cannot be a descendant of <p>",
  // followed by "Hydration failed because the server rendered HTML didn't
  // match the client" -- the subtree was thrown away and re-rendered on every
  // load of this page. (Not the known dev-server Skeleton noise in MEMORY.md:
  // that one is a concurrent on-demand-compile artefact. This reproduced on a
  // single worker, every time, with React naming the tag nesting.)
  const headerSubtitle = loading ? (
    <Skeleton as="span" className="inline-block h-4 w-64" />
  ) : (
    <span className="flex items-center gap-2 flex-wrap">
      <DomainEnum namespace="souls.civilizations" value={soul?.civilization} />
      {/* previous_identity 与 dateRangeText 合并成一句(Stage 3 文档缺陷 #4)
          —— 生卒日期属于 birth_name 那一世,不属于标题上那个当前名字,拆成
          两段独立的尾巴会让这份归属变得含糊。下面生命周期脊柱上的分世带负责
          完整的多世拆分;这里只是一句摘要。 */}
      {soul?.birth_name && soul.birth_name !== soul.name && (
        <>
          <span aria-hidden="true">·</span>
          <span>
            {tf("souls.detail.previous_identity", "Formerly {{name}}", { name: soul.birth_name })}
            {dateRangeText ? ` (${dateRangeText})` : ""}
          </span>
        </>
      )}
      {(!soul?.birth_name || soul.birth_name === soul.name) && dateRangeText && (
        <>
          <span aria-hidden="true">·</span>
          <span>{dateRangeText}</span>
        </>
      )}
      {/* 全站唯一展示 UUID 的地方 —— 见 src/lib/domainDisplay.ts 的
          IDENTIFIER_POLICY:页面所讲的那个实体,一次,在页头,可复制,
          且永不代替名字。 */}
      {soul?.id && (
        <>
          <span aria-hidden="true">·</span>
          <IdentifierChip id={soul.id} ariaLabel={tf("souls.detail.copy_id_aria", "Copy soul ID")} />
        </>
      )}
    </span>
  );

  const headerActions = !loading && soul ? (
    <SoulHeaderActions
      onEdit={() => setIsEditModalOpen(true)}
      onDelete={handleDeleteConfirm}
      isOverflowMenuOpen={isOverflowMenuOpen}
      setIsOverflowMenuOpen={setIsOverflowMenuOpen}
      tf={tf}
    />
  ) : null;

  return (
    <PageShell
      variant="page"
      backLink={backLink}
      title={headerTitle}
      subtitle={headerSubtitle}
      actions={headerActions}
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column: Soul info + ledger */}
        <div className="lg:col-span-1 space-y-6">
          {/* Soul Card */}
          <SoulInfoCard
            soul={soul}
            loading={loading}
            birthDisplay={birthDisplay}
            deathDisplay={deathDisplay}
            tf={tf}
          />

          {/* 业力总账 — Stage 3 doc's left-column ledger card: the existing
              SoulReadingPanel (unchanged) plus the raw-vs-decayed breakdown,
              lifespan chart, and next-life inheritance preview, all moved
              out of this ad hoc box into their own component. */}
          {loading ? (
            <div className="bg-[hsl(var(--color-surface-1))] p-4 border border-[hsl(var(--color-hairline))] space-y-3">
              <div className="flex justify-between items-center">
                <Skeleton className="h-4 w-12" />
                <Skeleton className="h-6 w-12" />
              </div>
              <div className="flex justify-between items-center">
                <Skeleton className="h-4 w-12" />
                <Skeleton className="h-6 w-12" />
              </div>
              <div className="border-t border-[hsl(var(--color-hairline))] pt-2 flex justify-between items-center">
                <Skeleton className="h-4 w-12" />
                <Skeleton className="h-6 w-12" />
              </div>
              <Skeleton className="h-3 w-full" />
            </div>
          ) : ledger ? (
            <SoulKarmaLedgerCard
              ledgerLabel={ledgerLabel}
              reading={ledger.reading}
              meritScore={ledger.merit_score}
              demeritScore={ledger.demerit_score}
              karmicBalance={ledger.karmic_balance}
              recordCount={ledger.record_count}
              records={ledger.records}
              inheritance={inheritanceQuery.data ?? null}
            />
          ) : (
            <div className="bg-[hsl(var(--color-surface-1))] p-4 border border-[hsl(var(--color-hairline))]">
              <h2 title={soul?.civilization} className="text-03 font-semibold text-[hsl(var(--color-ink-muted))] uppercase mb-3">{ledgerLabel}</h2>
              <p className="text-03 text-[hsl(var(--color-ink-muted))]">{t("souls.detail.no_ledger")}</p>
            </div>
          )}

          {/* Action Buttons */}
          <SoulActionsCard
            soul={soul}
            loading={loading}
            actionLoading={actionLoading}
            dispositions={dispositions}
            reincarnations={reincarnations}
            rebirthForm={rebirthForm}
            onRebirthFormChange={setRebirthForm}
            onDie={handleDie}
            onStartJudgment={handleStartJudgment}
            onReincarnate={handleReincarnate}
            tf={tf}
          />
        </div>

        {/* Right column: Timeline */}
        <SoulTimelineColumn
          soul={soul}
          loading={loading}
          records={records}
          ledger={ledger}
          judgments={judgments}
          dispositions={dispositions}
          reincarnations={reincarnations}
          events={events}
          onChanged={refreshSoulViews}
          onOpenJudgmentQueue={(judgmentId) => router.push(`/judgment/queue?at=${judgmentId}`)}
        />
      </div>

      {/* Edit Modal */}
      {soul && (
        <SoulEditModal
          isOpen={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
          soul={soul}
          // 这里原来是 `handleEditSuccess`,而它只是 `loadSoulData()`。
          // `useUpdateSoul` 自己就 invalidate 了 `soulKeys.all`,前缀能够到这一页
          // 的五份 souls 读取,所以那次重取是页面在重复 hook 已经做过的事。
          // 判决/处置这里**不**标脏也是想清楚的:这张表单写的是 name /
          // birth_date / origin_location / current_state 四个字段,不产生也不
          // 修改任何 Judgment 或 Disposition 行。
          // 这个 prop 现在没有页面侧的活可干了;`SoulEditModal` 的签名要求它,
          // 而那个文件不在这次改动的范围内。它变成空的这件事由
          // SoulDetailPage.cacheInvalidation.test.tsx 最后一条守着:那条用真的
          // 弹窗、真的 useUpdateSoul 走一遍,断言页面自己把新名字换上来。
          onUpdated={() => {}}
        />
      )}

      <SoulDeleteModal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={handleDelete}
        isPending={deleteSoulMutation.isPending}
      />

      {/* Custom Confirm Dialog */}
      <ConfirmDialog
        isOpen={isConfirmOpen}
        title={t("common.confirm")}
        message={confirmMessage}
        onConfirm={() => {
          setIsConfirmOpen(false);
          confirmCallback?.();
        }}
        onCancel={() => setIsConfirmOpen(false)}
        variant="warning"
      />
    </PageShell>
  );
}

// IdChip used to live here. It is now <IdentifierChip> in
// src/components/ui/DomainValue.tsx, next to the policy that says when an
// identifier may be rendered at all (BRIEF §4.6).
