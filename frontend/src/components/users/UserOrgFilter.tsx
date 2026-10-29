"use client";

import { useQuery } from "@tanstack/react-query";
import { organizationsApi, tenantsApi } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { OrgTreeSelect } from "@/src/components/organizations/OrgTreeSelect";

/**
 * 用户页左侧的机构树筛选(rbac-snowy 2026-10-29,对照 Snowy 用户页)。点一个机构 = 它与全部下级机构里的人
 * (服务端 `?organization=` 含下级);「全部机构」= 不筛。与机构页、用户弹层共用 `["organizations"]` 这把键。
 */
export function UserOrgFilter({ value, onChange }: { value: number | null; onChange: (id: number | null) => void }) {
  const { t } = useI18n();
  const orgs = useQuery({ queryKey: ["organizations"], queryFn: () => organizationsApi.all() });
  const tenants = useQuery({
    queryKey: ["tenants", "names"],
    queryFn: async () => (await tenantsApi.list()).data.results,
  });
  const tenantNames = new Map((tenants.data ?? []).map((x) => [x.id, x.display_name || x.code]));
  return (
    <OrgTreeSelect
      mode="single"
      label={t("users.org_filter.label")}
      noneLabel={t("users.org_filter.all")}
      organizations={orgs.data ?? []}
      tenantNames={tenantNames}
      value={value}
      onChange={onChange}
    />
  );
}
