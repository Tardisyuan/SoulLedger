import { api } from "./client";
import type { components } from "./generated/schema";
import type { PaginatedResponse } from "./users";

/**
 * AuditLogSerializer (backend/apps/audit/serializers.py:9) — the list shape.
 *
 * The actor arrives as `username` (source="user.username") and `user_display`
 * (a SerializerMethodField that falls back to "System"). There is no `user`
 * key; it is kept optional only because app/audit/page.tsx still names it in
 * a `user_display || user || "-"` fallback that can never reach the second
 * branch.
 */
export interface AuditLogEntry {
  id: number;
  action: string;
  resource: string;
  resource_id: string;
  changes?: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent?: string | null;
  description: string;
  timestamp: string;
  username: string | null;
  tenant_code: string | null;
  user_display: string;
  /**
   * Request-scoped correlation id (AuditLog.trace_id, backend/apps/audit/models.py:52).
   * Blank on rows written outside a request context, or on anything created
   * before this field was serialized — see lib/auditGrouping.ts, which treats
   * a blank trace_id as "groups with nobody" rather than "groups with everyone".
   */
  trace_id: string;
  /** Not serialized. Always undefined. */
  user?: number | null;
}

/** AuditLogDetailSerializer: the list shape plus the acting user's own record. `tenant` is the user's hall code. */
export interface AuditLogDetail extends AuditLogEntry {
  user_details: { id: number; username: string; role: string | null; tenant: string | null } | null;
  is_batch_operation: boolean;
}

export const auditApi = {
  list: (params?: Record<string, string>) => api.get<PaginatedResponse<AuditLogEntry>>("/audit-logs/", { params }),
  get: (id: number | string) => api.get<AuditLogDetail>(`/audit-logs/${id}/`),
  /** 与 `list` 同一组筛选 / 租户划界的 CSV,不分页(`AuditLogViewSet.export`);页码参数不要传。 */
  exportCsv: (params?: Record<string, string>) =>
    api.get<Blob>("/audit-logs/export/", { params, responseType: "blob" }),
  /** Every `AuditAction` member. `label` is the model's fixed Chinese — display via `audit.actions.*`, not it. */
  actions: () => api.get<AuditActionOption[]>("/audit-logs/actions/"),
  /** The distinct `resource` strings in the caller's audit log (same hall scoping as `list`). */
  resources: () => api.get<string[]>("/audit-logs/resources/"),
  /** 权限变更时间线:不分页的数组,新的在前。默认只含六类权限资源;`resource` 精确匹配。 */
  timeline: (params?: AuditTimelineParams) => api.get<AuditLogEntry[]>("/audit-logs/timeline/", { params }),
  /** 不收参数:与列表同样按殿划界，不随列表的筛选变化。 */
  stats: () => api.get<AuditStats>("/audit-logs/stats/"),
};

/** `GET /audit-logs/timeline/` 的查询参数。`limit` 默认 50,后端上限 500(`TIMELINE_MAX_LIMIT`)。 */
export interface AuditTimelineParams {
  /** 精确匹配一个资源(小写，如 `role`;2026-10-17 起，此前是 icontains)。不传时是六类权限资源。 */
  resource?: string;
  action?: string;
  start_date?: string;
  end_date?: string;
  limit?: number;
}

/** `GET /audit-logs/stats/`(`AuditStatsSerializer`)。只列有记录的动作;`top_resources` 后端截到 20 行。 */
export type AuditStats = components["schemas"]["AuditStats"];

/** One row of `GET /audit-logs/actions/` (`AuditLogViewSet.actions`). */
export interface AuditActionOption {
  value: string;
  label: string;
}

/** One row of `GET /auth/login-logs/` (ADMIN-only, `LoginLogViewSet`; this tenant's users). */
export type LoginLogEntry = components["schemas"]["LoginLog"];
export type LoginLogStatus = LoginLogEntry["status"];

export const loginLogsApi = {
  list: (params?: { page?: string; status?: LoginLogStatus; search?: string }) =>
    api.get<PaginatedResponse<LoginLogEntry>>("/auth/login-logs/", { params }),
};

/** One row of `GET /auth/admin/sessions/` (`session.manage`): a live sign-in in the admin's halls (all halls for a hall-less admin). */
export type AdminSession = components["schemas"]["AdminSession"];
export type AdminSessionKind = "officer" | "soul";

/** 在线会话与强退(backend/apps/authentication/admin_session_views.py)。范围外的 id 答 404;自己这台 400 `current_session`。 */
export const adminSessionsApi = {
  list: (params: { kind: AdminSessionKind; page?: string; user?: string }) =>
    api.get<PaginatedResponse<AdminSession>>("/auth/admin/sessions/", { params }),
  revoke: (id: string) => api.post<void>(`/auth/admin/sessions/${id}/revoke/`),
  revokeUser: (user: number) => api.post<{ revoked: number }>("/auth/admin/sessions/revoke-user/", { user }),
};
