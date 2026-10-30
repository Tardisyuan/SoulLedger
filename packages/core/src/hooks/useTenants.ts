"use client";

import { useQuery } from "@tanstack/react-query";
import { tenantsApi, type Tenant } from "../api/index";
import { collectPages } from "../api/client";
import { tenantKeys } from "../query_keys";

/** Every page of `/tenants/` — a list past 20 halls used to be cut at the first page. */
function allTenants(): Promise<Tenant[]> {
  return collectPages(async (page) => (await tenantsApi.list({ page })).data);
}

/**
 * Every hall the caller may see (ADMIN: all; otherwise its own), under one key for every picker,
 * filter and name lookup. Creating, deactivating or editing a hall invalidates `tenantKeys.all`,
 * which this sits under.
 */
export function useTenantNames(options: { enabled?: boolean; staleTime?: number } = {}) {
  return useQuery({ queryKey: tenantKeys.names, queryFn: allTenants, ...options });
}
