/**
 * A route may not hand-roll a modal out of `fixed inset-0`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THIS SHAPE HAS NOW BEEN FOUND THREE TIMES, AND NAMED WITHOUT BEING FIXED.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * A `<div className="fixed inset-0 …">` with a scrim and two buttons looks
 * like a dialog and is not one. What it does not have: `role="dialog"`,
 * `aria-modal`, a focus move on open, Escape, a focus trap, and focus return
 * to the trigger. Focus stays on the page behind the scrim and Tab walks the
 * list underneath.
 *
 * The 2026-09-01 round converted `app/dispatch/[id]`'s two, and its own
 * comment (`app/dispatch/[id]/page.tsx:293-299`) listed the dialects it was
 * consolidating — *"recycle-bin's `z-9999`, since renamed `z-dialog`"*.
 * **Recycle-bin was named in the fix and not converted**, and `app/disposition`
 * was not noticed at all. So the previous round's evidence was a sentence in a
 * comment, and a sentence in a comment is not a check. The two survivors were
 * the permanent hard delete and the disposition execution — the two most
 * irreversible actions in the product.
 *
 * WHAT COUNTS, and why the pattern is narrow. It matches the `className`
 * position only (`className="… fixed inset-0 …"`), not the words. Prose is
 * excluded deliberately: three files now *discuss* this pattern in comments,
 * including the two that were just converted, and a rule that matched their
 * explanations would report the files that no longer have the defect. That is
 * not hypothetical — this repository has the same failure recorded for
 * Tailwind scanning prose, and the guard in `errorIsNotAnEmptyState.test.ts`
 * caught two fresh instances of it in the same session as this file.
 *
 * WHAT IS ALLOWED, and where. `src/components/ui/Modal.tsx` is the primitive
 * and is where `fixed inset-0` belongs; the two navigation scrims
 * (`AppLayout`, `SettingsDrawer`) are drawers with their own audited keyboard
 * handling in `useDrawerA11y`. ~~This rule is scoped to `app/**` — the routes —
 * because that is where the shape keeps reappearing~~ — since 2026-09-14 it
 * also reads `src/` and `components/`, with those overlays named in `ALLOWED`
 * below instead of being out of sight: a modal moved from a page into a
 * component is the same defect one import away.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const FRONTEND = path.join(__dirname, "..", "..");

/*
 * WIDENED 2026-09-14 (audit FT-08). The rule read `className="…fixed inset-0…"`
 * — double quotes, those two words adjacent, `app/**` only. Measured: the
 * overlay written as `className={`fixed inset-0 z-dialog ${x}`}` (the spelling
 * two of the three allowed overlays below already use) or with the classes in
 * the other order passed, and a page-sized modal built in `src/components/`
 * was never looked at. Now: every `className=` value — quoted, or a braced
 * expression holding template literals / `cn(…)` — in comment-stripped
 * source under `app/`, `src/` and `components/`, the two tokens in any order.
 * The allowed overlays are named with the behaviour that justifies them.
 */
const ROOTS = ["app", "src", "components"];

/** Overlays that are not hand-rolled dialogs. Adding one needs a reason. */
const ALLOWED: Record<string, string> = {
  "src/components/ui/Modal.tsx": "the primitive; `fixed inset-0` belongs here",
  "src/components/layout/AppLayout.tsx": "navigation drawer scrim, keyboard handled by useDrawerA11y",
  "src/components/settings/SettingsDrawer.tsx": "settings drawer scrim, keyboard handled by useDrawerA11y",
  "src/components/souls/detail/SoulHeaderActions.tsx":
    "transparent aria-hidden click-catcher behind a role=menu with Escape and focus return — a menu, not a dialog",
};

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "__tests__" || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsxFiles(full));
    else if (entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(?<![:\w])\/\/[^\n]*/g, "");
}

const ROUTES = ROOTS.flatMap((root) => tsxFiles(path.join(FRONTEND, root))).map((full) => ({
  label: path.relative(FRONTEND, full),
  source: stripComments(readFileSync(full, "utf8")),
}));

/** Every `className=` value: a quoted string, or a balanced `{…}` expression. */
function classNameValues(source: string): string[] {
  const values: string[] = [];
  for (const m of source.matchAll(/className=/g)) {
    let i = (m.index ?? 0) + m[0].length;
    const open = source[i];
    if (open === '"' || open === "'") {
      values.push(source.slice(i + 1, source.indexOf(open, i + 1)));
      continue;
    }
    if (open !== "{") continue;
    let depth = 0;
    let quote: string | null = null;
    const start = i;
    for (; i < source.length; i++) {
      const c = source[i];
      if (quote) {
        if (c === "\\") i++;
        else if (c === quote) quote = null;
      } else if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) break;
    }
    values.push(source.slice(start, i + 1));
  }
  return values;
}

const token = (name: string) => new RegExp(`(?:^|[\\s"'\`:{(,])${name}(?=[\\s"'\`,)}]|$)`);
const FIXED = token("fixed");
const INSET_0 = token("inset-0");

/**
 * `fixed` and `inset-0` in one `className` value, in any order and any
 * quoting — not in prose, because comments are stripped first.
 */
const HAND_ROLLED_OVERLAY = {
  test: (source: string) => classNameValues(source).some((v) => FIXED.test(v) && INSET_0.test(v)),
};

describe("the scan is looking at something", () => {
  it("finds the app's route files", () => {
    // 40+ today (pages, layouts, loading and error boundaries). A floor: a
    // broken walk returning nothing would make the rule below vacuous.
    expect(ROUTES.length).toBeGreaterThanOrEqual(30);
  });

  it("the pattern matches a hand-rolled overlay when there is one", () => {
    // The rule is proved against a literal rather than trusted: this is the
    // exact markup `app/recycle-bin/page.tsx` carried until it was converted.
    const sample = '<div className="fixed inset-0 z-dialog flex items-center justify-center">';
    expect(HAND_ROLLED_OVERLAY.test(sample)).toBe(true);
  });

  it("the pattern matches the spellings that used to pass", () => {
    const spellings = [
      "<div className={`fixed inset-0 z-dialog ${open ? 'a' : 'b'}`}>",
      "<div className='inset-0 bg-black/50 fixed'>",
      '<div className={cn("fixed", "inset-0", x)}>',
      '<div className={\n  "md:fixed inset-0"\n}>',
    ];
    for (const s of spellings) expect(HAND_ROLLED_OVERLAY.test(s)).toBe(true);
    expect(HAND_ROLLED_OVERLAY.test('<div className="fixed top-0 inset-x-0">')).toBe(false);
  });

  it("the pattern does not match a comment about the pattern", () => {
    // Both converted files now contain exactly this shape of sentence.
    const prose = "        {/* `ConfirmDialog`, not a hand-rolled `fixed inset-0`. */}";
    expect(HAND_ROLLED_OVERLAY.test(stripComments(prose))).toBe(false);
  });

  it("every allowed overlay still has one — an exemption for nothing is stale", () => {
    for (const file of Object.keys(ALLOWED)) {
      const route = ROUTES.find((r) => r.label === file);
      expect([file, route && HAND_ROLLED_OVERLAY.test(route.source)]).toEqual([file, true]);
    }
  });
});

describe("no route builds its own modal", () => {
  it.each(ROUTES.filter((r) => !(r.label in ALLOWED)).map((r) => [r.label, r] as const))("%s", (_label, route) => {
    expect(HAND_ROLLED_OVERLAY.test(route.source)).toBe(false);
  });
});
