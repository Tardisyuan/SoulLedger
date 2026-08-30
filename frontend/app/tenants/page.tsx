"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTenant } from "@/src/contexts/TenantContext";
import { useI18n } from "@/src/contexts/I18nContext";
import { api, PAGE_SIZE, type Tenant, type PaginatedResponse } from "@/lib/api";
import { ListSkeleton } from "@/components/ui/skeleton";
import { PageShell } from "@/src/components/ui/PageShell";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { QueryError } from "@/src/components/ui/PageError";
import { MenuGloss } from "@/src/components/layout/MenuGloss";
import {
  CIVILIZATION_SHORT_CODES,
  TENANT_CODE_TO_CIVILIZATION,
} from "@/src/config/civilizations";

/**
 * The 3px identity rule down the left edge of a tenant row.
 *
 * `tailwind.config.js` reserves `border-3` for exactly two things — "文明身份线
 * 与判决落印带" — and a tenant IS a civilization here (`tenants.subtitle` reads
 * 各文明体系的租户配置), so this is that line rather than a new decoration.
 *
 * Derived through `TENANT_CODE_TO_CIVILIZATION` → `CIVILIZATION_SHORT_CODES`
 * rather than written as a four-member map, because a fifth civilization added
 * to `src/config/civilizations.ts` already carries its own prefix and would get
 * the rule for free. The colour has to arrive as an inline custom-property
 * reference and not a class: `--civ-mark` is stamped per *logged-in* tenant by
 * the `[data-civ]` rules in globals.css, and this list shows every tenant at
 * once, so each row names its own `--color-civ-mark-*` directly — the same
 * direct naming globals.css records for the dashboard swatch.
 *
 * An unmapped code gets no rule at all rather than a grey one: 3px of hairline
 * would read as an identity that happens to be dull.
 */
function civMark(tenantCode: string): string | undefined {
  const civilization = TENANT_CODE_TO_CIVILIZATION[tenantCode];
  const prefix = civilization ? CIVILIZATION_SHORT_CODES[civilization] : undefined;
  return prefix ? `hsl(var(--color-civ-mark-${prefix}))` : undefined;
}

export default function TenantsPage() {
  const { t } = useI18n();
  const { user } = useTenant();
  const [page, setPage] = useState(1);

  // tenantsApi.list() (lib/api/tenants.ts) doesn't forward a `page` param, so this
  // calls the shared `api` client directly to reach `/tenants/?page=`.
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["tenants", page],
    queryFn: () => api.get<PaginatedResponse<Tenant>>("/tenants/", { params: { page } }).then(r => r.data),
    enabled: !!user,
  });

  const tenants = data?.results ?? [];
  const count = data?.count ?? 0;
  const totalPages = data ? Math.ceil(count / PAGE_SIZE) : 0;
  const showPagination = !isLoading && tenants.length > 0;

  return (
    <PageShell
      variant="page"
      title={
        <>
          {t("tenants.title") || "Tenants"}
          <MenuGloss path="/tenants" />
        </>
      }
      subtitle={t("tenants.subtitle") || "Tenant management"}
      isLoading={isLoading}
      skeleton={<ListSkeleton count={5} />}
      // A failed request used to fall straight through to the empty state,
      // so "the server is down" and "there are no tenants" rendered the same
      // words. Measured 2026-08-29: identical page text, character for
      // character, between a 500 and an empty list.
      isEmpty={isError || tenants.length === 0}
      empty={
        isError ? (
          <QueryError onRetry={() => refetch()} />
        ) : (
          <EmptyState
            title={t("tenants.list")}
            reason={t("tenants.no_tenants")}
          />
        )
      }
      pagination={
        showPagination
          ? {
              // The two halves are supplied separately rather than handing the
              // slot a whole `<Pagination>`: that component is one atomic row
              // (`src/components/ui/Pagination.tsx:19` — `flex items-center
              // justify-between mt-4 px-2`) and this slot is already that row.
              // See the report; the short version is that nesting them either
              // collapses the inner `justify-between` inside the slot's
              // `shrink-0` controls cell, or drags `mt-4` in and drops the
              // buttons 8px below the count text it is supposed to sit level
              // with. Pagination.tsx is off-limits this wave, so the page gives
              // the slot what the slot asks for.
              count: (
                <p className="text-03 text-ink-muted">
                  {t("pagination.info", {
                    page: String(page),
                    total: String(totalPages),
                    count: String(count),
                  })}
                </p>
              ),
              controls: (
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                  >
                    ← {t("common.prev")}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setPage(p => p + 1)}
                    disabled={page >= totalPages}
                  >
                    {t("common.next")} →
                  </Button>
                </div>
              ),
            }
          : undefined
      }
    >
      <div className="space-y-3">
        {tenants.map((tenant: Tenant) => {
          const mark = civMark(tenant.code);
          return (
            <div
              key={tenant.id}
              className={`bg-surface-1 border border-hairline p-4 flex items-center justify-between gap-4${mark ? " border-l-3" : ""}`}
              style={mark ? { borderLeftColor: mark } : undefined}
            >
              <div className="min-w-0">
                <p className="text-03 font-medium text-ink truncate">{tenant.display_name}</p>
                <p className="text-02 font-mono text-ink-subtle mt-1 truncate">
                  {t("tenants.code") || "Code"}: {tenant.code}
                </p>
              </div>
              {/* `is_active` is in the same response and was going unread: every
                  tenant rendered a hardcoded green "Active", so a disabled
                  tenant looked enabled. The literal was not translated either,
                  which put a bare English word in the 简体中文 and Kemet
                  interfaces. */}
              <Badge tone={tenant.is_active ? "success" : "neutral"}>
                {tenant.is_active ? t("tenants.active") : t("tenants.inactive")}
              </Badge>
            </div>
          );
        })}
      </div>
    </PageShell>
  );
}
