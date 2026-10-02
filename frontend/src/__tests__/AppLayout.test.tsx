/**
 * Tests for the "bilingual chrome" pieces of AppLayout (Stage 6):
 *
 * 1. isMenuPathActive — DIRECTORY menu items have an empty-string `path`
 *    (see backend/apps/menus/models.py:28); the sidebar must never treat
 *    an empty path as "active", or every top-level group lights up on
 *    every single route.
 * 2. menuGlossParts — the "译名 中文原名" pairing shown in the breadcrumb
 *    and page H1s when the active locale differs from the (permanently
 *    Chinese) menu name stored in the DB.
 * 3. Breadcrumb — renders the pairing end-to-end for a matched menu trail.
 */
import { render, screen } from "@testing-library/react";
import { isMenuPathActive } from "@/src/lib/menuPath";
import { menuGlossParts } from "@/src/lib/menuI18n";
import type { SidebarMenu } from "@/src/hooks/useSidebarMenus";

describe("isMenuPathActive", () => {
  it("never treats an empty path (DIRECTORY groups) as active, regardless of route", () => {
    expect(isMenuPathActive("/audit", "")).toBe(false);
    expect(isMenuPathActive("/", "")).toBe(false);
    expect(isMenuPathActive("/dashboard", "")).toBe(false);
  });

  it("matches an exact path", () => {
    expect(isMenuPathActive("/audit", "/audit")).toBe(true);
  });

  it("matches a nested route under the menu path", () => {
    expect(isMenuPathActive("/souls/42", "/souls")).toBe(true);
  });

  it("一条路由只点亮一项:更具体的菜单存在时,祖先不亮", () => {
    // `/social` 与 `/social/follows` 都是菜单项,而 `startsWith` 让两者
    // **同时高亮**。侧边栏同时点亮两项,读起来像是不知道自己在哪一页。
    const paths = ["/social", "/social/follows", "/souls"];
    expect(isMenuPathActive("/social/follows", "/social", paths)).toBe(false);
    expect(isMenuPathActive("/social/follows", "/social/follows", paths)).toBe(true);
  });

  it("**断存在。** 没有更具体菜单时,详情页仍然点亮它的列表页", () => {
    // 只断「祖先不亮」的修法(比如「只有分组才做祖先高亮」)会让这一条红:
    // `/souls` 是叶子,而 `/souls/42` 应该点亮它。
    const paths = ["/social", "/social/follows", "/souls"];
    expect(isMenuPathActive("/souls/42", "/souls", paths)).toBe(true);
  });

  it("祖先仍然只在真的是祖先时才亮", () => {
    const paths = ["/social", "/social/follows"];
    expect(isMenuPathActive("/socialise", "/social", paths)).toBe(false);
  });

  it("does not match a sibling path that merely shares a prefix", () => {
    // /social must not light up for /social-other or vice versa.
    expect(isMenuPathActive("/social-other", "/social")).toBe(false);
    expect(isMenuPathActive("/social", "/social/follows")).toBe(false);
  });

  it("does not match an unrelated route", () => {
    expect(isMenuPathActive("/dashboard", "/audit")).toBe(false);
  });
});

const t = (map: Record<string, string>) => (key: string) => map[key] ?? key;

