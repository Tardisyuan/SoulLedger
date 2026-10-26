"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { officerAppApi } from "@soulledger/core/api";
import { TENANT_CODE_TO_CIVILIZATION } from "@soulledger/core/config/civilizations";
import { pickHall } from "@soulledger/core/domain/workflowSegments";
import { resolveEnumDisplay } from "@/src/lib/domainDisplay";
import { useI18n } from "@/src/contexts/I18nContext";
import { Button } from "@/src/components/ui/Button";
import { QueryError } from "@/src/components/ui/PageError";
import { PickStationsSheet } from "./PickStationsSheet";

/**
 * 审批页最上面一组「待我选站」(W-2):其他域发起、并入了跨域审判的审批流程里,本域那一段还没选站的。
 * 有才显示。行序是后端的(`segments.pick_tasks`:流程已在门口等的在前、等得久的在前);在门口的那一行加粗。
 * 数据与首页待办条同一个请求、同一把缓存键(`/officer-app/todo/` 的 `pick_nodes` 组)。
 */
export function PickNodesGroup() {
  const { t, locale } = useI18n();
  const todo = useQuery({
    queryKey: ["dashboard", "todo", "officer"],
    queryFn: async () => (await officerAppApi.todo()).data,
    staleTime: 60_000,
  });
  const [picking, setPicking] = useState<{ id: string; order: number } | null>(null);
  if (todo.isError && !todo.data) return <QueryError onRetry={() => void todo.refetch()} />;
  const group = todo.data?.pick_nodes;
  const items = group?.items ?? [];
  if (!group || items.length === 0) return null;

  return (
    <section data-testid="pick-nodes-group" className="mb-6 border border-[oklch(var(--color-line))] bg-[oklch(var(--color-surface-1))]">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-[oklch(var(--color-line))] px-4 py-3">
        <h2 className="text-lg text-[oklch(var(--color-ink))]">
          {t("workflow.pick_group.title")} <span className="font-mono text-sm">{group.count}</span>
        </h2>
        <p className="text-xs text-[oklch(var(--color-ink-muted))]">{t("workflow.pick_group.hint")}</p>
      </header>
      <ul>
        {items.map((row) => {
          const atGate = row.gate_days != null;
          const order = row.segment_order ?? 0;
          return (
            <li
              key={`${row.target.id}-${order}`}
              data-at-gate={atGate ? "" : undefined}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b last:border-b-0 border-[oklch(var(--color-line))] px-4 py-3"
            >
              <span className="min-w-0 flex-1">
                <span className={`block text-sm text-[oklch(var(--color-ink))] ${atGate ? "font-semibold" : ""}`}>
                  {t("workflow.pick_group.row_title", { soul: row.title, n: String(row.total ?? row.go ?? 0) })}
                </span>
                <span className="block text-xs text-[oklch(var(--color-ink-muted))]">
                  {t("workflow.pick_group.row_meta", {
                    // 发起殿的租户代码 → 文明名(「中国」),同跨域审判页;认不得时留空,不印代码。
                    realm: resolveEnumDisplay(t, "souls.civilizations", TENANT_CODE_TO_CIVILIZATION[row.realm ?? ""]).label ?? "",
                    // 冥界名 + 审判所在的殿(「酆都第十殿」);不印库里的英文展示名。
                    hall: pickHall(t, row, locale),
                    order: String(row.segment_order ?? ""),
                  })}
                </span>
              </span>
              <span className={`text-xs ${atGate ? "font-semibold text-[oklch(var(--color-ink))]" : "text-[oklch(var(--color-ink-muted))]"}`}>
                {atGate
                  ? t("workflow.pick_group.at_gate", { n: String(row.gate_days) })
                  : t("workflow.pick_group.ahead", { n: String(row.stations_ahead ?? 0) })}
              </span>
              <Button
                type="button"
                size="sm"
                variant={atGate ? "primary" : "secondary"}
                onClick={() => setPicking({ id: row.target.id, order })}
              >
                {t("workflow.pick_group.action")}
              </Button>
            </li>
          );
        })}
      </ul>
      {picking && (
        <PickStationsSheet
          workflowId={picking.id}
          order={picking.order}
          isOpen
          onClose={() => {
            setPicking(null);
            void todo.refetch();
          }}
        />
      )}
    </section>
  );
}
