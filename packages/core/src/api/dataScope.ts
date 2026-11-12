import { api } from "./client";

/**
 * 数据范围(Snowy 式五种,设计 local-gates/rbac-2026-10-29/datascope-design.md「接口(B4)」)。
 * 本人创建或被指派的数据在任何范围下都可见 —— 范围只收窄「别人的」那部分。
 */
export const DATA_SCOPES = ["ALL", "ORG_CHILD", "ORG", "SELF", "DEFINE"] as const;
export type DataScope = (typeof DATA_SCOPES)[number];

/** 一条范围:`orgs` 只在 DEFINE 时有意义(且不能空),是显式勾选的机构 id(Organization.id)。 */
export interface DataScopeRule {
  scope: DataScope;
  orgs: number[];
}

/** 按业务覆盖默认;没有覆盖行的资源跟随 `default`。 */
export interface DataScopeOverride extends DataScopeRule {
  resource: string;
}

/**
 * GET / PUT /perm/roles/{id}/data-scope/ 的回应。`default` 没配时也显示 ALL;`default_configured: false` 才说明
 * 没有默认行 —— 没配的角色兼任时不放宽,显式「全部」的会(后端 `data_scope.org_ids`)。
 */
export interface RoleDataScopeConfig {
  default: DataScopeRule;
  default_configured: boolean;
  overrides: DataScopeOverride[];
}

/** PUT 的 body。不给 `default`(或 null)= 默认没配,不存默认行;显式「全部」要发 `{scope: "ALL"}`。 */
export interface RoleDataScopeBody {
  default?: DataScopeRule | null;
  overrides: DataScopeOverride[];
}

/** GET /perm/data-scope/resources/:可单独设置范围的业务。`label` 是服务器给的中文名。 */
export interface DataScopeResource {
  key: string;
  label: string;
}

export const dataScopeApi = {
  getDataScopeResources: () => api.get<DataScopeResource[]>("/perm/data-scope/resources/"),
  getRoleDataScope: (roleId: number) => api.get<RoleDataScopeConfig>(`/perm/roles/${roleId}/data-scope/`),
  /** 只有无殿 ADMIN 能写;DEFINE 机构为空、或角色是 ADMIN 时服务器 400。 */
  putRoleDataScope: (roleId: number, body: RoleDataScopeBody) =>
    api.put<RoleDataScopeConfig>(`/perm/roles/${roleId}/data-scope/`, body),
};
