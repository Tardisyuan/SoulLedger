/**
 * The phone web shell, four layers folded into two (fe-mobile 3.1 / 3.2, 2026-11-14).
 *
 * jsdom has no layout and does not evaluate media queries, so what it can answer is: which pieces are in the DOM,
 * what they contain, and which width rule each one carries. Where the behaviour is "not drawn at ≤ 768" the test
 * reads the class or the stylesheet rule that says so — the pixel result is the mobile-chrome E2E's to check.
 *
 * What is asserted:
 *   - 门内换页 at ≤ 768 is the 「页名 ▾」 button in the top bar, opening a named modal sheet grouped by section,
 *     the current page marked; the page-tab strip is not drawn at that width (doors.module.css) and gives no height
 *     (`--door-tabs-h` → 0, globals.css).
 *   - the top bar on a phone has no user menu; its items live in 「我」 — so logout is still reachable there.
 *   - a `bare` page (案卷台) still has the top bar on a phone (`min-[769px]:hidden`, not absent).
 *   - the tokens and the coarse-pointer rule exist; the viewport asks for `viewport-fit=cover`.
 */
import fs from "node:fs";
import path from "node:path";
import { fireEvent, screen, within } from "@testing-library/react";

jest.mock("@/src/contexts/I18nContext", () => ({
  LOCALE_LABELS: { "zh-Hans": "简体中文", en: "English", egy: "Kemet" },
  useI18n: () => ({
    t: (key: string) => key,
    locale: "zh-Hans",
    hydrated: true,
    formatDate: (v: unknown) => String(v),
    formatDateTime: (v: unknown) => String(v),
  }),
}));

jest.mock("@/src/contexts/ThemeContext", () => ({
  useTheme: () => ({ theme: "dark", toggleTheme: jest.fn() }),
}));

let mockUser: unknown = { id: 1, username: "cui", display_name: "崔判官", role: "JUDGE", tenant: null, permissions: ["judgment.read"] };
jest.mock("@/src/contexts/TenantContext", () =>
  require("./support/mocks").tenantMock({ ctx: () => ({ user: mockUser, tenantCode: "CN", logout: jest.fn() }) }),
);

let mockPathname = "/judgment/42";
jest.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), back: jest.fn() }),
}));

jest.mock("@soulledger/core/api", () => ({
  notificationsApi: { list: jest.fn().mockResolvedValue({ data: { count: 0, results: [] } }) },
  authApi: { logout: jest.fn().mockResolvedValue({}) },
}));

jest.mock("@/src/components/connection-status", () => ({
  ConnectionStatus: () => null,
  ConnectionBanner: () => null,
  useConnectionBannerShown: () => false,
}));

const menu = (id: number, name: string, p: string) => ({
  id,
  name,
  path: p,
  icon: null,
  order: id,
  component: null,
  roles: [],
  is_active: true,
  parent: null,
  children: [],
});
jest.mock("@/src/hooks/useSidebarMenus", () => ({
  ...jest.requireActual("@/src/hooks/useSidebarMenus"),
  useSidebarMenus: () => ({
    data: [menu(1, "仪表盘", "/dashboard"), menu(2, "审判", "/judgment"), menu(3, "申诉", "/judgment/appeals"), menu(4, "灵魂", "/souls")],
  }),
}));

import { AppLayout } from "@/src/components/layout/AppLayout";
import { renderWithProviders } from "./support/render";

const FRONTEND = path.join(__dirname, "..", "..");
const read = (rel: string) => fs.readFileSync(path.join(FRONTEND, rel), "utf8");

function renderLayout(bare = false) {
  return renderWithProviders(<AppLayout bare={bare}>page body</AppLayout>, { i18n: false });
}

beforeEach(() => {
  mockPathname = "/judgment/42";
  mockUser = { id: 1, username: "cui", display_name: "崔判官", role: "JUDGE", tenant: null, permissions: ["judgment.read"] };
});

