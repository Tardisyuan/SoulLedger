/**
 * 规范 v3 外框的导航:用户选的模式与它的三条约束、文明色只落在当前项上、图标来自数据。
 *
 * 决定(2026-10-01,用户拍板):
 *   - ≥ 1200 导航展开 252 / 收起 68 由用户选,存在 `localStorage["soulledger-nav-mode"]`,
 *     `[` 切换(焦点在输入框里不算);769–1199 强制收起,开合按钮还在但不可用,并说出原因;
 *   - `--color-main` 只出现在当前项上:3px 左标 + 8% 混进 surface-1 的底;
 *   - 图标按 `menu.icon`(lucide 名)画,不认得就是中性方块,不按路径写死。
 *
 * jsdom 没有排版、没有 matchMedia:宽度靠给 `window.matchMedia` 打桩来说;
 * 宽度、过渡这类只有浏览器答得了的,在 E2E 与截图里看,这里不声称。
 */
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as lucide from "lucide-react";
import type { SidebarMenu } from "@/src/hooks/useSidebarMenus";

const MESSAGES: Record<string, string> = {
  "nav.expand_menu": "展开菜单",
  "nav.collapse_menu": "收起菜单",
  "nav.collapse_locked": "窗口宽度不足 1200 像素,导航固定收起",
  "judgment.case_number": "案号",
};

jest.mock("@/src/contexts/I18nContext", () => ({
  LOCALE_LABELS: { "zh-Hans": "简体中文", en: "English", egy: "Kemet" },
  useI18n: () => ({
    t: (key: string) => MESSAGES[key] ?? key,
    locale: "zh-Hans",
    hydrated: true,
    formatDate: (v: unknown) => String(v),
    formatDateTime: (v: unknown) => String(v),
  }),
}));
jest.mock("@/src/contexts/ThemeContext", () => ({ useTheme: () => ({ theme: "light", toggleTheme: jest.fn() }) }));
let mockUser: { username: string; display_name: string; role: string } | null = null;
jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: mockUser, tenantCode: "CN", logout: jest.fn() }),
}));
const mockPathname = jest.fn(() => "/menus");
jest.mock("next/navigation", () => ({
  usePathname: () => mockPathname(),
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
}));
jest.mock("@soulledger/core/api", () => ({
  notificationsApi: { list: jest.fn().mockResolvedValue({ data: { count: 0, results: [] } }) },
  authApi: { logout: jest.fn().mockResolvedValue({}) },
}));
jest.mock("@/src/components/connection-status", () => ({
  ConnectionBanner: () => null,
  useConnectionBannerShown: () => false,
}));

function menu(over: Partial<SidebarMenu> & Pick<SidebarMenu, "id" | "name" | "path">): SidebarMenu {
  return { icon: null, order: 0, component: null, roles: [], is_active: true, parent: null, children: [], ...over };
}
const MENUS: SidebarMenu[] = [
  menu({ id: 1, name: "概览", path: "/dashboard", icon: "LayoutDashboard" }),
  menu({ id: 2, name: "灵魂", path: "/souls", icon: "users" }),
  menu({
    id: 3,
    name: "系统设置",
    path: "",
    icon: "Settings",
    menu_type: "DIRECTORY",
    children: [
      menu({ id: 4, name: "菜单", path: "/menus", icon: null }),
      menu({ id: 5, name: "Sekhem Tepy Em Djeret", path: "/soul-credentials", icon: null }),
    ],
  }),
  menu({
    id: 6,
    name: "审计",
    path: "",
    icon: "NoSuchIcon",
    menu_type: "DIRECTORY",
    children: [menu({ id: 7, name: "日志", path: "/audit" })],
  }),
];
jest.mock("@/src/hooks/useSidebarMenus", () => ({
  ...jest.requireActual("@/src/hooks/useSidebarMenus"),
  useSidebarMenus: () => ({ data: MENUS }),
}));

import { AppLayout } from "@/src/components/layout/AppLayout";
import { GlobalNav, NAV_MODE_KEY, iconResolver } from "@/src/components/layout/GlobalNav";
import { usePlaque } from "@/src/components/plaque/Plaque";

