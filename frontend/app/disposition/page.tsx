"use client";
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTenant } from "@/src/contexts/TenantContext";
import { useI18n } from "@/src/contexts/I18nContext";
import { usePlaque } from "@/src/components/plaque/Plaque";
import { useCourtOffice, useHall } from "@/src/components/plaque/useHall";
import { useToast } from "@/src/contexts/ToastContext";
import { dispositionApi, PAGE_SIZE, type Disposition } from "@soulledger/core/api";
import { releaseRefusalOf, type DispositionListParams, type DispositionSection } from "@soulledger/core/api/disposition";
import { dispositionKeys, soulKeys } from "@soulledger/core/query_keys";
import { ListSkeleton } from "@/components/ui/skeleton";
import { Pagination } from "@/src/components/ui/Pagination";
import { DomainText, MissingValue } from "@/src/components/ui/DomainValue";
import { PageShell } from "@/src/components/ui/PageShell";
import { Button, buttonVariants } from "@/src/components/ui/Button";
import { ConfirmDialog } from "@/src/components/ui/Modal";
import { FilterChipToggle } from "@/src/components/ui/FilterChip";
import { ActionsMenu } from "@/components/ui/data-grid/ActionsMenu";
import { ArchiveDialog } from "@/src/components/archive/ArchiveParts";
import { useArchiveDisposition, useUnarchiveDisposition } from "@soulledger/core/hooks/useDispositions";
import { usePermissions } from "@/src/hooks/usePermissions";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { QueryError } from "@/src/components/ui/PageError";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { useMenuButtonConfig } from "@/src/hooks/useMenuButtonConfig";
import { ExportCsvButton } from "@/src/components/ExportCsvButton";
import { MenuGloss } from "@/src/components/layout/MenuGloss";
import { formatHistoricalDate } from "@/lib/utils";
import { termState, type TermState } from "@/src/lib/dispositionTerm";
import { VerdictBadge as DomainVerdictBadge } from "@/src/components/ui/StatusBadge";

/**
 * 处置(规范 v1 第三类 A·07):一页三段 —— 待执行 → 执行中 → 期满,就是处置本身的时间顺序。
 *
 * 三段各是一次 `?section=` 查询,各自分页,段标上的数是那次查询的 `count` —— 服务端的总数,
 * 不是本页的行数。期满由服务端的期满检查写下 `expired_at`,前端不再从 `term_start + 年限`
 * 推算;「期满」一段带 `soul_reborn=false`,已经转世的灵魂不再排着等「安排轮回」。
 *
 * 规则 15 的例外只在这里和回收站:待执行段的「执行」、期满段的「安排轮回」是行尾按钮,
 * 因为这两段的工作就是那一个动作。执行中段没有动作,只有期限条;永恒处置画虚线框。
 *
 * 执行中段「按期满近 → 远」由服务端排(`ordering=term_end`,跨页也对):期满日在 SQL 里按
 * 序列化器 `term_end` 同一条规则算,永久与没有期满日的排最后。稿子里的「下次自动期满检查 ·
 * 今日 24:00」没有画:期满任务(`disposition.expire_due_for_tenant`,由定时任务按租户登记)
 * 下次何时跑,本页没有可读的来源。
 */

const SECTIONS: readonly DispositionSection[] = ["pending", "executing", "expired"];
const SECTION_TITLE: Record<DispositionSection, string> = {
  pending: "disposition.section_pending",
  executing: "disposition.section_running",
  expired: "disposition.section_expired",
};
const SECTION_MARK: Record<DispositionSection, string> = { pending: "甲", executing: "乙", expired: "丙" };
/** `apps/judgment/weighing.py::unfinished_flow` 的码:前两个在 `disposition.flow_waiting`,埃及的在 `judgment.weighing.errors`。 */
const FLOW_WAITING_APPROVAL = ["approval_in_progress", "approval_rejected", "approval_cancelled"];
const FLOW_WAITING_WEIGHING = ["weighing_in_progress", "weighing_rejected", "weighing_wavers"];

