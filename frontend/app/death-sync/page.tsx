"use client";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { useTenant } from "@/src/contexts/TenantContext";
import { useI18n } from "@/src/contexts/I18nContext";
import { api } from "@soulledger/core/api";
import { ListSkeleton } from "@/components/ui/skeleton";
import { PageSection } from "@/components/ui/page-section";
import { MenuGloss } from "@/src/components/layout/MenuGloss";
import { DomainEnum, IdentifierChip } from "@/src/components/ui/DomainValue";
import { PageShell } from "@/src/components/ui/PageShell";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { QueryError } from "@/src/components/ui/PageError";
import { badgeVariants } from "@/src/components/ui/Badge";

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

const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-[hsl(var(--color-status-warning)/0.1)] text-[hsl(var(--color-status-warning))]",
  ACCEPTED: "bg-[hsl(var(--color-status-info)/0.1)] text-[hsl(var(--color-status-info))]",
  PROCESSED: "bg-[hsl(var(--color-status-success)/0.1)] text-[hsl(var(--color-status-success))]",
  FAILED: "bg-[hsl(var(--color-status-error)/0.1)] text-[hsl(var(--color-status-error))]",
  DUPLICATE: "bg-[hsl(var(--color-status-lost)/0.1)] text-[hsl(var(--color-status-lost))]",
  PARTIAL: "bg-[hsl(var(--color-status-warning)/0.1)] text-[hsl(var(--color-status-warning))]",
};

/**
 * Badge geometry from `Badge`, fill from the table above.
 *
 * `tone: null` skips the variant and its default, so the six token pairs above
 * are the only colours in the list — see the same helper on the actors page.
 * `border-transparent` because those pairs name no border colour and `Badge`'s
 * base carries `border` (a width, not a colour): without it the badge would
 * inherit whatever `borderColor.DEFAULT` resolves to and grow a hairline these
 * rows never had.
 *
 * The table itself stays a `--color-status-*` map on purpose. It is one of the
 * four registered in `src/__tests__/statusTokenLayering.test.ts`, whose entry
 * reads "recorded rather than fixed because the argument for moving it is
 * weak, not absent" — moving it to a tone here would be answering a palette
 * question this pass was not asked, and deleting the register entry along
 * with it.
 */
function statusBadgeClass(status: string): string {
  return cn(badgeVariants({ tone: null }), "border-transparent", STATUS_COLORS[status] || "");
}

export default function DeathSyncPage() {
  const { t, formatDateTime } = useI18n();
  const { user } = useTenant();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["death-sync", "registrations"],
    queryFn: () => api.get("/death-sync/registrations/").then(r => r.data),
    enabled: !!user,
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
      <PageSection title={t("death_sync.registrations") || "Registrations"} isLoading={isLoading}>
        {/* A failed request used to fall through to the empty state, so
            "the server is down" and "there is nothing here" read the same. */}
        {isError ? (
          <QueryError onRetry={() => refetch()} />
        ) : isLoading ? (
          <ListSkeleton count={5} />
        ) : registrations.length === 0 ? (
          <EmptyState title={t("death_sync.no_registrations") || "No death registrations found."} />
        ) : (
          <div className="space-y-3">
            {registrations.map((reg: DeathRegistration) => (
              <div key={reg.id} className="bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-04 font-medium text-[hsl(var(--color-ink))]">{reg.source_system}</p>
                    <p className="text-03 text-[hsl(var(--color-ink-subtle))]">
                      {/* IdentifierChip, not dead text. This one is a genuine
                          exception to clauses 1-2 and is registered as such in
                          IDENTIFIER_POLICY_EXCEPTIONS — an external system's
                          reference IS the content of a sync row. Clause 3 is
                          not waivable though, and this line was violating it:
                          a reference you cannot paste back into the source
                          system is a decoration, not a trace. */}
                      {t("death_sync.reference") || "Ref"}:{" "}
                      <IdentifierChip
                        id={reg.source_reference_id || reg.idempotency_key}
                        variant="inline"
                      />
                    </p>
                  </div>
                  <DomainEnum
                    namespace="death_sync.status"
                    value={reg.status}
                    className={statusBadgeClass(reg.status)}
                  />
                </div>
                <div className="mt-2 flex gap-4 text-02 text-[hsl(var(--color-ink-muted))]">
                  <span>{t("death_sync.requested") || "Requested"}: {formatDateTime(reg.request_timestamp)}</span>
                  {/* `!= null`,不是真值判断。`processing_duration_ms` 是
                      `number | null`,值为 0 时 `0 && …` 求值为 `0`,而 React
                      **会把裸 0 渲染出来** —— 元信息行里凭空多一个 0。 */}
                  {reg.processing_duration_ms != null && (
                    <span>{t("death_sync.duration") || "Duration"}: {reg.processing_duration_ms}ms</span>
                  )}
                </div>
                {reg.error_message && (
                  <p className="mt-2 text-03 text-[hsl(var(--color-status-error))]">{reg.error_message}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </PageSection>
    </PageShell>
  );
}
