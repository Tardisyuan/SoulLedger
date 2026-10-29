"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { tudiGodKeys, tudiGodsApi, type TudiGod } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import { usePlaque } from "@/src/components/plaque/Plaque";
import { useHall } from "@/src/components/plaque/useHall";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { PermissionDenied } from "@/src/components/rbac/PermissionDenied";
import { MenuGloss } from "@/src/components/layout/MenuGloss";
import { PageShell } from "@/src/components/ui/PageShell";
import { Button } from "@/src/components/ui/Button";
import { MissingValue } from "@/src/components/ui/DomainValue";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { ActionsMenu } from "@/components/ui/data-grid/ActionsMenu";
import { TudiGodEditor } from "@/src/components/tudi-gods/TudiGodEditor";
import { TudiRegisterDeathDialog } from "@/src/components/tudi-gods/TudiRegisterDeathDialog";
import { mayRegisterUnder } from "@/src/components/tudi-gods/tudiDisplay";
import { useTenant } from "@/src/contexts/TenantContext";

/*
 * 系统设置 › 土地公(Design 第五十七批 S-5),和「城隍」并列,照城隍管理:列表 + 右侧抽屉。
 * 四栏:土地公 · 管辖地 · 上级城隍(上级被删时灰字「—」)· 名下官员。看是 `judgment.read`,
 * 看 `tudi.read`;增改删 `tudi.manage`(接口自己查);行菜单「以土地公名义登记死亡」(S-6)要 `tudi.register`,且是这位土地公名下的官员
 * 或持 `tudi.manage`(同后端 `register_death`),土地公预填。(2026-10-29 从 judgment.* / soul.die 拆出。)
 * ponytail: 只取第一页(20 位);一殿的土地公多过一页再加分页。
 */

const MUTED = "text-sm text-[oklch(var(--color-ink-subtle))]";

function TudiGodsContent() {
  const { t } = useI18n();
  usePlaque({ hall: useHall(t("plaque.office.rules")) });
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission("tudi.manage");
  const canRegister = hasPermission("tudi.register");
  const { user } = useTenant();
  const registrable = (g: TudiGod) => canRegister && mayRegisterUnder(g, user?.id, canEdit);
  const [editing, setEditing] = useState<TudiGod | "new" | null>(null);
  const [registering, setRegistering] = useState<TudiGod | null>(null);
  const list = useQuery({ queryKey: [...tudiGodKeys.all, "list"], queryFn: () => tudiGodsApi.list().then((r) => r.data.results) });

  const columns: DataTableColumn[] = [
    { key: "name", header: t("earthGods.title"), pinned: true },
    { key: "regions", header: t("earthGods.jurisdiction") },
    { key: "city_god", header: t("earthGods.parent_city_god") },
    { key: "officers", header: t("earthGods.officers") },
    ...(canEdit || canRegister ? [{ key: "actions", header: t("earthGods.edit"), srOnlyHeader: true }] : []),
  ];

  return (
    <PageShell
      variant="page"
      title={
        <>
          {t("earthGods.title")}
          <MenuGloss path="/death-sync/tudi-gods" />
        </>
      }
      actions={
        canEdit ? (
          <Button type="button" variant="primary" size="sm" data-testid="tudi-god-create" onClick={() => setEditing("new")}>
            {t("earthGods.create")}
          </Button>
        ) : undefined
      }
    >
      <DataTable<TudiGod>
        caption={t("earthGods.title")}
        columns={columns}
        data={list.data ?? []}
        isLoading={list.isLoading}
        isError={list.isError}
        onRetry={() => list.refetch()}
        skeletonRows={3}
        emptyMessage={t("earthGods.empty")}
        keyExtractor={(g) => g.id}
        renderRow={(g) => (
          <>
            <td className="px-3 py-2 text-sm whitespace-nowrap text-[oklch(var(--color-ink))]">{g.name}</td>
            <td className="px-3 py-2 text-sm">{g.regions?.length ? g.regions.join("、") : <MissingValue kind="unrecorded" />}</td>
            <td className="px-3 py-2 text-sm whitespace-nowrap" data-testid={`tudi-god-parent-${g.id}`}>
              {g.city_god_name ?? <span className={MUTED}>{t("earthGods.no_parent")}</span>}
            </td>
            <td className="px-3 py-2 text-sm">
              {g.officers.length ? g.officers.map((o) => o.name).join(" · ") : <span className={MUTED}>{t("earthGods.no_officers")}</span>}
            </td>
            {(canEdit || canRegister) && (
              <td className="px-3 py-2 text-right">
                <ActionsMenu
                  menuLabel={t("earthGods.row_actions", { name: g.name })}
                  primary={canEdit ? { label: t("earthGods.edit"), onSelect: () => setEditing(g) } : undefined}
                  items={registrable(g) ? [{ key: "register", label: t("earthGods.register_death"), onSelect: () => setRegistering(g) }] : []}
                />
              </td>
            )}
          </>
        )}
      />
      {editing && <TudiGodEditor key={editing === "new" ? "new" : editing.id} god={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {registering && <TudiRegisterDeathDialog tudi={registering} onClose={() => setRegistering(null)} />}
    </PageShell>
  );
}

export default function TudiGodsPage() {
  return (
    <RequirePermission permissions="tudi.read" fallback={<PermissionDenied permission="tudi.read" />}>
      <TudiGodsContent />
    </RequirePermission>
  );
}