export default function DispositionPage() {
  const { t, formatDate } = useI18n();
  const hall = useHall(useCourtOffice());
  usePlaque({ hall });
  const { user } = useTenant();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [showExecuteModal, setShowExecuteModal] = useState<string | null>(null);
  // 期满释放(2026-10-29):celery beat 没部署,刑期满了由官员在这里记期满,灵魂往下走。
  const [releaseTarget, setReleaseTarget] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  // 「显示已归档」只在处置列表(后端 `show_archived` 只有它认)。已归档的行调灰一级,状态写「□ 已归档」。
  const [showArchived, setShowArchived] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<Disposition | null>(null);
  const archiveMutation = useArchiveDisposition();
  const unarchiveMutation = useUnarchiveDisposition();
  const { hasPermission } = usePermissions();
  // 菜单按钮配置(第四十批 W-b):归档(行尾 ⋯)与导出另要配置允许。取消归档不在配置里。
  const buttonOn = useMenuButtonConfig();
  const canArchive = hasPermission("disposition.execute");
  const [pages, setPages] = useState<Record<DispositionSection, number>>({ pending: 1, executing: 1, expired: 1 });

  // One query per section, each paged on its own. `dispositionKeys.list` sits under
  // `["dispositions"]`, which the execute mutation below invalidates.
  const sectionQuery = (base: DispositionListParams) => {
    const params: DispositionListParams = showArchived ? { ...base, show_archived: "1" } : base;
    return {
    queryKey: dispositionKeys.list(params),
    queryFn: () => dispositionApi.list(params).then((r) => r.data),
    enabled: !!user,
    placeholderData: <P,>(previous: P) => previous,
    };
  };
  const pendingQ = useQuery(sectionQuery({ section: "pending", page: String(pages.pending) }));
  // 期满近 → 远,服务端排:本页之外的行也在对的位置上。
  const executingQ = useQuery(sectionQuery({ section: "executing", ordering: "term_end", page: String(pages.executing) }));
  // 已经转世的灵魂不再排在「期满」里等安排轮回。
  const expiredQ = useQuery(sectionQuery({ section: "expired", soul_reborn: "false", page: String(pages.expired) }));
  const queries: Record<DispositionSection, typeof pendingQ> = { pending: pendingQ, executing: executingQ, expired: expiredQ };

  const isLoading = SECTIONS.some((s) => queries[s].isLoading);
  const isError = SECTIONS.some((s) => queries[s].isError);
  const total = SECTIONS.reduce((n, s) => n + (queries[s].data?.count ?? 0), 0);

  const pending = pendingQ.data?.results ?? [];
  const running = (executingQ.data?.results ?? []).map((d) => ({ d, term: termState(d, now) }));
  const expired = expiredQ.data?.results ?? [];

  /** `flow_waiting` / 执行 409 的码 → 原因;不是这几个码为 null。 */
  const flowWaitingText = (code: string | null | undefined) =>
    !code
      ? null
      : FLOW_WAITING_APPROVAL.includes(code)
        ? t(`disposition.flow_waiting.${code}`)
        : FLOW_WAITING_WEIGHING.includes(code)
          ? t(`judgment.weighing.errors.${code}`)
          : null;

  const executeMutation = useMutation({
    mutationFn: (id: string) => dispositionApi.execute(id),
    onSuccess: () => {
      showToast(t("disposition.executed_success"), "success");
      // 执行 / 释放改的是灵魂的状态与所在界域:灵魂列表与详情也要重取(同 souls/[id] 的 refreshSoulViews)。
      queryClient.invalidateQueries({ queryKey: dispositionKeys.all });
      queryClient.invalidateQueries({ queryKey: soulKeys.all });
      setShowExecuteModal(null);
    },
    onError: (err: unknown) => {
      // 原审的审批流程没走完 / 被驳回(埃及:称心流程,或天平摇摆)时不执行(409,apps/judgment/weighing.py),说清是哪一条。
      const code = (err as { response?: { data?: { code?: string } } })?.response?.data?.code;
      showToast(flowWaitingText(code) ?? t("disposition.execute_error"), "error");
    },
  });

  const releaseMutation = useMutation({
    mutationFn: (id: string) => dispositionApi.release(id),
    onSuccess: () => {
      showToast(t("disposition.release_success"), "success");
      // 执行 / 释放改的是灵魂的状态与所在界域:灵魂列表与详情也要重取(同 souls/[id] 的 refreshSoulViews)。
      queryClient.invalidateQueries({ queryKey: dispositionKeys.all });
      queryClient.invalidateQueries({ queryKey: soulKeys.all });
      setReleaseTarget(null);
    },
    onError: (err: unknown) => {
      const code = releaseRefusalOf(err);
      showToast(t(`disposition.release_error.${code ?? "generic"}`), "error");
      setReleaseTarget(null);
    },
  });

  // 行尾 ⋯:有结案判决的处置可以「归档」(后端只收有结案判决的);已归档的行给「取消归档」。
  const rowMenu = (d: Disposition) => {
    if (!canArchive) return null;
    if (d.is_archived) {
      return (
        <ActionsMenu
          menuLabel={`${t("common.row_actions")} · ${d.soul_name || d.soul}`}
          items={[{ key: "unarchive", label: t("records.archive.unarchive"), onSelect: () => unarchiveMutation.mutate(d.id) }]}
        />
      );
    }
    if (!d.verdict || !buttonOn("disposition.archive")) return null;
    return (
      <ActionsMenu
        menuLabel={`${t("common.row_actions")} · ${d.soul_name || d.soul}`}
        items={[{ key: "archive", label: t("records.archive.confirm"), onSelect: () => setArchiveTarget(d) }]}
      />
    );
  };
  const archivedMark = (d: Disposition) =>
    d.is_archived ? (
      <span className="text-xs text-[oklch(var(--color-ink-muted))]">
        <span aria-hidden="true">□ </span>
        {t("records.archive.badge")}
      </span>
    ) : null;

  const soulLink = (d: Disposition) => (
    <Link href={`/souls/${d.soul}`} className="font-medium text-[oklch(var(--color-ink))] hover:underline">
      {d.soul_name || d.soul}
    </Link>
  );
  const realm = (d: Disposition) => (
    <span className="font-mono text-xs truncate" title={d.realm_name || d.destination_realm || undefined}>
      <DomainText value={d.realm_name || d.destination_realm} />
    </span>
  );
  const pager = (section: DispositionSection) => {
    const count = queries[section].data?.count ?? 0;
    if (count <= PAGE_SIZE) return null;
    return (
      <Pagination
        page={pages[section]}
        totalPages={Math.ceil(count / PAGE_SIZE)}
        count={count}
        onPageChange={(p) => setPages((prev) => ({ ...prev, [section]: p }))}
      />
    );
  };
  // 每段的导出带这一段列表用的同一组筛选(不含页码),导出的就是该段「当前筛选下的结果」。
  const SECTION_FILTERS: Record<DispositionSection, DispositionListParams> = {
    pending: { section: "pending" },
    executing: { section: "executing", ordering: "term_end" },
    expired: { section: "expired", soul_reborn: "false" },
  };
  const sectionProps = (section: DispositionSection) => ({
    action: buttonOn("disposition.export") && (
      <RequirePermission permissions="disposition.read">
        <ExportCsvButton
          size="sm"
          fetchCsv={() => dispositionApi.exportCsv(SECTION_FILTERS[section])}
          page={t("disposition.title")}
          hall={hall}
        />
      </RequirePermission>
    ),
    mark: SECTION_MARK[section],
    title: t(SECTION_TITLE[section]),
    count: queries[section].data?.count ?? 0,
    testId: `disposition-section-${section}`,
  });

  return (
    <PageShell
      variant="full"
      title={
        <>
          {t("disposition.title")}
          <MenuGloss path="/disposition" />
        </>
      }
      subtitle={t("disposition.subtitle")}
      filters={
        <FilterChipToggle pressed={showArchived} onPressedChange={(v) => { setShowArchived(v); setPages({ pending: 1, executing: 1, expired: 1 }); }}>
          {t("records.archive.show_archived")}
        </FilterChipToggle>
      }
      isLoading={isLoading}
      skeleton={<ListSkeleton count={5} />}
      // `isError ||`: a failed request yields no rows, and "the server is down"
      // and "no dispositions have been filed" must not read the same.
      isEmpty={isError || total === 0}
      empty={
        isError ? (
          <QueryError onRetry={() => SECTIONS.forEach((s) => queries[s].refetch())} />
        ) : (
          <EmptyState title={t("disposition.list")} reason={t("disposition.no_dispositions")} />
        )
      }
    >
      {/* ── 甲 · 待执行:判决列 + 行尾「执行」(规则 15 例外) ───────────── */}
      <Section {...sectionProps("pending")}>
        {pending.map((d) => (
          <Row key={d.id} archived={d.is_archived} testId="disposition-pending-row" cols="md:grid-cols-[1.3fr_7rem_1.3fr_8rem_6rem_7rem]">
            {soulLink(d)}
            <VerdictBadge verdict={d.verdict} />
            {realm(d)}
            <span className="text-[oklch(var(--color-ink-muted))]">
              {termLabel(termState(d, now), t)}
              {/* 没写刑期时服务端按界域填的默认值(2026-10-29):标出来,判官知道这是默认、可改。 */}
              {d.default_term_years != null && d.sentence_years === d.default_term_years && (
                <span data-testid="disposition-term-default" className="block text-xs">
                  {t("disposition.term_default", { n: String(d.default_term_years) })}
                </span>
              )}
            </span>
            <span className="font-mono text-xs tabular-nums text-[oklch(var(--color-ink-subtle))]">{formatDate(d.created_at)}</span>
            <span className="flex items-center justify-end gap-2">
              {archivedMark(d)}
              {d.is_archived ? null : d.is_eternal ? (
                <span className="text-xs text-[oklch(var(--color-ink-muted))]">{t("disposition.eternal")}</span>
              ) : (
                <RequirePermission permissions="disposition.execute">
                  {/* 原审的审批流程没走完(或被驳回)不能执行:置灰,原因写在旁边(用户 2026-10-29)。 */}
                  {d.flow_waiting ? (
                    <span className="flex items-center gap-2 min-w-0">
                      <span data-testid="disposition-flow-waiting" className="text-xs text-[oklch(var(--color-ink-muted))]">
                        {flowWaitingText(d.flow_waiting)}
                      </span>
                      <Button type="button" variant="secondary" size="sm" disabled>
                        {t("disposition.execute")}
                      </Button>
                    </span>
                  ) : (
                    <Button type="button" variant="secondary" size="sm" onClick={() => setShowExecuteModal(d.id)}>
                      {t("disposition.execute")}
                    </Button>
                  )}
                </RequirePermission>
              )}
              {rowMenu(d)}
            </span>
          </Row>
        ))}
        {pager("pending")}
      </Section>

      {/* ── 乙 · 执行中(服刑中):期限条;期满日已到而每日检查没跑到的,行尾「期满释放」 ───────── */}
      <Section {...sectionProps("executing")}>
        {running.map(({ d, term }) => (
          <Row key={d.id} archived={d.is_archived} testId="disposition-running-row" cols="md:grid-cols-[1.3fr_1.1fr_2fr_12rem]">
            {soulLink(d)}
            {realm(d)}
            <TermBar term={term} />
            <span className="flex items-center justify-end gap-2 text-right font-mono text-xs tabular-nums text-[oklch(var(--color-ink-muted))]">
              {archivedMark(d)}
              <span>
                {term.kind === "running" && term.fraction > 0.9 && <span aria-hidden="true">◐ </span>}
                {term.kind === "running" ? t("disposition.days_left", { n: String(term.daysLeft) }) : termLabel(term, t)}
                {d.term_end && (
                  <span data-testid="disposition-serving-until" className="block">
                    {t("disposition.serving_until", { date: formatHistoricalDate(d.term_end) ?? "" })}
                  </span>
                )}
              </span>
              {d.can_release && !d.is_archived && (
                <RequirePermission permissions="disposition.execute">
                  <Button type="button" variant="secondary" size="sm" data-testid="disposition-release" onClick={() => setReleaseTarget(d.id)}>
                    {t("disposition.release")}
                  </Button>
                </RequirePermission>
              )}
              {rowMenu(d)}
            </span>
          </Row>
        ))}
        {pager("executing")}
      </Section>

      {/* ── 丙 · 期满(已转世的不在此列):行尾「安排轮回」(规则 15 例外) ── */}
      <Section {...sectionProps("expired")}>
        {expired.map((d) => {
          const end = formatHistoricalDate(d.term_end ?? null) ?? (d.expired_at ? formatDate(d.expired_at) : null);
          return (
            <Row key={d.id} archived={d.is_archived} testId="disposition-expired-row" cols="md:grid-cols-[1.3fr_1.3fr_1fr_8rem]">
              {soulLink(d)}
              {realm(d)}
              <span className="font-mono text-xs tabular-nums text-[oklch(var(--color-ink))]">
                <span aria-hidden="true">◐ </span>
                {end ? t("disposition.expired_on", { date: end }) : <MissingValue kind="unrecorded" />}
              </span>
              <span className="flex items-center justify-end gap-2">
                {archivedMark(d)}
                {!d.is_archived && (
                  <Link href={`/souls/${d.soul}`} className={buttonVariants({ variant: "primary", size: "sm" })}>
                    {t("disposition.arrange_reincarnation")}
                  </Link>
                )}
                {rowMenu(d)}
              </span>
            </Row>
          );
        })}
        {pager("expired")}
      </Section>

      {/* Executing a disposition is what sends a soul to its realm; it is not a
          dialog to leave dismissible by a stray Tab into the page behind it —
          hence ConfirmDialog (focus trap, Escape, focus return) and not a
          hand-rolled `fixed inset-0`. */}
      <ArchiveDialog
        isOpen={archiveTarget !== null}
        name={archiveTarget?.soul_name || archiveTarget?.soul || ""}
        onClose={() => setArchiveTarget(null)}
        onConfirm={(reason) =>
          archiveTarget && archiveMutation.mutate({ id: archiveTarget.id, reason }, { onSuccess: () => setArchiveTarget(null) })
        }
        isPending={archiveMutation.isPending}
      />
      <ConfirmDialog
        isOpen={showExecuteModal !== null}
        title={t("disposition.confirm_execute")}
        message={t("disposition.execute_warning")}
        confirmText={t("disposition.confirm_execute")}
        confirmLoading={executeMutation.isPending}
        onCancel={() => setShowExecuteModal(null)}
        onConfirm={() => showExecuteModal && executeMutation.mutate(showExecuteModal)}
      />
      <ConfirmDialog
        isOpen={releaseTarget !== null}
        title={t("disposition.release_confirm")}
        message={t("disposition.release_warning")}
        confirmText={t("disposition.release")}
        confirmLoading={releaseMutation.isPending}
        onCancel={() => setReleaseTarget(null)}
        onConfirm={() => releaseTarget && releaseMutation.mutate(releaseTarget)}
      />
    </PageShell>
  );
}

