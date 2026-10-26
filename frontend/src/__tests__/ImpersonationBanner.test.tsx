/**
 * 代看固定条(W6):名字、殿 · 角色、理由、等宽倒计时、退出查看;到点自动退出;写类控件置灰而读类不置灰。
 * 状态走真实的 core 模块与 jsdom 的 sessionStorage(刷新、换页都保留的那条路径)。
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { ImpersonationBanner } from "@/src/components/impersonation/ImpersonationBanner";
import { leaveImpersonation } from "@/src/components/impersonation/wireImpersonation";
import { IMPERSONATION_KEY } from "@soulledger/core/api/impersonation";

jest.mock("@/src/components/impersonation/wireImpersonation", () => ({
  leaveImpersonation: jest.fn(),
  wireImpersonation: jest.fn(),
}));

const COPY: Record<string, string> = {
  "users.roles.JUDGE": "审判者",
  "admin.impersonate.banner": "正在以 {{name}} 的身份查看",
  "admin.impersonate.reason_line": "理由：{{reason}}",
  "admin.impersonate.remaining": "剩 {{time}}",
  "admin.impersonate.readonly": "只读",
  "admin.impersonate.exit": "退出查看",
  "admin.impersonate.locked": "查看中，不能操作",
  "halls.viewing.banner": "正在以全局管理员身份查看{{name}}",
  "halls.viewing.back": "回到各殿概况",
};
jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    locale: "zh-Hans",
    hydrated: true,
    t: (key: string, params?: Record<string, string>) =>
      Object.entries(params ?? {}).reduce((s, [k, v]) => s.replace(`{{${k}}}`, v), COPY[key] ?? key),
  }),
}));

jest.mock("@/src/hooks/usePermissions", () => ({
  usePermissions: () => ({
    hasAnyPermission: () => true,
    hasPermission: () => true,
    hasAllPermissions: () => true,
    permissions: [],
  }),
}));

function view(expiresInMs: number) {
  sessionStorage.setItem(
    IMPERSONATION_KEY,
    JSON.stringify({
      id: 7,
      target: { id: 3, name: "孟婆", role: "JUDGE", hall: { "zh-Hans": "第十殿" } },
      reason: "她说看不到「移交」菜单",
      expiresAt: Date.now() + expiresInMs,
      adminAccess: "admin-token",
    })
  );
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  sessionStorage.clear();
});
afterEach(() => {
  jest.useRealTimers();
  sessionStorage.clear();
});

describe("代看固定条", () => {
  it("写明是谁(殿 · 角色)、理由、倒计时和退出;点退出走收场", () => {
    view(26 * 60_000 + 41_000);
    render(<ImpersonationBanner />);

    const banner = screen.getByTestId("impersonation-banner");
    expect(banner).toHaveTextContent("只读");
    expect(banner).toHaveTextContent("正在以 孟婆(第十殿 · 审判者) 的身份查看");
    expect(banner).toHaveTextContent("理由：她说看不到「移交」菜单");
    expect(screen.getByTestId("impersonation-countdown")).toHaveTextContent("剩 26:41");
    expect(screen.getByTestId("impersonation-countdown").className).toContain("font-mono");
    // 不能收起:没有任何关闭 / 收起控件,只有退出查看一个按钮。
    expect(banner.querySelectorAll("button")).toHaveLength(1);

    fireEvent.click(screen.getByTestId("impersonation-exit"));
    expect(leaveImpersonation).toHaveBeenCalledTimes(1);
  });

  it("倒计时走字,到点自动退出;没到点不退出", () => {
    view(3_000);
    render(<ImpersonationBanner />);
    act(() => void jest.advanceTimersByTime(1_000));
    expect(screen.getByTestId("impersonation-countdown")).toHaveTextContent("剩 00:02");
    expect(leaveImpersonation).not.toHaveBeenCalled();

    act(() => void jest.advanceTimersByTime(2_500));
    expect(leaveImpersonation).toHaveBeenCalledTimes(1);
  });

  it("没有在看时什么都不画", () => {
    render(<ImpersonationBanner />);
    expect(screen.queryByTestId("impersonation-banner")).toBeNull();
  });
});

describe("进殿查看(第五十四批 O-2)", () => {
  function enterHall() {
    sessionStorage.setItem(
      IMPERSONATION_KEY,
      JSON.stringify({
        id: 9,
        target: { id: 0, name: "", role: "ADMIN", hall: { "zh-Hans": "酆都第十殿" } },
        reason: "",
        expiresAt: Date.now() + 60_000,
        adminAccess: "admin-token",
        hallView: { code: "CN_DIYU" },
      })
    );
  }

  it("说看的是哪一殿、退出写「回到各殿概况」;没有理由、没有被看的人", () => {
    enterHall();
    render(<ImpersonationBanner />);
    const banner = screen.getByTestId("impersonation-banner");
    expect(banner).toHaveTextContent("正在以全局管理员身份查看酆都第十殿");
    expect(banner).not.toHaveTextContent("理由");
    expect(banner).not.toHaveTextContent("的身份查看");
    expect(screen.getByTestId("impersonation-exit")).toHaveTextContent("回到各殿概况");
    fireEvent.click(screen.getByTestId("impersonation-exit"));
    expect(leaveImpersonation).toHaveBeenCalledTimes(1);
  });

  it("写类控件照样置灰", () => {
    enterHall();
    render(
      <RequirePermission permissions="soul.create">
        <button type="button">go</button>
      </RequirePermission>
    );
    expect(screen.getByText("go").closest("[inert]")).not.toBeNull();
  });
});

describe("写类控件置灰", () => {
  const gated = (permission: string) => (
    <RequirePermission permissions={permission}>
      <button type="button">go</button>
    </RequirePermission>
  );

  it("代看时按权限闸住的写按钮不可点、带提示;读类权限不受影响", () => {
    view(60_000);
    const { container } = render(
      <>
        {gated("soul.create")}
        {gated("soul.read")}
      </>
    );
    const [write, read] = screen.getAllByText("go");
    expect(write.closest("[inert]")).not.toBeNull();
    expect(write.closest("[data-viewing-lock]")).toHaveAttribute("title", "查看中，不能操作");
    expect(read.closest("[inert]")).toBeNull();
    expect(container.querySelectorAll("[data-viewing-lock]")).toHaveLength(1);
  });

  it("没有在代看时按钮原样,没有任何置灰包裹", () => {
    const { container } = render(gated("soul.create"));
    expect(screen.getByText("go").closest("[inert]")).toBeNull();
    expect(container.querySelector("[data-viewing-lock]")).toBeNull();
  });
});
