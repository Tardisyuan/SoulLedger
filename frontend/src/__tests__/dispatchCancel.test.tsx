/**
 * 「取消移交」:发起方在对方批准之前撤回提案(`CancelDispatchButton`,详情页与「我方发起的」列表共用)。
 *
 * 只给能成功的人 —— 本殿发起(或 ADMIN)、状态 PROPOSED、持有 `dispatch.manage`;其余一律不渲染
 * (不是禁用的按钮)。每一条「有」都配一条「没有」。理由必填;409 `not_cancellable` 说清「对方已处理」。
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CancelDispatchButton } from "@/src/components/dispatch/CancelDispatchButton";
import { tZh } from "./support/zhBundle";

jest.mock("@soulledger/core/api", () => ({ dispatchApi: { cancel: jest.fn() } }));
const { dispatchApi } = jest.requireMock("@soulledger/core/api") as { dispatchApi: { cancel: jest.Mock } };

let mockTenant: string | null = "CN_DIYU";
jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: { id: 1, tenant: mockTenant ? { code: mockTenant } : null } }),
}));
let mockHeld = new Set(["dispatch.manage"]);
let mockAdmin = false;
jest.mock("@/src/hooks/usePermissions", () => ({
  usePermissions: () => ({ hasPermission: (p: string) => mockHeld.has(p), isAdmin: mockAdmin }),
}));
jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({ t: (key: string) => tZh(key), formatDateTime: (v: string) => v, locale: "zh-Hans", hydrated: true }),
}));
const mockShowToast = jest.fn();
jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast: mockShowToast }) }));

const record = (over: Record<string, unknown> = {}) => ({
  id: "d1", status: "PROPOSED", source_tenant_code: "CN_DIYU", soul_name: "孟婆", ...over,
});
const trigger = () => screen.queryByRole("button", { name: tZh("dispatch.cancel_dispatch") });

function renderButton(dispatch = record(), onCancelled?: () => void) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CancelDispatchButton dispatch={dispatch as never} onCancelled={onCancelled} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockTenant = "CN_DIYU";
  mockHeld = new Set(["dispatch.manage"]);
  mockAdmin = false;
  dispatchApi.cancel.mockResolvedValue({ data: {} });
});

describe("取消移交", () => {
  it("发起方:点开,没写理由确认键不可点;写了理由确认后带理由调用,并提示成功", async () => {
    const done = jest.fn();
    renderButton(record(), done);
    fireEvent.click(trigger() as HTMLElement);
    const confirm = await screen.findByRole("button", { name: tZh("dispatch.confirm_cancel") });
    expect(confirm).toBeDisabled();
    expect(dispatchApi.cancel).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(tZh("dispatch.cancel_reason")), { target: { value: "  改派别处  " } });
    fireEvent.click(confirm);

    await waitFor(() => expect(dispatchApi.cancel).toHaveBeenCalledWith("d1", "改派别处"));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(tZh("dispatch.cancel_success"), "success"));
    expect(done).toHaveBeenCalled();
  });

  it("确认键是普通主按钮(不是红色,也没有「输入名称」那一格);触发键是次级", async () => {
    // Design 第十九批 B:后果可以挽回(灵魂留在本殿、随时可重发),所以不用 danger,也不要输名称确认。
    renderButton();
    expect(trigger()?.className).toContain("border-[oklch(var(--color-line-strong))]");
    fireEvent.click(trigger() as HTMLElement);
    const confirm = await screen.findByRole("button", { name: tZh("dispatch.confirm_cancel") });
    expect(confirm.className).toContain("bg-[oklch(var(--color-main))]");
    expect(confirm.className).not.toContain("danger");
    expect(screen.getAllByRole("textbox")).toHaveLength(1); // 只有「理由」
  });

  it("对方已经批准(409 not_cancellable):说「对方已经处理了」,不说成功", async () => {
    dispatchApi.cancel.mockRejectedValue({ response: { status: 409, data: { code: "not_cancellable" } } });
    renderButton();
    fireEvent.click(trigger() as HTMLElement);
    fireEvent.change(await screen.findByLabelText(tZh("dispatch.cancel_reason")), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: tZh("dispatch.confirm_cancel") }));

    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith(tZh("dispatch.cancel_not_cancellable"), "error"),
    );
    expect(mockShowToast).not.toHaveBeenCalledWith(tZh("dispatch.cancel_success"), "success");
  });

  it("别的失败是笼统的「取消移交失败」", async () => {
    dispatchApi.cancel.mockRejectedValue({ response: { status: 500, data: {} } });
    renderButton();
    fireEvent.click(trigger() as HTMLElement);
    fireEvent.change(await screen.findByLabelText(tZh("dispatch.cancel_reason")), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: tZh("dispatch.confirm_cancel") }));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(tZh("dispatch.cancel_error"), "error"));
  });

  it.each(["APPROVED", "REJECTED", "EXECUTED", "CANCELLED", "DRAFT"])("状态是 %s:不渲染", (status) => {
    renderButton(record({ status }));
    expect(trigger()).toBeNull();
  });

  it("执行地(对方)看不到,对方殿的绑殿 ADMIN 也看不到;无殿 ADMIN 看得到", () => {
    mockTenant = "EG_DUAT";
    const away = renderButton();
    expect(trigger()).toBeNull();
    away.unmount();

    mockAdmin = true;
    const boundAdmin = renderButton();
    expect(trigger()).toBeNull();
    boundAdmin.unmount();

    mockTenant = null;
    renderButton();
    expect(trigger()).not.toBeNull();
  });

  it("没有 dispatch.manage:不渲染,也没有禁用的按钮", () => {
    mockHeld = new Set(["dispatch.read", "dispatch.approve"]);
    renderButton();
    expect(trigger()).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