describe("menuGlossParts", () => {
  const auditLeaf: Pick<SidebarMenu, "path" | "name" | "menu_type"> = {
    path: "/audit",
    name: "审计日志",
    menu_type: "MENU",
  };

  const settingsGroup: Pick<SidebarMenu, "path" | "name" | "menu_type"> = {
    path: "",
    name: "系统设置",
    menu_type: "DIRECTORY",
  };

  it("shows the raw Chinese name with no gloss under zh-Hans", () => {
    const result = menuGlossParts(
      auditLeaf,
      "zh-Hans",
      t({ "breadcrumb.menu.audit": "Audit Log" })
    );
    expect(result).toEqual({ primary: "审计日志" });
  });

  it("pairs translated label (primary) with the Chinese DB name (gloss) under a foreign locale", () => {
    const result = menuGlossParts(
      auditLeaf,
      "en",
      t({ "breadcrumb.menu.audit": "Audit Log" })
    );
    expect(result).toEqual({ primary: "Audit Log", gloss: "审计日志" });
  });

  it("pairs DIRECTORY group labels the same way, keyed by name instead of path", () => {
    const result = menuGlossParts(
      settingsGroup,
      "en",
      t({ "breadcrumb.menu.group_settings": "System Settings" })
    );
    expect(result).toEqual({ primary: "System Settings", gloss: "系统设置" });
  });

  it("falls back to the Chinese name alone when no translation key is registered", () => {
    const unregistered: Pick<SidebarMenu, "path" | "name" | "menu_type"> = {
      path: "/some-new-page",
      name: "新页面",
      menu_type: "MENU",
    };
    const result = menuGlossParts(unregistered, "en", t({}));
    expect(result).toEqual({ primary: "新页面" });
  });

  it("falls back to the Chinese name alone when t() has no translation for a registered key", () => {
    // t() with no matching key returns the key itself unmodified.
    const result = menuGlossParts(auditLeaf, "egy", (key: string) => key);
    expect(result).toEqual({ primary: "审计日志" });
  });
});

