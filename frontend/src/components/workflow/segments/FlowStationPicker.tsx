"use client";

import { useQuery } from "@tanstack/react-query";
import { workflowApi } from "@soulledger/core/api";
import { courtLabel } from "@soulledger/core/domain/courts";
import { useI18n } from "@/src/contexts/I18nContext";
import { DomainEnum } from "@/src/components/ui/DomainValue";
import { Button } from "@/src/components/ui/Button";
import { ListSkeleton } from "@/components/ui/skeleton";
import { StationPicker, type PickRow } from "./StationPicker";

type PreviewParams = Parameters<typeof workflowApi.flowPreview>[0];

/**
 * 选站预览,一处取:选站列表与两个弹层(结案、手动发起)共用同一个 query key,所以弹层先问「有没有可选的站」
 * (`nothing_to_pick`,第四十五批)不多发请求。没有可选的站时弹层跳过选站这一步。
 */
export function useFlowPreview(params: PreviewParams, enabled = true) {
  return useQuery({
    queryKey: ["workflows", "flow-preview", params],
    queryFn: async () => (await workflowApi.flowPreview(params)).data,
    enabled,
  });
}

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
  const { t, locale } = useI18n();
  const preview = useFlowPreview(params);
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
    hall: courtLabel(t, s.court_code, locale),
    who: s.approver ?? (s.approver_role ? <DomainEnum namespace="users.roles" value={s.approver_role} /> : null),
    required: s.is_required,
    jumpSources: s.jump_target_of,
  }));
  return (
    <StationPicker flowName={preview.data.name} rows={rows} skipped={skipped} onChange={onChange} foreign={preview.data.foreign} />
  );
}
