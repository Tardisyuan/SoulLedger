/**
 * Tests for SettingsDrawer component
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { SettingsDrawer } from "@/src/components/settings/SettingsDrawer";

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "settings.title": "Settings",
        "settings.theme": "Theme",
        "settings.light": "Light",
        "settings.dark": "Dark",
        "settings.accent_color": "Accent Color",
        "settings.nav_mode": "Navigation Mode",
        "settings.classic": "Classic",
        "settings.compact": "Compact",
        "settings.classic_desc": "Full sidebar with icons and labels",
        "settings.compact_desc": "Icons only with tooltips on hover",
        "settings.apply": "Apply",
        "settings.colors.amber": "Amber",
        "settings.colors.blue": "Blue",
        "settings.colors.green": "Green",
        "settings.colors.purple": "Purple",
        "settings.colors.red": "Red",
        "settings.colors.rose": "Rose",
      };
      return map[key] || key;
    },
    locale: "en",
    hydrated: true,
  }),
}));

jest.mock("@/src/contexts/ThemeContext", () => ({
  useTheme: () => ({
    theme: "dark",
    toggleTheme: jest.fn(),
  }),
}));

// Mock lucide-react icons
jest.mock("lucide-react", () => ({
  X: (props: any) => <svg data-testid="icon-x" {...props} />,
  Sun: (props: any) => <svg data-testid="icon-sun" {...props} />,
  Moon: (props: any) => <svg data-testid="icon-moon" {...props} />,
}));

const defaultProps = {
  open: true,
  onClose: jest.fn(),
  navMode: "classic" as const,
  onNavModeChange: jest.fn(),
};

function renderDrawer(overrides = {}) {
  return render(<SettingsDrawer {...defaultProps} {...overrides} />);
}

describe("SettingsDrawer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders nothing when open is false", () => {
    const { container } = renderDrawer({ open: false });
    expect(container.innerHTML).toBe("");
  });

  it("renders the drawer with title when open", () => {
    renderDrawer();
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("calls onClose when close button (X) is clicked", () => {
    const onClose = jest.fn();
    renderDrawer({ onClose });
    const closeButtons = screen.getAllByRole("button");
    // The X button is the first button (close in header)
    const xButton = closeButtons.find(
      (btn) => btn.querySelector('[data-testid="icon-x"]') !== null
    );
    expect(xButton).toBeTruthy();
    fireEvent.click(xButton!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when backdrop is clicked", () => {
    const onClose = jest.fn();
    renderDrawer({ onClose });
    // The backdrop is the first div with fixed inset-0
    const backdrop = document.querySelector(".fixed.inset-0.bg-black\\/50");
    expect(backdrop).toBeTruthy();
    fireEvent.click(backdrop!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders theme section with light and dark buttons", () => {
    renderDrawer();
    expect(screen.getByText("Theme")).toBeInTheDocument();
    expect(screen.getByText("Light")).toBeInTheDocument();
    expect(screen.getByText("Dark")).toBeInTheDocument();
  });

  it("renders accent color section", () => {
    renderDrawer();
    expect(screen.getByText("Accent Color")).toBeInTheDocument();
  });

  it("renders navigation mode section", () => {
    renderDrawer();
    expect(screen.getByText("Navigation Mode")).toBeInTheDocument();
    expect(screen.getByText("Classic")).toBeInTheDocument();
    expect(screen.getByText("Compact")).toBeInTheDocument();
  });

  it("shows classic description when navMode is classic", () => {
    renderDrawer({ navMode: "classic" });
    expect(screen.getByText("Full sidebar with icons and labels")).toBeInTheDocument();
  });

  it("shows compact description when navMode is compact", () => {
    renderDrawer({ navMode: "compact" });
    expect(screen.getByText("Icons only with tooltips on hover")).toBeInTheDocument();
  });

  it("calls onNavModeChange when classic button is clicked", () => {
    const onNavModeChange = jest.fn();
    renderDrawer({ onNavModeChange });
    fireEvent.click(screen.getByText("Classic"));
    expect(onNavModeChange).toHaveBeenCalledWith("classic");
  });

  it("calls onNavModeChange when compact button is clicked", () => {
    const onNavModeChange = jest.fn();
    renderDrawer({ onNavModeChange });
    fireEvent.click(screen.getByText("Compact"));
    expect(onNavModeChange).toHaveBeenCalledWith("compact");
  });

  it("renders accent color preset buttons", () => {
    renderDrawer();
    // Should have 6 color preset buttons (Amber, Blue, Green, Purple, Red, Rose)
    const colorButtons = document.querySelectorAll(".grid.grid-cols-3 button");
    expect(colorButtons.length).toBe(6);
  });

  it("renders custom hex input", () => {
    renderDrawer();
    const hexInput = screen.getByPlaceholderText("#ff5500");
    expect(hexInput).toBeInTheDocument();
  });

  it("renders apply button for custom hex", () => {
    renderDrawer();
    expect(screen.getByText("Apply")).toBeInTheDocument();
  });
});

/**
 * The accent is three tokens, and this is what keeps it that way.
 *
 * `applyAccentColor` used to set `--color-accent` alone. The other two are not
 * decorative: measured 2026-09-01, `--color-accent-ink` is read at **92 sites**
 * (every accent heading, link and eyebrow) and `--color-accent-hover` at 10.
 * Picking Blue turned the fills blue and left all of that amber — the feature
 * looked like it worked because the square you clicked did change.
 *
 * The theme is part of it: `--color-accent-ink` is declared equal to the accent
 * in dark and darkened in light (the accent measures 2.13:1 on white), and the
 * drawer writes INLINE properties on documentElement, which apply to both.
 */
