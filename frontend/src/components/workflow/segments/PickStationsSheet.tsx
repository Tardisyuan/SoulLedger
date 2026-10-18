"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { workflowApi, type ApprovalWorkflow } from "@soulledger/core/api";
import { workflowKeys } from "@soulledger/core/query_keys";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { BaseModal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { DomainEnum, DomainText } from "@/src/components/ui/DomainValue";
import { QueryError } from "@/src/components/ui/PageError";
import { ListSkeleton } from "@/components/ui/skeleton";
import { StationPicker, type PickRow } from "./StationPicker";
import { StaleSegmentNotice } from "./StaleSegmentNotice";
import { segmentNodes, segmentRefusalOf, staleOf, stationNo, type StaleSegment } from "@soulledger/core/domain/workflowSegments";

/** 现在库里的选择:这一段里已被跳过的站。 */
const skippedOf = (workflow: ApprovalWorkflow | undefined, order: number) =>
  new Set(workflow ? segmentNodes(workflow, order).filter((n) => n.status === "SKIPPED").map((n) => n.id) : []);

/**
 * 外域判官的「选站」底页(W-2,也是「改选」)。与 W-1a 同一个列表,只有本域这一段;外域行换成
 * 「本域排第 N · 前面:…」。带着这一段的 `version` 提交,别人刚改过就 409 `segment_changed` —— 拦下(W-5d),
 * 「看现在的选择」换成库里现在的样子再确认,不覆盖。
 */
export function PickStationsSheet({
  workflowId,
  order,
  isOpen,
  onClose,
}: {
  workflowId: string;
  order: number;
  isOpen: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: workflowKeys.detail(workflowId),
    queryFn: () => workflowApi.get(workflowId).then((res) => res.data),
    enabled: isOpen,
  });
  const workflow = detail.data;
  const segment = workflow?.segments?.find((s) => s.order === order);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [stale, setStale] = useState<StaleSegment | null>(null);

  // 勾选从库里来(改选时就是上一次的选择);库里的版本一变(「看现在的选择」重取到别人的改动)就重新从库里来。
  // 在渲染里对齐而不是放进 effect:只看版本,不跟着每次重取覆盖正在勾的。
  const [seeded, setSeeded] = useState<number | null>(null);
  if (segment && seeded !== segment.version) {
    setSeeded(segment.version);
    setSkipped(skippedOf(workflow, order));
  }

  const pick = useMutation({
    mutationFn: () =>
      workflowApi.pickSegment(workflowId, order, { skip_node_ids: [...skipped], version: segment!.version }),
    onSuccess: (res) => {
      queryClient.setQueryData(workflowKeys.detail(workflowId), res.data);
      queryClient.invalidateQueries({ queryKey: ["dashboard", "todo"] });
      showToast(t("workflow.pick.confirmed"), "success");
      onClose();
    },
    onError: (error) => {
      const refusal = segmentRefusalOf(error);
      const changed = staleOf(refusal);
      if (changed) {
        setStale(changed);
        return;
      }
      showToast(typeof refusal.data.error === "string" ? refusal.data.error : t("workflow.segment.error"), "error");
    },
  });

  const rows: PickRow[] = workflow
    ? segmentNodes(workflow, order).map((n) => ({
        key: n.id,
        label: `${stationNo(n)} · ${n.node_name}`,
        hall: <DomainText value={n.court_code} />,
        who: n.approver_role ? <DomainEnum namespace="users.roles" value={n.approver_role} /> : null,
        required: !!n.is_required,
      }))
    : [];
  const before = (workflow?.segments ?? []).filter((s) => s.order < order);

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={() => !pick.isPending && onClose()}
      wide
      title={segment ? `${segment.realm_name} · ${t("workflow.pick_group.action")}` : t("workflow.pick_group.action")}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={pick.isPending}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            variant="primary"
            loading={pick.isPending}
            disabled={!segment || !segment.can_pick || stale !== null}
            onClick={() => pick.mutate()}
          >
            {t("common.confirm")}
          </Button>
        </div>
      }
    >
      {detail.isError ? (
        <QueryError onRetry={() => void detail.refetch()} />
      ) : !workflow || !segment ? (
        <ListSkeleton count={4} />
      ) : (
        <div className="flex flex-col gap-3">
          {stale && (
            <StaleSegmentNotice
              stale={stale}
              onView={() => {
                setStale(null);
                void detail.refetch();
              }}
            />
          )}
          <StationPicker
            flowName={segment.name}
            rows={rows}
            skipped={skipped}
            onChange={setSkipped}
            footnote={
              before.length > 0
                ? t("workflow.pick.position", {
                    order: String(order),
                    prev: before.map((s) => s.realm_name).join("、"),
                    n: String(before.reduce((sum, s) => sum + s.go, 0)),
                  })
                : null
            }
          />
        </div>
      )}
    </BaseModal>
  );
}
