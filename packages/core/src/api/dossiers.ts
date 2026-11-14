import { api } from "./client";
import type { components } from "./generated/schema";
import type { Judgment, JudgmentQueueCounts, JudgmentQueueGroup, JudgmentQueueSource } from "./judgment";
import type { PaginatedResponse } from "./users";

/**
 * 卷宗:一件案子的只读聚合(`GET /dossiers/{judgment_id}/`,backend/apps/judgment/dossier.py)——
 * 案子(列表字段,不含法条全文)+ 引用行 + 灵魂(看不到时 null 且 `soul_redacted`)+ `whereabouts`(脊上的点由服务端算)
 * + `phase` + 调用者此刻能做的 `actions`。按案子的 id 取,不按灵魂。
 * 响应带弱 `ETag`;浏览器带 `If-None-Match` 重新验证,没变时 304(`Cache-Control: private, no-cache`)。
 *
 * `judgment` 用手写的 `Judgment`(去掉 `citations`),与案台、审判台读的是同一个类型;生成的 `JudgmentList` 是同一组字段。
 */
export type Dossier = Omit<components["schemas"]["Dossier"], "judgment"> & { judgment: Omit<Judgment, "citations"> };
export type DossierPhase = Dossier["phase"];
export type DossierWhereabouts = components["schemas"]["Whereabouts"];
/** 案台一行(约二十个字段);筛选参数与 `GET /judgment/` 相同(group / source / court / overdue …)。 */
export type DossierRow = components["schemas"]["DossierRow"];

/**
 * 案台一行(`DossierRowSerializer`)。写成 `Judgment` 的子集而不是生成的 `DossierRow`:案台的规则(`deskRules.ts`)
 * 本来就收 `Judgment`,而 `GET /dossiers/desk/` 进 `schema.ts` 之前生成的类型里还没有后加的七个字段。
 */
export type DeskRow = Pick<
  Judgment,
  | "id" | "case_number" | "soul" | "soul_name" | "civilization" | "court" | "source"
  | "deadline_at" | "is_overdue" | "claimed_by" | "claimed_by_name" | "deferred_at" | "stale_since"
  | "deadline_remaining_seconds" | "retrial_of" | "is_final" | "duat_stage" | "held_until" | "conclude_refusal" | "untimely"
>;

/** `GET /dossiers/desk/`:四组各头几件(`total` 是这一组在当前 `source` 下的件数)+ 不筛的计数 + 本月已结的百分比。 */
export interface DossierDesk {
  groups: { group: JudgmentQueueGroup; total: number; rows: DeskRow[] }[];
  counts: JudgmentQueueCounts;
  month_done_pct: number | null;
}

export const dossiersApi = {
  get: (id: string) => api.get<Dossier>(`/dossiers/${id}/`),
  list: (params: Record<string, string | number | boolean | undefined> = {}) =>
    api.get<PaginatedResponse<DossierRow>>("/dossiers/", { params }),
  /** 案台一屏,一个请求(此前四个分组列表 + queue-counts + hall-stats)。 */
  desk: (source?: JudgmentQueueSource) => api.get<DossierDesk>("/dossiers/desk/", { params: source ? { source } : {} }),
};
