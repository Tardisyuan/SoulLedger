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
 * `outline-hidden`, it names `cursor-not-allowed`, and it quotes
 * app/permissions/page.tsx's `focus-visible:ring-[oklch(var(--color-accent))]` as
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
   * arbitrary lengths; `text-xs` matches none of them and falls through to the
   * catch-all group for `text-*`, which is text-COLOR. So the size and the
   * colour were treated as one property and the later one deleted the earlier.
   * `lib/utils.ts` now registers 01–08 as font sizes.
   */
  it("keeps a font size and a text colour that are written together", () => {
    expect(cn("bg-[oklch(var(--color-accent))] text-black border-[oklch(var(--color-accent))]", "px-2 py-1 text-xs").split(/\s+/)).toEqual(
      expect.arrayContaining(["text-black", "text-xs"])
    );
    // Same string, not just separate arguments — the collision was never about
    // argument boundaries, so a fix that only worked across them would be fake.
    expect(cn("text-2xs uppercase text-[oklch(var(--color-ink-subtle))]").split(/\s+/)).toEqual(
      expect.arrayContaining(["text-2xs", "text-[oklch(var(--color-ink-subtle))]"])
    );
  });

  it("`text-display` — the one step not shaped like a t-shirt size — is a font size too", () => {
    // tailwind-merge's own table recognises 2xs/xs/sm/md/lg/xl by shape;
    // `display` (规范 v2 A3, 40px) is only a size because lib/utils.ts registers it.
    expect(cn("text-display", "text-md")).toBe("text-md");
    expect(cn("text-display text-black").split(/\s+/)).toEqual(
      expect.arrayContaining(["text-display", "text-black"])
    );
  });

  it("knows the Tailwind v4 utilities (tailwind-merge 3)", () => {
    // tailwind-merge 2 carried the v3 table: `outline-hidden` (v4, used across
    // this app) was unknown to it and survived next to `outline-dashed`, and
    // `text-shadow-*` fell into text-COLOR and deleted `text-black`.
    expect(cn("outline-hidden", "outline-dashed")).toBe("outline-dashed");
    expect(cn("text-black text-shadow-sm").split(/\s+/)).toEqual(
      expect.arrayContaining(["text-black", "text-shadow-sm"])
    );
  });

  it("still collapses two font sizes against each other", () => {
    // The other half of the fix, and the half a careless patch drops: telling
    // tailwind-merge these are font sizes has to make them conflict with each
    // OTHER, or `cn(base, "text-md")` would emit two sizes and the winner would
    // be decided by stylesheet order instead of by the caller.
    expect(cn("text-xs text-md")).toBe("text-md");
    expect(cn("text-black text-white")).toBe("text-white");
    // Added on review: the t-shirt scale must keep conflicting with itself too.
    // `extend` is additive, but a careless `override` of the font-size group
    // would drop `text-xs`…`text-9xl` from it, and the two scales coexist
    // during migration by design — `text-sm` and `text-sm` both live would be
    // harder to diagnose than the bug this fixes, because it renders a size,
    // just not the one anybody chose.
    expect(cn("text-sm text-lg")).toBe("text-lg");
  });

  it("does not make the two scales conflict with each other", () => {
    // The corollary, and the one an over-eager fix gets wrong: `text-sm` and
    // `text-sm` ARE the same property, so they must collapse.
    expect(cn("text-sm text-sm")).toBe("text-sm");
    expect(cn("text-sm text-sm")).toBe("text-sm");
  });

  it("carries the size class through to the rendered button, for every size", () => {
    // The end-to-end version. If the merge regresses, this is the assertion
    // that reports it as a Button defect rather than a utils curiosity.
    const expected: Record<ButtonSize, string> = { sm: "text-xs", md: "text-sm", lg: "text-sm" };
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
    // 18 = 6 variants x 3 sizes. Was 12; `warning` joined the set when
    // ConfirmDialog stopped hand-rolling `bg-yellow-500 text-white`, and
    // `inverse` (2026-10-01, v3 batch bar) made it 18. Pinned
    // exactly so the matrix cannot shrink silently — a dropped variant would
    // otherwise just mean fewer green cells.
    expect(MATRIX).toHaveLength(18);
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

describe("规范 v2 A1 按钮:主 = 匾色实底,危险 = neg.strong 实底白字", () => {
  it.each(BUTTON_SIZES)("primary/%s is onMain text on the plaque colour", (size) => {
    const classes = classesOf("primary", size);
    expect(classes).toContain("bg-[oklch(var(--color-main))]");
    expect(classes).toContain("text-[oklch(var(--color-on-main))]");
    // Hover / press darken the same fill by 12% / 24% black (A1), not a second colour.
    expect(classes).toContain("hover:bg-[color-mix(in_oklab,oklch(var(--color-main))_88%,black)]");
    expect(classes).toContain("active:bg-[color-mix(in_oklab,oklch(var(--color-main))_76%,black)]");
    // Absence too: no ink fill (v1), no accent fill (retired).
    expect(classes.join(" ")).not.toMatch(/(^|\s)bg-\[oklch\(var\(--color-(ink|accent)/);
  });

  it("danger is a solid neg.strong fill with white text, darkened the same way", () => {
    for (const size of BUTTON_SIZES) {
      const classes = classesOf("danger", size);
      expect(classes).toContain("bg-[oklch(var(--color-danger-strong))]");
      expect(classes).toContain("text-white");
      expect(classes).toContain("hover:bg-[color-mix(in_oklab,oklch(var(--color-danger-strong))_88%,black)]");
      // Not the text-strength danger hue as a fill: that one is for ✕ + words, not for white on it.
      expect(classes.join(" ")).not.toMatch(/(^|\s)bg-\[oklch\(var\(--color-(danger|status-error)\)\)\]/);
    }
  });

  it("the plaque colour appears on the primary button and on no other variant", () => {
    for (const variant of BUTTON_VARIANTS.filter((v) => v !== "primary")) {
      expect(classesOf(variant, "md").join(" ")).not.toContain("--color-main");
    }
  });

  it("disabled uses the disabled pair, not a faded copy", () => {
    for (const [variant, size] of MATRIX) {
      const classes = classesOf(variant, size);
      expect(classes).toContain("disabled:bg-[oklch(var(--color-disabled-surface))]");
      expect(classes).toContain("disabled:text-[oklch(var(--color-disabled-ink))]");
      expect(classes).not.toContain("disabled:opacity-50");
    }
  });
});

describe("focus is left to the global rule", () => {
  /**
   * `app/globals.css:459` is `:focus-visible { outline: 2px solid
   * oklch(var(--color-focus)) !important }`, and the `!important` is what beats
   * the 69 `outline-hidden` utilities in the app. A component participates by
   * doing nothing. Writing `outline-hidden` here would opt out; writing a ring
   * would double it.
   */
  it("writes no outline-hidden", () => {
    expect(CODE).not.toMatch(/\boutline-none\b/);
    for (const [variant, size] of MATRIX) {
      expect(classesOf(variant, size)).not.toContain("outline-hidden");
    }
  });

  it("writes no focus ring-3 of its own", () => {
    expect(CODE).not.toMatch(/\bfocus(-visible)?:ring/);
  });

  it("never colours a focus affordance with the user-configurable accent", () => {
    // `--color-focus` exists precisely because `--color-accent` is settable at
    // runtime, and a ring the user can tune to invisibility is not a ring.
    // app/permissions/page.tsx:178 does exactly this; it is not a model.
    expect(CODE).not.toMatch(/focus[^\s"']*:ring[^\s"']*--color-accent/);
  });
});

/** 规范 v3 的三档(2026-10-01 拍板全站换过去)。数字只在 globals.css 的 `--control-h-*` 里。 */
const GLOBALS = readFileSync(path.join(__dirname, "../../app/globals.css"), "utf8");
const CONTROL_PX = { sm: 44, md: 48, lg: 56 } as const;

describe("三档高度:规范 v3 的 44 / 48 / 56", () => {
  it("each size is one height, taken from its token, the same for every variant", () => {
    for (const [variant, size] of MATRIX) {
      const h = classesOf(variant, size).filter((c) => /^h-/.test(c));
      expect(h).toEqual([`h-(--control-h-${size})`]);
    }
  });

  it("the tokens are 44 / 48 / 56 px", () => {
    for (const size of ["sm", "md", "lg"] as const) {
      expect(GLOBALS).toMatch(new RegExp(`--control-h-${size}: ${CONTROL_PX[size]}px;`));
    }
  });

  it("needs no phone-only height patch: the smallest size is already the 44 px target (§1.7)", () => {
    for (const [variant, size] of MATRIX) {
      expect(classesOf(variant, size).filter((c) => c.startsWith("max-sm:"))).toEqual([]);
    }
  });
});

describe("behaviour", () => {
  it("defaults to secondary/md", () => {
    render(<Button>label</Button>);
    const classes = screen.getByRole("button").className.split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining(["bg-transparent", "border-[oklch(var(--color-line-strong))]", "h-(--control-h-md)", "px-3", "text-sm"]));
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
    render(<Button variant="primary" className="bg-[oklch(var(--color-surface-4))]" />);
    const classes = screen.getByRole("button").className.split(/\s+/);
    expect(classes).toContain("bg-[oklch(var(--color-surface-4))]");
    expect(classes).not.toContain("bg-[oklch(var(--color-accent))]");
  });
});