const ALL_PATHS = ["/dashboard", "/souls", "/menus", "/soul-credentials", "/audit"];

function Nav({ collapsed = false, currentId = 3 }: { collapsed?: boolean; currentId?: number | null }) {
  const [openId, setOpenId] = useState<number | null>(currentId);
  return (
    <GlobalNav
      menus={MENUS}
      allMenuPaths={ALL_PATHS}
      currentId={currentId}
      openId={openId}
      onToggle={(id) => setOpenId((o) => (o === id ? null : id))}
      collapsed={collapsed}
    />
  );
}

function renderLayout() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return render(<AppLayout>page body</AppLayout>, { wrapper: Wrapper });
}

/** 769–1199 与 ≥ 1200 两种宽度;GlobalNav 只问 `(max-width: 1199.98px)`。 */
function setViewport(width: number) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => {
      const max = /max-width:\s*([\d.]+)px/.exec(query);
      const min = /min-width:\s*([\d.]+)px/.exec(query);
      const matches = (max ? width <= Number(max[1]) : true) && (min ? width >= Number(min[1]) : true);
      return { matches, media: query, addEventListener: () => {}, removeEventListener: () => {} };
    },
  });
}

const nav = () => screen.getByTestId("global-nav");
const toggle = () => screen.getByTestId("nav-toggle");

beforeEach(() => {
  window.localStorage.clear();
  mockPathname.mockReturnValue("/menus");
  delete (window as { matchMedia?: unknown }).matchMedia;
});

