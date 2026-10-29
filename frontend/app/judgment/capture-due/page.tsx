"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { captureWarrantsApi, type CaptureDueSoul } from "@soulledger/core/api";
import { soulKeys } from "@soulledger/core/query_keys";
import { useI18n } from "@/src/contexts/I18nContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import { usePlaque } from "@/src/components/plaque/Plaque";
import { useHall } from "@/src/components/plaque/useHall";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { PermissionDenied } from "@/src/components/rbac/PermissionDenied";
import { MenuGloss } from "@/src/components/layout/MenuGloss";
import { PageShell } from "@/src/components/ui/PageShell";
import { Button } from "@/src/components/ui/Button";
import { Drawer } from "@/src/components/ui/Drawer";
import { DomainEnum, MissingValue } from "@/src/components/ui/DomainValue";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { CaptureIssueStep, daysOverdue } from "@/src/components/souls/detail/CapturePanel";

/*
 * 待发勾魂牒(Design 第五十七批 S-7):侧栏「灵魂业务」里排在「城隍初审」前面(流程:勾魂 → 初审 → 十殿)。
 * `capture-warrants/due/`:阳寿已到、还在世、没有未了结勾魂牒的本殿地府灵魂,后端已按阳寿先后排(最多 200 行;页头的数是 `count`,全部待发的数)。
 * 过期写「超 N 天」,灰字,不用红色。行尾「发牒」是次按钮,打开勾魂卡的发牒步骤(右侧抽屉),不在列表里直接发。
 */

function CaptureDueContent() {
  const { t } = useI18n();
  usePlaque({ hall: useHall(t("plaque.office.trials")) });
  const { hasPermission } = usePermissions();
  const canIssue = hasPermission("capture.issue");
  const [issuing, setIssuing] = useState<CaptureDueSoul | null>(null);
  const list = useQuery({ queryKey: soulKeys.captureDue(), queryFn: () => captureWarrantsApi.due().then((r) => r.data) });
  const rows = list.data?.results ?? [];
  // 页头写后端的总数:列表最多 200 行,行数不是待发的数。

  const columns: DataTableColumn[] = [
    { key: "soul", header: t("captureDue.soul"), pinned: true },
    { key: "origin", header: t("captureDue.origin") },
    { key: "fated", header: t("captureDue.fated") },
    { key: "escort", header: t("captureDue.escort") },
    ...(canIssue ? [{ key: "issue", header: t("captureDue.issue"), srOnlyHeader: true }] : []),
  ];

  return (
    <PageShell
      variant="page"
      title={
        <>
          {t("captureDue.title")}
          <MenuGloss path="/judgment/capture-due" />
        </>
      }
      subtitle={
        <span className="text-sm text-[oklch(var(--color-ink-muted))]">
          <span className="font-mono tabular-nums" data-testid="capture-due-count">{list.data?.count ?? 0}</span> · {t("captureDue.scope")}
        </span>
      }
    >
      <DataTable<CaptureDueSoul>
        caption={t("captureDue.title")}
        columns={columns}
        data={rows}
        isLoading={list.isLoading}
        isError={list.isError}
        onRetry={() => list.refetch()}
        skeletonRows={3}
        emptyMessage={t("captureDue.empty")}
        keyExtractor={(s) => s.id}
        renderRow={(s) => {
          const over = daysOverdue(s.fated_death_date);
          return (
            <>
              <td className="px-3 py-2 text-sm whitespace-nowrap">
                <Link href={`/souls/${s.id}`} className="underline underline-offset-2 text-[oklch(var(--color-ink))]">{s.name}</Link>
              </td>
              <td className="px-3 py-2 text-sm">{s.origin_location || <MissingValue kind="unrecorded" />}</td>
              <td className="px-3 py-2 text-sm whitespace-nowrap font-mono tabular-nums" data-testid={`capture-due-fated-${s.id}`}>
                {s.fated_death_date}
                {over > 0 && (
                  <span className="ml-1 font-sans text-[oklch(var(--color-ink-muted))]">· {t("souls.capture.overdue", { n: String(over) })}</span>
                )}
              </td>
              <td className="px-3 py-2 text-sm whitespace-nowrap"><DomainEnum namespace="souls.capture.escort" value={s.suggested_escort} /></td>
              {canIssue && (
                <td className="px-3 py-2 text-right">
                  <Button type="button" variant="secondary" size="sm" data-testid={`capture-due-issue-${s.id}`} onClick={() => setIssuing(s)}>
                    {t("captureDue.issue")}
                  </Button>
                </td>
              )}
            </>
          );
        }}
      />
      {issuing && (
        <Drawer isOpen onClose={() => setIssuing(null)} title={`${t("souls.capture.title")} · ${issuing.name}`}>
          <div className="p-4">
            <p className="text-xs text-[oklch(var(--color-ink-muted))]">{t("souls.capture.due_on", { date: issuing.fated_death_date })}</p>
            <CaptureIssueStep soul={issuing} suggested={issuing.suggested_escort} onIssued={() => setIssuing(null)} />
          </div>
        </Drawer>
      )}
    </PageShell>
  );
}

export default function CaptureDuePage() {
  return (
    <RequirePermission permissions="capture.read" fallback={<PermissionDenied permission="capture.read" />}>
      <CaptureDueContent />
    </RequirePermission>
  );
}
