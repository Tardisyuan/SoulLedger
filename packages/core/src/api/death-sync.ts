import { api } from "./client";
import type { components } from "./generated/schema";
import type { PaginatedResponse } from "./users";

/** One row of `GET /death-sync/registrations/` (ADMIN-only, this tenant's rows). */
export type DeathRegistration = components["schemas"]["DeathRegistrationRequest"];
export type DeathRegistrationStatus = DeathRegistration["status"];
/** `anomaly_status` is the `?status=` value that lists exactly the rows counted. */
export type DeathRegistrationSummary = components["schemas"]["DeathRegistrationSummary"];

export const deathSyncApi = {
  registrations: (params: { page?: string; status?: string } = {}) =>
    api.get<PaginatedResponse<DeathRegistration>>("/death-sync/registrations/", { params }),
  summary: () => api.get<DeathRegistrationSummary>("/death-sync/registrations/summary/"),
};
