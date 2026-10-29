/**
 * 用户页左侧机构树与「已停用」筛选(rbac-snowy 2026-10-29)。点机构 → `?organization=<id>` 给服务端
 * (服务端含下级);「全部机构」→ 不带;状态签 → `is_active`。
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import UsersPage from "@/app/users/page";
import { usersApi, permApi, organizationsApi, tenantsApi } from "@soulledger/core/api";

jest.mock("@soulledger/core/api", () => ({
  usersApi: { list: jest.fn(), delete: jest.fn(), activate: jest.fn(), deactivate: jest.fn() },
  permApi: { roles: { list: jest.fn() } },
  organizationsApi: { all: jest.fn() },
  tenantsApi: { list: jest.fn() },
  PAGE_SIZE: 20,
}));
jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({ t: (key: string) => key, locale: "zh-Hans", hydrated: true }),
}));
jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: { id: 1, username: "yama", role: "ADMIN", tenant: null, permissions: ["user.manage"] } }),
}));
jest.mock("@/src/components/layout/MenuGloss", () => ({ MenuGloss: () => null }));
let mockQuery = "";
jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(mockQuery),
}));

const mockUsers = usersApi.list as jest.Mock;
const page = { data: { count: 1, next: null, previous: null, results: [{ id: 3, username: "cuijue", email: "c@x", role: "JUDGE", tenant: null, is_active: true }] } };

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <UsersPage />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery = "";
  window.localStorage.clear();
  mockUsers.mockResolvedValue(page);
  (permApi.roles.list as jest.Mock).mockResolvedValue({ data: [] });
  (organizationsApi.all as jest.Mock).mockResolvedValue([
    { id: 10, name: "第一殿", code: "D1", parent: null, tenant: 1, sort: 0 },
    { id: 11, name: "孽镜台", code: "D1_MIRROR", parent: 10, tenant: 1, sort: 0 },
  ]);
  (tenantsApi.list as jest.Mock).mockResolvedValue({ data: { results: [{ id: 1, code: "CN_DIYU", display_name: "中国地府" }] } });
});

it("picking an organization in the tree filters by it; 全部机构 clears it", async () => {
  renderPage();
  await screen.findByText("cuijue");
  expect(mockUsers).toHaveBeenLastCalledWith(expect.objectContaining({ organization: undefined }));
  const tree = screen.getByRole("group", { name: "users.org_filter.label" });
  fireEvent.click(await within(tree).findByRole("radio", { name: /第一殿/ }));
  await waitFor(() => expect(mockUsers).toHaveBeenLastCalledWith(expect.objectContaining({ organization: "10", page: 1 })));
  fireEvent.click(within(tree).getByRole("radio", { name: "users.org_filter.all" }));
  await waitFor(() => expect(mockUsers).toHaveBeenLastCalledWith(expect.objectContaining({ organization: undefined })));
});

it("arriving with ?organization= starts with that organization picked", async () => {
  mockQuery = "organization=11";
  renderPage();
  await screen.findByText("cuijue");
  expect(mockUsers).toHaveBeenCalledWith(expect.objectContaining({ organization: "11" }));
  expect(await screen.findByRole("radio", { name: /孽镜台/ })).toBeChecked();
});

it("the status chip asks for deactivated accounts only", async () => {
  renderPage();
  await screen.findByText("cuijue");
  expect(mockUsers).toHaveBeenLastCalledWith(expect.objectContaining({ is_active: undefined }));
  const chip = screen.getByRole("combobox", { name: "users.status" });
  fireEvent.change(chip, { target: { value: "false" } });
  await waitFor(() => expect(mockUsers).toHaveBeenLastCalledWith(expect.objectContaining({ is_active: "false" })));
});
