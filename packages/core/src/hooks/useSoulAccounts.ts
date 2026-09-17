"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  soulAccountsApi,
  type CredentialFilters,
  type RebirthApplicationFilters,
  type SoulContactUpdate,
} from "../api/index";
import { soulAccountKeys } from "../query_keys";

/**
 * Officer-side soul accounts. Every write invalidates the whole
 * `soulAccountKeys.all` root: a reset touches an account row and a credential,
 * a delivery changes what the soul's account card summarises.
 *
 * `revealCredential` has NO hook here, on purpose. `useMutation` keeps its
 * last `data` in the MutationCache (for `gcTime` after the observer goes
 * away), which is a copy of a one-time password outliving the dialog that
 * showed it. The caller awaits `soulAccountsApi.revealCredential` directly and
 * holds the result in component state only.
 */

export function useSoulAccountChain(soulId: string, enabled = true) {
  return useQuery({
    queryKey: soulAccountKeys.chain(soulId),
    // ponytail: first page only (20 lives); a soul past that shows its first 20.
    queryFn: async () => (await soulAccountsApi.accounts({ soul: soulId })).data.results,
    enabled: enabled && !!soulId,
  });
}

export function useSoulCredentials(filters: CredentialFilters) {
  return useQuery({
    queryKey: soulAccountKeys.credentials({ ...filters }),
    queryFn: async () => (await soulAccountsApi.credentials(filters)).data,
    placeholderData: (previous) => previous,
  });
}

export function useRebirthApplications(filters: RebirthApplicationFilters) {
  return useQuery({
    queryKey: soulAccountKeys.rebirthApplications({ ...filters }),
    queryFn: async () => (await soulAccountsApi.rebirthApplications(filters)).data,
    placeholderData: (previous) => previous,
  });
}

function useSoulAccountWrite<TVars, TResult>(fn: (vars: TVars) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => qc.invalidateQueries({ queryKey: soulAccountKeys.all }),
  });
}

/** `created` is false on the backend's idempotent 200: this life already had an account and no password was sent. */
export function useProvisionSoulAccount() {
  return useSoulAccountWrite(async ({ soulId, contacts }: { soulId: string; contacts?: SoulContactUpdate }) => {
    const response = await soulAccountsApi.provision(soulId, contacts);
    return { account: response.data, created: response.status === 201 };
  });
}

export function useResetSoulCredential() {
  return useSoulAccountWrite(async ({ accountId, contacts }: { accountId: string; contacts?: SoulContactUpdate }) =>
    (await soulAccountsApi.resetCredential(accountId, contacts)).data
  );
}

export function useMarkCredentialDelivered() {
  return useSoulAccountWrite(async (id: string) => (await soulAccountsApi.markDelivered(id)).data);
}

export function useRetryCredential() {
  return useSoulAccountWrite(async (id: string) => (await soulAccountsApi.retry(id)).data);
}

export function useDecideCrossCivilization() {
  return useSoulAccountWrite(async ({ id, value }: { id: string; value: boolean }) =>
    (await soulAccountsApi.decideCrossCivilization(id, value)).data
  );
}

/**
 * A failed soul-account call, read off the axios error: HTTP status plus the
 * backend's stable `code` (`{detail, code}`). 400 field errors (contact
 * validation) come back as `fields`. `code` is null when the body is not the
 * business-refusal shape — the page shows its generic copy then, never a
 * guessed meaning.
 */
export interface SoulAccountFailure {
  status: number | null;
  code: string | null;
  fields: Record<string, string[]>;
}

export function classifySoulAccountError(error: unknown): SoulAccountFailure {
  const response = (error as { response?: { status?: number; data?: unknown } } | null)?.response;
  const data = response?.data;
  const fields: Record<string, string[]> = {};
  let code: string | null = null;
  if (data && typeof data === "object") {
    const body = data as Record<string, unknown>;
    if (typeof body.code === "string") code = body.code;
    else if (response?.status === 400) {
      for (const [key, value] of Object.entries(body)) {
        const messages = (Array.isArray(value) ? value : [value]).filter((m): m is string => typeof m === "string");
        if (messages.length > 0) fields[key] = messages;
      }
    }
  }
  return { status: response?.status ?? null, code, fields };
}
