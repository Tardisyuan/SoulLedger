/**
 * 「哪一个是选中的」不能只靠颜色说。
 *
 * 这个仓库有四条 tab 条,全部走 `PageShell` 的 `tabs` 槽,全部是朴素
 * `<button>`,选中的那个只在 `border-b-2` 的颜色和文字颜色上和别人不同。既没有
 * `aria-selected`,也没有 `aria-pressed`,也没有 `aria-current`。读屏用户听到的是
 * 两个一模一样的按钮,分不出当前在看哪一个视图。
 *
 * 同一类问题在导航是更重的一版:旧侧栏的项(当时的 `SidebarMenuItem`)把可见文字整个放在
 * `{!collapsed && …}` 里而**不给替代**,所以紧凑/轨道模式下整条主导航是一列
 * 没有可访问名称的 `<svg>`。
 *
 * 第三十批第 4 步起导航是门栏(`DoorRail`):门上的字与小字都 `aria-hidden`(一个「审」字读出来没有意义),
 * 名字在 `aria-label` 上 —— 正是旧侧栏那个缺陷会复发的地方。门内二级导航(`DoorTabs`)同理。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 为什么是 `aria-pressed` 而不是 `role="tab"`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 它们不是真的 tablist:没有 `tabpanel`,方向键也不在它们之间移动。声明了
 * `role` 却不兑现对应的键盘契约,正是这个仓库已经有三个实例的那个缺陷 ——
 * 见 `verification-mechanisms-fail-silently-here`。它们**是**一组「恰好一个
 * 打开」的开关,而 `aria-pressed` 说的正是这句真话。门内导航是链接,当前页用 `aria-current="page"`。
 *
 * 这个套件用渲染而不是扫文本:选中态是运行时算出来的,一条正则只能看到属性
 * 存在,看不到它跟着选中项走。
 *
 * 这里只放**导航**。四条 tab 条的断言写在它们各自已有的页面套件里
 * (`NotificationsPage.test.tsx` / `DashboardPage.test.tsx`)。
 */
import { render, screen, within } from "@testing-library/react";
import type { SidebarMenu } from "@/src/hooks/useSidebarMenus";

const mockPathname = jest.fn(() => "/souls");
jest.mock("next/navigation", () => ({
  usePathname: () => mockPathname(),
}));

jest.mock("@/src/contexts/I18nContext", () => require("./support/mocks").i18nMock({ locale: "zh-Hans", hydrated: true }));

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const mockUser = { role: "JUDGE", username: "cui", display_name: "崔珏", extra_roles: [] as string[] };
jest.mock("@/src/contexts/TenantContext", () => ({ useTenant: () => ({ user: mockUser }) }));
jest.mock("@/src/hooks/usePermissions", () => ({
  usePermissions: () => ({ isAdmin: false, hasPermission: (c: string) => c === "judgment.read" }),
}));
jest.mock("@/src/components/plaque/useHall", () => ({ useHallCivilization: () => "CHINESE" }));

function menu(over: Partial<SidebarMenu> & Pick<SidebarMenu, "id" | "name" | "path">): SidebarMenu {
  return { icon: null, order: 0, component: null, roles: [], is_active: true, parent: null, children: [], ...over };
}
const mockMenus: SidebarMenu[] = [
  menu({ id: 1, name: "灵魂管理", path: "/souls" }),
  menu({ id: 2, name: "功德管理", path: "/ledger" }),
  menu({ id: 3, name: "语料条文", path: "/corpus" }),
  menu({ id: 4, name: "领域管理", path: "/realms" }),
  menu({ id: 5, name: "动态", path: "/social" }),
];
jest.mock("@/src/hooks/useSidebarMenus", () => ({ useSidebarMenus: () => ({ data: mockMenus }) }));

import { DoorRail, DoorTabs } from "@/src/components/layout/DoorRail";

const rail = () => screen.getByTestId("door-rail");

describe("门栏:当前门不只靠文明色", () => {
  it("每一门都有名字,哪怕看得见的字被藏起来", () => {
    render(<DoorRail />);
    for (const name of ["caseDesk.rail.desk", "caseDesk.rail.souls", "caseDesk.rail.corpus"]) {
      expect(within(rail()).getByRole("link", { name })).toBeInTheDocument();
    }
    // Absence: the glyph is not the name (a lone 「审」 says nothing to a screen reader).
    expect(within(rail()).queryByRole("link", { name: "caseDesk.rail.desk_glyph" })).not.toBeInTheDocument();
  });

  it("当前门用 aria-current 说出来;别的门不挂", () => {
    render(<DoorRail />);
    expect(within(rail()).getByRole("link", { name: "caseDesk.rail.souls" })).toHaveAttribute("aria-current", "page");
    expect(within(rail()).getByRole("link", { name: "caseDesk.rail.desk" })).not.toHaveAttribute("aria-current");
    expect(within(rail()).getByRole("link", { name: "caseDesk.rail.corpus" })).not.toHaveAttribute("aria-current");
  });

  it("子页面(灵魂卷宗)点亮它所在的门", () => {
    mockPathname.mockReturnValueOnce("/souls/42");
    render(<DoorRail />);
    expect(within(rail()).getByRole("link", { name: "caseDesk.rail.souls" })).toHaveAttribute("aria-current", "page");
  });
});

describe("门内导航:当前页用 aria-current", () => {
  it("当前页挂 aria-current=page,同门的另一页不挂", () => {
    mockPathname.mockReturnValue("/ledger");
    render(<DoorTabs />);
    const tabs = screen.getByTestId("door-tabs");
    expect(within(tabs).getByRole("link", { name: "功德管理" })).toHaveAttribute("aria-current", "page");
    expect(within(tabs).getByRole("link", { name: "灵魂管理" })).not.toHaveAttribute("aria-current");
    mockPathname.mockReturnValue("/souls");
  });
});

describe("门外与借住(第三十六批 第一节第 4 条)", () => {
  afterEach(() => mockPathname.mockReturnValue("/souls"));

  it("判官的界域在「律」里,门内标签叫「冥界图」,不叫菜单名", () => {
    mockPathname.mockReturnValue("/realms");
    render(<DoorRail />);
    expect(within(rail()).getByRole("link", { name: "caseDesk.rail.corpus" })).toHaveAttribute("aria-current", "page");
    render(<DoorTabs />);
    const tabs = screen.getByTestId("door-tabs");
    expect(within(tabs).getByRole("link", { name: "overview.map.title" })).toHaveAttribute("aria-current", "page");
    expect(within(tabs).queryByRole("link", { name: "领域管理" })).toBeNull();
  });

  it.each(["/social", "/profile"])("%s:一门都不亮,没有门内标签行", (path) => {
    mockPathname.mockReturnValue(path);
    render(<DoorRail />);
    for (const link of within(rail()).getAllByRole("link")) {
      if (link.getAttribute("data-door")) expect(link).not.toHaveAttribute("aria-current");
    }
    render(<DoorTabs />);
    expect(screen.queryByTestId("door-tabs")).toBeNull();
  });

  it("「我」的页:底部头像挂 aria-current(样式给它 2px civT 的圈);朋友圈不挂", () => {
    mockPathname.mockReturnValue("/profile");
    const { unmount } = render(<DoorRail />);
    expect(within(rail()).getByRole("link", { name: "caseDesk.rail.me" })).toHaveAttribute("aria-current", "page");
    unmount();
    mockPathname.mockReturnValue("/social");
    render(<DoorRail />);
    expect(within(rail()).getByRole("link", { name: "caseDesk.rail.me" })).not.toHaveAttribute("aria-current");
  });
});
