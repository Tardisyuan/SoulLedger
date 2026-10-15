"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { auditApi } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { usePlaque } from "@/src/components/plaque/Plaque";
import { useHall } from "@/src/components/plaque/useHall";
import { usePermissions } from "@/src/hooks/usePermissions";
import { Skeleton } from "@/components/ui/skeleton";
import { PageShell } from "@/src/components/ui/PageShell";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { Button } from "@/src/components/ui/Button";
import { LedgerHeading } from "@/src/components/souls/detail/SoulLedgerSections";

/** A cell for any JSON value: strings as typed, everything else as compact JSON. */
function show(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

interface ChangeRow {
  key: string;
  /** Present on `{old, new}` entries only. */
  diff?: { before: unknown; after: unknown };
  plain?: unknown;
}

/** `changes` is free-form. `{field: {old, new}}` is a before → after pair; any other entry is shown as it is. */
function changeRows(changes: Record<string, unknown> | null | undefined): ChangeRow[] {
  if (!changes) return [];
  return Object.entries(changes).map(([key, value]) => {
    const pair = value as Record<string, unknown> | null;
    if (pair && typeof pair === "object" && !Array.isArray(pair) && "old" in pair && "new" in pair) {
      return { key, diff: { before: pair.old, after: pair.new } };
    }
    return { key, plain: value };
  });
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] max-sm:grid-cols-1 gap-x-3 py-2 border-b border-[oklch(var(--color-rule))] text-sm">
      <dt className="text-[oklch(var(--color-ink-subtle))]">{label}</dt>
      <dd className="min-w-0 break-words text-[oklch(var(--color-ink))]">{children}</dd>
    </div>
  );
}

export default function AuditDetailPage() {
  const { t, formatDateTime } = useI18n();
  usePlaque({ title: t("audit.title"), hall: useHall(t("plaque.office.records")) });
  const { hasPermission } = usePermissions();
  const canReadAudit = hasPermission("audit.read");
  const router = useRouter();
  const id = useParams().id as string;

  const { data: log, isPending, isError } = useQuery({
    queryKey: ["audit", "detail", id],
    queryFn: async () => (await auditApi.get(id)).data,
    enabled: canReadAudit && !!id,
  });

  const backLink = (
    <Button variant="ghost" size="sm" onClick={() => router.back()}>
      {t("common.back")}
    </Button>
  );

  if (!canReadAudit) {
    return (
      <PageShell density="document" variant="page" title={t("audit.title")} backLink={backLink}>
        <EmptyState title={t("audit.access_denied")} reason={t("audit.needs_audit_read")} />
      </PageShell>
    );
  }
  if (isError) {
    return (
      <PageShell density="document" variant="page" title={t("audit.title")} backLink={backLink}>
        <EmptyState title={t("audit.detail.not_found")} />
      </PageShell>
    );
  }

  const rows = changeRows(log?.changes);
  return (
    <PageShell
      density="document"
      variant="page"
      backLink={backLink}
      title={isPending ? <Skeleton className="h-8 w-64" /> : t(`audit.actions.${log.action}`)}
      subtitle={isPending ? <Skeleton className="h-4 w-32" /> : log.description}
    >
      {isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <>
          <dl>
            <Row label={t("audit.timestamp")}>{formatDateTime(log.timestamp)}</Row>
            <Row label={t("audit.user")}>
              {log.user_display}
              {log.user_details?.tenant ? ` · ${log.user_details.tenant}` : ""}
            </Row>
            <Row label={t("audit.detail.resource")}>
              <span className="font-mono text-xs">
                {log.resource_id ? `${log.resource}#${log.resource_id}` : log.resource}
              </span>
            </Row>
            <Row label={t("audit.ip_address")}>
              <span className="font-mono text-xs">{log.ip_address}</span>
            </Row>
            <Row label={t("audit.detail.user_agent")}>{log.user_agent}</Row>
            {log.trace_id ? (
              <Row label={t("audit.detail.trace_id")}>
                <span className="font-mono text-xs">{log.trace_id}</span>{" "}
                {/* The list reads `?trace=` and asks the endpoint for that request's rows only. */}
                <Link
                  href={`/audit?trace=${encodeURIComponent(log.trace_id)}`}
                  className="text-[oklch(var(--color-accent-ink))] hover:underline"
                >
                  {t("audit.detail.trace_filter")}
                </Link>
              </Row>
            ) : null}
          </dl>

          <LedgerHeading mark="甲" title={t("audit.detail.changes")} count={rows.length} />
          {rows.length === 0 ? (
            <p className="py-2 text-sm text-[oklch(var(--color-ink-muted))]">{t("audit.detail.no_changes")}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-2xs uppercase tracking-widest text-[oklch(var(--color-ink-subtle))]">
                  <th scope="col" className="py-2 pr-3 font-normal">{t("audit.detail.field")}</th>
                  <th scope="col" className="py-2 pr-3 font-normal">{t("audit.detail.before")}</th>
                  <th scope="col" className="py-2 font-normal">{t("audit.detail.after")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="border-t border-[oklch(var(--color-rule))] align-top">
                    <th scope="row" className="py-2 pr-3 text-left font-mono text-xs font-normal">{r.key}</th>
                    {r.diff ? (
                      <>
                        <td className="py-2 pr-3 font-mono text-xs break-all">{show(r.diff.before)}</td>
                        <td className="py-2 font-mono text-xs break-all">{show(r.diff.after)}</td>
                      </>
                    ) : (
                      <td colSpan={2} className="py-2 font-mono text-xs break-all">{show(r.plain)}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </PageShell>
  );
}
