"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTenant } from "@/src/contexts/TenantContext";
import { useI18n } from "@/src/contexts/I18nContext";
import { api, PAGE_SIZE, type Tenant, type PaginatedResponse } from "@soulledger/core/api";
import { DataTable } from "@/components/ui/data-table";
import { PageShell } from "@/src/components/ui/PageShell";
import { Badge } from "@/src/components/ui/Badge";
import { MenuGloss } from "@/src/components/layout/MenuGloss";
import { RequireAdmin } from "@/src/components/rbac/RequirePermission";
import { PermissionDenied } from "@/src/components/rbac/PermissionDenied";

function TenantsPageContent() {
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
    >
      {/* 账页(规范 v1 §2):卡片列换成表格 —— 名称、编号(等宽)、状态徽章。
          加载 / 失败 / 空三种状态交给 DataTable:失败时是「! 加载失败」加重试,
          空时是一句话,两者字面不同(2026-08-29 量过:此前 500 与空列表逐字相同)。
          分页也由它渲染,不再往壳的 `pagination` 槽里手拼上一页 / 下一页。
          没有租户详情路由,所以不是整行链接。 */}
      <DataTable<Tenant>
        caption={t("tenants.list")}
        columns={[
          { key: "display_name", header: t("menus.name") },
          { key: "code", header: t("tenants.code") || "Code" },
          { key: "status", header: t("menus.status") },
        ]}
        data={tenants}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        keyExtractor={(tenant) => String(tenant.id)}
        renderRow={(tenant) => (
          <>
            <td className="px-4 py-3 font-medium text-[oklch(var(--color-ink))]">{tenant.display_name}</td>
            <td className="px-4 py-3 font-mono text-xs text-[oklch(var(--color-ink-muted))]">{tenant.code}</td>
            <td className="px-4 py-3">
              {/* `is_active` is in the same response and was going unread: every
                  tenant rendered a hardcoded green "Active", so a disabled
                  tenant looked enabled. */}
              <Badge tone={tenant.is_active ? "success" : "neutral"} glyph={tenant.is_active ? "✓" : "○"}>
                {tenant.is_active ? t("tenants.active") : t("tenants.inactive")}
              </Badge>
            </td>
          </>
        )}
        emptyMessage={t("tenants.no_tenants")}
        page={page}
        totalPages={totalPages}
        totalCount={count}
        onPageChange={setPage}
      />
    </PageShell>
  );
}


/* `RequireAdmin`,不是 `RequirePermission permissions="ADMIN"` —— 后者把角色名当
   码名用,只因为 `hasPermission` 对 ADMIN 短路才碰巧成立(见 RequirePermission.tsx
   里 RequireAdmin 的注释)。这两页对应的后端确实是硬编码的 ADMIN,不是某个码名。 */
export default function TenantsPage() {
  return (
    <RequireAdmin fallback={<PermissionDenied />}>
      <TenantsPageContent />
    </RequireAdmin>
  );
}
