/**
 * `/users?username=<u>` —— 求助通知的「去用户页」落到那一个账号(第三类 F 组 2.6):
 * 服务端按用户名精确筛,那一行高亮;账号不存在时是普通的空结果。
 */
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import UsersPage from "@/app/users/page";
import { usersApi, permApi } from "@soulledger/core/api";

jest.mock("@soulledger/core/api", () => ({
  usersApi: { list: jest.fn(), delete: jest.fn(), activate: jest.fn(), deactivate: jest.fn() },
  permApi: { roles: { list: jest.fn() } },
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
const mockReplace = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => new URLSearchParams(mockQuery),
}));

const mockUsers = usersApi.list as jest.Mock;
const row = (id: number, username: string) => ({ id, username, email: `${username}@x`, role: "JUDGE", tenant: null, is_active: true });
const page = (...results: ReturnType<typeof row>[]) => ({ data: { count: results.length, next: null, previous: null, results } });

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
  (permApi.roles.list as jest.Mock).mockResolvedValue({ data: [] });
});

it("asks the server for that exact username and highlights its row", async () => {
  mockQuery = "username=cuijue";
  mockUsers.mockResolvedValue(page(row(3, "cuijue")));
  const { container } = renderPage();
  await screen.findByText("cuijue");
  expect(mockUsers).toHaveBeenCalledWith(expect.objectContaining({ username: "cuijue" }));
  const hit = container.querySelector("[data-located]");
  expect(hit).toHaveTextContent("cuijue");
});

it("a row that is not the located account is not highlighted", async () => {
  mockQuery = "username=cuijue";
  mockUsers.mockResolvedValue(page(row(3, "cuijue"), row(4, "cuijue2")));
  const { container } = renderPage();
  await screen.findByText("cuijue2");
  expect(container.querySelectorAll("[data-located]")).toHaveLength(1);
});

it("no such account: the normal filtered empty result", async () => {
  mockQuery = "username=nobody";
  mockUsers.mockResolvedValue(page());
  const { container } = renderPage();
  expect(await screen.findByText("table.no_results")).toBeInTheDocument();
  expect(container.querySelector("[data-located]")).toBeNull();
});

it("without ?username nothing is located and no username goes to the server", async () => {
  mockQuery = "";
  mockUsers.mockResolvedValue(page(row(3, "cuijue")));
  const { container } = renderPage();
  await screen.findByText("cuijue");
  expect(mockUsers).toHaveBeenCalledWith(expect.objectContaining({ username: undefined }));
  expect(container.querySelector("[data-located]")).toBeNull();
});
