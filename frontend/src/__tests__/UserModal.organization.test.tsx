/**
 * 审计 1017 #3:机构与职务只能由管理员经 `PATCH /users/{id}/` 设置,而编辑弹层里没有这两项。
 *
 * 钉住:编辑时出现职务框与机构选择;机构选项只有被编辑账号所在租户的(ADMIN 的机构列表跨租户,
 * 后端会拒绝别的租户的);保存时 PATCH 带上 organization / position;选「不属于任何机构」发 null。
 * 新建时不出现(账号的租户还没定)。
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { UserModal } from "@/src/components/users/UserModal";
import { usersApi, organizationsApi, type User } from "@soulledger/core/api";

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({ t: (key: string) => key, locale: "zh-Hans", hydrated: true }),
}));

jest.mock("@soulledger/core/api", () => ({
  usersApi: { update: jest.fn().mockResolvedValue({ data: {} }), create: jest.fn() },
  permApi: { roles: { list: jest.fn().mockResolvedValue({ data: [] }) } },
  organizationsApi: { all: jest.fn() },
}));

jest.mock("@/src/components/ui/Toast", () => ({ showToast: jest.fn() }));

const mockedUpdate = usersApi.update as jest.Mock;
const mockedOrgs = organizationsApi.all as jest.Mock;

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
  mockedUpdate.mockClear();
  mockedOrgs.mockClear();
  mockedOrgs.mockResolvedValue([
    { id: 10, name: "地府", code: "DIYU", parent: null, level: 0, sort: 0, tenant: 1 },
    { id: 11, name: "第一殿", code: "D1", parent: 10, level: 1, sort: 0, tenant: 1 },
    { id: 12, name: "第二殿", code: "D2", parent: 10, level: 1, sort: 1, tenant: 1 },
    { id: 20, name: "Hades", code: "HADES", parent: null, level: 0, sort: 0, tenant: 4 },
  ]);
});

it("offers only the edited user's tenant's organizations, with the current one selected", async () => {
  renderModal(user);
  expect(await screen.findByRole("radio", { name: /第二殿/ })).toBeInTheDocument();
  expect(screen.getByRole("radio", { name: /第一殿/ })).toHaveAttribute("aria-checked", "true");
  expect(screen.queryByRole("radio", { name: /Hades/ })).not.toBeInTheDocument();
  expect(screen.getByRole("radio", { name: /users.organization_none/ })).toHaveAttribute("aria-checked", "false");
  expect(screen.getByLabelText("users.position")).toHaveValue("判官");
});

it("PATCHes the chosen organization and the position", async () => {
  renderModal(user);
  fireEvent.click(await screen.findByRole("radio", { name: /第二殿/ }));
  fireEvent.change(screen.getByLabelText("users.position"), { target: { value: "主簿" } });
  fireEvent.submit(document.getElementById("user-form")!);
  await waitFor(() => expect(mockedUpdate).toHaveBeenCalledTimes(1));
  expect(mockedUpdate.mock.calls[0][0]).toBe("7");
  expect(mockedUpdate.mock.calls[0][1]).toMatchObject({ organization: 12, position: "主簿" });
});

it("sends null when the organization is cleared", async () => {
  renderModal(user);
  fireEvent.click(await screen.findByRole("radio", { name: /users.organization_none/ }));
  fireEvent.submit(document.getElementById("user-form")!);
  await waitFor(() => expect(mockedUpdate).toHaveBeenCalledTimes(1));
  expect(mockedUpdate.mock.calls[0][1]).toMatchObject({ organization: null });
});

it("does not show either field, nor fetch organizations, when creating", async () => {
  renderModal(null);
  await screen.findByLabelText(/users.username/);
  expect(screen.queryByLabelText("users.position")).not.toBeInTheDocument();
  expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  expect(mockedOrgs).not.toHaveBeenCalled();
});
