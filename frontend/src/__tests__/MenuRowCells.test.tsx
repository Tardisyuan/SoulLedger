/**
 * MenuRowCells resolves `menu.icon` by lucide-react *export name*
 * (`LucideIcons[menu.icon]`), and that name is whatever IconPicker stored.
 *
 * lucide-react 1.x turned several names the DB already holds into aliases:
 * menus migration 0009 seeds "BarChart" and "Building2", 0013 "Scroll",
 * 0015 "Clock". An alias is the same component as its canonical icon, so its
 * `displayName` is the canonical name ("ChartNoAxesColumnIncreasing",
 * "BuildingComplex") — which is what IconPicker now stores for a fresh pick.
 * Both spellings must keep drawing the same icon, or seeded rows and freshly
 * edited rows silently lose their icon (no error: the lookup is `undefined`
 * and the cell renders the name alone).
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { MenuRowCells } from "@/src/components/menus/MenuRowCells";
import { IconPicker } from "@/src/components/ui/IconPicker";
import type { MenuItemFull } from "@/src/components/menus/menuTypes";

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({ locale: "en", setLocale: jest.fn(), t: (key: string) => key, hydrated: true }),
}));

// The real permission gate runs; only the user behind it is supplied.
jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({
    user: { id: 1, username: "a", display_name: "A", email: "a@example.com", role: "ADMIN", tenant: null, permissions: [] },
  }),
}));

jest.mock("@/src/components/ui/Modal", () => ({
  BaseModal({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) {
    return isOpen ? <div data-testid="mock-modal">{children}</div> : null;
  },
}));

function menu(icon: string | null): MenuItemFull {
  return {
    id: 1, name: "Row", path: "/row", icon, order: 1, component: null,
    roles: [], is_active: true, parent: null,
  } as MenuItemFull;
}

/** The svg drawn in the name cell, or null. */
function iconIn(icon: string | null): string | null {
  const { container, unmount } = render(
    <table><tbody><tr><MenuRowCells menu={menu(icon)} onEdit={jest.fn()} onDelete={jest.fn()} /></tr></tbody></table>
  );
  const svg = container.querySelector("td")!.querySelector("svg");
  const html = svg ? svg.outerHTML : null;
  unmount();
  return html;
}

describe("MenuRowCells icon lookup", () => {
  it.each(["BarChart", "Building2", "Scroll", "Clock"])(
    "draws an icon for the stored name %s (menus migrations 0009/0013/0015)",
    (name) => {
      expect(iconIn(name)).not.toBeNull();
    }
  );

  it("draws nothing for a name lucide does not export, or for no name", () => {
    expect(iconIn("NoSuchIcon")).toBeNull();
    expect(iconIn(null)).toBeNull();
  });

  it("a name IconPicker stores resolves to the same icon as the seeded alias", () => {
    const onChange = jest.fn();
    render(<IconPicker value="" onChange={onChange} />);
    fireEvent.click(screen.getByText("icon_picker.select"));
    fireEvent.click(screen.getByText("icon_picker.categories.charts"));
    // First icon in the charts category is `BarChart`; its button is labelled
    // with the displayName, which is what gets stored.
    fireEvent.click(screen.getByRole("button", { name: "ChartNoAxesColumnIncreasing" }));
    const stored = onChange.mock.calls[0][0] as string;
    expect(stored).toBe("ChartNoAxesColumnIncreasing");

    const fromPicker = iconIn(stored);
    expect(fromPicker).not.toBeNull();
    expect(fromPicker).toBe(iconIn("BarChart"));
  });

  it("IconPicker previews a row stored under an alias name", () => {
    const { container } = render(<IconPicker value="Building2" onChange={jest.fn()} />);
    expect(container.querySelector("button svg")).not.toBeNull();
    expect(screen.queryByText("icon_picker.select")).not.toBeInTheDocument();
  });
});