type T = (key: string, params?: Record<string, string>) => string;

/** 期限一格的字:「刑期 3 年」「永恒 · 不计时」「期限未记录」。 */
function termLabel(term: TermState, t: T): string {
  switch (term.kind) {
    case "eternal":
      return t("disposition.term_eternal");
    case "no_term":
      return t("disposition.term_unrecorded");
    case "no_start":
      return t("sentence_plan.years", { years: String(term.years) });
    case "running":
      return t("sentence_plan.years", { years: String(term.end.year - term.start.year) });
  }
}

/** 判决徽章:字形 + 名,颜色之外必有字形(规范 v1 §1.2)。没有本地审判的处置写「未记录」。 */
function VerdictBadge({ verdict }: { verdict: Disposition["verdict"] }) {
  if (!verdict) {
    return (
      <span className="text-xs">
        <MissingValue kind="unrecorded" />
      </span>
    );
  }
  return <DomainVerdictBadge verdict={verdict} className="justify-self-start" />;
}

/**
 * 期限条 TermBar(规范 v1 §2.9):6 px;超过 90% 变警示色;永恒 = 虚线空框、不计时。
 * 起算没记录的不画进度 —— 画一条从零开始的条就是替它编了一个起点。
 */
function TermBar({ term }: { term: TermState }) {
  const { t } = useI18n();
  if (term.kind === "eternal") {
    // 虚线空框只是示意;「永恒 · 不计时」由行末那一格说,这里不重复。
    return (
      <span
        aria-hidden="true"
        data-term-bar="eternal"
        className="block min-w-16 h-1.5 border border-dashed border-[oklch(var(--color-ink-subtle))]"
      />
    );
  }
  if (term.kind !== "running") {
    return (
      <span className="text-xs text-[oklch(var(--color-ink-subtle))]">
        {term.kind === "no_start" ? t("disposition.start_unrecorded") : t("disposition.term_unrecorded")}
      </span>
    );
  }
  const pct = Math.min(100, Math.round(term.fraction * 100));
  return (
    <span className="flex items-center gap-2 font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">
      <span>{formatHistoricalDate(term.start)}</span>
      <span
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="relative flex-1 min-w-16 h-1.5 bg-[oklch(var(--color-surface-3))]"
      >
        <span
          className="absolute inset-y-0 left-0 bg-[oklch(var(--color-ink))]"
          style={{ width: `${pct}%` }}
        />
      </span>
      <span>{formatHistoricalDate(term.end)}</span>
    </span>
  );
}

