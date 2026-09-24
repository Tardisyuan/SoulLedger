"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  permApi,
  type MatrixChange,
  type MatrixChangesResult,
  type RoleCopyPayload,
  type RoleDeleteRefusal,
} from "../api/index";
import { permKeys } from "../query_keys";

/**
 * The permissions page's server calls (backend/apps/perm/matrix.py).
 *
 * A matrix save invalidates the grants of every role a *saved* cell belongs
 * to, and the role list (versions and `permission_count` moved). Roles whose
 * cells were all refused or failed are left alone: their server state did not
 * change, and refetching them would only discard the operator's unsaved ticks
 * in the page's local state for nothing.
 */

export function useRoles() {
  return useQuery({
    queryKey: permKeys.roles,
    queryFn: async () => (await permApi.roles.list()).data,
  });
}

/** `"ROLE:permission_id"` — how the page addresses a matrix cell. */
export function matrixCellKey(role: string, permissionId: number): string {
  return `${role}:${permissionId}`;
}

export interface MatrixSaveSummary {
  saved: number;
  failed: number;
  refused: number;
  unchanged: number;
  /** Cells that did not reach the table (refused or failed), for highlighting. */
  notSaved: Set<string>;
  /** Roles with at least one saved cell. */
  rolesChanged: string[];
}

/** 「已存 2 项，失败 1 项」 and where the failures are, from one response. */
export function summarizeMatrixSave(result: MatrixChangesResult): MatrixSaveSummary {
  const notSaved = new Set<string>();
  const rolesChanged = new Set<string>();
  for (const r of result.results) {
    if (r.status === "refused" || r.status === "failed") notSaved.add(matrixCellKey(r.role, r.permission_id));
    if (r.status === "saved") rolesChanged.add(r.role);
  }
  return {
    saved: result.saved,
    failed: result.failed,
    refused: result.refused,
    unchanged: result.unchanged,
    notSaved,
    rolesChanged: [...rolesChanged].sort(),
  };
}

export function useApplyMatrixChanges() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { changes: MatrixChange[]; expectedVersions?: Record<string, number> }) =>
      (await permApi.applyChanges(vars.changes, vars.expectedVersions)).data,
    onSuccess: (result) => {
      const { rolesChanged } = summarizeMatrixSave(result);
      if (rolesChanged.length === 0) return;
      queryClient.invalidateQueries({ queryKey: permKeys.roles });
      for (const role of rolesChanged) {
        queryClient.invalidateQueries({ queryKey: permKeys.rolePermissions(role) });
      }
    },
  });
}

/** Read-only, but on demand (before a save), so a mutation rather than a query. */
export function useMatrixImpact() {
  return useMutation({
    mutationFn: async (changes: MatrixChange[]) => (await permApi.impact(changes)).data,
  });
}

export function useCopyRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { sourceId: number; data: RoleCopyPayload }) =>
      (await permApi.roles.copy(vars.sourceId, vars.data)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: permKeys.roles }),
  });
}

/**
 * The typed refusal of a failed delete, or null when the error is something
 * else (network, 404, 403). A refusal is 400 with a `code`.
 */
export function roleDeleteRefusal(error: unknown): RoleDeleteRefusal | null {
  const response = (error as { response?: { status?: number; data?: unknown } } | null)?.response;
  const data = response?.data as Partial<RoleDeleteRefusal> | undefined;
  if (response?.status !== 400 || !data || typeof data.code !== "string") return null;
  return data as RoleDeleteRefusal;
}

export function useDeleteRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await permApi.roles.delete(id);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: permKeys.roles }),
  });
}
