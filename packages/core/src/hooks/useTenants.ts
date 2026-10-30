"use client";

import { useQuery } from "@tanstack/react-query";
import { tenantsApi, type Tenant } from "../api/index";
import { tenantKeys } from "../query_keys";

/** Every page of `/tenants/` — a list past 20 halls used to be cut at the first page. */
async function allTenants(): Promise<Tenant[]> {
  const all: Tenant[] = [];
  for (let page = 1; ; page += 1) {
    const { data } = await tenantsApi.list({ page });
    all.push(...data.results);
    if (!data.next) return all;
  }
}

/**
 * Every hall the caller may see (ADMIN: all; otherwise its own), under one key for every picker,
 * filter and name lookup. Creating, deactivating or editing a hall invalidates `tenantKeys.all`,
 * which this sits under.
 */
export function useTenantNames(options: { enabled?: boolean; staleTime?: number } = {}) {
  return useQuery({ queryKey: tenantKeys.names, queryFn: allTenants, ...options });
}
