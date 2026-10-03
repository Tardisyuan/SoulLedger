import { api } from "./client";
import type { components } from "./generated/schema";
import type { PaginatedResponse } from "./users";

/** One row of `GET /death-sync/registrations/` (ADMIN-only, this tenant's rows). */
export type DeathRegistration = components["schemas"]["DeathRegistrationRequest"];
export type DeathRegistrationStatus = DeathRegistration["status"];
/** `anomaly_status` is the `?status=` value that lists exactly the rows counted. */
export type DeathRegistrationSummary = components["schemas"]["DeathRegistrationSummary"];

/**
 * One row of `GET /death-sync/api-keys/` (ADMIN-only, `ExternalApiKeyViewSet`).
 * `_raw_key` is the plaintext and arrives exactly once, in the 201 of `create`;
 * every other response carries the 8-char `key_prefix` only — the server keeps
 * a SHA-256 and cannot show the key again.
 */
export type ExternalApiKey = components["schemas"]["ExternalApiKey"];
export type ExternalApiKeySystemType = ExternalApiKey["system_type"];
export type ExternalApiKeyCreate = Pick<ExternalApiKey, "name" | "system_type"> &
  Partial<Pick<ExternalApiKey, "can_register_death" | "can_query_status" | "can_manage_webhooks">>;

export const deathSyncApi = {
  registrations: (params: { page?: string; status?: string } = {}) =>
    api.get<PaginatedResponse<DeathRegistration>>("/death-sync/registrations/", { params }),
  summary: () => api.get<DeathRegistrationSummary>("/death-sync/registrations/summary/"),
  apiKeys: (params: { page?: string } = {}) =>
    api.get<PaginatedResponse<ExternalApiKey>>("/death-sync/api-keys/", { params }),
  createApiKey: (body: ExternalApiKeyCreate) => api.post<ExternalApiKey>("/death-sync/api-keys/", body),
  /** Revoke = `is_active: false`. The row stays listed, so the prefix remains traceable in the log. */
  revokeApiKey: (id: string) => api.patch<ExternalApiKey>(`/death-sync/api-keys/${id}/`, { is_active: false }),
  // No admin client for `/death-sync/webhooks/`: that viewset authenticates
  // with APIKeyAuthentication only (a Bearer JWT gets 401), and
  // `events.EventWebhookDelivery` has no endpoint at all.
};
