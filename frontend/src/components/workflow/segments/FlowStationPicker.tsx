"use client";

import { useQuery } from "@tanstack/react-query";
import { workflowApi } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { DomainEnum } from "@/src/components/ui/DomainValue";
import { Button } from "@/src/components/ui/Button";
import { ListSkeleton } from "@/components/ui/skeleton";
import { StationPicker, type PickRow } from "./StationPicker";

type PreviewParams = Parameters<typeof workflowApi.flowPreview>[0];

/**
 * 流程生成之前的选站(W-1a):结案弹层勾「生成审批流」后的第 2 步、审批页手动发起的第 2 步。
 * 站来自 `GET /workflows/flow-preview/`(与生成时同一套模板解析),勾掉的站以站序(`node_order`)送回
 * `skip_node_orders`;外域只读,按跨域审判的顺序接在后面。
 */
export function FlowStationPicker({
  params,
  skipped,
  onChange,
}: {
  params: PreviewParams;
  skipped: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
}) {
  const { t } = useI18n();
  const preview = useQuery({
    queryKey: ["workflows", "flow-preview", params],
    queryFn: async () => (await workflowApi.flowPreview(params)).data,
  });
  if (preview.isError) {
    return (
      <div role="alert" className="flex flex-col gap-2 text-sm text-[oklch(var(--color-ink))]">
        {t("workflow.pick.load_error")}
        <Button type="button" size="sm" variant="secondary" className="self-start" onClick={() => void preview.refetch()}>
          {t("common.retry")}
        </Button>
      </div>
    );
  }
  if (!preview.data) return <ListSkeleton count={4} />;
  const rows: PickRow[] = preview.data.stations.map((s, i) => ({
    key: String(s.node_order),
    label: `${i + 1} · ${s.node_name}`,
    hall: s.court_code,
    who: s.approver ?? (s.approver_role ? <DomainEnum namespace="users.roles" value={s.approver_role} /> : null),
    required: s.is_required,
  }));
  return (
    <StationPicker flowName={preview.data.name} rows={rows} skipped={skipped} onChange={onChange} foreign={preview.data.foreign} />
  );
}
