import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { cn } from "@/lib/utils";
import {
  Button,
  BUTTON_VARIANTS,
  BUTTON_SIZES,
  type ButtonSize,
  type ButtonVariant,
} from "@/src/components/ui/Button";

const SOURCE = readFileSync(
  path.join(__dirname, "..", "components", "ui", "Button.tsx"),
  "utf8"
);

/**
 * Source with comments removed.
 *
 * Every "this file must not contain X" assertion below has to read this and not
 * `SOURCE`, and the first run proved why: four of them went red immediately,
 * because Button.tsx *documents* the things it refuses to do — it names
 * `outline-none`, it names `cursor-not-allowed`, and it quotes
 * app/permissions/page.tsx's `focus-visible:ring-[hsl(var(--color-accent))]` as
 * the anti-example. A scanner that cannot tell a prohibition from its own
 * explanation punishes the file for explaining itself, and the way that gets
 * "fixed" under time pressure is by deleting the comment.
 */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

/** Every variant × size, so "100%" below means the whole matrix and not a sample. */
const MATRIX: Array<[ButtonVariant, ButtonSize]> = BUTTON_VARIANTS.flatMap((variant) =>
  BUTTON_SIZES.map((size) => [variant, size] as [ButtonVariant, ButtonSize])
);

function classesOf(variant: ButtonVariant, size: ButtonSize): string[] {
  const { unmount } = render(
    <Button variant={variant} size={size}>
      label
    </Button>
  );
  const classes = screen.getByRole("button").className.split(/\s+/).filter(Boolean);
  unmount();
  return classes;
}

describe("the class merge does not eat the eight-step type scale", () => {
  /**
   * This block is not about Button. It is here because Button is where the bug
   * surfaced, and because a size variant plus a foreground colour in one `cn()`
   * call is the shape every component in this pass has.
   *
   * `tailwind-merge` ships a fixed table of class groups and does not read
   * `tailwind.config.js`. Its `font-size` group knows `text-xs`…`text-9xl` and
   * arbitrary lengths; `text-02` matches none of them and falls through to the
   * catch-all group for `text-*`, which is text-COLOR. So the size and the
   * colour were treated as one property and the later one deleted the earlier.
   * `lib/utils.ts` now registers 01–08 as font sizes.
   */
  it("keeps a font size and a text colour that are written together", () => {
    expect(cn("bg-accent text-black border-accent", "px-2 py-1 text-02").split(/\s+/)).toEqual(
      expect.arrayContaining(["text-black", "text-02"])
    );
    // Same string, not just separate arguments — the collision was never about
    // argument boundaries, so a fix that only worked across them would be fake.
    expect(cn("text-01 uppercase text-[hsl(var(--color-ink-subtle))]").split(/\s+/)).toEqual(
      expect.arrayContaining(["text-01", "text-[hsl(var(--color-ink-subtle))]"])
    );
  });

  it("still collapses two font sizes against each other", () => {
    // The other half of the fix, and the half a careless patch drops: telling
    // tailwind-merge these are font sizes has to make them conflict with each
    // OTHER, or `cn(base, "text-05")` would emit two sizes and the winner would
    // be decided by stylesheet order instead of by the caller.
    expect(cn("text-02 text-05")).toBe("text-05");
    expect(cn("text-black text-white")).toBe("text-white");
    // Added on review: the t-shirt scale must keep conflicting with itself too.
    // `extend` is additive, but a careless `override` of the font-size group
    // would drop `text-xs`…`text-9xl` from it, and the two scales coexist
    // during migration by design — `text-sm` and `text-03` both live would be
    // harder to diagnose than the bug this fixes, because it renders a size,
    // just not the one anybody chose.
    expect(cn("text-sm text-lg")).toBe("text-lg");
  });

  it("does not make the two scales conflict with each other", () => {
    // The corollary, and the one an over-eager fix gets wrong: `text-sm` and
    // `text-03` ARE the same property, so they must collapse.
    expect(cn("text-sm text-03")).toBe("text-03");
    expect(cn("text-03 text-sm")).toBe("text-sm");
  });

  it("carries the size class through to the rendered button, for every size", () => {
    // The end-to-end version. If the merge regresses, this is the assertion
    // that reports it as a Button defect rather than a utils curiosity.
    const expected: Record<ButtonSize, string> = { sm: "text-02", md: "text-03", lg: "text-04" };
    for (const size of BUTTON_SIZES) {
      expect(classesOf("primary", size)).toContain(expected[size]);
    }
  });
});

