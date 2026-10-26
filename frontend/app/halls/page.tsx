"use client";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { tenantsApi, type HallOverviewRow } from "@soulledger/core/api";
import { quotaIsFull } from "@soulledger/core/api/reincarnation";
import { useI18n } from "@/src/contexts/I18nContext";
import { DataTable } from "@/components/ui/data-table";
import { PageShell } from "@/src/components/ui/PageShell";
import { Badge } from "@/src/components/ui/Badge";
import { MissingValue } from "@/src/components/ui/DomainValue";
import { SelectField } from "@/src/components/ui/Field";
import { MenuGloss } from "@/src/components/layout/MenuGloss";
import { RequireAdmin } from "@/src/components/rbac/RequirePermission";
import { PermissionDenied } from "@/src/components/rbac/PermissionDenied";
import { showToast } from "@/src/components/ui/Toast";
import { enterHall } from "@/src/components/impersonation/wireImpersonation";
import { sortHalls, type HallSort } from "@/src/lib/hallsOverview";

/** 殿内待办拆开的四项;0 的项不写。 */
const TODO_PARTS = [
  ["approvals", "halls.overview.todo_approvals"],
  ["dispatch_proposals", "halls.overview.todo_dispatch"],
  ["cooldowns", "halls.overview.todo_cooldowns"],
  ["letters_awaiting", "halls.overview.todo_letters"],
] as const;

/** 分段条四格:浅 → 深 = 在城隍处 · 在枉死城 · 有人认领;无人认领是最浅的空格。只用 ink 的深浅,不用状态色。 */
const SEGMENTS = [
  ["at_city_god", "bg-[oklch(var(--color-ink)/0.25)]"],
  ["held", "bg-[oklch(var(--color-ink)/0.55)]"],
  ["claimed", "bg-[oklch(var(--color-ink))]"],
  ["unclaimed", "bg-[oklch(var(--color-line))]"],
] as const;

/** 点进去以后各格去哪儿(都先只读进入那一殿)。 */
const TARGET = { todo: "/dashboard", judgments: "/judgment", rebirth: "/rebirths", appeals: "/judgment/appeals", enter: "/dashboard" };

const LINK = "underline decoration-[oklch(var(--color-ink-subtle))] underline-offset-2 text-left disabled:cursor-wait";

