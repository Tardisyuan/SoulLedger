import { render, screen } from "@testing-library/react";
import { Badge, BADGE_TONES, BADGE_TONE_CLASSES } from "@/src/components/ui/Badge";
import {
  ENUM_TONE_CLASSES,
  EnumBadge,
  renderGridCell,
  type DataGridColumn,
  type EnumTone,
} from "@/components/ui/data-grid/columns";

function classesOf(node: React.ReactElement): string[] {
  const { container, unmount } = render(node);
  const classes = (container.firstElementChild?.className ?? "").split(/\s+/).filter(Boolean);
  unmount();
  return classes;
}

/**
 * An enum cell as the app actually produces one.
 *
 * `EnumBadge` is exported, but no page imports it — it is reachable only
 * through `renderGridCell`, which is the whole reason 66 hand-rolled badges
 * grew up beside it. So the comparison below goes through that function with a
 * real column definition, not through the exported component: a delegation that
 * works when you call `EnumBadge` yourself and breaks in the grid would pass a
 * test written against the export.
 */
const GRID_TONES = Object.keys(ENUM_TONE_CLASSES) as EnumTone[];

interface ToneRow {
  state: EnumTone;
}

function enumColumn(extra: Partial<{ glyph: string; title: string }> = {}): DataGridColumn<ToneRow> {
  return {
    key: "state",
    header: "State",
    type: "enum",
    value: (row) => ({ tone: row.state, label: "FAILED", title: "FAILED", ...extra }),
  };
}

function enumCell(tone: EnumTone, extra?: Partial<{ glyph: string; title: string }>) {
  return <>{renderGridCell(enumColumn(extra), { state: tone })}</>;
}

describe("Badge and EnumBadge cannot drift apart", () => {
  /**
   * `components/ui/data-grid/columns.tsx:150` already froze a badge —
   * `EnumBadge` — with a measured five-tone table. It is exported, it has a
   * contract test, and no page imports it, because it is reachable only through
   * `renderGridCell`. That is how 66 hand-rolled badges with 25 signatures grew
   * up beside a perfectly good shared one.
   *
   * `Badge` restates those five tone strings rather than importing them, so the
   * dependency edge can later run the other way (EnumBadge → Badge) without a
   * cycle. Restating is only safe if something holds the two copies equal. This
   * is that something, and it imports BOTH.
   */
  /**
   * WHAT REPLACED THE BYTE-IDENTITY ASSERTION, AND WHY IT HAD TO GO.
   *
   * This used to be `expect(BADGE_TONE_CLASSES[tone]).toBe(ENUM_TONE_CLASSES[tone])`,
   * over two independently written copies of the same five strings. Now that
   * `ENUM_TONE_CLASSES` is a projection of `BADGE_TONE_CLASSES`, that assertion
   * compares a value with itself: no edit anywhere in the repo could turn it
   * red. An assertion nothing can falsify is worse than no assertion, because
   * the green is read as coverage. It is deleted, not weakened.
   *
   * The property it was a proxy for survives, and is stated directly: an enum
   * cell rendered through the grid must carry EXACTLY the classes `Badge`
   * renders for that tone — same set, same order, nothing extra. `toEqual` on
   * the arrays, not `toContain` per class, so a `rounded` or a `text-xs`
   * creeping back into `EnumBadge` fails here rather than passing a subset
   * check. This IS falsifiable: hand-roll a className into `EnumBadge` and it
   * goes red.
   */
  it("parametrises over the grid's real tone set", () => {
    // The floor under the it.each below: five keys projected today. If
    // ENUM_TONE_CLASSES ever empties, the per-tone cases vanish silently and
    // the suite still reports a pass.
    expect(GRID_TONES).toHaveLength(5);
  });

  it.each(GRID_TONES)("an enum cell for tone %s renders exactly Badge's classes", (tone) => {
    expect(classesOf(enumCell(tone))).toEqual(classesOf(<Badge tone={tone}>FAILED</Badge>));
  });

  it("keeps the raw enum member on title through the delegation", () => {
    // IDENTIFIER_POLICY: the label is localisable, `title` is not. Forwarding
    // `title` to Badge is exactly the kind of prop a thin wrapper drops.
    const { container } = render(enumCell("error"));
    expect(container.firstElementChild).toHaveAttribute("title", "FAILED");
  });

  it("keeps the decorative glyph, hidden, through the delegation", () => {
    render(enumCell("warning", { glyph: "\u25c6" }));
    expect(screen.getByText("\u25c6")).toHaveAttribute("aria-hidden", "true");
  });

  it("covers every tone EnumBadge has, and says which extra ones it adds", () => {
    // Pin the subject set, not just the per-key comparison: `it.each` over
    // ENUM_TONE_CLASSES' keys is vacuously green if that table is ever emptied.
    expect(Object.keys(ENUM_TONE_CLASSES).sort()).toEqual([
      "error",
      "info",
      "neutral",
      "success",
      "warning",
    ]);
    expect(BADGE_TONES.sort()).toEqual([
      "accent",
      "error",
      "info",
      "ink",
      "neutral",
      "success",
      "warning",
    ]);
  });

  it("renders the same tone classes EnumBadge renders, for a shared tone", () => {
    // The end-to-end version of the table comparison: equal tables are worth
    // nothing if one of the two components stops applying its table.
    const mine = classesOf(<Badge tone="error">FAILED</Badge>);
    const theirs = classesOf(
      // `title`, not `raw`: EnumValue has no `raw` member. The raw enum member
      // travels in `title` here — that is this repo's IDENTIFIER_POLICY, and
      // the reason a badge stays recoverable when its label is localised.
      <EnumBadge value={{ title: "FAILED", label: "FAILED", tone: "error" }} />
    );
    for (const cls of ENUM_TONE_CLASSES.error.split(/\s+/)) {
      expect(mine).toContain(cls);
      expect(theirs).toContain(cls);
    }
  });

  it("has no fill: the tone is the text and a same-colour border (规范 v1 §2 徽章)", () => {
    // A tint over a row was the one place badge text could drop under AA; with
    // no fill the text colour sits on the row's own ground, which
    // inkOnSurfaceContract measures for every text token.
    for (const tone of BADGE_TONES) {
      const classes = BADGE_TONE_CLASSES[tone];
      expect(classes).not.toMatch(/\bbg-/);
      const text = /text-\[oklch\(var\((--[\w-]+)\)\)\]/.exec(classes)?.[1];
      const border = /border-\[oklch\(var\((--[\w-]+)\)\)\]/.exec(classes)?.[1];
      expect(text).toBeDefined();
      expect(border).toBe(text);
    }
  });
});