describe("interaction states are on every variant and every size", () => {
  /**
   * The counts these replace, measured across app/, src/ and components/:
   * `active:` on 0 of 190 buttons, `disabled:` on 29%, and 14 buttons with no
   * `hover:` at all. "Most of them" is what produced that spread, so each of
   * these asserts the full 12-cell matrix and reports the cells that failed.
   */
  it.each(MATRIX)("%s/%s acknowledges a press", (variant, size) => {
    expect(classesOf(variant, size).filter((c) => c.startsWith("active:")).length).toBeGreaterThan(0);
  });

  it.each(MATRIX)("%s/%s reacts to hover", (variant, size) => {
    expect(classesOf(variant, size).filter((c) => c.startsWith("hover:")).length).toBeGreaterThan(0);
  });

  it.each(MATRIX)("%s/%s styles its disabled state", (variant, size) => {
    expect(classesOf(variant, size).filter((c) => c.startsWith("disabled:")).length).toBeGreaterThan(0);
  });

  it("names the failing cells rather than the first one, when it fails", () => {
    // A per-cell `it.each` stops at the first red and hides the shape of the
    // regression. This one collects the whole matrix so the failure message
    // distinguishes "one variant lost a state" from "the base string is gone".
    const missing = MATRIX.filter(([variant, size]) => {
      const classes = classesOf(variant, size);
      return !["active:", "hover:", "disabled:"].every((prefix) =>
        classes.some((c) => c.startsWith(prefix))
      );
    });
    expect(missing).toEqual([]);
    expect(MATRIX).toHaveLength(12);
  });

  it("kills hover and press on a disabled button rather than leaving them live", () => {
    // `disabled:pointer-events-none` is the load-bearing one. Without it,
    // whether a disabled button still lights up on hover depends on Tailwind's
    // variant ORDER — invisible, and not something a test would notice moving.
    render(<Button disabled>label</Button>);
    expect(screen.getByRole("button").className).toContain("disabled:pointer-events-none");
  });

  it("does not write disabled:cursor-not-allowed, which would render nothing", () => {
    // With pointer events off the cursor never changes, so that class emits CSS
    // that can never apply. Writing it would be the same species of defect as
    // WorkflowEditor.tsx:488's malformed `placeholder:[hsl(...)]`: a class that
    // looks like an intention and produces no style.
    expect(CODE).not.toContain("cursor-not-allowed");
  });
});

describe("the primary button's foreground is the one that passes AA", () => {
  /**
   * `--color-accent` is hsl(38 92% 50%) = #f59e0b, relative luminance 0.441199.
   *   vs black  (0.441199 + 0.05) / 0.05          = 9.82 : 1   ✓ AA and AAA
   *   vs white  1.05 / (0.441199 + 0.05)          = 2.14 : 1   ✗ fails at any size
   * The repo had 47 `text-black` primaries and 16 `text-white` ones. The 16 are
   * a defect, not a preference.
   */
  it.each(BUTTON_SIZES)("primary/%s is black on accent", (size) => {
    const classes = classesOf("primary", size);
    expect(classes).toContain("text-black");
    expect(classes).toContain("bg-accent");
  });

  it.each(BUTTON_SIZES)("primary/%s is never white on accent", (size) => {
    // Asserting the absence as well as the presence: `text-black text-white`
    // both present would satisfy the test above while rendering whichever the
    // stylesheet ordered last.
    expect(classesOf("primary", size)).not.toContain("text-white");
  });

  it("records the arithmetic, not just the conclusion", () => {
    // A future reader changing this to white needs to meet the number, not a
    // preference. If the comment goes, so does the reason.
    expect(SOURCE).toContain("9.82");
    expect(SOURCE).toContain("2.14");
  });

  it("does not fill danger with the error token, which fails AA in dark mode", () => {
    // `bg-[hsl(var(--color-status-error))]` + white text measures 3.59:1 in the
    // dark theme (5.84:1 light). Danger is the 10% tint instead.
    for (const size of BUTTON_SIZES) {
      const classes = classesOf("danger", size);
      expect(classes).toContain("bg-[hsl(var(--color-status-error)/0.1)]");
      expect(classes).not.toContain("bg-[hsl(var(--color-status-error))]");
      expect(classes).not.toContain("text-white");
    }
  });
});

