import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { Spinner, PageSpinner } from "@/src/components/ui/Spinner";
import { I18nProvider } from "@/src/contexts/I18nContext";

const SOURCE = readFileSync(
  path.join(__dirname, "..", "components", "ui", "Spinner.tsx"),
  "utf8"
);
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const APP_DIR = path.join(__dirname, "..", "..", "app");

function loadingFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) loadingFiles(full, out);
    else if (entry.name === "loading.tsx") out.push(full);
  }
  return out;
}

function classesIn(container: HTMLElement): string[] {
  return [...container.querySelectorAll("*")].flatMap((el) =>
    el.className.toString().split(/\s+/).filter(Boolean)
  );
}

describe("the ring-3 colour is a token, and there is only one of it", () => {
  /**
   * 21 `app/**&#47;loading.tsx` files, 20 of them the same six lines. Fifteen
   * hardcode `border-amber-500/20` + `border-t-amber-500`; five write the
   * `--color-accent` token. Those two spellings were NOT the same colour until
   * the first wave dropped tailwind.config.js's `amber` override, which had
   * shifted the whole scale one step brighter than Tailwind's own — so
   * `amber-500` was #fbbf24 while `--color-accent` is #f59e0b.
   *
   * They agree now, and agreeing by coincidence is the thing to remove:
   * `--color-accent` is user-configurable at runtime, and a palette literal
   * cannot follow it. Fifteen spinners would keep spinning amber after the
   * user picked another accent.
   */
  it("paints both rings from --color-accent", () => {
    const { container } = render(<Spinner />);
    const classes = classesIn(container);
    expect(classes).toContain("border-[hsl(var(--color-accent)/0.2)]");
    expect(classes).toContain("border-t-[hsl(var(--color-accent))]");
  });

  it("names no palette colour at all", () => {
    // Absence, asserted, and by family rather than by the one value: swapping
    // amber for another literal is the same defect wearing a different hue.
    expect(CODE).not.toMatch(
      /\b(?:border|bg|text)(?:-t|-b|-l|-r)?-(?:amber|yellow|orange|red|blue|green|slate|gray|grey|zinc|neutral|stone)-\d{2,3}\b/
    );
  });

  it("still finds the 21 loading.tsx files this replaces", () => {
    // The floor for the scan below. A guard that scans nothing is green, and
    // "found no palette literals" would be the passing state on the day the
    // walk broke.
    expect(loadingFiles(APP_DIR).length).toBeGreaterThanOrEqual(20);
  });
});

