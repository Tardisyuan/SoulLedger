/**
 * 角色抽屉「数据范围」区(数据范围 B6)。接口按设计「接口(B4)」的约定 mock:
 * GET/PUT /perm/roles/{id}/data-scope/ → {default:{scope,orgs}, overrides:[{resource,scope,orgs}]}。
 *
 * 钉住:ADMIN 角色只显示「全部(固定)」、不取接口;只有无殿管理员能改,有殿管理员与非管理员只读;
 * 自定义机构未选机构不能保存;覆盖行选了就进 body、改回「跟随默认」就不进;保存提示「对方刷新后生效」。
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Role } from "@soulledger/core/api";
import { dataScopeApi } from "@soulledger/core/api";
import { RoleDataScopeSection } from "@/src/components/permissions/RoleDataScopeSection";

jest.mock("@soulledger/core/api", () => ({
  DATA_SCOPES: ["ALL", "ORG_CHILD", "ORG", "SELF", "DEFINE"],
  dataScopeApi: { getDataScopeResources: jest.fn(), getRoleDataScope: jest.fn(), putRoleDataScope: jest.fn() },
  organizationsApi: {
    all: jest.fn().mockResolvedValue([
      { id: 1, name: "地府", code: "ROOT_CN", parent: null, level: 0, sort: 0, tenant: 1 },
      { id: 2, name: "第一殿", code: "D1", parent: 1, level: 1, sort: 0, tenant: 1 },
    ]),
  },
  tenantsApi: { list: jest.fn().mockResolvedValue({ data: { results: [{ id: 1, code: "CN", display_name: "中国地府" }] } }) },
}));

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({ t: (key: string) => key, locale: "zh-Hans", hydrated: true }),
}));

const mockToast = jest.fn();
jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast: mockToast }) }));

let mockUser: { role: string; tenant: { code: string; display_name: string } | null; permissions: string[] };
jest.mock("@/src/contexts/TenantContext", () => ({ useTenant: () => ({ user: mockUser }) }));

const api = dataScopeApi as unknown as Record<string, jest.Mock>;

const role = (name: string, id = 5) => ({ id, name, display_name: name }) as Role;

function renderSection(r: Role) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RoleDataScopeSection role={r} />
    </QueryClientProvider>,
  );
}

const radio = (scope: string) => screen.getByRole("radio", { name: `permissions.datascope.scope.${scope}` });
const saveButton = () => screen.getByRole("button", { name: "permissions.datascope.save" });

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { role: "ADMIN", tenant: null, permissions: [] };
  api.getDataScopeResources.mockResolvedValue({ data: [{ key: "soul", label: "灵魂" }, { key: "judgment", label: "审判" }] });
  api.getRoleDataScope.mockResolvedValue({ data: { default: { scope: "ALL", orgs: [] }, overrides: [] } });
  api.putRoleDataScope.mockImplementation((_id, body) => Promise.resolve({ data: body }));
});

it("the ADMIN role reads 'all (fixed)' and offers nothing to change", () => {
  renderSection(role("ADMIN", 1));
  expect(screen.getByText("permissions.datascope.admin_fixed")).toBeInTheDocument();
  expect(screen.getByText("permissions.datascope.own_always")).toBeInTheDocument();
  expect(screen.queryAllByRole("radio")).toHaveLength(0);
  expect(screen.queryByRole("button", { name: "permissions.datascope.save" })).not.toBeInTheDocument();
  expect(api.getRoleDataScope).not.toHaveBeenCalled();
});

it("DEFINE without a unit cannot be saved; with one it PUTs the explicit ids and says it applies on refresh", async () => {
  renderSection(role("JUDGE"));
  await waitFor(() => expect(radio("ALL")).toBeChecked());
  expect(saveButton()).toBeDisabled(); // 没改动
  fireEvent.click(radio("DEFINE"));
  expect(await screen.findByText("permissions.datascope.orgs_required")).toBeInTheDocument();
  expect(saveButton()).toBeDisabled();
  fireEvent.click(await screen.findByRole("checkbox", { name: /第一殿/ }));
  expect(screen.queryByText("permissions.datascope.orgs_required")).not.toBeInTheDocument();
  expect(saveButton()).toBeEnabled();
  fireEvent.click(saveButton());
  await waitFor(() => expect(api.putRoleDataScope).toHaveBeenCalledTimes(1));
  expect(api.putRoleDataScope).toHaveBeenCalledWith(5, { default: { scope: "DEFINE", orgs: [2] }, overrides: [] });
  await waitFor(() => expect(mockToast).toHaveBeenCalledWith("permissions.datascope.saved", "success"));
});

it("leaving DEFINE sends no units", async () => {
  api.getRoleDataScope.mockResolvedValue({ data: { default: { scope: "DEFINE", orgs: [2] }, overrides: [] } });
  renderSection(role("JUDGE"));
  await waitFor(() => expect(radio("DEFINE")).toBeChecked());
  fireEvent.click(radio("ORG_CHILD"));
  expect(screen.queryByRole("checkbox", { name: /第一殿/ })).not.toBeInTheDocument();
  fireEvent.click(saveButton());
  await waitFor(() => expect(api.putRoleDataScope).toHaveBeenCalledTimes(1));
  expect(api.putRoleDataScope.mock.calls[0][1]).toEqual({ default: { scope: "ORG_CHILD", orgs: [] }, overrides: [] });
});

it("a per-record override is added when chosen and removed by 'follow default'", async () => {
  api.getRoleDataScope.mockResolvedValue({
    data: { default: { scope: "ORG", orgs: [] }, overrides: [{ resource: "judgment", scope: "SELF", orgs: [] }] },
  });
  renderSection(role("JUDGE"));
  fireEvent.click(await screen.findByText("permissions.datascope.per_resource"));
  const judgment = await screen.findByLabelText("审判");
  await waitFor(() => expect(judgment).toHaveValue("SELF"));
  expect(screen.getByLabelText("灵魂")).toHaveValue("");
  fireEvent.change(screen.getByLabelText("灵魂"), { target: { value: "ORG_CHILD" } });
  fireEvent.change(judgment, { target: { value: "" } });
  fireEvent.click(saveButton());
  await waitFor(() => expect(api.putRoleDataScope).toHaveBeenCalledTimes(1));
  const body = api.putRoleDataScope.mock.calls[0][1];
  expect(body.overrides).toEqual([{ resource: "soul", scope: "ORG_CHILD", orgs: [] }]);
  expect(body.overrides.find((o: { resource: string }) => o.resource === "judgment")).toBeUndefined();
});

it("an override set to DEFINE with no unit blocks the save", async () => {
  renderSection(role("JUDGE"));
  fireEvent.click(await screen.findByText("permissions.datascope.per_resource"));
  fireEvent.change(await screen.findByLabelText("灵魂"), { target: { value: "DEFINE" } });
  expect(await screen.findByText("permissions.datascope.orgs_required")).toBeInTheDocument();
  expect(saveButton()).toBeDisabled();
});

it.each([
  ["an admin bound to a hall", { role: "ADMIN", tenant: { code: "CN", display_name: "中国地府" }, permissions: [] }],
  ["a non-admin outside any hall", { role: "JUDGE", tenant: null, permissions: ["perm.manage"] }],
])("%s sees the scope read-only", async (_label, who) => {
  mockUser = who;
  api.getRoleDataScope.mockResolvedValue({ data: { default: { scope: "DEFINE", orgs: [2] }, overrides: [] } });
  renderSection(role("JUDGE"));
  await waitFor(() => expect(radio("DEFINE")).toBeChecked());
  expect(radio("ALL")).toBeDisabled();
  expect(await screen.findByRole("checkbox", { name: /第一殿/ })).toBeDisabled();
  expect(screen.getByText("permissions.datascope.read_only")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "permissions.datascope.save" })).not.toBeInTheDocument();
});
