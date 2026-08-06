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
  let mockLocale: "zh-Hans" | "en" = "en";

  jest.mock("next/navigation", () => ({
    usePathname: () => mockPathname,
  }));

  jest.mock("@/src/contexts/I18nContext", () => ({
    useI18n: () => ({
      locale: mockLocale,
      t: (key: string) => {
        const map: Record<string, string> = {
          "breadcrumb.menu.audit": "Audit Log",
          "breadcrumb.menu.group_settings": "System Settings",
          "breadcrumb.aria_label": "Breadcrumb",
          "breadcrumb.home": "Dashboard",
        };
        return map[key] ?? key;
      },
    }),
  }));

  // Requiring after the mocks are registered so AppLayout picks them up.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
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

  it("shows only the Chinese name, with no separate gloss, under zh-Hans", () => {
    mockLocale = "zh-Hans";
    render(<Breadcrumb menus={menus} />);
    expect(screen.getByText("系统设置")).toBeInTheDocument();
    expect(screen.getByText("审计日志")).toBeInTheDocument();
    expect(screen.queryByText("System Settings")).not.toBeInTheDocument();
    expect(screen.queryByText("Audit Log")).not.toBeInTheDocument();
  });
});
