/**
 * The landing page's two asymmetries.
 *
 * `hallmark`'s one page-level finding for this app: `/` was the single
 * template-shaped screen — centred `h1`, centred subtitle, centred section
 * heading, a symmetric 2×2 equal-height grid, centred footer. "Centred
 * everything" is not a defect; it is the arrangement every generated landing
 * page reaches for, which is why it reads as one.
 *
 * Two changes answer it, and they cover different viewers. The hero's left
 * anchor works for everyone including anonymous visitors (`/` is public). The
 * own-realm marking only exists once there is a tenant to know — so it is
 * asserted in both states here, because "renders nothing for an anonymous
 * visitor" is the half that a test written only for the signed-in case would
 * miss.
 */
import { render, screen } from "@testing-library/react";

import HomePage from "@/app/page";

let mockUser: Record<string, unknown> | null = null;

jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: mockUser }),
}));

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({ t: (key: string) => key, locale: "zh-Hans", hydrated: true }),
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

describe("the landing page is not centred everything", () => {
  it("anchors the hero left rather than centring it", () => {
    const { container } = render(<HomePage />);

    const hero = container.querySelector("main > header");
    expect(hero).not.toBeNull();
    // The tell, asserted as an absence: this carried `text-center`.
    expect(hero?.className ?? "").not.toContain("text-center");
  });

  it("does not centre the civilization grid either, so the two agree", () => {
    const { container } = render(<HomePage />);

    const grid = container.querySelector("main section > div.grid");
    expect(grid).not.toBeNull();
    // `mx-auto` here would re-centre the block under a left-anchored hero,
    // which reads as a mistake rather than a choice.
    expect(grid?.className ?? "").not.toContain("mx-auto");
  });
});

describe("the viewer's own realm is marked", () => {
  it("marks exactly one card, and names it in words as well as colour", () => {
    mockUser = { username: "yama", tenant: { code: "GR_HADES" } };

    render(<HomePage />);

    // One, not several — the marking has to identify a realm, not decorate.
    expect(screen.getAllByText("home.your_realm")).toHaveLength(1);
  });

  it("marks the card for the tenant's civilization, not a fixed one", () => {
    mockUser = { username: "yama", tenant: { code: "CN_DIYU" } };

    render(<HomePage />);

    // Walk from the marker to the card it labels, the way a reader does —
    // rather than matching a class string, which would pin the styling and
    // not the fact.
    const card = screen.getByText("home.your_realm").closest("div");
    expect(card?.textContent).toContain("home.civilizations.CHINESE");
    expect(card?.textContent).not.toContain("home.civilizations.GREEK");
  });

  it("marks nothing for an anonymous visitor", () => {
    mockUser = null;

    render(<HomePage />);

    // `/` is public. Without a tenant there is no "yours", and inventing one
    // would be the same class of claim as a fabricated activity feed.
    expect(screen.queryByText("home.your_realm")).not.toBeInTheDocument();
  });

  it("marks nothing when the user has no tenant", () => {
    mockUser = { username: "yama", tenant: null };

    render(<HomePage />);

    expect(screen.queryByText("home.your_realm")).not.toBeInTheDocument();
  });
});
