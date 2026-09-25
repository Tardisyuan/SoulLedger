"use client";
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTenant } from "@/src/contexts/TenantContext";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { dispositionApi, PAGE_SIZE, type Disposition } from "@soulledger/core/api";
import type { DispositionListParams, DispositionSection } from "@soulledger/core/api/disposition";
import { dispositionKeys } from "@soulledger/core/query_keys";
import { ListSkeleton } from "@/components/ui/skeleton";
import { Pagination } from "@/src/components/ui/Pagination";
import { DomainEnum, DomainText, MissingValue } from "@/src/components/ui/DomainValue";
import { PageShell } from "@/src/components/ui/PageShell";
import { Button, buttonVariants } from "@/src/components/ui/Button";
import { ConfirmDialog } from "@/src/components/ui/Modal";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { QueryError } from "@/src/components/ui/PageError";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { MenuGloss } from "@/src/components/layout/MenuGloss";
import { formatHistoricalDate } from "@/lib/utils";
import { termState, type TermState } from "@/src/lib/dispositionTerm";
import { verdictGlyph, verdictInk } from "@/src/lib/verdictGlyph";

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
 * 今日 24:00」没有画:期满任务
 * (`disposition.expire_due`)没有排进任何调度,下次何时跑没有可读的来源。
 */

const SECTIONS: readonly DispositionSection[] = ["pending", "executing", "expired"];
const SECTION_TITLE: Record<DispositionSection, string> = {
  pending: "disposition.section_pending",
  executing: "disposition.section_running",
  expired: "disposition.section_expired",
};
const SECTION_MARK: Record<DispositionSection, string> = { pending: "甲", executing: "乙", expired: "丙" };

export default function DispositionPage() {
  const { t, formatDate } = useI18n();
  const { user } = useTenant();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [showExecuteModal, setShowExecuteModal] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  const [pages, setPages] = useState<Record<DispositionSection, number>>({ pending: 1, executing: 1, expired: 1 });

  // One query per section, each paged on its own. `dispositionKeys.list` sits under
  // `["dispositions"]`, which the execute mutation below invalidates.
  const sectionQuery = (params: DispositionListParams) => ({
    queryKey: dispositionKeys.list(params),
    queryFn: () => dispositionApi.list(params).then((r) => r.data),
    enabled: !!user,
    placeholderData: <P,>(previous: P) => previous,
  });
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

  const executeMutation = useMutation({
    mutationFn: (id: string) => dispositionApi.execute(id),
    onSuccess: () => {
      showToast(t("disposition.executed_success"), "success");
      queryClient.invalidateQueries({ queryKey: ["dispositions"] });
      setShowExecuteModal(null);
    },
    onError: () => showToast(t("disposition.execute_error"), "error"),
  });

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
  const sectionProps = (section: DispositionSection) => ({
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
          <Row key={d.id} testId="disposition-pending-row" cols="md:grid-cols-[1.3fr_7rem_1.3fr_8rem_6rem_7rem]">
            {soulLink(d)}
            <VerdictBadge verdict={d.verdict} />
            {realm(d)}
            <span className="text-[oklch(var(--color-ink-muted))]">{termLabel(termState(d, now), t)}</span>
            <span className="font-mono text-xs tabular-nums text-[oklch(var(--color-ink-subtle))]">{formatDate(d.created_at)}</span>
            <span className="flex justify-end">
              {d.is_eternal ? (
                <span className="text-xs text-[oklch(var(--color-ink-muted))]">{t("disposition.eternal")}</span>
              ) : (
                <RequirePermission permissions="disposition.execute">
                  <Button type="button" variant="secondary" size="sm" onClick={() => setShowExecuteModal(d.id)}>
                    {t("disposition.execute")}
                  </Button>
                </RequirePermission>
              )}
            </span>
          </Row>
        ))}
        {pager("pending")}
      </Section>

      {/* ── 乙 · 执行中:期限条,没有动作 ─────────────────────────────────── */}
      <Section {...sectionProps("executing")}>
        {running.map(({ d, term }) => (
          <Row key={d.id} testId="disposition-running-row" cols="md:grid-cols-[1.3fr_1.1fr_2fr_8rem]">
            {soulLink(d)}
            {realm(d)}
            <TermBar term={term} />
            <span className="text-right font-mono text-xs tabular-nums text-[oklch(var(--color-ink-muted))]">
              {term.kind === "running" ? t("disposition.days_left", { n: String(term.daysLeft) }) : termLabel(term, t)}
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
            <Row key={d.id} testId="disposition-expired-row" cols="md:grid-cols-[1.3fr_1.3fr_1fr_8rem]">
              {soulLink(d)}
              {realm(d)}
              <span className="font-mono text-xs tabular-nums text-[oklch(var(--color-warning))]">
                {end ? t("disposition.expired_on", { date: end }) : <MissingValue kind="unrecorded" />}
              </span>
              <span className="flex justify-end">
                <Link href={`/souls/${d.soul}`} className={buttonVariants({ variant: "primary", size: "sm" })}>
                  {t("disposition.arrange_reincarnation")}
                </Link>
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
      <ConfirmDialog
        isOpen={showExecuteModal !== null}
        title={t("disposition.confirm_execute")}
        message={t("disposition.execute_warning")}
        confirmText={t("disposition.confirm_execute")}
        variant="danger"
        confirmLoading={executeMutation.isPending}
        onCancel={() => setShowExecuteModal(null)}
        onConfirm={() => showExecuteModal && executeMutation.mutate(showExecuteModal)}
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
  return (
    <span className={`justify-self-start border border-current px-1.5 font-mono text-2xs whitespace-nowrap ${verdictInk(verdict)}`}>
      <span aria-hidden="true">{verdictGlyph(verdict)} </span>
      <DomainEnum namespace="judgment.verdicts" value={verdict} />
    </span>
  );
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
  const late = pct > 90;
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
          className={`absolute inset-y-0 left-0 ${late ? "bg-[oklch(var(--color-warning))]" : "bg-[oklch(var(--color-ink))]"}`}
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
  children,
}: {
  mark: string;
  title: string;
  count: number;
  testId: string;
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <section className="mb-6" data-testid={testId}>
      <h2 className="pt-4 pb-1 border-b border-[oklch(var(--color-block))] font-mono text-2xs uppercase text-[oklch(var(--color-ink-subtle))]">
        <span aria-hidden="true">{mark} · </span>
        {title} <span className="tabular-nums" data-testid="section-count">{count}</span>
      </h2>
      {count === 0 ? (
        <p className="py-2 text-sm text-[oklch(var(--color-ink-subtle))]">{t("disposition.section_empty")}</p>
      ) : (
        children
      )}
    </section>
  );
}

/** 一行账:桌面按列,393 下单列堆叠;行高 36 / 52(规范 v1 §2 行高)。 */
function Row({ cols, testId, children }: { cols: string; testId: string; children: ReactNode }) {
  return (
    <div
      data-testid={testId}
      className={`grid grid-cols-1 ${cols} items-center gap-x-3 gap-y-1 min-h-9 max-md:min-h-13 py-1 border-b border-[oklch(var(--color-rule))] text-sm`}
    >
      {children}
    </div>
  );
}
