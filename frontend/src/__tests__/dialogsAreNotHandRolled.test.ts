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
 * handling in `useDrawerA11y`. This rule is scoped to `app/**` — the routes —
 * because that is where the shape keeps reappearing, and because a component
 * that genuinely needs an overlay should be building it beside the primitive
 * rather than inside a page.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const APP_ROOT = path.join(__dirname, "..", "..", "app");

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...routeFiles(full));
    else if (entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

const ROUTES = routeFiles(APP_ROOT).map((full) => ({
  label: path.relative(path.join(APP_ROOT, ".."), full),
  source: readFileSync(full, "utf8"),
}));

/**
 * `fixed inset-0` in a `className`, not in prose.
 *
 * `[^"]*` cannot cross the closing quote, so a comment mentioning the classes
 * in backticks — which is how every note about this pattern is written — does
 * not match, while `className="fixed inset-0 z-dialog …"` does.
 */
const HAND_ROLLED_OVERLAY = /className="[^"]*fixed inset-0/;

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

  it("the pattern does not match a comment about the pattern", () => {
    // Both converted files now contain exactly this shape of sentence.
    const prose = "        {/* `ConfirmDialog`, not a hand-rolled `fixed inset-0`. */}";
    expect(HAND_ROLLED_OVERLAY.test(prose)).toBe(false);
  });
});

describe("no route builds its own modal", () => {
  it.each(ROUTES.map((r) => [r.label, r] as const))("%s", (_label, route) => {
    expect(HAND_ROLLED_OVERLAY.test(route.source)).toBe(false);
  });
});
