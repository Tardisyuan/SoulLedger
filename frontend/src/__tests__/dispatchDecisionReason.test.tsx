/**
 * 移交详情页的「驳回理由 / 取消理由」读 `decision_reason` 字段 —— `reason` 是发起时的原文,不再被追加。
 * 每一条「有」配一条「没有」:批准的、空理由的、状态不符的,都不画这一段。
 */
import { screen } from "@testing-library/react";

// Same `React.use` shim as dispatchReturnHome.test.tsx.
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
import { renderWithProviders } from "./support/render";

jest.mock("@soulledger/core/api", () => ({
  dispatchApi: { get: jest.fn(), approve: jest.fn(), reject: jest.fn(), execute: jest.fn(), returnHome: jest.fn() },
}));
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: { id: 1, username: "cn_mod", role: "MODERATOR" }, isAdmin: false }),
}));
jest.mock("@/src/contexts/I18nContext", () => require("./support/mocks").i18nMock({ formatDateTime: (v: string) => v ?? "", locale: "en", hydrated: true }));
jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast: jest.fn() }) }));
jest.mock("@/src/hooks/usePermissions", () => ({
  usePermissions: () => {
    const has = () => false;
    return { hasPermission: has, hasAnyPermission: has, hasAllPermissions: has };
  },
}));

function renderPage(over: Record<string, unknown>, omit: string[] = []) {
  const data: Record<string, unknown> = { id: "d1", status: "PROPOSED", soul_name: "孟婆", reason: "先在彼处受罚", decision_reason: "",
            source_tenant_code: "CN_DIYU", target_tenant_code: "EG_DUAT", executed_at: null, returned_at: null, ...over };
  for (const k of omit) delete data[k];
  (dispatchApi.get as jest.Mock).mockResolvedValue({ data });
  return renderWithProviders(<DispatchDetailPage params={Promise.resolve({ id: "d1" })} />, { i18n: false });
}

describe("the decision reason on a dispatch", () => {
  it("shows a rejection reason from the field, under its own heading, and the proposal's words stay as proposed", async () => {
    renderPage({ status: "REJECTED", decision_reason: "本殿名额已满" });
    expect(await screen.findByTestId("dispatch-decision-reason")).toHaveTextContent("本殿名额已满");
    expect(screen.getByText("dispatch.reject_reason")).toBeInTheDocument();
    expect(screen.getByText("先在彼处受罚")).toBeInTheDocument();
  });

  it("shows a cancellation reason under the cancel heading", async () => {
    renderPage({ status: "CANCELLED", decision_reason: "改派别处" });
    expect(await screen.findByTestId("dispatch-decision-reason")).toHaveTextContent("改派别处");
    expect(screen.getByText("dispatch.cancel_reason")).toBeInTheDocument();
    expect(screen.queryByText("dispatch.reject_reason")).toBeNull();
  });

  it.each([
    ["REJECTED", ""],
    ["CANCELLED", ""],
    ["APPROVED", "不该出现"],
  ])("draws nothing for %s with decision_reason %j", async (status, decision_reason) => {
    renderPage({ status, decision_reason });
    await screen.findByText("先在彼处受罚");
    expect(screen.queryByTestId("dispatch-decision-reason")).toBeNull();
  });
});

// P-11:缺 `soul_name` 键 = 字段权限藏了姓名 →「已隐藏」,不把灵魂主键印成名字;null 不带「已隐藏」。
describe("a withheld soul name on a dispatch", () => {
  const WITHHELD = "common.value.unrecorded — souls.field_withheld";
  const SOUL_ID = "9f1c2d3e-0000-4000-8000-00000000abcd";

  it("shows 已隐藏 when the key is absent, never the soul's id", async () => {
    renderPage({ soul: SOUL_ID }, ["soul_name"]);
    expect(await screen.findByLabelText(WITHHELD)).toBeInTheDocument();
    expect(screen.queryByText(SOUL_ID)).not.toBeInTheDocument();
  });

  it("does not say 已隐藏 when the key is there but null", async () => {
    renderPage({ soul: SOUL_ID, soul_name: null });
    await screen.findByText("先在彼处受罚");
    expect(screen.queryByLabelText(WITHHELD)).not.toBeInTheDocument();
  });
});
