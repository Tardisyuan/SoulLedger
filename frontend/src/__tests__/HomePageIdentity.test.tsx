/**
 * The landing page (Design batch 70, in the real product too): four civilization cards are the way in. Each goes to
 * sign-in with its civilization; a signed-in visitor's own link goes to the dashboard. The demo's one-click entry and its
 * kicker are props, so without them the page has neither.
 */
import { render, screen, within } from "@testing-library/react";
import HomePage from "@/app/page";

let mockUser: Record<string, unknown> | null = null;

jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: mockUser }),
}));
jest.mock("@/src/contexts/I18nContext", () => require("./support/mocks").i18nMock({ params: "colon", locale: "zh-Hans", setLocale: () => {}, hydrated: true }));
jest.mock("@/components/LanguageSwitcher", () => ({ LanguageSwitcher: () => null }));
jest.mock("@/src/components/layout/ThemeToggle", () => ({ ThemeToggle: () => null }));

beforeEach(() => {
  mockUser = null;
});

describe("the landing page", () => {
  it("has four cards in order, each linking to sign-in with its civilization", () => {
    render(<HomePage />);
    const links = within(screen.getByTestId("landing-civs")).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/login?civ=cn", "/login?civ=eu", "/login?civ=eg", "/login?civ=gr"]);
  });

  it("names each card for a screen reader", () => {
    render(<HomePage />);
    expect(screen.getByTestId("landing-card-eg")).toHaveAttribute("aria-label", "demo.landing.card_label:demo.civ.eg.name");
  });

  it("carries no demo copy of its own", () => {
    const { container } = render(<HomePage />);
    expect(container.textContent).not.toContain("demo.landing.kicker");
    expect(screen.queryByTestId("demo-enter-admin")).toBeNull();
  });

  it("anonymous: the console link goes to /login", () => {
    render(<HomePage />);
    expect(screen.getByTestId("landing-console")).toHaveAttribute("href", "/login");
  });

  it("signed in: the console link goes to /dashboard", () => {
    mockUser = { display_name: "崔判官", username: "cui", tenant: { code: "CN_DIYU" } };
    render(<HomePage />);
    expect(screen.getByTestId("landing-console")).toHaveAttribute("href", "/dashboard");
  });

  it("shows a console thumbnail under the cards: one image per theme, lazy, files that exist", () => {
    const fs = jest.requireActual<typeof import("fs")>("fs");
    const path = jest.requireActual<typeof import("path")>("path");
    render(<HomePage />);
    const preview = screen.getByTestId("landing-preview");
    expect(preview).toHaveTextContent("landing.preview_label");
    const imgs = [...preview.querySelectorAll("img")];
    expect(imgs.map((img) => img.getAttribute("data-theme"))).toEqual(["light", "dark"]);
    for (const img of imgs) {
      expect(img).toHaveAttribute("loading", "lazy");
      expect(img).toHaveClass("v4-themed");
      expect(fs.existsSync(path.join(__dirname, "..", "..", "public", img.getAttribute("src")!))).toBe(true);
    }
  });

  it("shows how it is built, with the numbers from the stats file", () => {
    render(<HomePage />);
    expect(screen.getByTestId("landing-architecture")).toHaveTextContent("packages/core");
    expect(screen.getByTestId("landing-numbers")).toHaveTextContent("demo.build.tests.backend");
  });
});