describe("the accent picker writes the whole accent, not a third of it", () => {
  const readToken = (name: string) =>
    document.documentElement.style.getPropertyValue(name);

  beforeEach(() => {
    document.documentElement.removeAttribute("style");
    // The drawer persists the accent and re-applies it on mount, so without
    // this the next test reads the previous test's colour back out of storage.
    try {
      localStorage.clear();
    } catch {
      // jsdom without storage
    }
  });

  it("sets accent, hover and ink together", () => {
    renderDrawer();

    const blue = document.querySelectorAll<HTMLButtonElement>(".grid.grid-cols-3 button")[1];
    fireEvent.click(blue);

    expect(readToken("--color-accent")).not.toBe("");
    // These two were left at their amber values by the old code.
    expect(readToken("--color-accent-hover")).not.toBe("");
    expect(readToken("--color-accent-ink")).not.toBe("");
    // All three must share the chosen hue — the failure being pinned is
    // exactly "the fill moved and the text did not".
    const hueOf = (v: string) => v.trim().split(" ")[0];
    expect(hueOf(readToken("--color-accent-hover"))).toBe(hueOf(readToken("--color-accent")));
    expect(hueOf(readToken("--color-accent-ink"))).toBe(hueOf(readToken("--color-accent")));
  });

  it("refuses a custom hex too dark for the black label on primary buttons", () => {
    renderDrawer();

    const before = readToken("--color-accent");
    fireEvent.change(screen.getByPlaceholderText("#ff5500"), {
      target: { value: "#101010" },
    });
    fireEvent.click(screen.getByText("Apply"));

    expect(screen.getByRole("alert")).toBeInTheDocument();
    // And it must not have applied it. Primary buttons label the accent fill
    // with text-black; #101010 behind black text is unreadable.
    expect(readToken("--color-accent")).toBe(before);
  });

  it("still accepts a legible custom hex", () => {
    renderDrawer();

    fireEvent.change(screen.getByPlaceholderText("#ff5500"), {
      target: { value: "#ffaa00" },
    });
    fireEvent.click(screen.getByText("Apply"));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(readToken("--color-accent")).not.toBe("");
  });
});
