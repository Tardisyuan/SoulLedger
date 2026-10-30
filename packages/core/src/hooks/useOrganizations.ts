"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { organizationNotEmptyOf, organizationsApi, type OrganizationInput } from "../api/index";
import { notify } from "../platform/index";
import { organizationKeys } from "../query_keys";

/** Every screen that lists organizations reads this one query (every page; the tree needs them all). */
const ORGANIZATIONS = organizationKeys.all;

/** Every organization, all pages — the organizations page, the user dialog and filter, data scopes. */
export function useAllOrganizations(options: { enabled?: boolean } = {}) {
  return useQuery({ queryKey: ORGANIZATIONS, queryFn: () => organizationsApi.all(), ...options });
}

/** Create, edit and move are one form: a move is a PATCH with another `parent`. Needs `org.manage`. */
export function useSaveOrganization() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id?: number; data: Partial<OrganizationInput> }) =>
      id === undefined
        ? organizationsApi.create(data as OrganizationInput).then((r) => r.data)
        : organizationsApi.update(id, data).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ORGANIZATIONS });
      notify("org.saved", "success");
    },
    onError: () => notify("org.failed", "error"),
  });
}

/**
 * DELETE. A unit with sub-units or people is refused with 409 `not_empty` and its two counts:
 * the page reads them with `organizationNotEmptyOf(error)` and shows the refusal, so no failure toast here.
 */
export function useDeleteOrganization() {
  const qc = useQueryClient();
  return useMutation({
    /** `{ id, moveTo }`:名下灵魂 / 审判先转到 `moveTo` 再删(`DELETE ?move_to=`)。 */
    mutationFn: (arg: number | { id: number; moveTo: number }) =>
      typeof arg === "number" ? organizationsApi.delete(arg) : organizationsApi.delete(arg.id, arg.moveTo),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ORGANIZATIONS });
      notify("org.deleted", "success");
    },
    onError: (error) => {
      if (organizationNotEmptyOf(error)) return;
      notify("org.failed", "error");
    },
  });
}
