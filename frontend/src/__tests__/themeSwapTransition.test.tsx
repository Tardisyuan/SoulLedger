import { act, render, screen } from "@testing-library/react";
import { ThemeProvider, useTheme } from "@/src/contexts/ThemeContext";

/**
 * The `theme-switching` class, which is the only reason the theme swap is a
 * change rather than a cut.
 *
 * WHAT IS ACTUALLY AT RISK HERE. The rule in `app/globals.css` is scoped to
 * `html.theme-switching *` and it is deliberately temporary: left on, it would
 * put a 160ms colour tween on every hover, every focus ring and every state
 * change in the application, and keep a selector that matches every node
 * active forever to serve an interaction that happens a few times a session.
 * So "it comes back off" is not a detail of the implementation, it is the
 * thing that makes the implementation acceptable — and a timer that silently
 * stops firing leaves no visible trace beyond every transition in the app
 * being subtly wrong.
 *
 * `<html>` is not React's to clean up, so nothing else would ever take the
 * class off.
 *
 * WHAT THIS DOES NOT CHECK, said plainly: that the colours actually animate.
 * jsdom does not run CSS animations or resolve Tailwind classes to computed
 * styles, so no assertion here can see a tween. What is asserted is the
 * mechanism the tween depends on — the class is present across the swap and
 * gone afterwards. The visual half is a browser question and belongs in
 * Playwright if it is ever pinned at all.
 */

function Toggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <button type="button" onClick={toggleTheme}>
      {theme}
    </button>
  );
}

function renderToggle() {
  return render(
    <ThemeProvider>
      <Toggle />
    </ThemeProvider>
  );
}

describe("theme swap transition", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    document.documentElement.className = "";
    localStorage.clear();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    document.documentElement.className = "";
  });

  it("is not on the root until a swap happens", () => {
    renderToggle();
    expect(document.documentElement.classList.contains("theme-switching")).toBe(false);
  });

  it("goes on with the swap and comes off after it", () => {
    renderToggle();

    act(() => {
      screen.getByRole("button").click();
    });

    const root = document.documentElement;
    expect(root.classList.contains("theme-switching")).toBe(true);
    // The colour classes changed in the same commit — that is what the
    // transition has to span.
    expect(root.classList.contains("light")).toBe(true);

    // Still on part-way through: a class removed early cuts the swap in half.
    act(() => {
      jest.advanceTimersByTime(100);
    });
    expect(root.classList.contains("theme-switching")).toBe(true);

    act(() => {
      jest.advanceTimersByTime(100);
    });
    expect(root.classList.contains("theme-switching")).toBe(false);
    expect(root.classList.contains("light")).toBe(true);
  });

  it("does not leave the class on the root when the provider unmounts mid-swap", () => {
    // The realistic version of this is a theme switch immediately followed by a
    // navigation. `<html>` outlives the provider, so without the cleanup the
    // class stays and every colour change on the next page inherits a tween.
    const { unmount } = renderToggle();

    act(() => {
      screen.getByRole("button").click();
    });
    expect(document.documentElement.classList.contains("theme-switching")).toBe(true);

    unmount();

    expect(document.documentElement.classList.contains("theme-switching")).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
  });
});
