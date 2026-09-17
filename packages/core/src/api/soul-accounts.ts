import { api } from "./client";
import type { PaginatedResponse } from "./users";

/**
 * `/api/v1/soul-accounts/` — the officer side of soul accounts.
 * backend/apps/soul_accounts/{views,serializers}.py is the contract.
 *
 * Unions are spelled out (not aliased from the generated schema) for the reason
 * `frontend/src/__tests__/enumsMatchTheSchema.test.ts` gives, which also holds
 * each one equal to its schema component.
 */

export type SoulAccountOrigin = "DEATH_SYNC" | "OFFICER" | "BACKFILL";

export type InitialCredentialStatus = "QUEUED" | "SENT" | "PENDING" | "REVEALED" | "DELIVERED" | "VOID";

export type RebirthApplicationStatus = "UNDER_REVIEW" | "REJECTED" | "APPEALING" | "APPEAL_REJECTED" | "APPROVED";

export type RebirthApplicationForm = "DIVINE" | "HUMAN" | "ASURA" | "ANIMAL" | "HUNGRY_GHOST" | "HELL_BEING" | "OTHER";

/** SoulAccountSerializer. Contacts arrive masked; the raw values never leave the server. */
export interface SoulAccount {
  id: string;
  soul: string;
  soul_code: string;
  soul_name: string;
  /** 0 is the first life. */
  cycle: number;
  previous_account: string | null;
  origin: SoulAccountOrigin;
  username: string;
  must_change_password: boolean;
  initial_password_expires_at: string | null;
  /** Set when the life ended in rebirth. Terminal: that account never logs in again. */
  retired_at: string | null;
  created_at: string;
  last_login: string | null;
  contact_email_masked: string;
  contact_phone_masked: string;
}

/** InitialCredentialSerializer. **No secret** — the plaintext only ever leaves through `revealCredential`. */
export interface InitialCredential {
  id: string;
  account: string;
  soul: string;
  soul_code: string;
  soul_name: string;
  cycle: number;
  /** "EMAIL" / "SMS"; "" when the soul had no usable contact. */
  channel: string;
  status: InitialCredentialStatus;
  expires_at: string;
  attempts: number;
  /** Exception class name of the last failed send; "" when none. */
  last_error: string;
  created_at: string;
  sent_at: string | null;
  revealed_at: string | null;
  revealed_by: string | null;
  delivered_at: string | null;
  delivered_by: string | null;
}

/** RevealedCredentialSerializer — served once, with `Cache-Control: no-store`. */
export interface RevealedCredential {
  soul_code: string;
  password: string;
  expires_at: string;
}

/** OfficerRebirthApplicationSerializer. */
export interface OfficerRebirthApplication {
  id: string;
  soul: string;
  soul_code: string;
  soul_name: string;
  account: string;
  cycle: number;
  desired_form: RebirthApplicationForm;
  statement: string;
  appeal_statement: string;
  status: RebirthApplicationStatus;
  workflow: string;
  appeal_workflow: string | null;
  /** null = the initial review has not decided yet. */
  cross_civilization: boolean | null;
  /** What the approver wrote FOR THE SOUL on rejection; internal node notes are never here. */
  rejection_reason: string;
  decided_at: string | null;
  /** The initial review's rejection, kept when the soul appeals. `rejection_reason` /
   *  `decided_at` above are the LATEST decision (after an appeal: the appeal's conclusion).
   *  Empty / null when there was no appeal — or for appeals filed before this was kept (reason not recoverable). */
  first_rejection_reason: string;
  first_decided_at: string | null;
  /** The current node's type and ROLE (never who); null once the application is closed. */
  current_step: RebirthCurrentStep | null;
  can_appeal: boolean;
  /** End of the cooldown this application's final rejection started; null when not cooling down. */
  cooldown_until: string | null;
  /** Whether THIS user may decide cross-civilization now — the same check the
   *  `cross-civilization/` endpoint runs. Read it; do not re-derive it from `current_step`. */
  can_decide_cross_civilization: boolean;
  created_at: string;
  updated_at: string;
}

/** MeCurrentStepSerializer. */
export interface RebirthCurrentStep {
  node_type: string;
  approver_role: string;
  is_appeal: boolean;
}

/** Optional contact update sent with provision / reset. Blank strings clear. */
export interface SoulContactUpdate {
  contact_email?: string;
  contact_phone?: string;
}

export interface CredentialFilters {
  status?: string;
  soul?: string;
  page?: number;
}

export interface RebirthApplicationFilters {
  status?: string;
  soul?: string;
  page?: number;
}

/** Business refusals: `{detail, code}` with a stable `code`. */
export interface SoulAccountErrorBody {
  detail: string;
  code: string;
}

export const soulAccountsApi = {
  /** Paginated; `?soul=` gives one soul's chain in cycle order. */
  accounts: (params: { soul?: string; page?: number }) =>
    api.get<PaginatedResponse<SoulAccount>>("/soul-accounts/accounts/", { params }),
  /** 201 created / 200 the life already had an account (no new password sent). */
  provision: (soulId: string, contacts: SoulContactUpdate = {}) =>
    api.post<SoulAccount>("/soul-accounts/accounts/provision/", { soul_id: soulId, ...contacts }),
  /** New password, new 72 h, previous open credentials voided. 409 `account_retired`. */
  resetCredential: (accountId: string, contacts: SoulContactUpdate = {}) =>
    api.post<InitialCredential>(`/soul-accounts/accounts/${accountId}/reset-credential/`, contacts),
  credentials: (params: CredentialFilters) =>
    api.get<PaginatedResponse<InitialCredential>>("/soul-accounts/credentials/", { params }),
  /**
   * The plaintext, exactly once. 409 `credential_not_revealable` on any second
   * call; 410 `credential_expired`. Callers must not put the result anywhere
   * that outlives the dialog showing it — no query cache, no mutation cache,
   * no storage.
   */
  revealCredential: (id: string) => api.post<RevealedCredential>(`/soul-accounts/credentials/${id}/reveal/`),
  /** Only a REVEALED credential; 409 `credential_not_revealed`, 410 expired. */
  markDelivered: (id: string) => api.post<InitialCredential>(`/soul-accounts/credentials/${id}/mark-delivered/`),
  /** Only PENDING; 409 `credential_not_pending`. The 200 row says whether it went out (SENT) or not (PENDING). */
  retry: (id: string) => api.post<InitialCredential>(`/soul-accounts/credentials/${id}/retry/`),
  rebirthApplications: (params: RebirthApplicationFilters) =>
    api.get<PaginatedResponse<OfficerRebirthApplication>>("/soul-accounts/rebirth-applications/", { params }),
  /** 403 `not_the_approver`; 409 `not_in_initial_review`. */
  decideCrossCivilization: (id: string, crossCivilization: boolean) =>
    api.post<OfficerRebirthApplication>(`/soul-accounts/rebirth-applications/${id}/cross-civilization/`, {
      cross_civilization: crossCivilization,
    }),
};
