"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { organizationNotEmptyOf, organizationsApi, type OrganizationInput } from "../api/index";
import { notify } from "../platform/index";

/** The organizations page reads one `["organizations"]` query (every page, assembled into a tree). */
const ORGANIZATIONS = ["organizations"] as const;

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
    mutationFn: (id: number) => organizationsApi.delete(id),
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
