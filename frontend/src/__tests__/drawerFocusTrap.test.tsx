/**
 * The two off-canvas drawers, from the keyboard.
 *
 * WHY THIS EXISTS. `AppLayout.tsx` matched `Escape|onKeyDown|keydown|tabIndex|
 * role=` zero times across 722 lines, and `SettingsDrawer.tsx` never called
 * itself a dialog. Both had a `<div onClick={close}>` scrim and nothing else —
 * a way out for the mouse and none for anything else. `eslint.config.mjs`
 * carried an exemption for the two `jsx-a11y` rules that catch that scrim
 * shape, which is why the defect had to be found by reading rather than by
 * running anything.
 *
 * WHAT jsdom CAN AND CANNOT ANSWER, said here because the tempting assertions
 * are the unanswerable ones. jsdom has no layout and does not move focus on a
 * Tab key event. So:
 *   - assertable: `document.activeElement` is inside the drawer after opening;
 *     it is back on the opener after closing; Tab off the *last* control lands
 *     on the first and Shift+Tab off the first lands on the last — those two
 *     wraps are moves the trap makes itself, with `preventDefault`.
 *   - NOT assertable, and not claimed anywhere below: that Tab from the middle
 *     of the drawer reaches the next control (that is the browser's own tab
 *     order), or anything about where things are on screen.
 */
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ── Mocks ────────────────────────────────────────────────────────────

/**
 * `t()` returns the key unchanged when a key is missing — that is the real
 * I18nContext's documented behaviour, and one of the assertions below depends
 * on it, so this stub reproduces it rather than inventing a nicer one.
 * `MESSAGES` is mutable so both branches of AppLayout's drawer-name fallback
 * can be exercised.
 */
const MESSAGES: Record<string, string> = {};

jest.mock("@/src/contexts/I18nContext", () => ({
  // `LanguageSwitcher` sits in AppLayout's header and reads this at render.
  LOCALE_LABELS: { "zh-Hans": "简体中文", en: "English", egy: "Kemet" },
  useI18n: () => ({
    t: (key: string) => MESSAGES[key] ?? key,
    locale: "zh-Hans",
    hydrated: true,
    formatDate: (v: unknown) => String(v),
    formatDateTime: (v: unknown) => String(v),
  }),
}));

jest.mock("@/src/contexts/ThemeContext", () => ({
  useTheme: () => ({ theme: "dark", toggleTheme: jest.fn() }),
}));

jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: null, tenantCode: "CN", logout: jest.fn() }),
}));

jest.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
}));

jest.mock("@soulledger/core/api", () => ({
  notificationsApi: { list: jest.fn().mockResolvedValue({ data: { results: [] } }) },
  authApi: { logout: jest.fn().mockResolvedValue({}) },
}));

jest.mock("@/src/components/connection-status", () => ({
  ConnectionStatus: () => <span data-testid="connection-status" />,
  ConnectionBanner: () => null,
  useConnectionBannerShown: () => false,
}));

jest.mock("@/src/hooks/useSidebarMenus", () => ({
  ...jest.requireActual("@/src/hooks/useSidebarMenus"),
  // One page on purpose: it pins the focusable set inside the drawer to exactly
  // two — the wordmark link and that page's link (the drawer has no collapse
  // button since 规范 v1; the rail is a viewport state) — so "first" and "last"
  // below mean something fixed rather than whatever a menu fixture rendered.
  // 六个一级项:底栏放前 4 个,「更多」抽屉里是其余 2 个 —— 抽屉里至少要有两个可聚焦的
  // 东西(关闭 + 链接),Tab 圈的断言才不是一站式的平凡成立。
  useSidebarMenus: () => ({
    data: ["概览", "灵魂", "审判", "总账", "界域", "审计"].map((name, i) => ({
      id: i + 1,
      name,
      path: i === 0 ? "/dashboard" : `/p${i}`,
      icon: null,
      order: i,
      component: null,
      roles: [],
      is_active: true,
      parent: null,
      children: [],
    })),
  }),
}));

import { AppLayout } from "@/src/components/layout/AppLayout";
import { SettingsDrawer } from "@/src/components/settings/SettingsDrawer";
import { focusablesWithin } from "@/src/components/layout/useDrawerA11y";

// ── AppLayout's phone drawer ─────────────────────────────────────────

function renderLayout() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<AppLayout>page body</AppLayout>, { wrapper: Wrapper });
}

/** 底栏的「更多」—— 规范 v2 里它取代了 v1 的 ☰,打开的是同一种模态抽屉。按它报告的状态找,不按文案。 */
function hamburger(): HTMLElement {
  const bar = screen.getByTestId("bottom-bar");
  const found = Array.from(bar.querySelectorAll<HTMLElement>("button[aria-expanded]")).pop();
  if (!found) throw new Error("no 更多 button rendered");
  return found;
}

beforeEach(() => {
  for (const key of Object.keys(MESSAGES)) delete MESSAGES[key];
});

