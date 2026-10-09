import { api } from "./client";
import type { PaginatedResponse } from "./users";
import type { components } from "./generated/schema";

export interface Tenant {
  id: number;
  code: string;
  display_name: string;
  description?: string;
  is_active?: boolean;
  dispatch_enabled?: boolean;
  api_endpoint?: string;
  settings?: Record<string, unknown>;
  /** `TENANT_CIVILIZATION[code]`, or `"UNKNOWN"` for a tenant outside that map. */
  civilization?: string;
  /** 匾上的印字,0–2 个;空 = 用文明默认字。只有 ADMIN 能改(`updateSealGlyphs`)。 */
  seal_glyphs?: string[];
  /** 殿司展示名(三语),空的后端退回 zh 再退回 `display_name`。只有 ADMIN 能改(`updateSettings`)。 */
  hall_name?: string;
  hall_name_en?: string;
  hall_name_egy?: string;
  created_at?: string;
}

/** `settings` 里转生冷却天数的键名 —— 与 `apps/tenants/models.py::REBIRTH_COOLDOWN_SETTING` 同一个字符串。 */
export const REBIRTH_COOLDOWN_SETTING = "soul_rebirth_cooldown_days";
/** `settings` 里「要求开启两步验证的角色」的键名 —— 与 `apps/authentication/mfa.py::MFA_REQUIRED_ROLES_SETTING` 同一个字符串。 */
export const MFA_REQUIRED_ROLES_SETTING = "mfa_required_roles";

/** One row of `GET /tenants/{code}/mfa-roles/` (殿设置 › 安全). `always`: ADMIN, required regardless. */
export type TenantMfaRoleRow = components["schemas"]["TenantMfaRoleRow"];

/**
 * `PATCH /tenants/{code}/settings/` 的请求体:只有这几个已知字段,没有整份 `settings` JSON。
 * `soul_rebirth_cooldown_days` 由后端**合并**进 `settings`(别的键如 `assistant_enabled` 原样保留);
 * `null` = 删掉这个键,回到默认 30 天。
 */
export interface TenantSettingsPatch {
  description?: string;
  dispatch_enabled?: boolean;
  hall_name?: string;
  hall_name_en?: string;
  hall_name_egy?: string;
  soul_rebirth_cooldown_days?: number | null;
  /** Role names that must use two-step verification. ADMIN is required whether or not it is listed. */
  mfa_required_roles?: string[];
}

export const tenantsApi = {
  list: () => api.get<PaginatedResponse<Tenant>>("/tenants/"),
  // TenantViewSet sets lookup_field = "code" (backend/apps/tenants/views.py:9),
  // so the detail route is /tenants/{code}/ — a numeric id does not address it.
  get: (code: string) => api.get<Tenant>(`/tenants/${code}/`),
  /** ADMIN only. Wrong script or too many glyphs is a 400 on `seal_glyphs`, never truncated. */
  updateSealGlyphs: (code: string, sealGlyphs: string[]) =>
    api.patch<Tenant>(`/tenants/${code}/seal-glyphs/`, { seal_glyphs: sealGlyphs }),
  /** ADMIN only. Field errors come back as a DRF 400 keyed by field; a negative cooldown is one of them. */
  updateSettings: (code: string, patch: TenantSettingsPatch) =>
    api.patch<Tenant>(`/tenants/${code}/settings/`, patch),
  /** ADMIN only. */
  mfaRoles: (code: string) => api.get<TenantMfaRoleRow[]>(`/tenants/${code}/mfa-roles/`),
};
