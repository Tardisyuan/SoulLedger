/**
 * 用户页的「以此人身份查看」(Design 第二十八批 W6):只给系统管理员(ADMIN),不出现在另一位管理员、
 * 自己、停用与灵魂账号的行上;确认弹层理由必填,理由原样交给 `startImpersonation`。
 * 每条都同时断言有与没有 —— 只断言「按钮在」,换成人人可见也是绿的。
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import UsersPage from "@/app/users/page";
import { usersApi, permApi } from "@soulledger/core/api";
import { startImpersonation } from "@soulledger/core/api/impersonation";

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

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({ t: (key: string) => key, locale: "zh-Hans", hydrated: true }),
}));

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
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <UsersPage />
    </QueryClientProvider>
  );
}

function rowOf(name: string): HTMLElement {
  const tr = screen.getByText(name).closest("tr");
  if (!tr) throw new Error(`no row for ${name}`);
  return tr;
}

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

    expect(within(rowOf("mengpo")).getByText(OPEN)).toBeInTheDocument();
    for (const name of ["yama", "cui", "gone", "soulx"]) {
      expect(within(rowOf(name)).queryByText(OPEN)).toBeNull();
    }
    expect(screen.getAllByText(OPEN)).toHaveLength(1);
  });

  it("不是管理员的人一行都看不到", async () => {
    mockTenant.user = { id: 9, username: "judge", role: "JUDGE", tenant: null, permissions: ["user.manage"] };
    renderPage();
    // 页级门(rbac-web L-1):users/ 是 IsAdmin,非管理员整页 403,一行都不画。
    expect(await screen.findByTestId("permission-denied")).toBeInTheDocument();
    expect(screen.queryByText("mengpo")).toBeNull();
    expect(screen.queryByText(OPEN)).toBeNull();
  });

  it("弹层理由必填;开始时把账号与去掉首尾空白的理由交出去", async () => {
    (startImpersonation as jest.Mock).mockReturnValue(new Promise(() => {}));
    renderPage();
    await screen.findByText("mengpo");
    fireEvent.click(within(rowOf("mengpo")).getByText(OPEN));

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
