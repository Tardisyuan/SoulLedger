/**
 * /permissions 「权限定义」一段的列菜单(2026-10-15):编号(codename)与名称两列钉住,
 * 隐藏的偏好记在 `soulledger.permissions.columns`、重挂后还在;矩阵一段没有列菜单,
 * 矩阵的筛选(搜索框与「只看差异」)不记。
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PermissionsPage from "@/app/permissions/page";
import { permApi, type Permission } from "@soulledger/core/api";

jest.mock("@soulledger/core/api", () => ({
  permApi: {
    list: jest.fn(),
    roles: { list: jest.fn() },
    rolePermissions: jest.fn(),
    applyChanges: jest.fn(),
    impact: jest.fn().mockResolvedValue({ data: { required_codenames: [], conflicts: [] } }),
  },
}));
jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) => (params ? `${key}:${Object.values(params).join(",")}` : key),
    locale: "en",
    hydrated: true,
  }),
}));
jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast: jest.fn() }) }));
jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: { id: 1, username: "admin", role: "ADMIN", tenant: null, permissions: [] } }),
}));
jest.mock("@/src/components/layout/MenuGloss", () => ({ MenuGloss: () => null }));

const PERMS = [{ id: 1, codename: "soul.read", name: "读灵魂", category: "soul" } as Permission];
const COLS = "soulledger.permissions.columns";
const headers = () => screen.queryAllByRole("columnheader").map((h) => h.textContent);
const menuButton = () => screen.queryByRole("button", { name: /^list\.columns\.button/ });

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PermissionsPage />
    </QueryClientProvider>
  );
}
async function openDefinitions() {
  fireEvent.click(await screen.findByRole("button", { name: /permissions\.segments\.definitions/ }));
  await screen.findByText("soul.read");
}

beforeEach(() => {
  (permApi.list as jest.Mock).mockResolvedValue({ data: PERMS });
  (permApi.roles.list as jest.Mock).mockResolvedValue({ data: [] });
  (permApi.rolePermissions as jest.Mock).mockResolvedValue({ data: { role: "x", permissions: [], details: [] } });
});

describe("权限定义的列菜单", () => {
  it("只在「权限定义」一段出现;矩阵一段没有", async () => {
    renderPage();
    await screen.findByRole("button", { name: /permissions\.segments\.definitions/ });
    expect(menuButton()).toBeNull();
    await openDefinitions();
    expect(menuButton()).toBeInTheDocument();
  });

  it("codename 与名称两列钉住不能隐藏;类别可以", async () => {
    renderPage();
    await openDefinitions();
    fireEvent.click(menuButton()!);
    for (const name of ["permissions.codename", "permissions.name"]) {
      const item = screen.getByRole("menuitemcheckbox", { name: new RegExp(name) });
      expect(item).toBeDisabled();
      fireEvent.click(item);
    }
    expect(headers().join("|")).toContain("permissions.codename");
    expect(headers().join("|")).toContain("permissions.name");
    expect(screen.getByRole("menuitemcheckbox", { name: "permissions.category" })).not.toBeDisabled();
  });

  it("隐藏类别:表头没了、偏好写进本浏览器、重挂后还在", async () => {
    const { unmount } = renderPage();
    await openDefinitions();
    expect(headers().join("|")).toContain("permissions.category");
    fireEvent.click(menuButton()!);
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "permissions.category" }));
    expect(headers().join("|")).not.toContain("permissions.category");
    expect(JSON.parse(localStorage.getItem(COLS)!)).toEqual({ hidden: "category" });
    unmount();

    renderPage();
    await openDefinitions();
    await waitFor(() => expect(headers().join("|")).not.toContain("permissions.category"));
    expect(headers().join("|")).toContain("permissions.codename");
  });

  it("矩阵的搜索框与「只看差异」不写任何记忆", async () => {
    renderPage();
    fireEvent.change(await screen.findByPlaceholderText("permissions.matrix.filter_placeholder"), { target: { value: "soul" } });
    fireEvent.click(screen.getByRole("button", { name: "permissions.matrix.only_differences" }));
    expect(localStorage.length).toBe(0);
  });
});