/** 分段标「甲 · 待执行 4」,数是服务端的总数;空段写一行而不是塌掉。 */
function Section({
  mark,
  title,
  count,
  testId,
  action,
  children,
}: {
  mark: string;
  title: string;
  count: number;
  testId: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <section className="mb-6" data-testid={testId}>
      <div className="flex items-end justify-between gap-3 pt-4 pb-1 border-b border-[oklch(var(--color-block))]">
        <h2 className="text-2xs uppercase text-[oklch(var(--color-ink-subtle))]">
          <span aria-hidden="true">{mark} · </span>
          {title} <span className="tabular-nums" data-testid="section-count">{count}</span>
        </h2>
        {count > 0 && action}
      </div>
      {count === 0 ? (
        <p className="py-2 text-sm text-[oklch(var(--color-ink-subtle))]">{t("disposition.section_empty")}</p>
      ) : (
        children
      )}
    </section>
  );
}

/** 一行账:桌面按列,393 下单列堆叠;行高 36 / 52(规范 v1 §2 行高)。 */
function Row({ cols, testId, archived, children }: { cols: string; testId: string; archived?: boolean; children: ReactNode }) {
  return (
    <div
      data-testid={testId}
      data-archived={archived ? "" : undefined}
      className={`grid grid-cols-1 ${cols} ${archived ? "text-[oklch(var(--color-ink-muted))]" : ""} items-center gap-x-3 gap-y-1 min-h-(--table-row-h) py-1 border-b border-[oklch(var(--color-rule))] text-sm`}
    >
      {children}
    </div>
  );
}
