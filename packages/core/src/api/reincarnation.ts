import { api } from "./client";
import type { PaginatedResponse } from "./users";
import type { components } from "./generated/schema";

export interface Reincarnation {
  id: string;
  soul: string;
  soul_name?: string;
  /** 灵魂编号(没开过号的为 null);转生登记簿的「灵魂」列。 */
  soul_code?: string | null;
  disposition: string | null;
  target_realm: string;
  rebirth_form: string;
  cycle_count: number;
  previous_realm: string;
  new_identity: string;
  notes: string;
  reincarnated_at: string;
}

/**
 * One row of `GET /reincarnation/quota/` (2026-10-24): this calendar month's rebirths on a path against
 * its limit — `null` = no limit, 0 = none this month. Every path is listed, `OTHER` included. A plain
 * list: the schema calls it paginated only because the viewset has a paginator; the action does not use it.
 */
export type RebirthQuotaUsage = components["schemas"]["RebirthQuotaUsage"];

/** The 409 `reborn` answers when the chosen path is full this month; the soul stays where it was. */
export interface RebirthQuotaFull {
  code: "rebirth_quota_full";
  rebirth_form: string;
  limit: number;
  used: number;
}

/** The 409 body when `error` is a rebirth refused for a full path; null for anything else. */
export function rebirthQuotaFullOf(error: unknown): RebirthQuotaFull | null {
  const r = (error as { response?: { status?: number; data?: Partial<RebirthQuotaFull> } })?.response;
  const d = r?.data;
  if (r?.status !== 409 || d?.code !== "rebirth_quota_full" || typeof d.rebirth_form !== "string") return null;
  return { code: "rebirth_quota_full", rebirth_form: d.rebirth_form, limit: Number(d.limit), used: Number(d.used) };
}

/** A path is full when it has a limit and this month's count has reached it (0 = full from the first day). */
export const quotaIsFull = (row: Pick<RebirthQuotaUsage, "limit" | "used"> | undefined): boolean =>
  row != null && row.limit != null && row.used >= row.limit;

export const reincarnationApi = {
  /** 筛选只有后端已有的:`soul`、`rebirth_form`(单值)、`cycle_count`;`ordering` 可按 `reincarnated_at` / `cycle_count`。 */
  list: (params?: Record<string, string>) => api.get<PaginatedResponse<Reincarnation>>("/reincarnation/", { params }),
  reborn: (data: object) => api.post<Reincarnation>("/reincarnation/reborn/", data),
  /** The caller's hall, this month, per path. */
  quota: () => api.get<RebirthQuotaUsage[]>("/reincarnation/quota/"),
};