describe("导航模式:≥ 1200 由用户选,并且记住", () => {
  beforeEach(() => setViewport(1440));

  it("默认展开;按钮切到收起,写进 localStorage,再按回到展开", () => {
    renderLayout();
    expect(nav()).not.toHaveAttribute("data-collapsed");
    expect(toggle()).toHaveAccessibleName("收起菜单");

    fireEvent.click(toggle());
    expect(nav()).toHaveAttribute("data-collapsed", "true");
    expect(window.localStorage.getItem(NAV_MODE_KEY)).toBe("collapsed");
    expect(toggle()).toHaveAccessibleName("展开菜单");

    fireEvent.click(toggle());
    expect(nav()).not.toHaveAttribute("data-collapsed");
    expect(window.localStorage.getItem(NAV_MODE_KEY)).toBe("expanded");
  });

  it("上次存的「收起」在下一次打开时生效", () => {
    window.localStorage.setItem(NAV_MODE_KEY, "collapsed");
    renderLayout();
    expect(nav()).toHaveAttribute("data-collapsed", "true");
  });

  it("`[` 切换;焦点在输入框里、或带修饰键时不切", () => {
    const { container } = renderLayout();
    fireEvent.keyDown(document.body, { key: "[" });
    expect(nav()).toHaveAttribute("data-collapsed", "true");

    const input = document.createElement("input");
    container.appendChild(input);
    fireEvent.keyDown(input, { key: "[" });
    expect(nav()).toHaveAttribute("data-collapsed", "true");

    const editable = document.createElement("div");
    editable.contentEditable = "true";
    Object.defineProperty(editable, "isContentEditable", { value: true });
    container.appendChild(editable);
    fireEvent.keyDown(editable, { key: "[" });
    fireEvent.keyDown(document.body, { key: "[", ctrlKey: true });
    expect(nav()).toHaveAttribute("data-collapsed", "true");

    fireEvent.keyDown(document.body, { key: "[" });
    expect(nav()).not.toHaveAttribute("data-collapsed");
  });

  it("localStorage 抛错(隐私窗口)时照样能切,只是不记住", () => {
    const get = jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const set = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    try {
      renderLayout();
      fireEvent.click(toggle());
      expect(nav()).toHaveAttribute("data-collapsed", "true");
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });
});

describe("769–1199:强制收起,按钮在而不可用,并说出原因", () => {
  beforeEach(() => setViewport(1024));

  it("存的是「展开」也收起;按钮 aria-disabled,名字与 title 都是原因;点它、按 `[` 都不改变", () => {
    window.localStorage.setItem(NAV_MODE_KEY, "expanded");
    renderLayout();
    expect(nav()).toHaveAttribute("data-collapsed", "true");

    const button = toggle();
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAccessibleName("窗口宽度不足 1200 像素,导航固定收起");
    expect(button).toHaveAttribute("title", "窗口宽度不足 1200 像素,导航固定收起");
    // Disabled = grey fill + grey text (规范 v3), not just a cursor.
    expect(button.className).toContain("bg-[oklch(var(--color-disabled-surface))]");
    expect(button.className).toContain("text-[oklch(var(--color-disabled-ink))]");

    // One at a time: a click and a `[` that each toggled would cancel out.
    fireEvent.click(button);
    expect(nav()).toHaveAttribute("data-collapsed", "true");
    expect(window.localStorage.getItem(NAV_MODE_KEY)).toBe("expanded");
    fireEvent.keyDown(document.body, { key: "[" });
    expect(nav()).toHaveAttribute("data-collapsed", "true");
    expect(window.localStorage.getItem(NAV_MODE_KEY)).toBe("expanded");
  });

  it("≥ 1200 时同一个按钮没有 aria-disabled(断言不在场)", () => {
    setViewport(1200);
    renderLayout();
    expect(toggle()).not.toHaveAttribute("aria-disabled");
    expect(nav()).not.toHaveAttribute("data-collapsed");
  });
});

describe("文明色只落在当前项上", () => {
  /** 导航里每个读 `--color-main` 的元素。 */
  const mainReaders = () => Array.from(nav().querySelectorAll<HTMLElement>("*")).filter((el) => /--color-main/.test(el.getAttribute("class") ?? ""));

  it("展开:恰好两处 —— 当前二级项的 8% 底,和它里面的 3px 左标", () => {
    render(<Nav />);
    const current = screen.getByRole("link", { name: "菜单" });
    expect(current).toHaveAttribute("aria-current", "page");
    const mark = within(current).getByTestId("nav-current-mark");

    expect(mainReaders()).toEqual([current, mark]);
    expect(current.className).toContain("bg-[color-mix(in_oklab,oklch(var(--color-main))_8%,oklch(var(--color-surface-1)))]");
    expect(current.className).toContain("font-semibold");
    expect(current.className).toContain("text-[oklch(var(--color-ink))]");
    expect(mark.className).toContain("w-[3px]");
    expect(mark.className).toContain("bg-[oklch(var(--color-main))]");
    // Absence: the group that holds it, its sibling, the leaves and the nav itself stay neutral.
    expect(screen.getByRole("button", { name: "系统设置" }).className).not.toContain("--color-main");
    expect(screen.getByRole("link", { name: "Sekhem Tepy Em Djeret" }).className).not.toContain("--color-main");
    expect(nav().className).not.toContain("--color-main");
    expect(nav().className).toContain("bg-[oklch(var(--color-surface-1))]");
  });

  it("收起:子项藏起来了,当前态落在它那一组的图标上 —— 仍然只有底与左标两处", () => {
    render(<Nav collapsed />);
    const group = screen.getByRole("button", { name: "系统设置" });
    expect(group).toHaveAttribute("aria-current", "true");
    expect(mainReaders()).toEqual([group, within(group).getByTestId("nav-current-mark")]);
  });

  it("当前页不在菜单里时,导航里一处 `--color-main` 都没有", () => {
    render(<Nav currentId={null} />);
    expect(mainReaders()).toEqual([]);
  });
});

describe("收起的分组仍然够得着它的页面", () => {
  it("点组图标打开浮出层,列出这组的页面;点页面关掉浮出层", async () => {
    render(<Nav collapsed currentId={null} />);
    expect(screen.queryByRole("link", { name: "日志" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "审计" }));
    const flyout = await screen.findByTestId("nav-flyout");
    const page = within(flyout).getByRole("link", { name: "日志" });
    expect(page).toHaveAttribute("href", "/audit");

    fireEvent.click(page);
    await waitFor(() => expect(screen.queryByTestId("nav-flyout")).not.toBeInTheDocument());
  });
});

describe("手风琴:同一时刻只开一组,当前页所在组默认打开", () => {
  it("AppLayout 里打开另一组会收起这一组", () => {
    setViewport(1440);
    renderLayout();
    const settings = within(nav()).getByRole("button", { name: "系统设置" });
    const audit = within(nav()).getByRole("button", { name: "审计" });
    expect(settings).toHaveAttribute("aria-expanded", "true");
    expect(audit).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(audit);
    expect(audit).toHaveAttribute("aria-expanded", "true");
    expect(settings).toHaveAttribute("aria-expanded", "false");
    expect(within(nav()).queryByRole("link", { name: "菜单" })).not.toBeInTheDocument();
  });
});

describe("图标来自 menu.icon", () => {
  it("每一项的图标就是它自己 `icon` 字段里的名字,不认得的落回中性方块", async () => {
    render(<Nav />);
    const iconOf = (el: HTMLElement) => el.querySelector<HTMLElement>("[data-icon]");
    const dashboard = iconOf(screen.getByRole("link", { name: "概览" }))!;
    const souls = iconOf(screen.getByRole("link", { name: "灵魂" }))!;
    const unknown = iconOf(screen.getByRole("button", { name: "审计" }))!;
    expect(dashboard).toHaveAttribute("data-icon", "LayoutDashboard");
    expect(souls).toHaveAttribute("data-icon", "users");

    // lucide 的 svg 自带 `lucide-<kebab>` 类:画的确实是那个图标,不是随便一个。
    await waitFor(() => expect(dashboard.querySelector("svg.lucide-layout-dashboard")).not.toBeNull());
    expect(souls.querySelector("svg.lucide-users")).not.toBeNull();
    expect(unknown.querySelector("svg")).toBeNull();
    expect(within(unknown).getByTestId("nav-icon-fallback")).toBeInTheDocument();
  });

  it("解析:导出名、别名、kebab 都认;非图标导出与空值不认", () => {
    const resolve = iconResolver(lucide);
    expect(resolve("LayoutDashboard")).toBe(lucide.LayoutDashboard);
    expect(resolve("Building2")).toBe(lucide.Building2);
    expect(resolve("users")).toBe(lucide.Users);
    expect(resolve("layout-dashboard")).toBe(lucide.LayoutDashboard);
    expect(resolve("Icon")).toBeNull();
    expect(resolve("createLucideIcon")).toBeNull();
    expect(resolve("NoSuchIcon")).toBeNull();
    expect(resolve(null)).toBeNull();
    expect(resolve("")).toBeNull();
  });
});

describe("长标签(egy)在 252 里截断,全文在 title", () => {
  it("21 个字符的标签:单行截断类 + title 是全文", () => {
    render(<Nav />);
    const label = within(screen.getByRole("link", { name: "Sekhem Tepy Em Djeret" })).getByText("Sekhem Tepy Em Djeret");
    expect(label).toHaveAttribute("title", "Sekhem Tepy Em Djeret");
    expect(label.className).toMatch(/(^|\s)truncate(\s|$)/);
    expect(label.className).toMatch(/(^|\s)min-w-0(\s|$)/);
  });
});

// 身份带的题字 / 殿名 / 右栏由页面经 `usePlaque` 给(用户 2026-10-02);没给就是面包屑末段。
describe("usePlaque:页面给身份带的题字", () => {
  function Page({ text }: { text: { title?: string; meta?: string; hall?: string; caseNumber?: string } }) {
    usePlaque(text);
    return <>page body</>;
  }
  function renderWith(children: ReactNode) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const Wrapper = ({ children: c }: { children: ReactNode }) => <QueryClientProvider client={client}>{c}</QueryClientProvider>;
    return render(<AppLayout>{children}</AppLayout>, { wrapper: Wrapper });
  }
  const band = () => screen.getByTestId("plaque");
  const title = () => band().querySelector("[data-tier]");

  it("没有页面报题字时,题字是面包屑末段,右栏不画", () => {
    renderWith("page body");
    expect(title()).toHaveTextContent("菜单");
    expect(band().querySelector(".identity-case")).toBeNull();
  });

  it("页面报的题字、殿名、右栏取代默认;页面离开后还给面包屑", () => {
    const { rerender } = renderWith(<Page text={{ title: "审批实例", meta: "生死簿复核 v3 · 第 4 / 6 步", hall: "酆都 · 第三殿" }} />);
    expect(title()).toHaveTextContent("审批实例");
    expect(title()).not.toHaveTextContent("菜单");
    expect(band().querySelector(".identity-case")).toHaveTextContent("生死簿复核 v3 · 第 4 / 6 步");
    expect(band().querySelector(".identity-court")).toHaveTextContent("酆都 · 第三殿");

    rerender(<AppLayout>page body</AppLayout>);
    expect(title()).toHaveTextContent("菜单");
    expect(band().querySelector(".identity-case")).toBeNull();
    expect(band().querySelector(".identity-court")).toBeNull();
  });

  it("案号槽:右栏是「案号」小字 + 可复制的整串,不画 meta;收起与手机档都保留(data-case)", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderWith(<Page text={{ title: "审判台", meta: "不该出现", caseNumber: "CN-2026-0042" }} />);
    const slot = band().querySelector(".identity-case") as HTMLElement;
    expect(slot).toHaveAttribute("data-case");
    expect(slot).toHaveTextContent(/^案号CN-2026-0042 ⧉$/);
    expect(slot).not.toHaveTextContent("不该出现");
    // 这份 t 不代参数:读屏名是 key 本身,案号由 data-case-number 认。
    const chip = within(slot).getByRole("button", { name: "common.value.copy_case_number" });
    expect(chip).toHaveAttribute("data-case-number", "CN-2026-0042");
    expect(chip).toHaveAttribute("data-identifier-variant", "band");
    fireEvent.click(chip);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("CN-2026-0042"));
  });

  it("只报右栏、题字留空(数据没到)时,题字仍是面包屑末段", () => {
    renderWith(<Page text={{ title: undefined, meta: "在押 3" }} />);
    expect(title()).toHaveTextContent("菜单");
    expect(band().querySelector(".identity-case")).toHaveTextContent("在押 3");
  });
});

