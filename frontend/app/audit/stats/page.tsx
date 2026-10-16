"use client";

import { useMemo, type ReactNode } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { auditApi } from "@soulledger/core/api";
import { toIntlLocale, useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { usePlaque } from "@/src/components/plaque/Plaque";
import { useHall } from "@/src/components/plaque/useHall";
import { usePermissions } from "@/src/hooks/usePermissions";
import { PageShell } from "@/src/components/ui/PageShell";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { QueryError } from "@/src/components/ui/PageError";
import { Spinner } from "@/src/components/ui/Spinner";
import { DomainEnum } from "@/src/components/ui/DomainValue";
import { MenuGloss } from "@/src/components/layout/MenuGloss";
import { AuditTabs } from "@/src/components/audit/AuditTabs";
import { auditResourceLabel } from "@/src/components/audit/auditLabels";

/**
 * /audit/stats(第三十七批 W-9b)。单独一个页签，不放在列表上方:列表一筛选，上面的数字却不动，
 * 会被当成筛选结果。`GET /audit-logs/stats/` 不收参数，范围与列表一样按殿划界 ——
 * 只有全局管理员(ADMIN 且不属于任何殿)数的是全部殿。
 */
export default function AuditStatsPage() {
  const { t, locale } = useI18n();
  usePlaque({ hall: useHall(t("plaque.office.records")) });
  const { hasPermission } = usePermissions();
  const canReadAudit = hasPermission("audit.read");
  const { user, tenantCode } = useTenant();
  const isGlobalAdmin = user?.role === "ADMIN" && tenantCode === null;

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["audit-stats"],
    queryFn: async () => (await auditApi.stats()).data,
    enabled: canReadAudit,
  });
  const { data: actionValues = [] } = useQuery({
    queryKey: ["audit-actions"],
    queryFn: async () => (await auditApi.actions()).data.map((a) => a.value),
    enabled: canReadAudit,
    staleTime: Infinity,
  });

  const actions = useMemo(
    () => (data?.action_distribution ?? []).filter((a) => a.count > 0).sort((a, b) => b.count - a.count),
    [data]
  );
  // 「另 N 种动作没有记录」:全部 `AuditAction` 成员里，分布里没有(或为 0)的那些。
  const zeroActions = actionValues.filter((v) => !actions.some((a) => a.action === v)).length;
  const resources = useMemo(
    () =>
      [...(data?.top_resources ?? [])].sort(
        (a, b) => b.count - a.count || (a.resource < b.resource ? -1 : a.resource > b.resource ? 1 : 0)
      ),
    [data]
  );
  const number = (n: number) => new Intl.NumberFormat(toIntlLocale(locale)).format(n);

  const title = (
    <>
      {t("audit.title")}
      <MenuGloss path="/audit" />
    </>
  );
  if (!canReadAudit) {
    return (
      <PageShell variant="full" title={title}>
        <EmptyState title={t("audit.access_denied")} reason={t("audit.needs_audit_read")} />
      </PageShell>
    );
  }

  let body: ReactNode;
  if (isError) body = <QueryError onRetry={() => void refetch()} detail={t("audit.stats.failed")} />;
  else if (isPending) body = <Spinner />;
  else if (data.total_logs === 0) body = <EmptyState title={t("audit.no_logs")} />;
  else {
    const max = actions[0]?.count ?? 1;
    body = (
      <div className="max-w-3xl">
        <p data-testid="stats-scope" className="text-md font-semibold text-[oklch(var(--color-ink))]">
          {t(isGlobalAdmin ? "audit.stats.scope_all" : "audit.stats.scope_hall", { count: number(data.total_logs) })}
        </p>
        <p className="mt-1 text-xs text-[oklch(var(--color-ink-muted))]">{t("audit.stats.scope_note")}</p>

        <h3 className="mt-6 mb-2 text-sm font-semibold">{t("audit.stats.by_action")}</h3>
        <ul className="space-y-1">
          {actions.map((a) => (
            <li key={a.action} data-testid="stats-action" className="grid grid-cols-[8rem_1fr_4rem] items-center gap-3 text-sm">
              <DomainEnum namespace="audit.actions" value={a.action} />
              <span aria-hidden="true" className="h-2 bg-[oklch(var(--color-ink))]" style={{ width: `${(a.count / max) * 100}%` }} />
              <span className="text-right font-mono text-xs">{number(a.count)}</span>
            </li>
          ))}
        </ul>
        {zeroActions > 0 && (
          <p className="mt-2 text-xs text-[oklch(var(--color-ink-muted))]">{t("audit.stats.zero_actions", { n: String(zeroActions) })}</p>
        )}

        <h3 className="mt-6 mb-2 text-sm font-semibold">{t("audit.stats.top_resources")}</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-[oklch(var(--color-ink-subtle))]">
              <th scope="col" className="py-1 pr-3 font-normal">{t("audit.stats.col_resource")}</th>
              <th scope="col" className="py-1 text-right font-normal">{t("audit.stats.col_count")}</th>
            </tr>
          </thead>
          <tbody>
            {resources.map((r) => {
              const name = auditResourceLabel(t, r.resource);
              return (
                <tr key={r.resource} data-testid="stats-resource" className="border-t border-[oklch(var(--color-rule))]">
                  <td className="py-1 pr-3">
                    <Link
                      href={`/audit?resource=${encodeURIComponent(r.resource)}`}
                      aria-label={t("audit.stats.row_label", { name })}
                      title={r.resource}
                      className="text-[oklch(var(--color-accent-ink))] hover:underline"
                    >
                      {name}
                    </Link>
                  </td>
                  <td className="py-1 text-right font-mono text-xs">{number(r.count)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <PageShell variant="full" title={title} tabs={<AuditTabs />}>
      {body}
    </PageShell>
  );
}