describe("Breadcrumb", () => {
  let mockPathname = "/audit";
  let mockSearch = "";
  let mockLocale: "zh-Hans" | "en" = "en";

  jest.mock("next/navigation", () => ({
    usePathname: () => mockPathname,
    useSearchParams: () => new URLSearchParams(mockSearch),
  }));

  jest.mock("@/src/contexts/I18nContext", () => ({
    useI18n: () => ({
      locale: mockLocale,
      t: (key: string) => {
        const map: Record<string, string> = {
          "breadcrumb.menu.audit": "Audit Log",
          "breadcrumb.menu.group_settings": "System Settings",
          "breadcrumb.aria_label": "Breadcrumb",
          "breadcrumb.back": "Back",
          "breadcrumb.home": "Dashboard",
          "breadcrumb.detail": "Detail",
          "breadcrumb.menu.cross_judgments": "Cross-civ Judgments",
        };
        return map[key] ?? key;
      },
    }),
  }));

  // Requiring after the mocks are registered so AppLayout picks them up.
   
  const { Breadcrumb } = require("@/src/components/layout/AppLayout");

  const menus: SidebarMenu[] = [
    {
      id: 1,
      name: "系统设置",
      path: "",
      icon: "Settings",
      order: 60,
      component: "",
      roles: ["ADMIN"],
      is_active: true,
      parent: null,
      menu_type: "DIRECTORY",
      visible: true,
      children: [
        {
          id: 2,
          name: "审计日志",
          path: "/audit",
          icon: "Scroll",
          order: 40,
          component: "audit",
          roles: ["ADMIN"],
          is_active: true,
          parent: 1,
          menu_type: "MENU",
          visible: true,
        },
      ],
    },
  ];

  beforeEach(() => {
    mockPathname = "/audit";
    mockSearch = "";
    mockLocale = "en";
  });

  it("pairs both the group and the leaf crumb with their Chinese DB name under a foreign locale", () => {
    render(<Breadcrumb menus={menus} />);
    expect(screen.getByText("System Settings")).toBeInTheDocument();
    expect(screen.getByText("Audit Log")).toBeInTheDocument();
    // Both Chinese originals should also be present, as the muted gloss.
    expect(screen.getAllByText("系统设置").length).toBeGreaterThan(0);
    expect(screen.getAllByText("审计日志").length).toBeGreaterThan(0);
  });

  it("a route the menu tree does not hold reads its sidebar name, not the raw path segment", () => {
    // /judgment/<id> in the E2E build showed 「judgment / 详情」: no crumb came
    // from the menu tree, and breadcrumb.<segment> does not exist. The sidebar
    // label for the same route does (breadcrumb.menu.<segment>, - as _).
    mockPathname = "/cross-judgments/12";
    render(<Breadcrumb menus={menus} />);
    expect(screen.getByText("Cross-civ Judgments")).toBeInTheDocument();
    expect(screen.getByText("Detail")).toBeInTheDocument();
    expect(screen.queryByText("cross-judgments")).not.toBeInTheDocument();
  });

  it("an unknown segment still falls back to itself rather than to a key", () => {
    mockPathname = "/no-such-route";
    render(<Breadcrumb menus={menus} />);
    expect(screen.getByText("no-such-route")).toBeInTheDocument();
    expect(screen.queryByText(/breadcrumb\./)).not.toBeInTheDocument();
  });

  it("a path segment with no page of its own is shown but not linked", () => {
    // /admin has no page.tsx: the crumb linked it, and Next prefetched
    // /admin?_rsc=… into a 404 on every /admin/* page.
    mockPathname = "/admin/stats";
    render(<Breadcrumb menus={menus} />);
    expect(screen.getByText("admin")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "admin" })).not.toBeInTheDocument();
    expect(document.querySelector('a[href="/admin"]')).toBeNull();
  });

  it("an intermediate segment that does have a page stays a link", () => {
    mockPathname = "/audit/12";
    render(<Breadcrumb menus={menus} />);
    // Inside the trail: the back button before it links /audit too, and must not stand in for the crumb.
    expect(document.querySelector('ol a[href="/audit"]')).not.toBeNull();
  });

  describe("返回键(v3:回到来源,不走浏览器历史)", () => {
    const back = () => screen.queryByRole("link", { name: "Back" });

    it("没写来源时回到最近一段有页面的上级", () => {
      mockPathname = "/audit/12";
      render(<Breadcrumb menus={menus} />);
      expect(back()).toHaveAttribute("href", "/audit");
      // 在面包屑之前,不在那一串里。
      expect(back()?.closest("ol")).toBeNull();
    });

    it("链接上写了 ?from= 就回到那里(审判台 ← 审判队列)", () => {
      mockPathname = "/audit/12";
      mockSearch = "from=%2Fjudgment%2Fqueue";
      render(<Breadcrumb menus={menus} />);
      expect(back()).toHaveAttribute("href", "/judgment/queue");
    });

    it.each(["//evil.example/x", "https://evil.example/", "/\\evil.example"])("站外的 from(%s)不认,退回上级", (from) => {
      mockPathname = "/audit/12";
      mockSearch = `from=${encodeURIComponent(from)}`;
      render(<Breadcrumb menus={menus} />);
      expect(back()).toHaveAttribute("href", "/audit");
    });

    it("顶层页没有上级、也没写来源:不画", () => {
      render(<Breadcrumb menus={menus} />);
      expect(back()).toBeNull();
    });
  });

  it("PAGELESS_PREFIXES is exactly the set of app/ prefixes without a page.tsx", () => {
    const fs = jest.requireActual<typeof import("fs")>("fs");
    const path = jest.requireActual<typeof import("path")>("path");
    const appDir = path.join(__dirname, "../../app");
    const pages = new Set<string>();
    const walk = (dir: string, url: string[]) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) {
          // (group) folders do not appear in the URL.
          const seg = /^\(.*\)$/.test(e.name) ? [] : [e.name];
          walk(path.join(dir, e.name), [...url, ...seg]);
        } else if (e.name === "page.tsx") {
          pages.add("/" + url.join("/"));
        }
      }
    };
    walk(appDir, []);
    const pageless = new Set<string>();
    for (const page of pages) {
      const parts = page.split("/").filter(Boolean);
      for (let i = 1; i < parts.length; i++) {
        const prefix = "/" + parts.slice(0, i).join("/");
        if (!pages.has(prefix)) pageless.add(prefix);
      }
    }
    expect(pages.has("/audit")).toBe(true); // the walk found the tree
    const { PAGELESS_PREFIXES } = require("@/src/components/layout/Breadcrumb");
    expect([...PAGELESS_PREFIXES].sort()).toEqual([...pageless].sort());
  });

  it("shows only the Chinese name, with no separate gloss, under zh-Hans", () => {
    mockLocale = "zh-Hans";
    render(<Breadcrumb menus={menus} />);
    expect(screen.getByText("系统设置")).toBeInTheDocument();
    expect(screen.getByText("审计日志")).toBeInTheDocument();
    expect(screen.queryByText("System Settings")).not.toBeInTheDocument();
    expect(screen.queryByText("Audit Log")).not.toBeInTheDocument();
  });
});
