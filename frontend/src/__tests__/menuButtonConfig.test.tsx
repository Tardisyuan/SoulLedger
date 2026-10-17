/**
 * `useMenuButtonConfig`(第四十批 W-b):关键按钮要「权限码允许且配置允许」才显示。
 *
 * - 没有配置行 = 允许(存量部署不丢按钮);取数中、取失败也按允许。
 * - 关掉的那一行只关它自己(按菜单 path + code),同 code 不同菜单不受牵连。
 * - 接上的按钮 id 互不重复,(菜单, code) 也互不重复 —— 否则一个开关管两个按钮。
 */
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useMenuButtonConfig } from "@/src/hooks/useMenuButtonConfig";
import { WIRED_BUTTONS, buttonKey, type WiredButtonId } from "@/src/lib/menuButtons";

jest.mock("@soulledger/core/api", () => ({ menuButtonsApi: { config: jest.fn() } }));
const { menuButtonsApi } = jest.requireMock("@soulledger/core/api") as { menuButtonsApi: { config: jest.Mock } };
jest.mock("@/src/contexts/TenantContext", () => ({ useTenant: () => ({ user: { id: 1, role: "ADMIN" } }) }));

function Probe({ ids }: { ids: WiredButtonId[] }) {
  const on = useMenuButtonConfig();
  return <p data-testid="probe">{ids.map((id) => `${id}=${on(id) ? "on" : "off"}`).join(" ")}</p>;
}

function renderProbe(ids: WiredButtonId[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Probe ids={ids} />
    </QueryClientProvider>,
  );
}

beforeEach(() => jest.clearAllMocks());

describe("useMenuButtonConfig", () => {
  it("关掉的只关它自己;没有行的照旧开着", async () => {
    menuButtonsApi.config.mockResolvedValue({
      data: [
        { id: 1, menu: 11, menu_path: "/souls", code: "export", is_active: false },
        { id: 2, menu: 12, menu_path: "/dispatch", code: "approve", is_active: true },
      ],
    });
    renderProbe(["souls.export", "dispatch.export", "dispatch.approve", "souls.create"]);
    await waitFor(() =>
      expect(screen.getByTestId("probe")).toHaveTextContent(
        "souls.export=off dispatch.export=on dispatch.approve=on souls.create=on",
      ),
    );
  });

  it("取数中与取失败都按允许", async () => {
    menuButtonsApi.config.mockRejectedValue(new Error("down"));
    renderProbe(["souls.create"]);
    expect(screen.getByTestId("probe")).toHaveTextContent("souls.create=on");
    await waitFor(() => expect(menuButtonsApi.config).toHaveBeenCalled());
    expect(screen.getByTestId("probe")).toHaveTextContent("souls.create=on");
  });

  it("接上的按钮:id 与 (菜单, code) 都不重复", () => {
    expect(WIRED_BUTTONS.length).toBeGreaterThan(5);
    expect(new Set(WIRED_BUTTONS.map((b) => b.id)).size).toBe(WIRED_BUTTONS.length);
    expect(new Set(WIRED_BUTTONS.map((b) => buttonKey(b.menu, b.code))).size).toBe(WIRED_BUTTONS.length);
  });
});
