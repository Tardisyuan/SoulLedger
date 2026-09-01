/**
 * `role="menu"` and `role="listbox"` are promises. These are the tests that
 * make them true.
 *
 * Both grid popups declared their role and implemented none of the navigation
 * it announces. `ActionsMenu` was the serious one: it is the actions column of
 * every row of every table in the app, every destructive action lives behind
 * its "⋯" trigger, and its panel is portaled to `document.body` — so Tab from
 * the trigger went to the NEXT ROW's actions rather than into the menu that
 * had just opened, focus never entered the panel, no arrow key did anything,
 * and Escape dropped focus on the body. Delete and restore were, in practice,
 * mouse-only across the app (WCAG 2.1.1 operable-by-keyboard, 4.1.2
 * name/role/value). `FilterBar`'s chips had the identical broken promise in a
 * milder setting: not portaled, so Tab did reach the options.
 *
 * WHY THESE ASSERTIONS AND NOT "the aria attributes are present". The
 * attributes were already all present and correct — `aria-haspopup`,
 * `aria-expanded`, `role`, `aria-label` — on a component that could not be
 * operated. An attribute test would have been green throughout. What has to be
 * asserted is where `document.activeElement` ends up after a key.
 */
import { render, screen, fireEvent } from "@testing-library/react";

import { ActionsMenu } from "@/components/ui/data-grid/ActionsMenu";

function renderMenu(overrides?: { disabledSecond?: boolean }) {
  const onFirst = jest.fn();
  const onLast = jest.fn();
  render(
    <ActionsMenu
      menuLabel="Row actions"
      items={[
        { key: "view", label: "View", onSelect: onFirst },
        { key: "edit", label: "Edit", onSelect: jest.fn(), disabled: overrides?.disabledSecond },
        { key: "delete", label: "Delete", onSelect: onLast, tone: "danger" },
      ]}
    />
  );
  const trigger = screen.getByRole("button", { name: "Row actions" });
  return { trigger, onFirst, onLast };
}

function openMenu() {
  const { trigger, onFirst, onLast } = renderMenu();
  fireEvent.click(trigger);
  return { trigger, onFirst, onLast };
}

describe("the actions menu is operable from the keyboard", () => {
  it("moves focus into the menu when it opens", () => {
    openMenu();
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "View" }));
  });

  it("opens on ArrowDown from the trigger, as a menu button should", () => {
    const { trigger } = renderMenu();
    trigger.focus();

    fireEvent.keyDown(trigger, { key: "ArrowDown" });

    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "View" }));
  });

  it("walks down with ArrowDown and wraps at the end", () => {
    openMenu();

    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Edit" }));

    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Delete" }));

    // Wraps rather than sticking: a menu is a ring.
    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "View" }));
  });

  it("walks up with ArrowUp, wrapping backwards from the first", () => {
    openMenu();

    fireEvent.keyDown(document, { key: "ArrowUp" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Delete" }));
  });

  it("jumps with Home and End", () => {
    openMenu();

    fireEvent.keyDown(document, { key: "End" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Delete" }));

    fireEvent.keyDown(document, { key: "Home" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "View" }));
  });

  it("skips a disabled item instead of parking on it", () => {
    const { trigger } = renderMenu({ disabledSecond: true });
    fireEvent.click(trigger);

    fireEvent.keyDown(document, { key: "ArrowDown" });

    // "Edit" is disabled, so ArrowDown from "View" lands on "Delete".
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Delete" }));
  });

  it("closes on Escape AND puts focus back on the trigger", () => {
    const { trigger } = openMenu();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    // Without this half, Escape leaves focus on <body> and the keyboard has to
    // start over from the top of the page.
    expect(document.activeElement).toBe(trigger);
  });

  it("closes on Tab rather than tabbing into a portal in the wrong place", () => {
    openMenu();

    fireEvent.keyDown(document, { key: "Tab" });

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("returns focus to the trigger before running the action", () => {
    // The order matters: several of these actions open a @headlessui dialog,
    // which restores focus on close to whatever held it on open. If the menu
    // item still held focus, that element is gone by then and the restore
    // lands on <body>.
    const focusedWhenSelected: (Element | null)[] = [];
    render(
      <ActionsMenu
        menuLabel="Row actions"
        items={[
          {
            key: "delete",
            label: "Delete",
            onSelect: () => focusedWhenSelected.push(document.activeElement),
          },
        ]}
      />
    );
    const trigger = screen.getByRole("button", { name: "Row actions" });
    fireEvent.click(trigger);

    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));

    expect(focusedWhenSelected).toEqual([trigger]);
  });

  it("does not leave the items as tab stops, which would double the navigation", () => {
    openMenu();
    for (const item of screen.getAllByRole("menuitem")) {
      expect(item).toHaveAttribute("tabindex", "-1");
    }
  });
});
