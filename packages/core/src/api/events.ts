import { api } from "./client";
import type { PaginatedResponse } from "./users";

/**
 * SoulEventSerializer (backend/apps/events/serializers.py:9).
 *
 * The timestamp key is `create_time`. `created_at` was declared required here
 * and is not a field on the serializer at all — it never arrives.
 */
export interface SoulEvent {
  id: string;
  soul: string;
  soul_name?: string;
  event_type: string;
  payload: Record<string, unknown>;
  actor: string;
  create_time: string;
}

/**
 * `GET /events/` 的查询参数(backend/apps/events/views.py)。日期是 YYYY-MM-DD、两端都含;
 * `search` 按灵魂姓名 / 出生名包含、灵魂编号整串匹配;`exclude_system: "1"` 去掉系统事件。
 */
export interface SoulEventListParams {
  soul?: string;
  event_type?: string;
  actor?: string;
  search?: string;
  start_date?: string;
  end_date?: string;
  exclude_system?: "1";
  ordering?: string;
  page?: string;
}

export const eventsApi = {
  list: (params?: SoulEventListParams) => api.get<PaginatedResponse<SoulEvent>>("/events/", { params }),
  /** 「全部操作人」下拉:本殿出现过的非系统操作人(最多 200 个)。接受与 list 相同的日期参数。 */
  actors: (params?: Pick<SoulEventListParams, "start_date" | "end_date">) => api.get<string[]>("/events/actors/", { params }),
};
