"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTenant } from "@/src/contexts/TenantContext";
import { useI18n } from "@/src/contexts/I18nContext";
import { usePlaque } from "@/src/components/plaque/Plaque";
import { useHall } from "@/src/components/plaque/useHall";
import { api, PAGE_SIZE, type Tenant, type PaginatedResponse } from "@soulledger/core/api";
import { DataTable } from "@/components/ui/data-table";
import { PageShell } from "@/src/components/ui/PageShell";
import { Badge } from "@/src/components/ui/Badge";
import { MissingValue } from "@/src/components/ui/DomainValue";
import { MenuGloss } from "@/src/components/layout/MenuGloss";
import { RequireAdmin } from "@/src/components/rbac/RequirePermission";
import { PermissionDenied } from "@/src/components/rbac/PermissionDenied";
import { Button } from "@/src/components/ui/Button";
import { SealGlyphsDialog } from "@/src/components/tenants/SealGlyphsDialog";
import { TenantSettingsDialog } from "@/src/components/tenants/TenantSettingsDialog";
import { DEFAULT_SEAL_GLYPHS, type SealCiv } from "@/src/components/plaque/Seal";
import { civSkinOf } from "@/src/lib/civSkin";

function TenantsPageContent() {
  const { t } = useI18n();
  usePlaque({ hall: useHall(t("plaque.office.rules")) });
  const { user } = useTenant();
  const [page, setPage] = useState(1);
  const [editingSeal, setEditingSeal] = useState<Tenant | null>(null);
  const [editingSettings, setEditingSettings] = useState<Tenant | null>(null);

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
          { key: "seal_glyphs", header: t("tenants.seal.column") },
          { key: "actions", header: t("users.actions"), align: "right" },
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
            <td className="px-4 py-3">
              <SealGlyphsCell tenant={tenant} />
            </td>
            <td className="px-4 py-3 text-right">
              <Button type="button" variant="ghost" size="sm" onClick={() => setEditingSettings(tenant)}>
                {t("tenants.settings.edit")}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setEditingSeal(tenant)}>
                {t("tenants.seal.edit")}
              </Button>
            </td>
          </>
        )}
        emptyMessage={t("tenants.no_tenants")}
        page={page}
        totalPages={totalPages}
        totalCount={count}
        onPageChange={setPage}
      />
      {/* 印字(补足 A6):只有管理员能改,这一页整页已在 RequireAdmin 后面。
          key 让每次打开都从这一行的现值起步,而不是上一次输入的残留。 */}
      {editingSeal ? (
        <SealGlyphsDialog key={editingSeal.code} tenant={editingSeal} onClose={() => setEditingSeal(null)} />
      ) : null}
      {/* 殿的设置(说明、调拨开关、三语殿名、转生冷却):同样只有管理员,同样按 key 从现值起步。 */}
      {editingSettings ? (
        <TenantSettingsDialog key={editingSettings.code} tenant={editingSettings} onClose={() => setEditingSettings(null)} />
      ) : null}
    </PageShell>
  );
}

/** 印字一栏:配了就写配的字;没配写「默认「冥」」,淡色 —— 不配不是空,是文明默认。 */
function SealGlyphsCell({ tenant }: { tenant: Tenant }) {
  const { t } = useI18n();
  const glyphs = tenant.seal_glyphs ?? [];
  if (glyphs.length > 0) {
    return <span className="text-[oklch(var(--color-ink))]">{glyphs.join(" ")}</span>;
  }
  const skin = civSkinOf(tenant.code);
  const fallback = skin in DEFAULT_SEAL_GLYPHS ? DEFAULT_SEAL_GLYPHS[skin as SealCiv].join("") : null;
  return (
    <span className="text-xs text-[oklch(var(--color-ink-subtle))]">
      {fallback ? t("tenants.seal.default", { glyph: fallback }) : <MissingValue kind="inapplicable" />}
    </span>
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
