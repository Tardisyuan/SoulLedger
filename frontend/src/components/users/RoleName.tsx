"use client";

import { useQuery } from "@tanstack/react-query";
import { permApi } from "@soulledger/core/api";
import { permissionKeys } from "@soulledger/core/query_keys";
import { DomainEnum } from "@/src/components/ui/DomainValue";
import type { SelectOption } from "@/src/components/ui/Field";

/**
 * A role name on screen, resolved the way app/users/page.tsx resolves it.
 *
 * The five built-ins have `users.roles.<NAME>` copy and render through
 * `DomainEnum`, which is the §4.6 path (translated label in the text node,
 * raw member only in `title`). A role an admin created has no copy and cannot
 * — its name is data — so `DomainEnum` showed it as "unrecognised", italic,
 * with the name hidden in `title`. The users table already reads the role
 * table's `display_name` for it; the welcome card, the template preview and
 * the delete dialog are the same decision in three more places.
 */
function useRoleTable() {
  return useQuery({
    queryKey: permissionKeys.roles,
    queryFn: async () => (await permApi.roles.list()).data,
    staleTime: 60_000,
  });
}

/** `display_name` for a custom role, null for a built-in or an unknown name —
 * null meaning "let DomainEnum decide", exactly as the users page does. */
export function useCustomRoleLabel(): (name: string | null | undefined) => string | null {
  const roles = useRoleTable().data;
  return (name) => {
    const role = roles?.find((r) => r.name === name);
    return role && !role.is_builtin ? role.display_name || role.name : null;
  };
}

/** The role table as select options — built-ins by their translated copy,
 * custom roles by `display_name`. Same shape as the users page's filter. */
export function useRoleOptions(t: (key: string) => string): SelectOption[] {
  const roles = useRoleTable().data ?? [];
  return roles.map((r) => ({
    value: r.name,
    label: r.is_builtin ? t(`users.roles.${r.name}`) : r.display_name || r.name,
  }));
}

export function RoleName({ value, className }: { value: string | null | undefined; className?: string }) {
  const label = useCustomRoleLabel()(value);
  if (label === null) {
    return <DomainEnum namespace="users.roles" value={value} className={className} />;
  }
  return (
    <span title={value ?? undefined} className={className} data-enum-state="custom">
      {label}
    </span>
  );
}
