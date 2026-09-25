import { api } from "./client";
import type { components } from "./generated/schema";
import type { PaginatedResponse } from "./users";

type Schemas = components["schemas"];

/** 页面三段:待执行 / 执行中 / 期满。由后端的 `is_executed` 与 `expired_at` 推出。 */
export type DispositionSection = Schemas["DispositionSectionEnum"];
/** `section_counts`:当前过滤条件下每一段的总行数(忽略 `section` 本身)。 */
export type DispositionSectionCounts = Schemas["PaginatedDispositionList"]["section_counts"];

/** 列表页:项目的分页信封,多一个 `section_counts`。 */
export interface DispositionPage extends PaginatedResponse<Disposition> {
  section_counts: DispositionSectionCounts;
}

export interface DispositionListParams {
  /** 其余过滤项(`soul`、`is_executed`、`page`、`show_archived` ……)照旧是字符串。 */
  [key: string]: string | undefined;
  /** 只要某一段。 */
  section?: DispositionSection;
  /** `"false"`:藏起这一世之后已经转世的灵魂(「期满」段用);计数同样按它算。 */
  soul_reborn?: "true" | "false";
  /** `term_end`:期满近 → 远,永久 / 没有期满日的排最后(服务端 SQL 排,跨页)。前缀 `-` 反向。 */
  ordering?: "term_end" | "-term_end" | "created_at" | "-created_at" | "executed_at" | "-executed_at";
}

export interface Disposition {
  id: string;
  soul: string;
  judgment: string;
  destination_realm: string | null;
  // Read-only display names the serializer joins in alongside the raw FK ids
  // (soul.name / destination_realm.realm_code / destination_realm.name_en).
  // Optional because they're null whenever the related row is missing.
  soul_name?: string;
  realm_code?: string;
  realm_name?: string;
  is_eternal: boolean;
  is_executed: boolean;
  executed_at: string | null;
  memory_reset: string;
  sentence_years?: number | null;
  /**
   * When the term began being counted (DispositionSerializer's HistoricalDateField
   * over term_start_year/month/day — BCE-capable, so a signed year). Null = not
   * recorded; it is deliberately NOT derived from `executed_at` (see the model).
   */
  term_start?: { year: number; month: number | null; day: number | null } | null;
  notes: string;
  created_at: string;
  // 以下由 disposition/0015 那一轮加入。服务端总会发;标为可选,是因为既有的
  // 测试夹具与页面按旧形状构造 Disposition,字段是逐步被读起来的。
  /** 期满检查写下的时间;null = 未期满。 */
  expired_at?: string | null;
  /** 刑期走完的那一天(与每日期满检查同一个算法);永久刑或缺刑期 / 起算日时为 null。 */
  term_end?: Schemas["Disposition"]["term_end"];
  section?: DispositionSection;
  /** 产生这份处置的判决;没有本地审判时为 null。 */
  verdict?: Schemas["Disposition"]["verdict"];
  /** 灵魂**现在**的状态。 */
  soul_state?: Schemas["CurrentStateEnum"];
  /** 这份处置所属的那一世之后,灵魂是否已经转世。 */
  soul_reborn?: boolean;
}

export const dispositionApi = {
  // DispositionViewSet is a plain ModelViewSet, so `list` goes through the
  // project-wide PageNumberPagination — the envelope, not a bare array.
  list: (params?: DispositionListParams) => api.get<DispositionPage>("/disposition/", { params }),
  execute: (id: string, data?: object) => api.post<Disposition>(`/disposition/${id}/execute/`, data),
};
