/**
 * The landing page `/` (Design A10).
 *
 * `/` is public, so both states are asserted: an anonymous visitor gets four identical columns and
 * a console link to /login; a signed-in operator gets their own realm marked — once, in words as
 * well as the 3px rule — and a console link to /dashboard. "Renders nothing for an anonymous
 * visitor" is the half a test written only for the signed-in case would miss.
 */
import { render, screen, within } from "@testing-library/react";

import HomePage from "@/app/page";

let mockUser: Record<string, unknown> | null = null;

jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: mockUser }),
}));

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) => (params ? `${key}(${Object.values(params).join(",")})` : key),
    locale: "zh-Hans",
    hydrated: true,
  }),
}));

jest.mock("@/src/contexts/ThemeContext", () => ({
  useTheme: () => ({ theme: "dark", toggleTheme: jest.fn() }),
}));

jest.mock("@/components/LanguageSwitcher", () => ({
  LanguageSwitcher: () => <div data-testid="language-switcher" />,
}));

beforeEach(() => {
  mockUser = null;
});

const civs = () => within(screen.getByTestId("landing-civs")).getAllByRole("listitem");

describe("the landing page (A10)", () => {
  it("carries the balance mark, not the old line icon, and no civilization colour", () => {
    const { container } = render(<HomePage />);
    expect(within(screen.getByTestId("landing-brand")).getByText("灵魂簿")).toBeInTheDocument();
    // Top row (24 / 32, one per width) and the large one beside the title.
    expect(container.querySelectorAll("svg[data-brand-mark]")).toHaveLength(3);
    // The page's own markup (ThemeToggle's hover is the shared control's, not this page's).
    const own = [container.querySelector("main"), screen.getByTestId("landing-console"), screen.getByTestId("landing-brand")];
    for (const el of own) expect(el!.outerHTML).not.toMatch(/--color-civ|--color-accent/);
  });

  it("lists the four civilizations in order, each with its ink glyph, and no cards", () => {
    render(<HomePage />);
    const items = civs();
    expect(items.map((li) => li.getAttribute("data-civ"))).toEqual(["CHINESE", "EUROPEAN", "EGYPTIAN", "GREEK"]);
    expect(items.map((li) => li.textContent?.trim()[0])).toEqual(["■", "●", "▲", "◆"]);
    for (const li of items) expect(li.className).not.toMatch(/\bbg-/);
  });

  it("the console is a link, not a button, and goes to /login for an anonymous visitor", () => {
    render(<HomePage />);
    const link = screen.getByTestId("landing-console");
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "/login");
    expect(link).toHaveTextContent("home.console→");
    expect(link).not.toHaveTextContent("↗");
  });
});

describe("the viewer's own realm is marked", () => {
  it("marks exactly one column, the tenant's, in words as well as the rule", () => {
    mockUser = { username: "yama", tenant: { code: "CN_DIYU" } };
    render(<HomePage />);
    const marked = civs().filter((li) => li.hasAttribute("data-mine"));
    expect(marked.map((li) => li.getAttribute("data-civ"))).toEqual(["CHINESE"]);
    expect(within(marked[0]).getByText("home.your_realm")).toBeInTheDocument();
    expect(screen.getAllByText("home.your_realm")).toHaveLength(1);
    expect(marked[0].className).toContain("border-t-3");
  });

  it("signed in: the console goes to /dashboard and the page says who is signed in", () => {
    mockUser = { username: "yama", display_name: "阎罗", tenant: { code: "GR_HADES" } };
    render(<HomePage />);
    expect(screen.getByTestId("landing-console")).toHaveAttribute("href", "/dashboard");
    expect(screen.getAllByText("home.signed_in_as(阎罗)").length).toBeGreaterThan(0);
  });

  it("marks nothing, and claims no one, for an anonymous visitor", () => {
    render(<HomePage />);
    expect(civs().filter((li) => li.hasAttribute("data-mine"))).toEqual([]);
    expect(screen.queryByText("home.your_realm")).not.toBeInTheDocument();
    expect(screen.queryByText(/home\.signed_in_as/)).not.toBeInTheDocument();
  });

  it("marks nothing when the user has no tenant", () => {
    mockUser = { username: "yama", tenant: null };
    render(<HomePage />);
    expect(screen.queryByText("home.your_realm")).not.toBeInTheDocument();
  });
});
