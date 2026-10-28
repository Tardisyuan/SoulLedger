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

/** `DeathRegistrationFilter`: status; `search` = soul name / source reference (contains) or the idempotency key;
 *  `received_after` / `received_before` = YYYY-MM-DD, both inclusive. */
export interface DeathRegistrationFilters {
  status?: string;
  search?: string;
  received_after?: string;
  received_before?: string;
}

export const deathSyncApi = {
  registrations: (params: { page?: string } & DeathRegistrationFilters = {}) =>
    api.get<PaginatedResponse<DeathRegistration>>("/death-sync/registrations/", { params }),
  /** CSV of the rows the list shows under the same filters (no page). */
  exportCsv: (params: DeathRegistrationFilters = {}) =>
    api.get<Blob>("/death-sync/registrations/export/", { params, responseType: "blob" }),
  summary: () => api.get<DeathRegistrationSummary>("/death-sync/registrations/summary/"),
  /** Rerun a FAILED + INTERNAL_ERROR row on the same row; 409 with `code` for anything else. */
  retry: (id: string) => api.post<DeathRegistration>(`/death-sync/registrations/${id}/retry/`),
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
  /** Queue one `WEBHOOK_TEST` delivery to this endpoint (same signing and retries as a real event).
   *  201 = the new delivery row; 409 `webhook_inactive`. */
  testWebhook: (id: string) => api.post<WebhookDelivery>(`/death-sync/admin-webhooks/${id}/test/`),
  webhookDeliveries: (params: { page?: string; webhook?: string; status?: string } = {}) =>
    api.get<PaginatedResponse<WebhookDelivery>>("/death-sync/webhook-deliveries/", { params }),
  /** Send a finished failure (ABANDONED, or FAILED at its retry ceiling) again as a new row; the old row stays.
   *  409 `not_finished` (still retrying, or not a failure) / `webhook_inactive`. */
  redeliverWebhook: (deliveryId: string) =>
    api.post<WebhookDelivery>(`/death-sync/webhook-deliveries/${deliveryId}/redeliver/`),
};

/** 土地公(只地府,`/death-sync/tudi-gods/`):基层登记亡魂,报给上级城隍。 */
export type TudiGod = components["schemas"]["TudiGod"];
export type TudiGodInput = {
  name: string;
  regions?: string[];
  /** 上级城隍(本殿的);null = 没有,案子按出身地配。 */
  city_god?: string | null;
  officer_ids?: number[];
};
/** 以土地公名义登记一条死亡;灵魂只认 id。死因与地点写进登记(加密存放)。 */
export type TudiRegistrationInput = {
  soul_lookup: { soul_id: string };
  death_date: string;
  death_location?: string;
  cause_of_death?: string;
  idempotency_key?: string;
};

export const tudiGodKeys = { all: ["tudi-gods"] as const };

export const tudiGodsApi = {
  list: (params: { page?: string } = {}) =>
    api.get<PaginatedResponse<TudiGod>>("/death-sync/tudi-gods/", { params }),
  create: (body: TudiGodInput) => api.post<TudiGod>("/death-sync/tudi-gods/", body),
  update: (id: string, body: Partial<TudiGodInput>) => api.patch<TudiGod>(`/death-sync/tudi-gods/${id}/`, body),
  remove: (id: string) => api.delete(`/death-sync/tudi-gods/${id}/`),
  /** 201 = 一条登记(PROCESSED 或 FAILED 带 error_code);403 `not_tudi_officer`;409 = 同一个幂等键已有的那条。 */
  registerDeath: (id: string, body: TudiRegistrationInput) =>
    api.post<DeathRegistration>(`/death-sync/tudi-gods/${id}/register-death/`, body),
};
