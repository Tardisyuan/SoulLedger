"use client";

import { DomainEnum, MissingValue } from "@/src/components/ui/DomainValue";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { cityGodKeys, cityGodsApi, type CityGod } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import { usePlaque } from "@/src/components/plaque/Plaque";
import { useHall } from "@/src/components/plaque/useHall";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { PermissionDenied } from "@/src/components/rbac/PermissionDenied";
import { MenuGloss } from "@/src/components/layout/MenuGloss";
import { PageShell } from "@/src/components/ui/PageShell";
import { Button } from "@/src/components/ui/Button";
import { Badge } from "@/src/components/ui/Badge";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { CityGodEditor } from "@/src/components/city-gods/CityGodEditor";

/*
 * 系统设置 › 城隍(Design 第五十三批 G-1)。本殿的分工配置:谁管哪些地名、谁名下有哪些官员。
 * 兜底城隍排在最后,地名一栏写「没写中任何一位的案子」;名下官员为空时灰字说明只有殿管理员能办。
 * 没有 `judgment.assign` 的官员看到同一张表,没有「新建」与编辑。说明块常驻表格上方。
 */

const MUTED = "text-sm text-[oklch(var(--color-ink-subtle))]";

function CityGodsContent() {
  const { t } = useI18n();
  usePlaque({ hall: useHall(t("plaque.office.rules")) });
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission("judgment.assign");
  const [editing, setEditing] = useState<CityGod | "new" | null>(null);
  const list = useQuery({ queryKey: cityGodKeys.gods(), queryFn: () => cityGodsApi.list().then((r) => r.data.results) });
  const gods = [...(list.data ?? [])].sort((a, b) => Number(a.is_default) - Number(b.is_default));

  const columns: DataTableColumn[] = [
    { key: "name", header: t("cityGods.name"), pinned: true },
    { key: "rank", header: t("cityGods.rank") },
    { key: "bureaus", header: t("cityGods.bureaus_label") },
    { key: "regions", header: t("cityGods.regions") },
    { key: "officers", header: t("cityGods.officers") },
    { key: "open", header: t("cityGodCases.title"), align: "right" },
    ...(canEdit ? [{ key: "edit", header: t("cityGods.edit"), srOnlyHeader: true }] : []),
  ];

  return (
    <PageShell
      variant="page"
      title={
        <>
          {t("cityGods.title")}
          <MenuGloss path="/city-gods" />
        </>
      }
      actions={
        canEdit ? (
          <Button type="button" variant="primary" size="sm" data-testid="city-god-create" onClick={() => setEditing("new")}>
            {t("cityGods.create")}
          </Button>
        ) : undefined
      }
    >
      <p className="mb-3 border-l-2 border-[oklch(var(--color-line))] pl-3 text-sm text-[oklch(var(--color-ink-muted))]">{t("cityGods.explain")}</p>
      <DataTable<CityGod>
        caption={t("cityGods.title")}
        columns={columns}
        data={gods}
        isLoading={list.isLoading}
        isError={list.isError}
        onRetry={() => list.refetch()}
        skeletonRows={3}
        emptyMessage={t("cityGods.empty")}
        keyExtractor={(g) => g.id}
        renderRow={(g) => (
          <>
            <td className="px-3 py-2 text-sm whitespace-nowrap text-[oklch(var(--color-ink))]">
              {g.name}
              {g.is_default && <Badge tone="neutral" className="ml-2">{t("cityGods.default_badge")}</Badge>}
            </td>
            <td className="px-3 py-2 text-sm whitespace-nowrap">
              {g.rank ? (
                <>
                  <DomainEnum namespace="cityGods.ranks" value={g.rank} />
                  <span className={`ml-1 ${MUTED}`}><DomainEnum namespace="cityGods.rank_titles" value={g.rank} /></span>
                </>
              ) : <span className={MUTED}>{t("cityGods.rank_none")}</span>}
            </td>
            <td className="px-3 py-2 text-sm" title={(g.bureaus ?? []).map((b) => t(`cityGods.bureau_names.${b}`)).join(" · ")}>
              {g.bureaus?.length ? t("cityGods.bureau_count", { count: String(g.bureaus.length) }) : <MissingValue kind="unrecorded" />}
            </td>
            <td className="px-3 py-2 text-sm">
              {g.regions?.length ? g.regions.join(" · ") : g.is_default ? <span className={MUTED}>{t("cityGods.default_regions")}</span> : <MissingValue kind="unrecorded" />}
            </td>
            <td className="px-3 py-2 text-sm">
              {g.officers.length ? g.officers.map((o) => o.name).join(" · ") : <span className={MUTED}>{t("cityGods.no_officers")}</span>}
            </td>
            <td className="px-3 py-2 text-sm text-right whitespace-nowrap tabular-nums">{t("cityGods.open_cases", { count: String(g.open_case_count) })}</td>
            {canEdit && (
              <td className="px-3 py-2 text-right">
                <Button type="button" variant="ghost" size="sm" data-testid={`city-god-edit-${g.id}`} onClick={() => setEditing(g)}>
                  {t("cityGods.edit")}
                </Button>
              </td>
            )}
          </>
        )}
      />
      {editing && <CityGodEditor key={editing === "new" ? "new" : editing.id} god={editing === "new" ? null : editing} gods={gods} onClose={() => setEditing(null)} />}
    </PageShell>
  );
}

export default function CityGodsPage() {
  return (
    <RequirePermission permissions="judgment.read" fallback={<PermissionDenied permission="judgment.read" />}>
      <CityGodsContent />
    </RequirePermission>
  );
}
