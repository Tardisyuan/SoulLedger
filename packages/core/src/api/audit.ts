import { api } from "./client";
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

export const auditApi = {
  list: (params?: Record<string, string>) => api.get<PaginatedResponse<AuditLogEntry>>("/audit-logs/", { params }),
};
