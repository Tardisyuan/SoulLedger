import { api } from "./client";
import type { components } from "./generated/schema";
import type { PaginatedResponse } from "./users";

/**
 * 卷宗:一件案子的只读聚合(`GET /dossiers/{judgment_id}/`,backend/apps/judgment/dossier.py)——
 * 案子(列表字段,不含法条全文)+ 引用行 + 灵魂(看不到时 null 且 `soul_redacted`)+ `whereabouts`(脊上的点由服务端算)
 * + `phase` + 调用者此刻能做的 `actions`。按案子的 id 取,不按灵魂。
 * 响应带弱 `ETag`;浏览器带 `If-None-Match` 重新验证,没变时 304(`Cache-Control: private, no-cache`)。
 */
export type Dossier = components["schemas"]["Dossier"];
export type DossierPhase = Dossier["phase"];
export type DossierWhereabouts = components["schemas"]["Whereabouts"];
/** 案台一行(约十个字段);筛选参数与 `GET /judgment/` 相同(group / source / court / overdue …)。 */
export type DossierRow = components["schemas"]["DossierRow"];

export const dossiersApi = {
  get: (id: string) => api.get<Dossier>(`/dossiers/${id}/`),
  list: (params: Record<string, string | number | boolean | undefined> = {}) =>
    api.get<PaginatedResponse<DossierRow>>("/dossiers/", { params }),
};
