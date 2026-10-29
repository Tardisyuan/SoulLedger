/**
 * 菜单页(rbac-snowy 2026-10-29):
 * - 整棵树一次取回,按**根**分页 —— 子项永远紧跟在父项下面,不会因为落在后端的下一页而脱离父项;
 * - 编辑框的角色勾选来自角色表(殿主与自建角色都在),不是写死的四个。
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import MenusPage from "@/app/menus/page";
import { menusApi, permApi } from "@soulledger/core/api";

jest.mock("@soulledger/core/api", () => ({
  menusApi: { listAll: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
  permApi: { list: jest.fn(), roles: { list: jest.fn() } },
  PAGE_SIZE: 20,
}));
jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({ t: (key: string) => key, locale: "zh-Hans", hydrated: true }),
}));
jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast: jest.fn() }) }));
jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: { id: 1, username: "a", role: "ADMIN", tenant: null, permissions: [] } }),
}));
jest.mock("@/src/components/layout/MenuGloss", () => ({ MenuGloss: () => null }));

const menu = (id: number, name: string, parent: number | null, roles: string[] = []) => ({
  id, name, path: `/${name}`, icon: "Home", order: id, component: null, roles, is_active: true, parent,
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MenusPage />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  (permApi.list as jest.Mock).mockResolvedValue({ data: [] });
  (permApi.roles.list as jest.Mock).mockResolvedValue({
    data: [
      { id: 1, name: "ADMIN", display_name: "管理员", is_builtin: true },
      { id: 2, name: "MODERATOR", display_name: "殿主", is_builtin: true },
      { id: 3, name: "SCRIBE", display_name: "书记官", is_builtin: false },
    ],
  });
});

const rowNames = () =>
  screen.getAllByRole("row").map((r) => r.textContent ?? "").filter((t) => t.includes("/root") || t.includes("/child"));

it("a child listed after twenty-one roots still sits under its parent; paging is by root", async () => {
  const roots = Array.from({ length: 21 }, (_, i) => menu(i + 1, `root${i + 1}`, null));
  (menusApi.listAll as jest.Mock).mockResolvedValue([...roots, menu(100, "child_of_1", 1)]);
  renderPage();
  await screen.findByText("child_of_1");
  const names = rowNames();
  expect(names[0]).toContain("/root1");
  expect(names[0]).not.toContain("child_of_1");
  expect(names[1]).toContain("child_of_1");
  expect(names.some((n) => n.includes("root21"))).toBe(false);
  expect(menusApi.listAll).toHaveBeenCalledWith({});
  fireEvent.click(screen.getByRole("button", { name: /common\.next/ }));
  await screen.findByText("root21");
  expect(screen.queryByText("child_of_1")).toBeNull();
});

it("the editor's role chips are the role table, 殿主 and custom roles included", async () => {
  (menusApi.listAll as jest.Mock).mockResolvedValue([menu(1, "home", null, ["GONE_ROLE"])]);
  renderPage();
  await screen.findByText("home");
  fireEvent.click(screen.getByRole("button", { name: "menus.edit" }));
  const group = await screen.findByRole("group", { name: "menus.roles" });
  await waitFor(() => expect(within(group).getByRole("button", { name: "users.roles.MODERATOR" })).toBeInTheDocument());
  expect(within(group).getByRole("button", { name: "书记官" })).toHaveAttribute("aria-pressed", "false");
  // A name the menu carries but the table no longer has stays, so it can be unticked.
  expect(within(group).getByRole("button", { name: "GONE_ROLE" })).toHaveAttribute("aria-pressed", "true");
  expect(within(group).queryByRole("button", { name: "users.roles.GUARDIAN" })).toBeNull();
});
