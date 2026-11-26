import { queryOptions } from "@tanstack/react-query";
import { auditApi, cityGodKeys, cityGodsApi, eventsApi, tudiGodKeys, tudiGodsApi, workflowApi } from "../api/index";
import { auditKeys, soulKeys, workflowKeys } from "../query_keys";

/**
 * Queries read by more than one screen, key and fn kept together (`queryOptions`; audit 2026-11-26 §2.4). Each
 * was a copied `{ queryKey, queryFn }` pair; one key read with two different fns is a cache hazard, so they live
 * here. Callers spread one and add their own `enabled`. The key values are unchanged, so every existing
 * invalidation still reaches them.
 */

/** 本殿土地神(土地神页、灵魂详情、登记死亡)。 */
export const tudiGodListQuery = () =>
  queryOptions({ queryKey: [...tudiGodKeys.all, "list"], queryFn: () => tudiGodsApi.list().then((r) => r.data.results) });

/** 审计动作下拉的选项(三个审计页)。不会变,取一次。 */
export const auditActionsQuery = () =>
  queryOptions({
    queryKey: auditKeys.actions,
    queryFn: async () => (await auditApi.actions()).data.map((a) => a.value),
    staleTime: Infinity,
  });

/** 城隍 / 土地神编辑器里可选的官员。 */
export const cityGodOfficerChoicesQuery = () =>
  queryOptions({
    queryKey: [...cityGodKeys.all, "officer-choices"],
    queryFn: () => cityGodsApi.officerChoices().then((r) => r.data),
  });

/** 一个灵魂在地府各站之间的移动(详情页的站点行与地府图)。 */
export const soulStationEventsQuery = (soulId: string) =>
  queryOptions({
    queryKey: [...soulKeys.all, "station-events", soulId],
    queryFn: () =>
      eventsApi
        .list({ soul: soulId, event_type: "DIYU_STATION_CHANGED", ordering: "create_time" })
        .then((r) => r.data.results ?? []),
    staleTime: 60_000,
  });

/** 全部流程模板(流程页、发起流程)。键是模板家族的根,保存任何模板都刷新它。 */
export const workflowTemplatesQuery = () =>
  queryOptions({
    queryKey: workflowKeys.templates.all,
    queryFn: async () => (await workflowApi.templates.list()).data,
  });
