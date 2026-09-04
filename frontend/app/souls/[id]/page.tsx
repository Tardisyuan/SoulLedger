"use client";

import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useParams } from "next/navigation";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import type { ToastType } from "@/src/components/ui/Toast";
import {
  soulsApi,
  judgmentApi,
  dispositionApi,
  reincarnationApi,
  eventsApi,
  Soul,
  Judgment,
  Disposition,
  Reincarnation,
  SoulEvent,
  LedgerSummary,
  SoulRecordEntry,
} from "@soulledger/core/api";
import { ledgerApi, type LedgerInheritance } from "@soulledger/core/api/ledger";
import { useUpdateSoul, useDeleteSoul } from "@/src/hooks/useSouls";
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
  const [soul, setSoul] = useState<Soul | null>(null);
  const [ledger, setLedger] = useState<LedgerSummary | null>(null);
  // SoulRecordEntry, not SoulRecord — the latter is an alias for Soul itself,
  // which is not what /souls/{id}/records/ returns.
  const [records, setRecords] = useState<SoulRecordEntry[]>([]);
  const [judgments, setJudgments] = useState<Judgment[]>([]);
  const [dispositions, setDispositions] = useState<Disposition[]>([]);
  const [reincarnations, setReincarnations] = useState<Reincarnation[]>([]);
  const [events, setEvents] = useState<SoulEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
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

  const updateSoulMutation = useUpdateSoul();
  const deleteSoulMutation = useDeleteSoul();

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

  const loadSoulData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [soulRes, ledgerRes, recordsRes, judgmentRes, dispRes, reincRes, evtsRes] =
        await Promise.all([
          soulsApi.get(id),
          soulsApi.karma(id),
          soulsApi.records(id),
          judgmentApi.list({ soul: id }),
          dispositionApi.list({ soul: id }),
          reincarnationApi.list({ soul: id }),
          eventsApi.list({ soul: id }),
        ]);
      setSoul(soulRes.data);
      setLedger(ledgerRes.data);
      // /souls/{id}/records/ answers with a bare array (the @action returns
      // serializer.data directly), so there was never a `.results` to read and
      // the fallback was the only branch that ever ran. The four list
      // endpoints below are paginated, so for those it is the other way round.
      setRecords(recordsRes.data);
      setJudgments(judgmentRes.data.results);
      setDispositions(dispRes.data.results);
      setReincarnations(reincRes.data.results);
      setEvents(evtsRes.data.results);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } }; message?: string };
      setError(err?.response?.data?.detail || err?.message || t("souls.detail.loading"));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    if (!id) return;
    loadSoulData();
  }, [id, loadSoulData]);

  async function handleDie() {
    if (!soul) return;
    setConfirmMessage(t("souls.detail.mark_dead_confirm", { name: soul.name }));
    setConfirmCallback(() => async () => {
      setActionLoading("die");
      try {
        await soulsApi.die(soul.id, {});
        await loadSoulData();
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
      await loadSoulData();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      showToast(err?.response?.data?.error || err?.message || "Failed", "error");
    } finally {
      setActionLoading("");
    }
  }

  function handleEditSuccess() {
    loadSoulData();
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
          onChanged={loadSoulData}
          onOpenJudgmentQueue={(judgmentId) => router.push(`/judgment/queue?at=${judgmentId}`)}
        />
      </div>

      {/* Edit Modal */}
      {soul && (
        <SoulEditModal
          isOpen={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
          soul={soul}
          onUpdated={handleEditSuccess}
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
