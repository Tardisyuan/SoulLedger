/**
 * A dispatch is a residence, not a change of citizenship (2026-09-17).
 *
 * `app/dispatch/[id]/page.tsx` used to warn that executing "cannot be undone".
 * Now an EXECUTED record is an ongoing residence: the soul goes home by itself
 * when its disposition there is executed, and the home tenant can end it early
 * through `return-home/` with a written reason. The backend decides who may
 * (home tenant or ADMIN); the page offers the action behind `dispatch.return`.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Same `React.use` shim as dispatchApproveConfirms.test.tsx — see the note there
// for what it can and cannot prove.
jest.mock("react", () => {
  const actual = jest.requireActual("react");
  return {
    ...actual,
    use: <T,>(value: Promise<T> | T): T => {
      if (value && typeof (value as { then?: unknown }).then === "function") {
        return { id: "d1" } as unknown as T;
      }
      return value as T;
    },
  };
});

import DispatchDetailPage from "@/app/dispatch/[id]/page";
import { dispatchApi } from "@soulledger/core/api";

jest.mock("@soulledger/core/api", () => ({
  dispatchApi: {
    get: jest.fn(),
    approve: jest.fn(),
    reject: jest.fn(),
    execute: jest.fn(),
    returnHome: jest.fn().mockResolvedValue({ data: {} }),
  },
}));

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }));
// Which hall the viewer sits in (rbac-web M-1): the buttons follow the same side the backend checks.
let mockHall: string | null = "CN_DIYU";
let mockRole = "MODERATOR";
jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({
    user: { id: 1, username: "cn_mod", role: mockRole, tenant: mockHall ? { code: mockHall } : null },
    isAdmin: mockRole === "ADMIN",
  }),
}));
jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({ t: (key: string) => key, formatDateTime: (v: string) => v ?? "", locale: "en", hydrated: true }),
}));
const mockShowToast = jest.fn();
jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast: mockShowToast }) }));

// Real `RequirePermission`, fed a mutable permission list (suiteShape.test.ts forbids stubbing the gate).
let mockHeld = new Set<string>();
jest.mock("@/src/hooks/usePermissions", () => ({
  usePermissions: () => {
    const has = (p: string) => mockHeld.has(p);
    return {
      hasPermission: has,
      hasAnyPermission: (list: string[]) => list.some(has),
      hasAllPermissions: (list: string[]) => list.every(has),
    };
  },
}));

const mockedGet = dispatchApi.get as jest.Mock;
const mockedReturn = dispatchApi.returnHome as jest.Mock;

function renderPage(status: string, extra: Record<string, unknown> = {}) {
  mockedGet.mockResolvedValue({
    data: { id: "d1", status, soul_name: "孟婆", reason: "先在彼处受罚", source_tenant_code: "CN_DIYU",
            target_tenant_code: "EG_DUAT", executed_at: "2026-09-17T00:00:00Z", returned_at: null, ...extra },
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DispatchDetailPage params={Promise.resolve({ id: "d1" })} />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockHeld = new Set(["dispatch.return", "dispatch.execute"]);
  mockHall = "CN_DIYU";
  mockRole = "MODERATOR";
});

describe("ending a residence", () => {
  it("needs a reason, then posts it", async () => {
    renderPage("EXECUTED");
    fireEvent.click(await screen.findByRole("button", { name: "dispatch.return_home" }));
    expect(await screen.findByText("dispatch.return_home_warning")).toBeInTheDocument();
    const buttons = screen.getAllByRole("button", { name: "dispatch.return_home" });
    const confirm = buttons[buttons.length - 1];
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText("dispatch.return_home_reason"), { target: { value: "  刑满,提前送回  " } });
    fireEvent.click(confirm);

    await waitFor(() => expect(mockedReturn).toHaveBeenCalledWith("d1", "刑满,提前送回"));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith("dispatch.return_home_success", "success"));
  });

  it("says why when an open judgment blocks the return", async () => {
    mockedReturn.mockRejectedValueOnce({ response: { status: 409, data: { code: "open_judgment", error: "x" } } });
    renderPage("EXECUTED");
    fireEvent.click(await screen.findByRole("button", { name: "dispatch.return_home" }));
    fireEvent.change(screen.getByLabelText("dispatch.return_home_reason"), { target: { value: "送回" } });
    const buttons = screen.getAllByRole("button", { name: "dispatch.return_home" });
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith("dispatch.return_home_blocked_open_judgment", "error"));
    expect(mockShowToast).not.toHaveBeenCalledWith("dispatch.return_home_error", "error");
  });

  it("keeps the generic message for any other failure", async () => {
    mockedReturn.mockRejectedValueOnce({ response: { status: 409, data: { error: "not ongoing" } } });
    renderPage("EXECUTED");
    fireEvent.click(await screen.findByRole("button", { name: "dispatch.return_home" }));
    fireEvent.change(screen.getByLabelText("dispatch.return_home_reason"), { target: { value: "送回" } });
    const buttons = screen.getAllByRole("button", { name: "dispatch.return_home" });
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith("dispatch.return_home_error", "error"));
  });

  it("is not offered without dispatch.return", async () => {
    mockHeld = new Set(["dispatch.execute"]);
    renderPage("EXECUTED");
    await screen.findByText("孟婆");
    expect(screen.queryByRole("button", { name: "dispatch.return_home" })).toBeNull();
  });

  it.each(["APPROVED", "RETURNED", "PROPOSED"])("is not offered on a %s record", async (status) => {
    renderPage(status, status === "RETURNED" ? { returned_at: "2026-09-18T00:00:00Z" } : {});
    await screen.findByText("孟婆");
    expect(screen.queryByRole("button", { name: "dispatch.return_home" })).toBeNull();
  });

  it("shows when the soul returned", async () => {
    renderPage("RETURNED", { returned_at: "2026-09-18T00:00:00Z" });
    expect(await screen.findByText("dispatch.returned_at")).toBeInTheDocument();
    expect(screen.getByText("2026-09-18T00:00:00Z")).toBeInTheDocument();
  });
});

describe("executing a dispatch", () => {
  it("warns about a residence, not an irreversible transfer", async () => {
    mockHall = "EG_DUAT";
    renderPage("APPROVED", { executed_at: null });
    fireEvent.click(await screen.findByRole("button", { name: "dispatch.execute" }));
    expect(await screen.findByText("dispatch.execute_warning")).toBeInTheDocument();
  });
});

// 批准 / 驳回 / 执行只给目标殿,送回只给原属殿(= 发起殿),无殿 ADMIN 两边都有,绑殿 ADMIN 与殿内其他角色一样。
describe("which hall sees which button", () => {
  const ALL = ["dispatch.approve", "dispatch.reject", "dispatch.execute", "dispatch.return", "dispatch.manage"];
  const name = (n: string) => screen.queryByRole("button", { name: n });

  it.each([
    ["the target hall", "EG_DUAT", "MODERATOR", true],
    ["the sending hall", "CN_DIYU", "MODERATOR", false],
    ["a hall-bound ADMIN of the sending hall", "CN_DIYU", "ADMIN", false],
    ["a third hall's ADMIN", "GR_HADES", "ADMIN", false],
    ["an ADMIN with no hall", null, "ADMIN", true],
  ])("PROPOSED, %s: approve / reject %s", async (_who, hall, role, shown) => {
    mockHeld = new Set(ALL);
    mockHall = hall;
    mockRole = role;
    renderPage("PROPOSED", { executed_at: null });
    await screen.findByText("孟婆");
    expect(!!name("dispatch.approve")).toBe(shown);
    expect(!!name("dispatch.reject")).toBe(shown);
  });

  it.each([
    ["EG_DUAT", "MODERATOR", true],
    ["CN_DIYU", "MODERATOR", false],
    ["CN_DIYU", "ADMIN", false],
    [null, "ADMIN", true],
  ])("APPROVED in %s as %s: execute shown = %s", async (hall, role, shown) => {
    mockHeld = new Set(ALL);
    mockHall = hall;
    mockRole = role;
    renderPage("APPROVED", { executed_at: null });
    await screen.findByText("孟婆");
    expect(!!name("dispatch.execute")).toBe(shown);
  });

  it.each([
    ["CN_DIYU", "MODERATOR", true],
    ["EG_DUAT", "MODERATOR", false],
    ["EG_DUAT", "ADMIN", false],
    [null, "ADMIN", true],
  ])("EXECUTED in %s as %s: return home shown = %s", async (hall, role, shown) => {
    mockHeld = new Set(ALL);
    mockHall = hall;
    mockRole = role;
    renderPage("EXECUTED");
    await screen.findByText("孟婆");
    expect(!!name("dispatch.return_home")).toBe(shown);
  });
});
