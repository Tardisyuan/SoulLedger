/**
 * Tests for src/components/ui/IconPicker.tsx
 */
import { render, screen, fireEvent, within } from "@testing-library/react";
import { IconPicker } from "@/src/components/ui/IconPicker";

// ── Mock I18nContext ──────────────────────────────────
jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    locale: "en",
    setLocale: jest.fn(),
    t: (key: string) => {
      const map: Record<string, string> = {
        "icon_picker.select": "Select Icon",
        "icon_picker.clear": "Clear",
        "icon_picker.search": "Search icons...",
        "icon_picker.no_results": "No results found",
        "icon_picker.categories.navigation": "Navigation",
        "icon_picker.categories.users": "Users",
        "icon_picker.categories.notifications": "Notifications",
        "icon_picker.categories.actions": "Actions",
        "icon_picker.categories.view": "View",
        "icon_picker.categories.status": "Status",
        "icon_picker.categories.security": "Security",
        "icon_picker.categories.soul": "Soul",
        "icon_picker.categories.travel": "Travel",
        "icon_picker.categories.files": "Files",
        "icon_picker.categories.charts": "Charts",
        "icon_picker.categories.admin": "Admin",
        "icon_picker.categories.time": "Time",
        "icon_picker.categories.media": "Media",
      };
      return map[key] ?? key;
    },
    hydrated: true,
  }),
}));

// ── Mock BaseModal (headlessui Dialog is hard to test in jsdom) ──
jest.mock("@/src/components/ui/Modal", () => ({
  BaseModal({
    isOpen,
    onClose,
    title,
    children,
  }: {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: React.ReactNode;
  }) {
    if (!isOpen) return null;
    return (
      <div data-testid="mock-modal">
        <div>{title}</div>
        <button data-testid="modal-close" onClick={onClose}>
          close
        </button>
        {children}
      </div>
    );
  },
}));

// ── Tests ────────────────────────────────────────────