describe("it announces itself, or it says nothing — never an empty live region", () => {
  it("is a status with a readable label when given one", () => {
    render(<Spinner label="载入中" />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText("载入中")).toHaveClass("sr-only");
  });

  it("is hidden from assistive tech when unlabelled", () => {
    // The `<Button loading>` case: the button's own text is already the
    // accessible name, and `role="status"` carries an implicit aria-live, so an
    // unlabelled one would be a live region with nothing to announce.
    const { container } = render(<Spinner />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });

  it("does not also mark itself aria-hidden when it is a status", () => {
    // Both at once renders identically and announces nothing.
    render(<Spinner label="载入中" />);
    expect(screen.getByRole("status")).not.toHaveAttribute("aria-hidden");
  });

  it("keeps its two rings decorative in both modes", () => {
    const { container } = render(<Spinner label="载入中" />);
    const rings = [...container.querySelectorAll("[aria-hidden='true']")];
    expect(rings).toHaveLength(2);
  });
});

describe("motion", () => {
  it("stops turning under prefers-reduced-motion", () => {
    // Not decoration-trimming: a continuously rotating element is exactly what
    // the media query exists to stop. The ring stays visible.
    const { container } = render(<Spinner />);
    const classes = classesIn(container);
    expect(classes).toContain("animate-spin");
    expect(classes).toContain("motion-reduce:animate-none");
  });
});

describe("size", () => {
  it.each([
    ["sm", "w-4", "h-4", "border-2"],
    ["md", "w-6", "h-6", "border-2"],
    ["lg", "w-16", "h-16", "border-4"],
  ] as const)("%s is %s/%s with a %s ring-3", (size, w, h, border) => {
    const { container } = render(<Spinner size={size} />);
    const classes = classesIn(container);
    expect(classes).toEqual(expect.arrayContaining([w, h, border]));
  });

  it("defaults to md", () => {
    const { container } = render(<Spinner />);
    expect(classesIn(container)).toEqual(expect.arrayContaining(["w-6", "h-6"]));
  });

  it("does not put a 4px ring-3 on a 16px box", () => {
    // Ring width tracks diameter; the wrong pairing renders a donut, and it is
    // the pairing you get by copying the lg spinner into an inline slot.
    const { container } = render(<Spinner size="sm" />);
    expect(classesIn(container)).not.toContain("border-4");
  });
});

describe("PageSpinner is the whole-route shape those 20 files hand-roll", () => {
  it("fills AppLayout's slot exactly — never a whole viewport inside it", () => {
    const { container } = render(<PageSpinner label="载入中" />);
    const root = container.firstElementChild!;
    // This used to assert `min-h-screen`, which pinned the defect rather than
    // the requirement. A route's loading.tsx renders inside AppLayout.tsx:418's
    // `min-h-[calc(100vh-4rem)]` slot, so 100vh here is 100vh nested inside
    // 100vh−4rem — the same 64px of dead scroll 46 files were carrying and that
    // PageShell exists to delete, reintroduced through the one component all 21
    // loading files adopt. Asserting the absence matters as much as asserting
    // the presence: "the right value is shown" stays green while the wrong one
    // sits beside it.
    expect(root.className).toContain("min-h-[calc(100vh-4rem)]");
    expect(root.className).not.toContain("min-h-screen");
    expect(root.className).toContain("bg-[hsl(var(--color-canvas))]");
    expect(classesIn(container)).toEqual(expect.arrayContaining(["w-16", "h-16", "border-4"]));
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});

describe("a whole-route busy screen is never silent", () => {
  /**
   * 32 files import `PageSpinner`; exactly one of them passed `label`. An
   * unlabelled `Spinner` is `aria-hidden` by design — correct inside `<Button
   * loading>`, where the button's own text is the announcement — so 31 routes
   * were replacing everything on screen with an element assistive tech is told
   * to ignore. There is no neighbouring text on a route that has been replaced
   * by its spinner; the label has to come from the component.
   *
   * The real `I18nProvider` is used here, not a `t: (key) => key` stub. The
   * claim under test is that `common.loading` resolves in the shipped bundles,
   * and a stub that echoes its argument would pass whether the key exists or
   * not — a double that behaves like the bug.
   */
  const inProvider = (node: React.ReactElement) => render(<I18nProvider>{node}</I18nProvider>);

  it("announces a default label when the route supplies none", () => {
    inProvider(<PageSpinner />);
    const status = screen.getByRole("status");
    // zh-Hans is DEFAULT_LOCALE and no cookie is set, so this is the real
    // bundle's copy, resolved through the real lookup.
    expect(status).toHaveTextContent("加载中...");
  });

  it("does not announce the raw key", () => {
    // Absence, asserted separately: `t()` returns the key unchanged when it
    // misses, so "a status exists and has text" stays green while a screen
    // reader says "common dot loading".
    inProvider(<PageSpinner />);
    expect(screen.getByRole("status")).not.toHaveTextContent("common.loading");
    expect(screen.queryByText("common.loading")).not.toBeInTheDocument();
  });

  it("is never aria-hidden, whether or not the route named it", () => {
    const { container } = inProvider(<PageSpinner />);
    const spinner = container.querySelector("[role='status']");
    expect(spinner).toBeTruthy();
    expect(spinner).not.toHaveAttribute("aria-hidden");
  });

  it("still lets a route say something more specific than 'loading'", () => {
    // `app/judgment/[id]/page.tsx` passes `judgment.detail.loading`. The
    // default is a floor, not a ceiling.
    inProvider(<PageSpinner label="载入判词" />);
    expect(screen.getByRole("status")).toHaveTextContent("载入判词");
    expect(screen.getByRole("status")).not.toHaveTextContent("加载中");
  });
});