function HallsOverviewContent() {
  const { t, locale } = useI18n();
  const [sort, setSort] = useState<HallSort>("code");
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["tenants", "overview"],
    queryFn: () => tenantsApi.overview().then((r) => r.data),
  });
  const rows = useMemo(() => sortHalls(data ?? [], sort), [data, sort]);

  // 进入某殿 = 只读查看那一殿(`POST /tenants/{code}/view/`),整页跳转:清掉管理员自己的缓存,页顶出现横幅。
  const enter = useMutation({
    mutationFn: ({ code, path }: { code: string; path: string }) => enterHall(code, path),
    onError: () => showToast(t("halls.overview.enter_failed"), "error"),
  });

  const nameOf = (row: HallOverviewRow) => row.hall_names[locale] || Object.values(row.hall_names)[0] || row.code;
  const cell = (row: HallOverviewRow, path: string, children: React.ReactNode, label?: string) => (
    <button
      type="button"
      className={LINK}
      aria-label={label}
      disabled={enter.isPending}
      onClick={() => enter.mutate({ code: row.code, path })}
    >
      {children}
    </button>
  );

  return (
    <PageShell
      variant="page"
      title={
        <>
          {t("halls.overview.title")}
          <MenuGloss path="/halls" />
        </>
      }
      subtitle={t("halls.overview.subtitle")}
      actions={
        <SelectField
          label={t("halls.overview.sort_label")}
          size="sm"
          value={sort}
          onChange={(e) => setSort(e.target.value as HallSort)}
          options={[
            { value: "code", label: t("halls.overview.sort_code") },
            { value: "todo", label: t("halls.overview.sort_todo") },
          ]}
        />
      }
    >
      <DataTable<HallOverviewRow>
        caption={t("halls.overview.title")}
        columns={[
          { key: "hall", header: t("halls.overview.col_hall") },
          { key: "todo", header: t("halls.overview.col_todo"), align: "right" },
          { key: "judgments", header: t("halls.overview.col_judgments") },
          { key: "rebirth", header: t("halls.overview.col_rebirth") },
          { key: "appeals", header: t("halls.overview.col_appeals"), align: "right" },
          { key: "enter", header: t("halls.overview.col_enter"), align: "right" },
        ]}
        data={rows}
        isLoading={isLoading}
        isError={isError}
        errorMessage={t("halls.overview.load_failed")}
        onRetry={() => refetch()}
        emptyMessage={t("halls.overview.empty")}
        keyExtractor={(row) => row.code}
        renderRow={(row) => {
          const name = nameOf(row);
          const parts = TODO_PARTS.filter(([k]) => row.todo[k] > 0);
          const j = row.judgments;
          const open = j.at_city_god + j.held + j.claimed + j.unclaimed;
          return (
            <>
              <td className="px-4 py-3" data-hall-row={row.code} data-inactive={row.is_active ? undefined : "true"}>
                <span className={`font-medium ${row.is_active ? "text-[oklch(var(--color-ink))]" : "text-[oklch(var(--color-ink-subtle))]"}`}>
                  {name}
                </span>
                {row.is_active ? null : (
                  <Badge tone="neutral" glyph="○" className="ml-2">
                    {t("tenants.inactive")}
                  </Badge>
                )}
                <span className="block text-xs text-[oklch(var(--color-ink-subtle))]">
                  {t(`tenant.civilizations.${row.civilization}`)} · <span className="font-mono">{row.code}</span>
                </span>
              </td>
              <td className="px-4 py-3 text-right">
                {cell(row, TARGET.todo, <span className="font-mono tabular-nums">{row.todo.total}</span>)}
                {parts.length ? (
                  <span className="block text-xs text-[oklch(var(--color-ink-muted))]" data-testid="todo-parts">
                    {parts.map(([k, key]) => t(key, { n: String(row.todo[k]) })).join(" · ")}
                  </span>
                ) : null}
              </td>
              <td className="px-4 py-3">
                {cell(
                  row,
                  TARGET.judgments,
                  <span className="flex flex-col gap-1">
                    <span className="flex h-2 w-40 overflow-hidden bg-[oklch(var(--color-line))]" aria-hidden="true">
                      {open > 0
                        ? SEGMENTS.map(([k, color]) => (
                            <span key={k} data-segment={k} className={color} style={{ width: `${(j[k] / open) * 100}%` }} />
                          ))
                        : null}
                    </span>
                    <span className="font-mono text-xs tabular-nums text-[oklch(var(--color-ink))]">
                      {open} · {j.at_city_god} · {j.held} · {j.claimed} · {j.unclaimed}
                    </span>
                  </span>,
                  t("halls.overview.judgments_label", {
                    at_city_god: String(j.at_city_god),
                    held: String(j.held),
                    claimed: String(j.claimed),
                    unclaimed: String(j.unclaimed),
                  })
                )}
              </td>
              <td className="px-4 py-3 text-xs">
                <RebirthCell row={row} link={(children) => cell(row, TARGET.rebirth, children)} />
              </td>
              <td className="px-4 py-3 text-right">
                {cell(row, TARGET.appeals, <span className="font-mono tabular-nums">{row.open_appeals}</span>)}
              </td>
              <td className="px-4 py-3 text-right">
                {cell(row, TARGET.enter, t("halls.overview.enter"), t("halls.overview.enter_label", { name }))}
              </td>
            </>
          );
        }}
      />
      <p className="mt-3 text-xs text-[oklch(var(--color-ink-muted))]">{t("halls.overview.note")}</p>
      <p className="mt-1 text-xs text-[oklch(var(--color-ink-muted))]">{t("halls.overview.legend")}</p>
    </PageShell>
  );
}

/** 本月转世(第五十一批写法):有上限或本月办过的道才写;满了加「已满」。殿的文明不轮回(埃及)时写「不适用」。 */
function RebirthCell({ row, link }: { row: HallOverviewRow; link: (children: React.ReactNode) => React.ReactNode }) {
  const { t } = useI18n();
  if (row.civilization === "EGYPTIAN") return <MissingValue kind="inapplicable" />;
  const shown = row.rebirth_quota.filter((q) => q.limit != null || q.used > 0);
  return link(
    shown.length === 0 ? (
      <span className="font-mono tabular-nums">{t("rebirths.quota.used_unlimited", { used: "0" })}</span>
    ) : (
      <span className="flex flex-wrap gap-x-2 gap-y-1">
        {shown.map((q) => (
          <span key={q.rebirth_form} data-quota-form={q.rebirth_form} className="inline-flex items-center gap-1">
            {t(`reincarnation.forms.${q.rebirth_form}`)}{" "}
            <span className="font-mono tabular-nums">
              {q.limit == null
                ? t("rebirths.quota.used_unlimited", { used: String(q.used) })
                : t("rebirths.quota.used_of", { used: String(q.used), limit: String(q.limit) })}
            </span>
            {quotaIsFull(q) ? <Badge tone="ink">{t("rebirths.quota.full_badge")}</Badge> : null}
          </span>
        ))}
      </span>
    )
  );
}

export default function HallsOverviewPage() {
  return (
    <RequireAdmin fallback={<PermissionDenied />}>
      <HallsOverviewContent />
    </RequireAdmin>
  );
}