describe("AppLayout's phone sheet (底栏「更多」) has a keyboard way in, round and out", () => {
  it("is not a dialog while it is the desktop sidebar", () => {
    // Absence, asserted. The same <aside> is the permanent md+ sidebar; a
    // sidebar that is always on screen claiming aria-modal would tell a screen
    // reader the rest of the page is inert when it is not.
    renderLayout();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("becomes a named dialog when 更多 opens it", () => {
    MESSAGES["nav.mobile_menu"] = "导航菜单";
    renderLayout();
    fireEvent.click(hamburger());

    const drawer = screen.getByRole("dialog", { name: "导航菜单" });
    expect(drawer).toHaveAttribute("aria-modal", "true");
    expect(drawer.tagName).toBe("ASIDE");
  });

  it("still has a real name when the messages bundles have no key for it yet", () => {
    // `nav.mobile_menu` is being requested, not smuggled in. Until it lands
    // t() hands back the key, and a dialog named "nav.mobile_menu" would be
    // worse than the silence it replaced.
    renderLayout();
    fireEvent.click(hamburger());

    expect(screen.getByRole("dialog", { name: "导航菜单" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "nav.mobile_menu" })).not.toBeInTheDocument();
  });

  it("moves focus into the drawer when it opens", () => {
    // The defect this replaces: the drawer slid over the page and focus stayed
    // underneath it, so the next Tab walked content the overlay had covered.
    renderLayout();
    fireEvent.click(hamburger());

    const drawer = screen.getByRole("dialog");
    expect(document.activeElement).not.toBe(document.body);
    expect(drawer.contains(document.activeElement)).toBe(true);
  });

  it("closes on Escape", () => {
    renderLayout();
    fireEvent.click(hamburger());
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(document.activeElement!, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(hamburger()).toHaveAttribute("aria-expanded", "false");
  });

  it("hands focus back to the 更多 cell that opened it", () => {
    renderLayout();
    const trigger = hamburger();
    trigger.focus();
    fireEvent.click(trigger);

    fireEvent.keyDown(document.activeElement!, { key: "Escape" });

    expect(document.activeElement).toBe(hamburger());
  });

  it("wraps Tab from the last control back to the first, and Shift+Tab the other way", () => {
    renderLayout();
    fireEvent.click(hamburger());
    const drawer = screen.getByRole("dialog");

    const items = focusablesWithin(drawer);
    expect(items.length).toBeGreaterThan(1); // floor: a one-stop trap wraps trivially
    const first = items[0];
    const last = items[items.length - 1];

    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(first);
    expect(drawer.contains(document.activeElement)).toBe(true);

    first.focus();
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("gives the scrim a role instead of a bare click handler", () => {
    renderLayout();
    fireEvent.click(hamburger());

    const scrim = document.querySelector(".fixed.inset-0.z-scrim");
    expect(scrim).toBeTruthy();
    expect(scrim!.tagName).toBe("BUTTON");

    fireEvent.click(scrim!);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

// ── SettingsDrawer ───────────────────────────────────────────────────

/** A host with a real trigger, so focus return has somewhere real to return to. */
function SettingsHost() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        gear
      </button>
      <SettingsDrawer open={open} onClose={() => setOpen(false)} />
    </>
  );
}

describe("SettingsDrawer says what it is, and lets go", () => {
  beforeEach(() => {
    MESSAGES["settings.title"] = "设置";
    MESSAGES["common.close"] = "关闭";
  });

  it("is a modal dialog named by its own visible heading", () => {
    render(<SettingsHost />);
    fireEvent.click(screen.getByText("gear"));

    const drawer = screen.getByRole("dialog", { name: "设置" });
    expect(drawer).toHaveAttribute("aria-modal", "true");

    // The name is the heading, not a second copy of the string: same node.
    const heading = screen.getByRole("heading", { name: "设置" });
    expect(drawer.getAttribute("aria-labelledby")).toBe(heading.id);
    expect(heading.id).not.toBe("");
  });

  it("gives its close button and its scrim accessible names", () => {
    render(<SettingsHost />);
    fireEvent.click(screen.getByText("gear"));

    // Two ways out, both named. The X had no name at all before.
    expect(screen.getAllByRole("button", { name: "关闭" }).length).toBe(2);
  });

  it("moves focus in, closes on Escape, and gives it back to the gear", () => {
    render(<SettingsHost />);
    const gear = screen.getByText("gear");
    gear.focus();
    fireEvent.click(gear);

    const drawer = screen.getByRole("dialog");
    expect(drawer.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document.activeElement!, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(gear);
  });

  it("wraps Tab at both ends of the drawer", () => {
    render(<SettingsHost />);
    fireEvent.click(screen.getByText("gear"));
    const drawer = screen.getByRole("dialog");

    const items = focusablesWithin(drawer);
    expect(items.length).toBeGreaterThan(1);
    const first = items[0];
    const last = items[items.length - 1];

    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    first.focus();
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("gives the scrim a role instead of a bare click handler", () => {
    render(<SettingsHost />);
    fireEvent.click(screen.getByText("gear"));

    const scrim = document.querySelector("button.fixed.inset-0");
    expect(scrim).toBeTruthy();
    expect(scrim!.tagName).toBe("BUTTON");
  });
});
