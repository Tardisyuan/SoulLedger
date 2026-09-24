"use client";
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTenant } from "@/src/contexts/TenantContext";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { dispositionApi, PAGE_SIZE, type Disposition } from "@soulledger/core/api";
import { ListSkeleton } from "@/components/ui/skeleton";
import { Pagination } from "@/src/components/ui/Pagination";
import { DomainText } from "@/src/components/ui/DomainValue";
import { PageShell } from "@/src/components/ui/PageShell";
import { Button, buttonVariants } from "@/src/components/ui/Button";
import { ConfirmDialog } from "@/src/components/ui/Modal";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { QueryError } from "@/src/components/ui/PageError";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { MenuGloss } from "@/src/components/layout/MenuGloss";
import { formatHistoricalDate } from "@/lib/utils";
import { sectionOf, termState, type TermState } from "@/src/lib/dispositionTerm";

/**
 * 处置(规范 v1 第三类 A·07):一页三段 —— 待执行 → 执行中 → 期满,就是处置本身的时间顺序。
 *
 * 规则 15 的例外只在这里和回收站:待执行段的「执行」、期满段的「安排轮回」是行尾按钮,
 * 因为这两段的工作就是那一个动作。执行中段没有动作,只有期限条。
 *
 * 分段是在**当前这一页**的行上做的:列表接口只有 `is_executed` 过滤,没有「期满」,
 * 所以三段的计数是本页的行数,总数在底下的分页条上。「期满」由 `term_start + sentence_years`
 * 算出(见 `src/lib/dispositionTerm.ts`);已轮回的灵魂在这里不被排除 —— 处置行不带
 * 灵魂状态,「安排轮回」因此是去灵魂页的链接,由那一页按真实状态决定能不能做。
 * 稿子里的「判决」列与「下次自动期满检查」没有画:处置不带裁决,到期检查没有在跑。
 */
export default function DispositionPage() {
  const { t, formatDate } = useI18n();
  const { user } = useTenant();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [showExecuteModal, setShowExecuteModal] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  // Page in the key and on the wire. `list()` was called with no `page` and
  // nothing offered another one, so everything past the server's twentieth
  // disposition was invisible and unreachable, and nothing said so (FL-09).
  // `app/dispatch/page.tsx` is the sibling this copies; the execute mutation
  // below invalidates `["dispositions"]`, which prefix-matches every page.
  const [page, setPage] = useState(1);

  const { data: dispositionsResponse, isLoading, isError, refetch } = useQuery({
    queryKey: ["dispositions", page],
    queryFn: () => dispositionApi.list({ page: String(page) }).then(r => r.data),
    enabled: !!user,
    placeholderData: (previous) => previous,
  });

  // /disposition/ is a paginated ModelViewSet list, so `results` is always
  // present (an empty array included) and the old `|| dispositionsResponse`
  // fallback could never be reached.
  const dispositions = dispositionsResponse?.results ?? [];
  const pending = dispositions.filter((d) => sectionOf(d, now) === "pending");
  const running = dispositions
    .filter((d) => sectionOf(d, now) === "running")
    .map((d) => ({ d, term: termState(d, now) }))
    // 按期满近 → 远;不计时的(永恒、缺期限、缺起算)排在最后。
    .sort((a, b) => daysLeftOf(a.term) - daysLeftOf(b.term));
  const expired = dispositions.filter((d) => sectionOf(d, now) === "expired");

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
      // `isError ||`, not `dispositions.length === 0` alone. A failed request
      // yields `results ?? []`, which is empty, so "the server is down" and
      // "no dispositions have been filed" rendered the same words.
      isEmpty={isError || dispositions.length === 0}
      empty={
        isError ? (
          <QueryError onRetry={() => refetch()} />
        ) : (
          <EmptyState
            title={t("disposition.list")}
            reason={t("disposition.no_dispositions")}
          />
        )
      }
    >
      {/* ── 甲 · 待执行:行尾「执行」(规则 15 例外) ─────────────────────── */}
      <Section mark="甲" title={t("disposition.section_pending")} count={pending.length}>
        {pending.map((d) => (
          <Row key={d.id} testId="disposition-pending-row" cols="md:grid-cols-[1.3fr_1.3fr_8rem_6rem_7rem]">
            {soulLink(d)}
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
      </Section>

      {/* ── 乙 · 执行中:期限条,没有动作 ─────────────────────────────────── */}
      <Section mark="乙" title={t("disposition.section_running")} count={running.length}>
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
      </Section>

      {/* ── 丙 · 期满:行尾「安排轮回」(规则 15 例外) ───────────────────── */}
      <Section mark="丙" title={t("disposition.section_expired")} count={expired.length}>
        {expired.map((d) => {
          const term = termState(d, now);
          return (
            <Row key={d.id} testId="disposition-expired-row" cols="md:grid-cols-[1.3fr_1.3fr_1fr_8rem]">
              {soulLink(d)}
              {realm(d)}
              <span className="font-mono text-xs tabular-nums text-[oklch(var(--color-warning))]">
                {term.kind === "served" && t("disposition.expired_on", { date: formatHistoricalDate(term.end) ?? "" })}
              </span>
              <span className="flex justify-end">
                <Link href={`/souls/${d.soul}`} className={buttonVariants({ variant: "primary", size: "sm" })}>
                  {t("disposition.arrange_reincarnation")}
                </Link>
              </span>
            </Row>
          );
        })}
      </Section>

      <Pagination
        page={page}
        totalPages={Math.max(1, Math.ceil((dispositionsResponse?.count ?? 0) / PAGE_SIZE))}
        count={dispositionsResponse?.count ?? 0}
        onPageChange={setPage}
      />

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

function daysLeftOf(term: TermState): number {
  return term.kind === "running" ? term.daysLeft : Number.POSITIVE_INFINITY;
}

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
    case "served":
      return t("sentence_plan.years", { years: String(term.end.year - term.start.year) });
  }
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

/** 分段标「甲 · 待执行 4」,空段写一行而不是塌掉。 */
function Section({ mark, title, count, children }: { mark: string; title: string; count: number; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <section className="mb-6">
      <h2 className="pt-4 pb-1 border-b border-[oklch(var(--color-block))] font-mono text-2xs uppercase text-[oklch(var(--color-ink-subtle))]">
        <span aria-hidden="true">{mark} · </span>
        {title} <span className="tabular-nums">{count}</span>
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
