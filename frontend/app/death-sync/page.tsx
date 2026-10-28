"use client";
import { Suspense, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTenant } from "@/src/contexts/TenantContext";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { usePlaque } from "@/src/components/plaque/Plaque";
import { useHall } from "@/src/components/plaque/useHall";
import { deathSyncApi, PAGE_SIZE, type DeathRegistration } from "@soulledger/core/api";
import { DataTable } from "@/components/ui/data-table";
import { PageSection } from "@/components/ui/page-section";
import { MenuGloss } from "@/src/components/layout/MenuGloss";
import { DomainEnum, IdentifierChip, MissingValue } from "@/src/components/ui/DomainValue";
import { Button } from "@/src/components/ui/Button";
import { ConfirmDialog } from "@/src/components/ui/Modal";
import { PageShell } from "@/src/components/ui/PageShell";
import { type BadgeTone } from "@/src/components/ui/Badge";
import { StatusBadge } from "@/src/components/ui/StatusBadge";
import { FilterChipSelect } from "@/src/components/ui/FilterChip";
import { DeathSyncTabs } from "@/src/components/death-sync/DeathSyncTabs";
import { ExportCsvButton } from "@/src/components/ExportCsvButton";
import { fieldControl } from "@/src/components/ui/Field";
import { cn } from "@/lib/utils";

/**
 * Sync status → badge tone. 规范 v1:徽章无底色,颜色之外配一枚字形(`StatusBadge`)。
 *
 * 这张表此前是 `--color-status-*` 反馈令牌的直写表,登记在
 * `src/__tests__/statusTokenLayering.test.ts` 里「记下而未修」—— 理由是「移走的论据
 * 弱,但不是没有」。改成 tone 就是那条登记等的修法:tone 表本来就是反馈层,
 * PENDING / PROCESSED / FAILED 说的正是一次同步操作的结果。登记条目随之删除。
 */
const STATUS_TONES: Record<string, BadgeTone> = {
  // 规范 v3:还没处理不是风险,中性;FAILED 是错误。ACCEPTED / PARTIAL 已从后端删去(2026-10-29):从没有行写过它们。
  PENDING: "neutral",
  PROCESSED: "success",
  FAILED: "error",
  DUPLICATE: "neutral",
};

const STATUSES = Object.keys(STATUS_TONES);

/**
 * Only INTERNAL_ERROR is retried (user decision 2026-10-16): SOUL_NOT_FOUND,
 * SOUL_NOT_ALIVE, INVALID_TRANSITION, VALIDATION_ERROR are answers about the
 * data, and running them again gives the same answer. Same three checks the
 * server makes before answering 409 (`DeathSyncService.retry_failed`).
 */
const canRetry = (reg: DeathRegistration) =>
  reg.status === "FAILED" && reg.error_code === "INTERNAL_ERROR" && reg.retry_count < reg.max_retries;

export default function DeathSyncPage() {
  // useSearchParams needs a Suspense boundary or the route opts out of static
  // rendering (Next.js App Router) — same as app/judgment/queue/page.tsx.
  return (
    <Suspense fallback={null}>
      <DeathSyncRoute />
    </Suspense>
  );
}

