/**
 * 审计 1017 #3:机构与职务只能由管理员经 `PATCH /users/{id}/` 设置,而编辑弹层里没有这两项。
 *
 * 钉住:编辑时出现职务框与机构选择;机构选项只有被编辑账号所在租户的(ADMIN 的机构列表跨租户,
 * 后端会拒绝别的租户的);保存时 PATCH 带上 organization / position;选「不属于任何机构」发 null。
 * 新建时先选租户才出现(机构只列该租户的,换租户清空已选机构),POST 带上 organization / position。
 * 数据范围 B6:机构改用 OrgTreeSelect 单选;有殿的非管理员必填(没有「不属于任何机构」),缺省殿根
 * (`ROOT_` 开头的顶层,没有就取排序最前的顶层)。
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { UserModal } from "@/src/components/users/UserModal";
import { usersApi, organizationsApi, tenantsApi, type User } from "@soulledger/core/api";

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({ t: (key: string) => key, locale: "zh-Hans", hydrated: true }),
}));

jest.mock("@soulledger/core/api", () => ({
  usersApi: { update: jest.fn().mockResolvedValue({ data: {} }), create: jest.fn() },
  permApi: { roles: { list: jest.fn().mockResolvedValue({ data: [] }) } },
  organizationsApi: { all: jest.fn() },
  tenantsApi: { list: jest.fn() },
}));

jest.mock("@/src/components/ui/Toast", () => ({ showToast: jest.fn() }));

const mockedUpdate = usersApi.update as jest.Mock;
const mockedOrgs = organizationsApi.all as jest.Mock;
const mockedTenants = tenantsApi.list as jest.Mock;
const mockedCreate = usersApi.create as jest.Mock;

const user: User = {
  id: 7,
  username: "cuijue",
  email: "c@x",
  role: "JUDGE",
  is_active: true,
  tenant: { id: 1, code: "CN_DIYU", display_name: "中国地府" },
  organization: { id: 11, code: "D1", name: "第一殿" },
  position: "判官",
};

function renderModal(u: User | null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <UserModal isOpen onClose={() => {}} user={u} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockedCreate.mockReset();
  mockedCreate.mockResolvedValue({ data: {} });
  mockedTenants.mockResolvedValue({
    data: { results: [{ id: 1, code: "CN_DIYU", display_name: "中国地府" }, { id: 4, code: "GR", display_name: "希腊" }] },
  });
  mockedUpdate.mockClear();
  mockedOrgs.mockClear();
  mockedOrgs.mockResolvedValue([
    { id: 10, name: "地府", code: "DIYU", parent: null, level: 0, sort: 0, tenant: 1 },
    { id: 11, name: "第一殿", code: "D1", parent: 10, level: 1, sort: 0, tenant: 1 },
    { id: 12, name: "第二殿", code: "D2", parent: 10, level: 1, sort: 1, tenant: 1 },
    { id: 20, name: "Hades", code: "HADES", parent: null, level: 0, sort: 0, tenant: 4 },
  ]);
});

const submit = () => fireEvent.submit(document.getElementById("user-form")!);

it("offers only the edited user's tenant's organizations, with the current one selected and no 'none' for a non-admin", async () => {
  renderModal(user);
  expect(await screen.findByRole("radio", { name: /第二殿/ })).toBeInTheDocument();
  expect(screen.getByRole("radio", { name: /第一殿/ })).toBeChecked();
  expect(screen.getByRole("radio", { name: /第二殿/ })).not.toBeChecked();
  expect(screen.queryByRole("radio", { name: /Hades/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("radio", { name: /users.organization_none/ })).not.toBeInTheDocument();
  expect(screen.getByLabelText("users.position")).toHaveValue("判官");
});

it("PATCHes the chosen organization and the position", async () => {
  renderModal(user);
  fireEvent.click(await screen.findByRole("radio", { name: /第二殿/ }));
  fireEvent.change(screen.getByLabelText("users.position"), { target: { value: "主簿" } });
  submit();
  await waitFor(() => expect(mockedUpdate).toHaveBeenCalledTimes(1));
  expect(mockedUpdate.mock.calls[0][0]).toBe("7");
  expect(mockedUpdate.mock.calls[0][1]).toMatchObject({ organization: 12, position: "主簿" });
});

it("an ADMIN in a hall may belong to no unit: 'none' is offered and sends null", async () => {
  renderModal({ ...user, role: "ADMIN" });
  fireEvent.click(await screen.findByRole("radio", { name: /users.organization_none/ }));
  submit();
  await waitFor(() => expect(mockedUpdate).toHaveBeenCalledTimes(1));
  expect(mockedUpdate.mock.calls[0][1]).toMatchObject({ organization: null });
});

it("editing a non-admin with no unit defaults to the hall's first top-level unit when there is no ROOT_", async () => {
  renderModal({ ...user, organization: null });
  await waitFor(() => expect(screen.getByRole("radio", { name: /地府/ })).toBeChecked());
  submit();
  await waitFor(() => expect(mockedUpdate).toHaveBeenCalledTimes(1));
  expect(mockedUpdate.mock.calls[0][1]).toMatchObject({ organization: 10 });
});

it("prefers the ROOT_ unit over other top-level units as the default", async () => {
  mockedOrgs.mockResolvedValue([
    { id: 30, name: "旧顶层", code: "OLD", parent: null, level: 0, sort: 0, tenant: 1 },
    { id: 31, name: "殿根", code: "ROOT_CN_DIYU", parent: null, level: 0, sort: 5, tenant: 1 },
  ]);
  renderModal({ ...user, organization: null });
  await waitFor(() => expect(screen.getByRole("radio", { name: /殿根/ })).toBeChecked());
  expect(screen.getByRole("radio", { name: /旧顶层/ })).not.toBeChecked();
});

it("refuses to save a hall member with no unit when the hall has none to pick", async () => {
  mockedOrgs.mockResolvedValue([{ id: 20, name: "Hades", code: "HADES", parent: null, level: 0, sort: 0, tenant: 4 }]);
  renderModal({ ...user, organization: null });
  await waitFor(() => expect(mockedOrgs).toHaveBeenCalled());
  submit();
  expect(await screen.findByText("users.organization_required")).toBeInTheDocument();
  expect(mockedUpdate).not.toHaveBeenCalled();
});

it("creating: shows neither field until a tenant is chosen, then only that tenant's organizations", async () => {
  renderModal(null);
  const tenant = await screen.findByLabelText("users.tenant");
  expect(screen.queryByLabelText("users.position")).not.toBeInTheDocument();
  expect(mockedOrgs).not.toHaveBeenCalled();
  fireEvent.change(tenant, { target: { value: "1" } });
  expect(await screen.findByRole("radio", { name: /第二殿/ })).toBeInTheDocument();
  expect(screen.queryByRole("radio", { name: /Hades/ })).not.toBeInTheDocument();
  expect(screen.getByLabelText("users.position")).toBeInTheDocument();
});

it("creating: changing the tenant drops the old unit for the new hall's default, and POST carries organization + position", async () => {
  renderModal(null);
  fireEvent.change(await screen.findByLabelText("users.tenant"), { target: { value: "1" } });
  fireEvent.click(await screen.findByRole("radio", { name: /第二殿/ }));
  fireEvent.change(screen.getByLabelText("users.tenant"), { target: { value: "4" } });
  await waitFor(() => expect(screen.getByRole("radio", { name: /Hades/ })).toBeChecked());
  expect(screen.queryByRole("radio", { name: /第二殿/ })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("users.tenant"), { target: { value: "1" } });
  await waitFor(() => expect(screen.getByRole("radio", { name: /地府/ })).toBeChecked());
  expect(screen.getByRole("radio", { name: /第二殿/ })).not.toBeChecked();
  fireEvent.click(screen.getByRole("radio", { name: /第一殿/ }));
  fireEvent.change(screen.getByLabelText("users.position"), { target: { value: "主簿" } });
  fireEvent.change(screen.getByLabelText(/users.username/), { target: { value: "newbie" } });
  fireEvent.change(screen.getByLabelText(/users.email/), { target: { value: "n@x.io" } });
  fireEvent.change(screen.getByLabelText(/users.password/), { target: { value: "Str0ng-pass-phrase!" } });
  submit();
  await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1));
  expect(mockedCreate.mock.calls[0][0]).toMatchObject({ tenant: 1, organization: 11, position: "主簿" });
});
