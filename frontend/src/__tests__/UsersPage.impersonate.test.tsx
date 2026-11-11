/**
 * 用户页的「以此人身份查看」(Design 第二十八批 W6):只给系统管理员(ADMIN),不出现在另一位管理员、
 * 自己、停用与灵魂账号的行上;确认弹层理由必填,理由原样交给 `startImpersonation`。
 * 每条都同时断言有与没有 —— 只断言「按钮在」,换成人人可见也是绿的。
 */
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import UsersPage from "@/app/users/page";
import { usersApi, permApi } from "@soulledger/core/api";
import { startImpersonation } from "@soulledger/core/api/impersonation";
import { renderWithProviders } from "./support/render";

jest.mock("@soulledger/core/api", () => ({
  usersApi: { list: jest.fn(), delete: jest.fn(), activate: jest.fn(), deactivate: jest.fn() },
  permApi: { roles: { list: jest.fn() } },
  PAGE_SIZE: 20,
}));
jest.mock("@soulledger/core/api/impersonation", () => ({
  startImpersonation: jest.fn(),
  getImpersonation: () => null,
  subscribeImpersonation: () => () => {},
}));

jest.mock("@/src/contexts/I18nContext", () => require("./support/mocks").i18nMock({ locale: "zh-Hans", hydrated: true }));

const mockTenant = {
  user: { id: 1, username: "yama", role: "ADMIN", tenant: null, permissions: ["user.manage"] },
};
jest.mock("@/src/contexts/TenantContext", () => ({ useTenant: () => mockTenant }));
jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock("@/src/components/layout/MenuGloss", () => ({ MenuGloss: () => null }));

const OPEN = "admin.users.impersonate";

const row = (over: Record<string, unknown>) => ({
  id: 0, username: "", email: "x@example.com", role: "JUDGE", tenant: null, is_active: true, ...over,
});

function renderPage() {
  return renderWithProviders(<UsersPage />, { i18n: false });
}

function rowOf(name: string): HTMLElement {
  const tr = screen.getByText(name).closest("tr");
  if (!tr) throw new Error(`no row for ${name}`);
  return tr;
}


/** The row's actions live behind 「⋯」 since review-2026-11-01 Web 6; this opens it and returns its items. */
function menuOf(row: HTMLElement): HTMLElement[] {
  fireEvent.click(within(row).getByRole("button", { name: /^users\.row_menu/ }));
  const items = screen.queryAllByRole("menuitem");
  // Close again (the trigger toggles) so the next row's menu is the only one open.
  fireEvent.click(within(row).getByRole("button", { name: /^users\.row_menu/ }));
  return items;
}
const labelsOf = (items: HTMLElement[]) => items.map((i) => i.textContent);

beforeEach(() => {
  jest.clearAllMocks();
  mockTenant.user = { id: 1, username: "yama", role: "ADMIN", tenant: null, permissions: ["user.manage"] };
  (permApi.roles.list as jest.Mock).mockResolvedValue({ data: [] });
  (usersApi.list as jest.Mock).mockResolvedValue({
    data: {
      count: 5, next: null, previous: null,
      results: [
        row({ id: 1, username: "yama", role: "ADMIN" }),
        row({ id: 2, username: "cui", role: "ADMIN" }),
        row({ id: 3, username: "mengpo", role: "JUDGE" }),
        row({ id: 4, username: "gone", role: "JUDGE", is_active: false }),
        row({ id: 5, username: "soulx", role: "SOUL" }),
      ],
    },
  });
});

describe("「以此人身份查看」入口", () => {
  it("只出现在非管理员、在职、非自己的行上", async () => {
    renderPage();
    await screen.findByText("mengpo");

    expect(labelsOf(menuOf(rowOf("mengpo")))).toContain(OPEN);
    for (const name of ["yama", "cui", "gone", "soulx"]) {
      expect(labelsOf(menuOf(rowOf(name)))).not.toContain(OPEN);
    }
    expect(screen.queryAllByText(OPEN)).toHaveLength(0);
  });

  it("持 user.manage 的非管理员进得了页、看得到行,但没有代看入口", async () => {
    mockTenant.user = { id: 9, username: "judge", role: "JUDGE", tenant: null, permissions: ["user.manage"] };
    renderPage();
    // 页级门按码 `user.manage`(与后端 UserViewSet、菜单行同一个码,审计 C-01);代看仍只给管理员。
    await screen.findByText("mengpo");
    expect(screen.queryByTestId("permission-denied")).toBeNull();
    for (const name of ["yama", "cui", "mengpo", "gone", "soulx"]) {
      expect(labelsOf(menuOf(rowOf(name)))).not.toContain(OPEN);
    }
    expect(screen.queryByText(OPEN)).toBeNull();
  });

  it("没有 user.manage 的人整页拒绝,一行都不画", async () => {
    mockTenant.user = { id: 9, username: "judge", role: "JUDGE", tenant: null, permissions: ["soul.read"] };
    renderPage();
    expect(await screen.findByTestId("permission-denied")).toBeInTheDocument();
    expect(screen.queryByText("mengpo")).toBeNull();
    expect(usersApi.list).not.toHaveBeenCalled();
  });

  it("弹层理由必填;开始时把账号与去掉首尾空白的理由交出去", async () => {
    (startImpersonation as jest.Mock).mockReturnValue(new Promise(() => {}));
    renderPage();
    await screen.findByText("mengpo");
    fireEvent.click(within(rowOf("mengpo")).getByRole("button", { name: /^users\.row_menu/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: OPEN }));

    const start = await screen.findByTestId("impersonate-start");
    expect(screen.getByText("admin.impersonate.body")).toBeInTheDocument();
    expect(start).toBeDisabled();

    const reason = screen.getByLabelText(/admin\.impersonate\.reason_label/);
    fireEvent.change(reason, { target: { value: "   " } });
    expect(start).toBeDisabled();
    expect(startImpersonation).not.toHaveBeenCalled();

    fireEvent.change(reason, { target: { value: "  她说看不到「移交」菜单 " } });
    await waitFor(() => expect(start).toBeEnabled());
    fireEvent.click(start);
    await waitFor(() => expect(startImpersonation).toHaveBeenCalledWith(3, "她说看不到「移交」菜单"));
  });
});
