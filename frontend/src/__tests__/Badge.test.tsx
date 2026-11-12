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

  // 第三十批「卷宗」第 1 步(Design v4 第三十批第一节第 2 条)replaced 规范 v1 §2's no-fill, same-colour-border badge:
  // a tag is a tint, no border, and there are exactly four colour pairs. Each pair is one inkOnSurfaceContract
  // measures (TINTS: danger / success / warning on their own tint; ink-muted on surface-2 is an INK_TOKENS ×
  // TEXT_GROUNDS cell), so pinning the pairs here is what keeps the text over AA — an alpha fill or a civ colour
  // would not be measured anywhere.
  const PAIRS: Record<string, string> = {
    "--color-ink-muted": "--color-surface-2",
    "--color-success": "--color-success-tint",
    "--color-warning": "--color-warning-tint",
    "--color-danger": "--color-danger-tint",
  };
  it("is tinted: every tone is one of the four measured text / tint pairs, and none draws a border", () => {
    const seen = new Set<string>();
    for (const tone of BADGE_TONES) {
      const classes = BADGE_TONE_CLASSES[tone];
      expect(classes).not.toMatch(/\bborder\b|border-/);
      const text = /text-\[oklch\(var\((--[\w-]+)\)\)\]/.exec(classes)?.[1];
      const bg = /bg-\[oklch\(var\((--[\w-]+)\)\)\]/.exec(classes)?.[1];
      expect(text && PAIRS[text]).toBe(bg);
      seen.add(text!);
    }
    // Four colours, not five: the civ accent and the v3 `ink` tone both fold into neutral.
    expect([...seen].sort()).toEqual(Object.keys(PAIRS).sort());
    expect(BADGE_TONE_CLASSES.info).toBe(BADGE_TONE_CLASSES.neutral);
    expect(BADGE_TONE_CLASSES.accent).toBe(BADGE_TONE_CLASSES.neutral);
    expect(BADGE_TONE_CLASSES.ink).toBe(BADGE_TONE_CLASSES.neutral);
  });
});

describe("shape", () => {
  it("has the 4 px control corner and nothing rounder (第三十批: radius 4, not a pill)", () => {
    const classes = classesOf(<Badge>NEUTRAL</Badge>);
    expect(classes).not.toContain("rounded-full");
    expect(classes.filter((c) => c.startsWith("rounded"))).toEqual(["rounded-control"]);
  });

});

describe("geometry and content", () => {
  it("has the tag's geometry: --tag-h high (22 fine pointer / 28 touch), 8 px sides, sans 12 / 500, no frame", () => {
    const classes = classesOf(<Badge>X</Badge>);
    expect(classes).toEqual(expect.arrayContaining(["h-(--tag-h)", "px-2", "text-xs", "font-medium"]));
    expect(classes).not.toContain("border");
    expect(classes).not.toContain("font-mono");
  });

  it("keeps the 12 px type slot after cn() merges a tone colour in", () => {
    // The assertion that goes red if `cn()` starts eating the scale — the tone strings end in a colour.
    expect(classesOf(<Badge tone="error">X</Badge>)).toContain("text-xs");
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
