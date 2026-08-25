import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { Spinner, PageSpinner } from "@/src/components/ui/Spinner";

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

describe("the ring colour is a token, and there is only one of it", () => {
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
  ] as const)("%s is %s/%s with a %s ring", (size, w, h, border) => {
    const { container } = render(<Spinner size={size} />);
    const classes = classesIn(container);
    expect(classes).toEqual(expect.arrayContaining([w, h, border]));
  });

  it("defaults to md", () => {
    const { container } = render(<Spinner />);
    expect(classesIn(container)).toEqual(expect.arrayContaining(["w-6", "h-6"]));
  });

  it("does not put a 4px ring on a 16px box", () => {
    // Ring width tracks diameter; the wrong pairing renders a donut, and it is
    // the pairing you get by copying the lg spinner into an inline slot.
    const { container } = render(<Spinner size="sm" />);
    expect(classesIn(container)).not.toContain("border-4");
  });
});

describe("PageSpinner is the whole-route shape those 20 files hand-roll", () => {
  it("fills the viewport on the canvas and centres one lg spinner", () => {
    const { container } = render(<PageSpinner label="载入中" />);
    const root = container.firstElementChild!;
    expect(root.className).toContain("min-h-screen");
    expect(root.className).toContain("bg-canvas");
    expect(classesIn(container)).toEqual(expect.arrayContaining(["w-16", "h-16", "border-4"]));
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
