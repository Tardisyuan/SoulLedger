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

/**
 * One row of `GET /death-sync/admin-webhooks/` (ADMIN-only, `AdminWebhookViewSet`).
 * `_signing_secret` arrives exactly once, in the 201 of `create`; the column is
 * encrypted at rest and no other response carries it. `/death-sync/webhooks/`
 * is the external system's own door (API key only, a JWT gets 401) and is not
 * called from here.
 */
export type AdminWebhook = components["schemas"]["AdminWebhookConfig"];
/** `events` is optional on the wire only for input (`required=False`); every response carries the list. */
export type AdminWebhookEvent = NonNullable<AdminWebhook["events"]>[number];
export type AdminWebhookCreate = Pick<AdminWebhook, "api_key" | "url"> &
  Partial<Pick<AdminWebhook, "events" | "is_active" | "max_retries" | "timeout_seconds">>;
export type AdminWebhookUpdate = Partial<Pick<AdminWebhook, "url" | "events" | "is_active">>;
/** One row of `GET /death-sync/webhook-deliveries/` — newest first, no payload. */
export type WebhookDelivery = components["schemas"]["EventWebhookDelivery"];
export type WebhookDeliveryStatus = WebhookDelivery["status"];

export const deathSyncApi = {
  registrations: (params: { page?: string; status?: string } = {}) =>
    api.get<PaginatedResponse<DeathRegistration>>("/death-sync/registrations/", { params }),
  summary: () => api.get<DeathRegistrationSummary>("/death-sync/registrations/summary/"),
  apiKeys: (params: { page?: string } = {}) =>
    api.get<PaginatedResponse<ExternalApiKey>>("/death-sync/api-keys/", { params }),
  createApiKey: (body: ExternalApiKeyCreate) => api.post<ExternalApiKey>("/death-sync/api-keys/", body),
  /** Revoke = `is_active: false`. The row stays listed, so the prefix remains traceable in the log. */
  revokeApiKey: (id: string) => api.patch<ExternalApiKey>(`/death-sync/api-keys/${id}/`, { is_active: false }),

  webhooks: (params: { page?: string } = {}) =>
    api.get<PaginatedResponse<AdminWebhook>>("/death-sync/admin-webhooks/", { params }),
  /** The `EventType` enum the delivery handler filters on — the checklist's source, not a hand-written list. */
  webhookEventTypes: () => api.get<AdminWebhookEvent[]>("/death-sync/admin-webhooks/event-types/"),
  createWebhook: (body: AdminWebhookCreate) => api.post<AdminWebhook>("/death-sync/admin-webhooks/", body),
  updateWebhook: (id: string, body: AdminWebhookUpdate) =>
    api.patch<AdminWebhook>(`/death-sync/admin-webhooks/${id}/`, body),
  /** Disable = `is_active: false`; there is no DELETE route, the row and its deliveries stay. */
  disableWebhook: (id: string) =>
    api.patch<AdminWebhook>(`/death-sync/admin-webhooks/${id}/`, { is_active: false }),
  webhookDeliveries: (params: { page?: string; webhook?: string; status?: string } = {}) =>
    api.get<PaginatedResponse<WebhookDelivery>>("/death-sync/webhook-deliveries/", { params }),
};
