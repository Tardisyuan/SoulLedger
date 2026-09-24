"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTenant } from "@/src/contexts/TenantContext";
import { useI18n } from "@/src/contexts/I18nContext";
import { api, PAGE_SIZE } from "@soulledger/core/api";
import { DataTable } from "@/components/ui/data-table";
import { PageSection } from "@/components/ui/page-section";
import { MenuGloss } from "@/src/components/layout/MenuGloss";
import { IdentifierChip, MissingValue } from "@/src/components/ui/DomainValue";
import { PageShell } from "@/src/components/ui/PageShell";
import { type BadgeTone } from "@/src/components/ui/Badge";
import { StatusBadge } from "@/src/components/ui/StatusBadge";

interface DeathRegistration {
  id: string;
  source_system: string;
  status: string;
  idempotency_key: string;
  source_reference_id: string;
  request_timestamp: string;
  processing_duration_ms: number | null;
  error_message: string;
}

/**
 * Sync status → badge tone. 规范 v1:徽章无底色,颜色之外配一枚字形(`StatusBadge`)。
 *
 * 这张表此前是 `--color-status-*` 反馈令牌的直写表,登记在
 * `src/__tests__/statusTokenLayering.test.ts` 里「记下而未修」—— 理由是「移走的论据
 * 弱,但不是没有」。改成 tone 就是那条登记等的修法:tone 表本来就是反馈层,
 * PENDING / PROCESSED / FAILED 说的正是一次同步操作的结果。登记条目随之删除。
 */
const STATUS_TONES: Record<string, BadgeTone> = {
  PENDING: "warning",
  ACCEPTED: "info",
  PROCESSED: "success",
  FAILED: "error",
  DUPLICATE: "neutral",
  PARTIAL: "warning",
};

export default function DeathSyncPage() {
  const { t, formatDateTime } = useI18n();
  const { user } = useTenant();

  // Page in the key and on the wire — `DeathRegistrationReadViewSet` is a DRF
  // ReadOnlyModelViewSet and paginates at PAGE_SIZE; this read one page and
  // offered no way to the rest (FL-09). Same shape as `app/dispatch/page.tsx`.
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["death-sync", "registrations", page],
    queryFn: () => api.get("/death-sync/registrations/", { params: { page: String(page) } }).then(r => r.data),
    enabled: !!user,
    placeholderData: (previous) => previous,
  });
  const registrations = data?.results ?? [];

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
    >
      <PageSection title={t("death_sync.registrations") || "Registrations"}>
        {/* 账页表格(规范 v1 §2)。没有详情路由,所以不是整行链接。
            失败与空仍分开:DataTable 的失败行是「! 加载失败」+ 重试。 */}
        <DataTable<DeathRegistration>
          caption={t("death_sync.registrations")}
          columns={[
            { key: "source", header: t("death_sync.source_system") },
            { key: "requested", header: t("death_sync.requested") },
            { key: "duration", header: t("death_sync.duration"), align: "right" },
            { key: "status", header: t("death_sync.status_label") },
          ]}
          data={registrations}
          isLoading={isLoading}
          isError={isError}
          onRetry={() => refetch()}
          emptyMessage={t("death_sync.no_registrations") || "No death registrations found."}
          keyExtractor={(reg) => String(reg.id)}
          renderRow={(reg) => (
            <>
              <td className="px-3 py-2">
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
                {reg.error_message && (
                  <p className="text-xs text-[oklch(var(--color-danger))]">
                    <span aria-hidden="true">! </span>
                    {reg.error_message}
                  </p>
                )}
              </td>
              <td className="px-3 py-2 font-mono text-xs text-[oklch(var(--color-ink-muted))]">
                {formatDateTime(reg.request_timestamp)}
              </td>
              <td className="px-3 py-2 text-right font-mono text-xs tabular-nums text-[oklch(var(--color-ink-muted))]">
                {/* `!= null`,不是真值判断:`processing_duration_ms` 是 `number | null`,
                    0 ms 是一个值,照常显示;只有 null 才是「未记录」。 */}
                {reg.processing_duration_ms != null ? `${reg.processing_duration_ms}ms` : <MissingValue kind="unrecorded" />}
              </td>
              <td className="px-3 py-2">
                <StatusBadge namespace="death_sync.status" value={reg.status} tone={STATUS_TONES[reg.status] ?? "neutral"} />
              </td>
            </>
          )}
          page={page}
          totalPages={Math.max(1, Math.ceil((data?.count ?? 0) / PAGE_SIZE))}
          totalCount={data?.count ?? 0}
          onPageChange={setPage}
        />
      </PageSection>
    </PageShell>
  );
}