function DeathSyncRoute() {
  const { t, formatDateTime } = useI18n();
  const hall = useHall(t("plaque.office.records"));
  usePlaque({ hall });
  const { user } = useTenant();
  const router = useRouter();
  const pathname = usePathname();
  // The status filter lives in the URL, so the dashboard's 「死亡同步异常」 cell
  // can link straight to `?status=FAILED` and the filter survives a reload.
  const status = useSearchParams().get("status") ?? "";

  // Page in the key and on the wire — `DeathRegistrationReadViewSet` is a DRF
  // ReadOnlyModelViewSet and paginates at PAGE_SIZE; this read one page and
  // offered no way to the rest (FL-09). Same shape as `app/dispatch/page.tsx`.
  const [page, setPage] = useState(1);
  // 其余筛选(审计 2026-10-17 第 12 条,`DeathRegistrationFilter`):灵魂姓名 / 来源编号 / 幂等键、收到的日期起止。
  // 只属于这一次到访,不进 URL;导出带同一组(加上状态)。
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const filterParams: Record<string, string> = {};
  if (status) filterParams.status = status;
  if (search.trim()) filterParams.search = search.trim();
  if (from) filterParams.received_after = from;
  if (to) filterParams.received_before = to;
  const isFiltered = Object.keys(filterParams).length > 0;
  const changeFilter = (apply: () => void) => {
    apply();
    setPage(1);
  };
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["death-sync", "registrations", page, filterParams],
    queryFn: async () => (await deathSyncApi.registrations({ page: String(page), ...filterParams })).data,
    enabled: !!user,
    // Pushed: death-sync events invalidate ["death-sync"].
    staleTime: 0,
    placeholderData: (previous) => previous,
  });
  const registrations = data?.results ?? [];
  // A server-side count, not the length of one page.
  const summary = useQuery({
    queryKey: ["death-sync", "summary"],
    queryFn: async () => (await deathSyncApi.summary()).data,
    enabled: !!user,
    staleTime: 0,
  });

  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [retrying, setRetrying] = useState<DeathRegistration | null>(null);
  const retry = useMutation({
    mutationFn: (id: string) => deathSyncApi.retry(id),
    onSuccess: ({ data: row }) => {
      if (row.status === "PROCESSED") showToast(t("death_sync.retry.done"), "success");
      else showToast(t("death_sync.retry.still_failed", { reason: t(`death_sync.error.${row.error_code}`) }), "error");
    },
    // 409 = the row changed under us (another click, another admin, or the
    // limit); the refetch below shows what it is now.
    onError: () => showToast(t("death_sync.retry.refused"), "error"),
    onSettled: () => {
      setRetrying(null);
      void queryClient.invalidateQueries({ queryKey: ["death-sync"] });
    },
  });

  const setStatus = (next: string) => {
    setPage(1);
    router.replace(next ? `${pathname}?status=${encodeURIComponent(next)}` : pathname);
  };

  return (
    <PageShell
      variant="page"
      title={
        <>
          {t("death_sync.title") || "Death Registration"}
          <MenuGloss path="/death-sync" />
        </>
      }
      subtitle={t("death_sync.subtitle") || "External death registration sync"}
      tabs={<DeathSyncTabs />}
    >
      {/* 规范 v3 面板:surface-1 底 + 结构线,20 px 面板标题;v2 的分节纹撤掉。 */}
      <PageSection title={t("death_sync.registrations")}>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <FilterChipSelect
            label={t("death_sync.status_label")}
            value={status}
            options={[
              { value: "", label: t("filter.all") },
              ...STATUSES.map((s) => ({ value: s, label: t(`death_sync.status.${s}`) })),
            ]}
            clearLabel={t("filter.clear_one", { name: t("death_sync.status_label") })}
            onChange={setStatus}
          />
          <input
            type="text"
            data-testid="death-sync-search"
            placeholder={t("death_sync.filter.search")}
            aria-label={t("death_sync.filter.search")}
            value={search}
            onChange={(e) => changeFilter(() => setSearch(e.target.value))}
            className={cn(fieldControl({ size: "md" }), "flex-1 min-w-[200px]")}
          />
          <input
            type="date"
            data-testid="death-sync-from"
            aria-label={t("death_sync.filter.from")}
            title={t("death_sync.filter.from")}
            value={from}
            max={to || undefined}
            onChange={(e) => changeFilter(() => setFrom(e.target.value))}
            className={fieldControl({ size: "md" })}
          />
          <input
            type="date"
            data-testid="death-sync-to"
            aria-label={t("death_sync.filter.to")}
            title={t("death_sync.filter.to")}
            value={to}
            min={from || undefined}
            onChange={(e) => changeFilter(() => setTo(e.target.value))}
            className={fieldControl({ size: "md" })}
          />
          {summary.data && summary.data.anomaly_count > 0 && (
            <button
              type="button"
              data-testid="death-sync-anomalies"
              onClick={() => setStatus(summary.data.anomaly_status)}
              className="text-sm text-[oklch(var(--color-danger))] underline"
            >
              <span aria-hidden="true">! </span>
              {t("death_sync.anomaly_count", { count: String(summary.data.anomaly_count) })}
            </button>
          )}
          <div className="ml-auto">
            <ExportCsvButton
              size="sm"
              fetchCsv={() => deathSyncApi.exportCsv(filterParams)}
              page={t("death_sync.title")}
              hall={hall}
              count={data?.count}
            />
          </div>
        </div>
        {/* 账页表格(规范 v1 §2)。没有详情路由,所以不是整行链接。
            失败与空仍分开:DataTable 的失败行是「! 加载失败」+ 重试。 */}
        <DataTable<DeathRegistration>
          caption={t("death_sync.registrations")}
          columns={[
            { key: "source", header: t("death_sync.source_system") },
            { key: "requested", header: t("death_sync.requested") },
            { key: "duration", header: t("death_sync.duration"), align: "right" },
            { key: "status", header: t("death_sync.status_label") },
            { key: "actions", header: t("common.row_actions"), align: "right", srOnlyHeader: true },
          ]}
          data={registrations}
          isLoading={isLoading}
          isError={isError}
          onRetry={() => refetch()}
          emptyMessage={t("death_sync.no_registrations")}
          /* 空状态给一条出路(补足 C15):按状态筛空了,就给「清除筛选」。 */
          isFiltered={isFiltered}
          onClearFilters={() => {
            changeFilter(() => {
              setSearch("");
              setFrom("");
              setTo("");
            });
            setStatus("");
          }}
          keyExtractor={(reg) => String(reg.id)}
          renderRow={(reg) => (
            <>
              <td className="px-3 py-2 whitespace-nowrap">
                <p className="font-medium text-[oklch(var(--color-ink))]">{reg.source_system}</p>
                <p className="text-xs text-[oklch(var(--color-ink-subtle))]">
                  {/* IdentifierChip, not dead text. This one is a genuine
                      exception to clauses 1-2 and is registered as such in
                      IDENTIFIER_POLICY_EXCEPTIONS — an external system's
                      reference IS the content of a sync row. Clause 3 is
                      not waivable though: a reference you cannot paste back
                      into the source system is a decoration, not a trace. */}
                  {t("death_sync.reference") || "Ref"}:{" "}
                  <IdentifierChip
                    id={reg.source_reference_id || reg.idempotency_key}
                    variant="inline"
                  />
                </p>
                {(reg.error_code || reg.error_message) && (
                  <div className="max-w-80 whitespace-normal text-xs">
                    {/* 补足 C15:出错是冷玫红「✕ 原因」。原因是译名,原码在 title 里;
                        服务端的原文另起一行，失败无论能否重试都留在这里给管理员看。 */}
                    <p className="text-[oklch(var(--color-danger))]">
                      <span aria-hidden="true">✕ </span>
                      <DomainEnum namespace="death_sync.error" value={reg.error_code} />
                    </p>
                    {reg.error_message && (
                      <p className="text-[oklch(var(--color-ink-muted))]">{reg.error_message}</p>
                    )}
                  </div>
                )}
                {reg.retry_count > 0 && (
                  <p className="text-xs text-[oklch(var(--color-ink-subtle))]">
                    {t("death_sync.retry.count", { count: String(reg.retry_count), max: String(reg.max_retries) })}
                  </p>
                )}
              </td>
              <td className="px-3 py-2 font-mono text-xs whitespace-nowrap text-[oklch(var(--color-ink-muted))]">
                {formatDateTime(reg.request_timestamp)}
              </td>
              <td className="px-3 py-2 text-right font-mono text-xs tabular-nums text-[oklch(var(--color-ink-muted))]">
                {/* `!= null`,不是真值判断:`processing_duration_ms` 是 `number | null`,
                    0 ms 是一个值,照常显示;只有 null 才是「未记录」。 */}
                {reg.processing_duration_ms != null ? `${reg.processing_duration_ms}ms` : <MissingValue kind="unrecorded" />}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                <StatusBadge namespace="death_sync.status" value={reg.status} tone={STATUS_TONES[reg.status] ?? "neutral"} />
              </td>
              <td className="px-3 py-2 text-right whitespace-nowrap">
                {canRetry(reg) && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setRetrying(reg)}>
                    {t("death_sync.retry.action")}
                  </Button>
                )}
              </td>
            </>
          )}
          page={page}
          totalPages={Math.max(1, Math.ceil((data?.count ?? 0) / PAGE_SIZE))}
          totalCount={data?.count ?? 0}
          onPageChange={setPage}
        />
        <ConfirmDialog
          isOpen={retrying !== null}
          title={t("death_sync.retry.confirm_title")}
          message={t("death_sync.retry.confirm_message")}
          confirmText={t("death_sync.retry.action")}
          confirmLoading={retry.isPending}
          onConfirm={() => retrying && retry.mutate(retrying.id)}
          onCancel={() => setRetrying(null)}
        />
      </PageSection>
    </PageShell>
  );
}