describe("IconPicker", () => {
  const defaultProps = {
    value: "",
    onChange: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // --- Rendering ---

  it("should render the trigger button with placeholder text", () => {
    render(<IconPicker {...defaultProps} />);
    expect(screen.getByText("Select Icon")).toBeInTheDocument();
  });

  it("should display the icon name when a value is provided", () => {
    render(<IconPicker value="Home" onChange={jest.fn()} />);
    expect(screen.getByText("Home")).toBeInTheDocument();
  });

  it("should show a clear button when a value is selected", () => {
    render(<IconPicker value="Home" onChange={jest.fn()} />);
    expect(screen.getByText("Clear")).toBeInTheDocument();
  });

  it("should not show a clear button when no value is selected", () => {
    render(<IconPicker {...defaultProps} />);
    expect(screen.queryByText("Clear")).not.toBeInTheDocument();
  });

  // --- Modal open/close ---

  it("should open the modal when the trigger button is clicked", () => {
    render(<IconPicker {...defaultProps} />);
    expect(screen.queryByTestId("mock-modal")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Select Icon"));
    expect(screen.getByTestId("mock-modal")).toBeInTheDocument();
  });

  it("should close the modal when the close button is clicked", () => {
    render(<IconPicker {...defaultProps} />);

    // Open
    fireEvent.click(screen.getByText("Select Icon"));
    expect(screen.getByTestId("mock-modal")).toBeInTheDocument();

    // Close
    fireEvent.click(screen.getByTestId("modal-close"));
    expect(screen.queryByTestId("mock-modal")).not.toBeInTheDocument();
  });

  // --- Category tabs ---

  it("should render category tabs in the modal", () => {
    render(<IconPicker {...defaultProps} />);
    fireEvent.click(screen.getByText("Select Icon"));

    expect(screen.getByText("Navigation")).toBeInTheDocument();
    expect(screen.getByText("Users")).toBeInTheDocument();
    expect(screen.getByText("Soul")).toBeInTheDocument();
    expect(screen.getByText("Security")).toBeInTheDocument();
  });

  it("should start with 'navigation' as the active category", () => {
    render(<IconPicker {...defaultProps} />);
    fireEvent.click(screen.getByText("Select Icon"));

    const navBtn = screen.getByText("Navigation");
    expect(navBtn.className).toContain("bg-amber-500");
  });

  it("should switch categories when a tab is clicked", () => {
    render(<IconPicker {...defaultProps} />);
    fireEvent.click(screen.getByText("Select Icon"));

    fireEvent.click(screen.getByText("Users"));
    const usersBtn = screen.getByText("Users");
    expect(usersBtn.className).toContain("bg-amber-500");

    const navBtn = screen.getByText("Navigation");
    expect(navBtn.className).not.toContain("bg-amber-500");
  });

  // --- Icon grid ---

  it("should render icon buttons in the grid", () => {
    render(<IconPicker {...defaultProps} />);
    fireEvent.click(screen.getByText("Select Icon"));

    // The grid container has class "grid grid-cols-8" - find buttons inside it
    // Each icon is rendered as a button inside a grid. Look for SVGs inside the modal.
    const modal = screen.getByTestId("mock-modal");
    const svgElements = modal.querySelectorAll("svg");
    // navigation category has many icons, so there should be many SVGs
    expect(svgElements.length).toBeGreaterThan(5);
  });

  // --- Select icon ---

  it("should call onChange when an icon button in the grid is clicked", () => {
    const onChange = jest.fn();
    render(<IconPicker value="" onChange={onChange} />);
    fireEvent.click(screen.getByText("Select Icon"));

    // Find icon buttons: they are inside the grid container
    // Each icon button has an SVG child and a specific class
    const modal = screen.getByTestId("mock-modal");
    const gridButtons = modal.querySelectorAll(".grid button");
    expect(gridButtons.length).toBeGreaterThan(0);

    // Click the first icon button
    fireEvent.click(gridButtons[0]);
    expect(onChange).toHaveBeenCalled();
    // The value passed to onChange should be a non-empty string (icon displayName)
    expect(onChange.mock.calls[0][0]).toBeTruthy();
  });

  it("should close the modal after selecting an icon", () => {
    const onChange = jest.fn();
    render(<IconPicker value="" onChange={onChange} />);
    fireEvent.click(screen.getByText("Select Icon"));

    const modal = screen.getByTestId("mock-modal");
    const gridButtons = modal.querySelectorAll(".grid button");
    fireEvent.click(gridButtons[0]);

    expect(screen.queryByTestId("mock-modal")).not.toBeInTheDocument();
  });

  // --- Search ---

  it("should show a search input in the modal", () => {
    render(<IconPicker {...defaultProps} />);
    fireEvent.click(screen.getByText("Select Icon"));

    const searchInput = screen.getByPlaceholderText("Search icons...");
    expect(searchInput).toBeInTheDocument();
  });

  it("should filter icons based on search text", () => {
    render(<IconPicker {...defaultProps} />);
    fireEvent.click(screen.getByText("Select Icon"));

    // Count icons before search
    const modal = screen.getByTestId("mock-modal");
    const allButtonsBefore = modal.querySelectorAll(".grid button");
    const countBefore = allButtonsBefore.length;
    expect(countBefore).toBeGreaterThan(0);

    // Type a search term that won't match any icon displayName in jsdom
    // (lucide displayName is undefined in test env, so any search yields 0)
    const searchInput = screen.getByPlaceholderText("Search icons...");
    fireEvent.change(searchInput, { target: { value: "zzz" } });

    // Count icons after search - should be 0 (no match)
    const allButtonsAfter = modal.querySelectorAll(".grid button");
    expect(allButtonsAfter.length).toBeLessThan(countBefore);
  });

  it("should hide category tabs when search is active", () => {
    render(<IconPicker {...defaultProps} />);
    fireEvent.click(screen.getByText("Select Icon"));

    const searchInput = screen.getByPlaceholderText("Search icons...");
    fireEvent.change(searchInput, { target: { value: "Home" } });

    expect(screen.queryByText("Navigation")).not.toBeInTheDocument();
    expect(screen.queryByText("Users")).not.toBeInTheDocument();
  });

  it("should show 'no results' message when search matches nothing", () => {
    render(<IconPicker {...defaultProps} />);
    fireEvent.click(screen.getByText("Select Icon"));

    const searchInput = screen.getByPlaceholderText("Search icons...");
    fireEvent.change(searchInput, { target: { value: "zzznonexistent" } });

    expect(screen.getByText("No results found")).toBeInTheDocument();
  });

  it("should restore category view when search is cleared", () => {
    render(<IconPicker {...defaultProps} />);
    fireEvent.click(screen.getByText("Select Icon"));

    const searchInput = screen.getByPlaceholderText("Search icons...");
    fireEvent.change(searchInput, { target: { value: "Home" } });
    expect(screen.queryByText("Navigation")).not.toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: "" } });
    expect(screen.getByText("Navigation")).toBeInTheDocument();
  });

  // --- Clear selection ---

  it("should call onChange with empty string when clear is clicked", () => {
    const onChange = jest.fn();
    render(<IconPicker value="Home" onChange={onChange} />);

    fireEvent.click(screen.getByText("Clear"));
    expect(onChange).toHaveBeenCalledWith("");
  });
});
