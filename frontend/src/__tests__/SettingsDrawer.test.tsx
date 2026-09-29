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
        "settings.nav_mode": "Navigation Mode",
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
    // The backdrop is the full-screen button (规范 v2: scrim token, not bg-black/50)
    const backdrop = document.querySelector("button.fixed.inset-0");
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

  it("没有「导航模式」一节 —— 立柱只有一种宽度规则(规范 v2)", () => {
    renderDrawer();
    expect(screen.queryByText("Navigation Mode")).not.toBeInTheDocument();
  });
});

/**
 * 规范 v2 撤掉了用户自选强调色(2026-09-30),不加替代开关。这里断的是**不在**:
 * 没有那一节、没有色块、没有 hex 输入;旧用户 localStorage 里存着的选择被忽略 ——
 * 打开抽屉之后 <html> 上没有任何行内的 accent 令牌。
 */
describe("the accent picker is gone (规范 v2)", () => {
  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("style");
  });

  it("renders no accent section, no swatches and no hex input", () => {
    renderDrawer();
    expect(screen.queryByText("settings.accent_color")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("#ff5500")).not.toBeInTheDocument();
    expect(document.querySelectorAll(".grid.grid-cols-3 button")).toHaveLength(0);
  });

  it("ignores a stored pick from before v2", () => {
    localStorage.setItem("soulledger_accent_color", "#3b82f6");
    renderDrawer();
    for (const token of ["--color-accent", "--color-accent-hover", "--color-accent-ink"]) {
      expect(document.documentElement.style.getPropertyValue(token)).toBe("");
    }
  });
});
