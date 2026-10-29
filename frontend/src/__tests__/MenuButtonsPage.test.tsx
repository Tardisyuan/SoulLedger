/**
 * /menus/buttons —— 菜单按钮配置(第四十批 W-b)。
 *
 * 只列接上的关键按钮(`WIRED_BUTTONS`),按菜单分组,一行一个,写「出现在」与「也需要的权限码」。
 * 没有配置行 = 开着;关掉一个没有行的按钮时建一行(is_active=false),有行就只改 is_active。
 * 没有 `menu.manage` 的人只看,开关不可拨。改坏了说出来。
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import MenuButtonsPage from "@/app/menus/buttons/page";
import { WIRED_BUTTONS } from "@/src/lib/menuButtons";
import { tZh } from "./support/zhBundle";

jest.mock("@soulledger/core/api", () => ({
  menuButtonsApi: { config: jest.fn(), update: jest.fn(), create: jest.fn() },
  menusApi: { all: jest.fn() },
}));
const { menuButtonsApi, menusApi } = jest.requireMock("@soulledger/core/api") as {
  menuButtonsApi: { config: jest.Mock; update: jest.Mock; create: jest.Mock };
  menusApi: { all: jest.Mock };
};

const mockShowToast = jest.fn();
jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({ t: (k: string, p?: Record<string, string>) => tZh(k, p), locale: "zh-Hans", hydrated: true }),
}));
let mockPermissions = ["menu.read", "menu.manage"];
jest.mock("@/src/hooks/usePermissions", () => ({
  usePermissions: () => ({
    hasPermission: (p: string) => mockPermissions.includes(p),
    hasAnyPermission: (l: string[]) => l.some((p) => mockPermissions.includes(p)),
    hasAllPermissions: (l: string[]) => l.every((p) => mockPermissions.includes(p)),
  }),
}));
jest.mock("@/src/contexts/TenantContext", () => ({ useTenant: () => ({ user: { id: 1, role: "ADMIN" } }) }));

const MENUS = [
  { id: 2, name: "灵魂业务", path: "", children: [{ id: 11, name: "灵魂管理", path: "/souls", children: [] }] },
];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MenuButtonsPage />
    </QueryClientProvider>,
  );
}

const soulsGroup = async () => within(await screen.findByTestId("menu-buttons-/souls"));
const toggleFor = (group: ReturnType<typeof within>, labelKey: string) =>
  group.getByRole("checkbox", { name: `${tZh(labelKey)} · ${tZh("menu_buttons.col_show")}` });

beforeEach(() => {
  jest.clearAllMocks();
  mockPermissions = ["menu.read", "menu.manage"];
  menusApi.all.mockResolvedValue({ data: MENUS });
  menuButtonsApi.config.mockResolvedValue({
    data: [{ id: 5, menu: 11, menu_path: "/souls", code: "export", is_active: false }],
  });
  menuButtonsApi.update.mockResolvedValue({ data: {} });
  menuButtonsApi.create.mockResolvedValue({ data: {} });
});

describe("菜单按钮配置页", () => {
  it("每个接上的按钮一行;分组标题写菜单名与个数;写出现在与权限码", async () => {
    renderPage();
    const group = await soulsGroup();
    const souls = WIRED_BUTTONS.filter((b) => b.menu === "/souls");
    expect(group.getByText(tZh("menu_buttons.count", { menu: "灵魂管理", n: String(souls.length) }))).toBeInTheDocument();
    expect(group.getAllByRole("checkbox")).toHaveLength(souls.length);
    expect(group.getByText("soul.create")).toBeInTheDocument();
    expect(screen.getByText(tZh("menu_buttons.rule"))).toBeInTheDocument();
    expect(document.querySelectorAll("tbody tr")).toHaveLength(WIRED_BUTTONS.length);
  });

  it("没有配置行的按钮是开着的;关掉它时建一行 is_active=false", async () => {
    renderPage();
    const group = await soulsGroup();
    const create = toggleFor(group, "souls.create");
    expect(create).toBeChecked();
    fireEvent.click(create);
    await waitFor(() =>
      expect(menuButtonsApi.create).toHaveBeenCalledWith(
        expect.objectContaining({ menu: 11, code: "create", permission: "soul.create", is_active: false }),
      ),
    );
    expect(menuButtonsApi.update).not.toHaveBeenCalled();
  });

  it("已有行只改 is_active", async () => {
    renderPage();
    const group = await soulsGroup();
    const exportToggle = toggleFor(group, "common.export");
    expect(exportToggle).not.toBeChecked();
    fireEvent.click(exportToggle);
    await waitFor(() => expect(menuButtonsApi.update).toHaveBeenCalledWith(5, { is_active: true }));
    expect(menuButtonsApi.create).not.toHaveBeenCalled();
  });

  it("没有 menu.manage 只看,开关不可拨", async () => {
    mockPermissions = ["menu.read"];
    renderPage();
    const group = await soulsGroup();
    for (const box of group.getAllByRole("checkbox")) expect(box).toBeDisabled();
  });

  it("改不成说出来", async () => {
    menuButtonsApi.update.mockRejectedValue({ response: { status: 500 } });
    renderPage();
    fireEvent.click(toggleFor(await soulsGroup(), "common.export"));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(tZh("menu_buttons.update_error"), "error"));
  });
});