describe("用户菜单的每一项都是 44 的点击区", () => {
  afterEach(() => {
    mockUser = null;
  });

  it("主题 / 设置 / 关于 / 退出:min-h 是 --control-h-sm(44),不再是 min-h-8(32)", async () => {
    mockUser = { username: "yama", display_name: "阎罗", role: "ADMIN" };
    renderLayout();
    fireEvent.click(screen.getByTestId("user-menu"));
    const labels = await Promise.all(
      ["settings.theme", "nav.settings", "about.title", "auth.logout"].map((k) => screen.findByText(k)),
    );
    for (const label of labels) {
      const control = label.closest("button, a") as HTMLElement;
      expect(control.className).toContain("min-h-(--control-h-sm)");
      expect(control.className).not.toContain("min-h-8");
    }
  });
});

describe("品牌位(A9 §一):天平标加「灵魂簿」,文明印不在导航里", () => {
  const brand = () => nav().querySelector("[data-nav-brand]") as HTMLElement;

  it("展开:标 24 宽、对读屏隐藏,旁边的字说名字;没有印、没有「SoulLedger」那一行", () => {
    render(<Nav />);
    const mark = brand().querySelector("svg[data-brand-mark]") as SVGElement;
    expect(mark).toHaveAttribute("width", "24");
    expect(mark).toHaveAttribute("aria-hidden", "true");
    const paths = Array.from(mark.querySelectorAll("path"));
    expect(paths).toHaveLength(3);
    for (const p of paths) expect(p).toHaveAttribute("fill-rule", "evenodd");
    expect(brand()).toHaveTextContent(/^灵魂簿$/);
    expect(within(nav()).queryByTestId("seal")).toBeNull();
    expect(within(nav()).queryByText("SoulLedger")).toBeNull();
  });

  it("收起:只留标,标自己带名字", () => {
    render(<Nav collapsed />);
    expect(brand().textContent).toBe("");
    expect(within(brand()).getByRole("img", { name: "灵魂簿" })).toBeInTheDocument();
  });
});

