/**
 * 「哪一个是选中的」不能只靠颜色说。
 *
 * 这个仓库有四条 tab 条,全部走 `PageShell` 的 `tabs` 槽,全部是朴素
 * `<button>`,选中的那个只在 `border-b-2` 的颜色和文字颜色上和别人不同。既没有
 * `aria-selected`,也没有 `aria-pressed`,也没有 `aria-current`。读屏用户听到的是
 * 两个一模一样的按钮,分不出当前在看哪一个视图。
 *
 * 同一类问题在侧栏是更重的一版:`SidebarMenuItem` 把可见文字整个放在
 * `{!collapsed && …}` 里而**不给替代**,所以紧凑/轨道模式下整条主导航是一列
 * 没有可访问名称的 `<svg>`。改动之前这个文件里
 * `aria-label|title=|aria-current` 的计数是 **0**。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 为什么是 `aria-pressed` 而不是 `role="tab"`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 它们不是真的 tablist:没有 `tabpanel`,方向键也不在它们之间移动。声明了
 * `role` 却不兑现对应的键盘契约,正是这个仓库已经有三个实例的那个缺陷 ——
 * 见 `verification-mechanisms-fail-silently-here`。它们**是**一组「恰好一个
 * 打开」的开关,而 `aria-pressed` 说的正是这句真话。
 * `components/ui/data-grid/FilterBar.tsx:181` 早就是这么写的。
 *
 * 这个套件用渲染而不是扫文本:选中态是运行时算出来的,一条正则只能看到属性
 * 存在,看不到它跟着选中项走 —— 而 `aria-pressed={false}` 写死在四个按钮上
 * 会让正则满意,同时什么都没修好。
 *
 * 这里只放**侧栏**。四条 tab 条的断言写在它们各自已有的页面套件里
 * (`NotificationsPage.test.tsx` / `DashboardPage.test.tsx`),因为在那里断言的
 * 是真页面;`app/social` 与 `app/social/follows` 目前没有页面套件,所以那两条
 * **没有覆盖** —— 写在这里,而不是拿一个我自己写对的合成 tab 条冒充覆盖。
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { SidebarMenuItem } from "@/src/components/layout/SidebarMenuItem";
import type { SidebarMenu } from "@/src/hooks/useSidebarMenus";

const mockPathname = jest.fn(() => "/souls");
jest.mock("next/navigation", () => ({
  usePathname: () => mockPathname(),
}));

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({ t: (key: string) => key, locale: "en", hydrated: true }),
}));

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

/**
 * 从真类型建,不手写一个「够用」的对象字面量。
 *
 * 第一版把每个 fixture 写成 `{ id, name, path, icon, children }` —— jest 绿而
 * `tsc` 红:`SidebarMenu` 还要 `order` / `component` / `roles` / `is_active` /
 * `parent`。一个少了五个字段的替身,是在拿一个真实数据里不存在的形状喂组件。
 */
function menu(over: Partial<SidebarMenu> & Pick<SidebarMenu, "id" | "name" | "path">): SidebarMenu {
  return {
    icon: null,
    order: 0,
    component: null,
    roles: [],
    is_active: true,
    parent: null,
    children: [],
    ...over,
  };
}

const LEAF = menu({ id: 1, name: "灵魂", path: "/souls", icon: "Users" });
const OTHER = menu({ id: 2, name: "审判", path: "/judgment", icon: "Scale" });
const PARENT = menu({
  id: 3,
  name: "设置",
  path: "/settings",
  icon: "Settings",
  children: [menu({ id: 4, name: "菜单", path: "/menus", icon: "List" })],
});

describe("折叠侧栏:图标不是名字", () => {
  it("折叠时每一项仍然有可访问名称", () => {
    render(<SidebarMenuItem menu={LEAF} collapsed />);

    // 缺席断言在这条里是主角:改动前这里**没有任何**可访问名称,
    // `getByRole("link", { name })` 是唯一能区分「名字在」和「名字不在」的问法
    // ——按可见文字找会在展开态误绿。
    expect(screen.getByRole("link", { name: "灵魂" })).toBeInTheDocument();
    // 而可见文字确实不在:这条同时钉住「折叠仍然是折叠」,免得把名字加回去
    // 变成把布局改回去。
    expect(screen.queryByText("灵魂")).not.toBeInTheDocument();
  });

  it("展开时名称也在,而不是只在折叠时才补", () => {
    render(<SidebarMenuItem menu={LEAF} collapsed={false} />);
    expect(screen.getByRole("link", { name: "灵魂" })).toBeInTheDocument();
  });

  it("当前页用 aria-current 说出来,不只靠底色", () => {
    render(<SidebarMenuItem menu={LEAF} collapsed={false} />);
    expect(screen.getByRole("link", { name: "灵魂" })).toHaveAttribute("aria-current", "page");
  });

  it("不是当前页的就不许挂 aria-current", () => {
    render(<SidebarMenuItem menu={OTHER} collapsed={false} />);
    expect(screen.getByRole("link", { name: "审判" })).not.toHaveAttribute("aria-current");
  });

  it("折叠时有子项的那个按钮也仍然有名字", () => {
    // 上一条不能替代这条:展开态下按钮里有可见文字「设置」,
    // `getByRole("button", { name: "设置" })` 靠内容就能找到它 —— 实测把
    // `aria-label` 从按钮上删掉,那一条依然绿。折叠态没有可见文字,所以
    // `aria-label` 是唯一的名字来源,这条才真的在检验它。
    render(<SidebarMenuItem menu={PARENT} collapsed />);

    expect(screen.getByRole("button", { name: "设置" })).toBeInTheDocument();
    expect(screen.queryByText("设置")).not.toBeInTheDocument();
  });

  it("有子项的那个按钮报告自己的展开状态", () => {
    render(<SidebarMenuItem menu={PARENT} collapsed={false} />);

    const toggle = screen.getByRole("button", { name: "设置" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });
});