describe("shape", () => {
  it("is square by default, because 63 of the 66 were", () => {
    const classes = classesOf(<Badge>NEUTRAL</Badge>);
    expect(classes).not.toContain("rounded-full");
    // And no `rounded` either: borderRadius.DEFAULT is 0, so writing it would
    // emit `border-radius: 0` and read as a decision that was never made.
    expect(classes.filter((c) => c.startsWith("rounded"))).toEqual([]);
  });

  it("becomes a pill only when asked", () => {
    expect(classesOf(<Badge shape="pill">TAG</Badge>)).toContain("rounded-full");
  });
});

describe("geometry and content", () => {
  it("keeps EnumBadge's geometry so the two are swappable without a visual diff", () => {
    const classes = classesOf(<Badge>X</Badge>);
    expect(classes).toEqual(expect.arrayContaining(["px-1.5", "py-0.5", "font-mono", "font-normal", "border"]));
  });

  it("carries the 11 px label slot of the type scale, not a bare text-xs", () => {
    // 规范 v1: badges are 11 / 16 mono. This is also the assertion that goes
    // red if `cn()` starts eating the scale — the tone strings end in a colour.
    expect(classesOf(<Badge tone="error">X</Badge>)).toContain("text-01");
  });

  it("does not wrap mid-label inside a narrow cell", () => {
    expect(classesOf(<Badge>A LONG STATUS</Badge>)).toContain("whitespace-nowrap");
  });

  it("hides a decorative glyph from assistive tech", () => {
    render(<Badge glyph="◆">ALIVE</Badge>);
    // "black diamond ALIVE" is worse than "ALIVE".
    expect(screen.getByText("◆")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("ALIVE")).toBeInTheDocument();
  });

  it("emits no glyph element when none is given", () => {
    const { container } = render(<Badge>ALIVE</Badge>);
    expect(container.querySelectorAll("[aria-hidden='true']")).toHaveLength(0);
  });

  it("lets a caller's className win a conflict", () => {
    const classes = classesOf(<Badge tone="error" className="px-4" />);
    expect(classes).toContain("px-4");
    expect(classes).not.toContain("px-2");
  });
});