describe("focus is left to the global rule", () => {
  /**
   * `app/globals.css:459` is `:focus-visible { outline: 2px solid
   * hsl(var(--color-focus)) !important }`, and the `!important` is what beats
   * the 69 `outline-none` utilities in the app. A component participates by
   * doing nothing. Writing `outline-none` here would opt out; writing a ring
   * would double it.
   */
  it("writes no outline-none", () => {
    expect(CODE).not.toMatch(/\boutline-none\b/);
    for (const [variant, size] of MATRIX) {
      expect(classesOf(variant, size)).not.toContain("outline-none");
    }
  });

  it("writes no focus ring of its own", () => {
    expect(CODE).not.toMatch(/\bfocus(-visible)?:ring/);
  });

  it("never colours a focus affordance with the user-configurable accent", () => {
    // `--color-focus` exists precisely because `--color-accent` is settable at
    // runtime, and a ring the user can tune to invisibility is not a ring.
    // app/permissions/page.tsx:178 does exactly this; it is not a model.
    expect(CODE).not.toMatch(/focus[^\s"']*:ring[^\s"']*--color-accent/);
  });
});

describe("eighteen padding pairs collapse to three on the 4/8/12/16 grid", () => {
  const PAD = /^p[xy]-(.+)$/;
  const GRID = ["1", "2", "3", "4"]; // 4px, 8px, 12px, 16px

  it("emits exactly three distinct padding pairs across the twelve cells", () => {
    const pairs = new Set(
      MATRIX.map(([variant, size]) =>
        classesOf(variant, size).filter((c) => PAD.test(c)).sort().join(" ")
      )
    );
    expect([...pairs].sort()).toEqual(["px-2 py-1", "px-3 py-2", "px-4 py-3"]);
  });

  it("puts every padding step on the grid", () => {
    const offGrid = MATRIX.flatMap(([variant, size]) =>
      classesOf(variant, size)
        .map((c) => PAD.exec(c))
        .filter((m): m is RegExpExecArray => m !== null)
        .filter((m) => !GRID.includes(m[1]))
        .map((m) => `${variant}/${size}: ${m[0]}`)
    );
    expect(offGrid).toEqual([]);
  });

  it("keeps the ladder monotone so the three sizes read as one button", () => {
    const x = BUTTON_SIZES.map(
      (size) => classesOf("primary", size).find((c) => c.startsWith("px-"))!
    );
    const y = BUTTON_SIZES.map(
      (size) => classesOf("primary", size).find((c) => c.startsWith("py-"))!
    );
    expect(x).toEqual(["px-2", "px-3", "px-4"]);
    expect(y).toEqual(["py-1", "py-2", "py-3"]);
  });
});

describe("behaviour", () => {
  it("defaults to secondary/md", () => {
    render(<Button>label</Button>);
    const classes = screen.getByRole("button").className.split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining(["bg-surface-2", "px-3", "py-2", "text-03"]));
  });

  it("disables and marks itself busy while loading", () => {
    render(<Button loading>Save</Button>);
    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });

  it("is not aria-busy when merely disabled", () => {
    // Absence, asserted. `aria-busy` on every disabled control would tell a
    // screen reader that a permanently-unavailable button is loading forever.
    render(<Button disabled>Save</Button>);
    expect(screen.getByRole("button")).not.toHaveAttribute("aria-busy");
  });

  it("keeps its label readable while loading", () => {
    // The spinner is added, not swapped in — a button that replaces its text
    // with a spinner loses its accessible name mid-flight.
    render(<Button loading>Save</Button>);
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("does not force a type, so migrated submit buttons keep submitting", () => {
    // Defaulting to type="button" would silently break every form this
    // eventually replaces: no type error, no failing test, just a dead submit.
    render(<Button>label</Button>);
    expect(screen.getByRole("button")).not.toHaveAttribute("type");
  });

  it("lets a caller's className win a conflict", () => {
    render(<Button variant="primary" className="bg-surface-4" />);
    const classes = screen.getByRole("button").className.split(/\s+/);
    expect(classes).toContain("bg-surface-4");
    expect(classes).not.toContain("bg-accent");
  });
});