describe("门内换页 on a phone: 「页名 ▾」 and its sheet", () => {
  it("names the page the route is under, and opens a modal sheet grouped by section with that page current", () => {
    renderLayout();
    const picker = screen.getByTestId("door-page-picker");
    // /judgment/42 is under /judgment: the picker names the page, not the door.
    expect(picker).toHaveTextContent("审判");
    expect(picker).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("door-page-sheet")).not.toBeInTheDocument();

    fireEvent.click(picker);
    const sheet = screen.getByRole("dialog", { name: "nav.doors.desk.label" });
    expect(sheet).toHaveAttribute("data-testid", "door-page-sheet");
    expect(sheet).toHaveAttribute("aria-modal", "true");
    expect(picker).toHaveAttribute("aria-expanded", "true");
    // Sections in the desk door's order, each named.
    expect(within(sheet).getAllByText(/^doors\.section\./).map((el) => el.textContent)).toEqual(["doors.section.desk", "doors.section.sources"]);
    expect(within(sheet).getByRole("link", { name: "审判" })).toHaveAttribute("aria-current", "page");
    expect(within(sheet).getByRole("link", { name: "申诉" })).toHaveAttribute("href", "/judgment/appeals");
    // Absence: only one page is current, and the other door's pages are not listed.
    expect(within(sheet).getByRole("link", { name: "申诉" })).not.toHaveAttribute("aria-current");
    expect(within(sheet).queryByRole("link", { name: "灵魂" })).not.toBeInTheDocument();
  });

  it("closes on Escape", () => {
    renderLayout();
    fireEvent.click(screen.getByTestId("door-page-picker"));
    fireEvent.keyDown(screen.getByTestId("door-page-sheet"), { key: "Escape" });
    expect(screen.queryByTestId("door-page-sheet")).not.toBeInTheDocument();
  });

  it("the breadcrumb keeps only its back key on a phone while the picker names the page", () => {
    renderLayout();
    const crumbs = screen.getByTestId("topbar-crumbs");
    expect(crumbs.className).toContain("max-[768px]:[&_ol]:hidden");
    // The back key (to /judgment) is outside the <ol>, so it survives that rule.
    const back = within(crumbs).getByTestId("breadcrumb-back");
    expect(back.closest("ol")).toBeNull();
  });

  it("a page in no door draws no picker, and the breadcrumb stays whole", () => {
    mockPathname = "/profile";
    renderLayout();
    expect(screen.queryByTestId("door-page-picker")).not.toBeInTheDocument();
    expect(screen.getByTestId("topbar-crumbs").className).not.toContain("[&_ol]:hidden");
  });

  it("the page-tab strip is not drawn at ≤ 768 and gives no height there", () => {
    const doors = read("src/components/layout/doors.module.css");
    const narrow = doors.slice(doors.indexOf("@media (max-width: 768px)"));
    expect(narrow).toMatch(/\.tabs\s*\{\s*display:\s*none;/);
    expect(narrow).toMatch(/\.picker\s*\{\s*display:\s*flex;/);
    // DoorTabs publishes its height under another name; globals.css derives --door-tabs-h and zeroes it on a phone.
    const globals = read("app/globals.css");
    expect(globals).toContain("--door-tabs-h: var(--door-tabs-on, 0px);");
    const phone = globals.slice(globals.indexOf("--bottom-bar: calc(56px + var(--safe-b));") - 200);
    expect(phone).toMatch(/@media \(max-width: 768px\)\s*\{\s*html\s*\{[^}]*--door-tabs-h:\s*0px;/);
  });
});

describe("one 「我」: the top bar's user menu is gone on a phone, and its items are in the door bar's sheet", () => {
  it("the user menu carries the phone-hidden rule", () => {
    renderLayout();
    expect(screen.getByTestId("user-menu").className).toContain("max-[768px]:hidden");
  });

  it("「我」 holds settings, about and logout for a signed-in user", () => {
    renderLayout();
    fireEvent.click(screen.getByTestId("door-me"));
    const sheet = screen.getByTestId("me-sheet");
    expect(within(sheet).getByRole("button", { name: "nav.settings" })).toBeInTheDocument();
    expect(within(sheet).getByRole("link", { name: "about.title" })).toHaveAttribute("href", "/about");
    fireEvent.click(within(sheet).getByTestId("me-sheet-logout"));
    // Logout asks first (the same confirm the desktop menu opens); the sheet gets out of its way.
    expect(screen.queryByTestId("me-sheet")).not.toBeInTheDocument();
  });

  it("signed out, 「我」 has no logout to offer", () => {
    mockUser = null;
    renderLayout();
    fireEvent.click(screen.getByTestId("door-me"));
    expect(within(screen.getByTestId("me-sheet")).queryByTestId("me-sheet-logout")).not.toBeInTheDocument();
  });
});

describe("a bare page (案卷台) still has the top bar on a phone", () => {
  it("is in the DOM, hidden only from 769 up", () => {
    mockPathname = "/desk";
    renderLayout(true);
    const bar = screen.getByTestId("global-topbar");
    expect(bar.className).toContain("min-[769px]:hidden");
    expect(within(bar).getByTestId("door-page-picker")).toBeInTheDocument();
  });

  it("a page with the toolbar does not carry that rule", () => {
    renderLayout();
    expect(screen.getByTestId("global-topbar").className).not.toContain("min-[769px]:hidden");
  });
});

describe("tokens, safe area and the coarse-pointer rule", () => {
  const globals = read("app/globals.css");

  it("declares --safe-b from the safe-area inset, and the door bar is 56 plus it (batch 38, user 2026-11-14)", () => {
    expect(globals).toContain("--safe-b: env(safe-area-inset-bottom, 0px);");
    expect(globals).toContain("--bottom-bar: calc(56px + var(--safe-b));");
    // Absence: neither fe-mobile's 64 nor the inset read directly (the padding must follow the same token).
    expect(globals).not.toContain("--bottom-bar: calc(64px");
    expect(globals).not.toContain("--bottom-bar: calc(56px + env(");
  });

  it("hides keyboard hints by input method, not by width", () => {
    expect(globals).toMatch(/@media \(pointer: coarse\)\s*\{\s*kbd\s*\{\s*display:\s*none;/);
    const desk = read("src/components/desk/desk.module.css");
    expect(desk).toMatch(/@media \(pointer: coarse\)\s*\{\s*\.kbd,\s*\.keys\s*\{\s*display:\s*none;/);
  });

  it("asks for viewport-fit=cover, without which env(safe-area-inset-bottom) stays 0 on iOS", () => {
    expect(read("app/layout.tsx")).toMatch(/viewportFit:\s*"cover"/);
  });

  it("on a phone the door cells are 56 tall over the safe area, the current one marked by a short line under the glyph (batch 38)", () => {
    const doors = read("src/components/layout/doors.module.css");
    const narrow = doors.slice(doors.indexOf("@media (max-width: 768px)"), doors.indexOf("@media (min-width: 769px)"));
    expect(narrow).toContain("padding: 0 8px var(--safe-b, 0px);");
    expect(narrow).toMatch(/min-height:\s*56px;\s*height:\s*56px;/);
    // The 14 × 2 line under the glyph box, not a full-width edge line.
    expect(narrow).toMatch(/\.door\[aria-current="page"\]::after,\s*\.door\[aria-current="true"\]::after\s*\{[^}]*width:\s*14px;[^}]*height:\s*2px;/);
    // Absence: no edge line along the top or bottom of the cell.
    expect(narrow).not.toContain("inset 0 2px 0");
    expect(narrow).not.toContain("inset 0 -2px 0");
    expect(narrow).not.toContain("height: 64px");
  });

  it("matches batch 38's size table: cells ≥ 64 wide; icon 24 + gap 3, Chinese glyph 18/22 + gap 2; word 11/14 (500 for en / egy); line 3 under the mark in civT", () => {
    const doors = read("src/components/layout/doors.module.css");
    const narrow = doors.slice(doors.indexOf("@media (max-width: 768px)"), doors.indexOf("@media (min-width: 769px)"));
    expect(narrow).toContain("min-width: 64px;");
    expect(narrow).toMatch(/\.door\s*\{\s*--door-mark-h:\s*22px;/);
    expect(narrow).toMatch(/\.door:has\(\.doorIcon\)\s*\{\s*--door-gap:\s*3px;\s*--door-mark-h:\s*24px;/);
    expect(narrow).toMatch(/\.doorGlyph\s*\{\s*line-height:\s*22px;/);
    expect(narrow).toContain("top: calc(50% - (var(--door-mark-h) + var(--door-gap) + 14px) / 2 + var(--door-mark-h) + 3px);");
    // civT is --color-main-ink (globals.css).
    expect(narrow).toContain("background: oklch(var(--color-main-ink));");
    // Outside the media block: the Chinese gap 2, glyph 18, icon 24, word 11/14 and the word's weight 500.
    expect(doors).toContain("--door-gap: 2px;");
    expect(doors).toMatch(/\.doorGlyph\s*\{[^}]*font-size:\s*18px;/);
    expect(doors).toMatch(/\.doorIcon\s*\{[^}]*width:\s*24px;\s*height:\s*24px;/);
    expect(doors).toMatch(/\.doorLabel\s*\{\s*font-size:\s*11px;\s*line-height:\s*14px;/);
    expect(doors).toMatch(/\.doorLabelWord\s*\{\s*font-weight:\s*500;/);
    // Absence: the old fixed 24 px box in the line's position (wrong for the 22 px Chinese mark).
    expect(narrow).not.toContain("(24px + var(--door-gap)");
  });
});
