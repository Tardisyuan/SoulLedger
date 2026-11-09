/**
 * 退出登录之后的「再会」(app/goodbye,2026-11-10):AppLayout 退出前留一张便条(名字 + 文明),
 * 再会页读一次就删;六秒后回首页。真 I18nProvider(zh-Hans),断言读者看到的字。
 */
import { act, render, screen } from "@testing-library/react";
import { I18nProvider } from "@/src/contexts/I18nContext";
import GoodbyePage, { GOODBYE_SECONDS } from "@/app/goodbye/page";
import { leaveGoodbye, readGoodbye } from "@/src/lib/goodbye";

const mockReplace = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ replace: mockReplace, push: jest.fn() }) }));
// 嵌彩徽记(按需加载的落地页模块)与这里断言的无关。
jest.mock("next/dynamic", () => () => function Emblem() {
  return <span data-testid="goodbye-emblem" />;
});

const page = () => render(<I18nProvider><GoodbyePage /></I18nProvider>);

beforeEach(() => {
  sessionStorage.clear();
  mockReplace.mockClear();
});

describe("the note", () => {
  it("is read once, then gone", () => {
    leaveGoodbye({ name: "崔判官", civ: "cn" });
    expect(readGoodbye()).toEqual({ name: "崔判官", civ: "cn" });
    expect(readGoodbye()).toBeNull();
  });

  it("drops a civilization it does not know and a blank name", () => {
    leaveGoodbye({ name: "  ", civ: "neutral" });
    expect(readGoodbye()).toEqual({ name: null, civ: null });
    sessionStorage.setItem("soulledger_goodbye", "{not json");
    expect(readGoodbye()).toBeNull();
  });
});

describe("the page", () => {
  it("says farewell by name, in the civilization's words", () => {
    leaveGoodbye({ name: "崔判官", civ: "cn" });
    page();
    expect(screen.getByRole("heading", { name: "再会，崔判官" })).toBeInTheDocument();
    expect(screen.getByText("灯已熄，簿已合。")).toBeInTheDocument();
    expect(screen.getByTestId("goodbye")).toHaveAttribute("data-civ", "cn");
    expect(screen.getByTestId("goodbye-emblem")).toBeInTheDocument();
  });

  it("without a note (refreshed, opened directly) it is neutral", () => {
    page();
    expect(screen.getByRole("heading", { name: "再会" })).toBeInTheDocument();
    expect(screen.getByText("簿已合上。")).toBeInTheDocument();
    expect(screen.getByTestId("goodbye")).not.toHaveAttribute("data-civ");
    expect(screen.queryByTestId("goodbye-emblem")).toBeNull();
  });

  it("counts down and goes home, and both ways out are links", () => {
    jest.useFakeTimers();
    try {
      page();
      expect(screen.getByRole("status")).toHaveTextContent(`${GOODBYE_SECONDS} 秒后回到首页`);
      expect(screen.getByRole("link", { name: "回到首页" })).toHaveAttribute("href", "/");
      expect(screen.getByRole("link", { name: "重新登录" })).toHaveAttribute("href", "/login");
      for (let i = 0; i < GOODBYE_SECONDS; i++) act(() => void jest.advanceTimersByTime(1000));
      expect(mockReplace).toHaveBeenCalledWith("/");
    } finally {
      jest.useRealTimers();
    }
  });
});
