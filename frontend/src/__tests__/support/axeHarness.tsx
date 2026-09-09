/**
 * The a11y engine, and the two things that have to be true for it to be one.
 *
 * WHY AN ENGINE AT ALL. Before this file, accessibility in this suite was
 * hand-written `getByRole` / `toHaveAttribute("aria-…")` assertions — 166
 * mentions of `aria-` or `role=` across 40 files in `src/__tests__`. Those are
 * good tests and none of them were deleted. What they cannot do is tell you
 * what you did NOT think to assert. A `role="listbox"` with no accessible name,
 * an `aria-describedby` pointing at an id that was renamed, a duplicated id
 * after two components land on the same page — nothing in a hand-written suite
 * reports those, because the shape of the failure is "an assertion that was
 * never written".
 *
 * `eslint-plugin-jsx-a11y` (wired up in `eslint.config.mjs`, ~34 rules) is the
 * other half, and it barely overlaps: it reads JSX source one element at a
 * time and cannot see anything that depends on the rendered tree. Every rule
 * about an id reference resolving, about a role needing a particular parent,
 * about duplicate ids, or about state after an interaction is invisible to it
 * by construction. axe reads the DOM after render, so it sees the half lint
 * cannot.
 *
 * ── WHY axe-core DIRECTLY, AND NOT jest-axe ────────────────────────────────
 *
 * `jest-axe` was installed first and backed out, for two measured reasons.
 *
 * It ships no types. The only published stubs, `@types/jest-axe@3.5.9`, are
 * for jest-axe v3 — installing them alongside jest-axe v10 added **748 lines**
 * to the root lockfile and pulled `axe-core@3.5.6`, `@types/node@26.5.0` and a
 * duplicate jest-29 matcher stack into the tree. Declaring `axe-core` directly
 * costs **one** lockfile line, because eslint-plugin-jsx-a11y already had it
 * hoisted; the version is now pinned by us rather than by a transitive edge.
 *
 * And its one piece of added value is a matcher, `toHaveNoViolations`, that a
 * baseline gate cannot use — the question here is never "any violations?" but
 * "more than the budget?". What it does silently is the thing this file most
 * needs to be loud about: `configureAxe` disables every `cat.color` rule
 * without saying so (jest-axe/index.js:55-63). That disable is correct, and it
 * belongs in our source where a reader trips over it.
 *
 * ── The two things ─────────────────────────────────────────────────────────
 *
 * 1. COLOUR RULES CANNOT RUN HERE. jsdom computes no layout and therefore no
 *    real colours, so `color-contrast` either throws or fabricates a pass.
 *    This is the most dangerous property of running axe under jest: the engine
 *    reports "0 violations" on a page whose text is white on white.
 *    `DISABLED_RULES` names them and `a11yEngineBaseline.test.tsx` asserts the
 *    set is exactly that and nothing else — so the day someone disables a rule
 *    to turn a red run green, a test says so. Contrast is checked by
 *    `inkOnSurfaceContract.test.ts` and friends against the token values, which
 *    is where it can actually be checked.
 *
 * 2. AN ENGINE THAT RUNS NO RULES PASSES EVERYTHING. `axe.run` over a
 *    container that failed to render returns `violations: []` — the same value
 *    as a clean bill of health. So `audit` returns the *evaluated rule ids*
 *    alongside the violations, and the baseline test floors that count. Same
 *    reason `suiteShape.test.ts` pins the file list rather than counting it:
 *    finding nothing is the passing state, so what has to be asserted is that
 *    the subject set is the set we believe it is.
 */
import axe from "axe-core";

/**
 * The rules that cannot run under jsdom, derived rather than hard-coded.
 *
 * A hard-coded list would go stale the next time axe-core adds a colour rule,
 * and it would go stale *silently* — the list would still match itself. Asking
 * axe for `cat.color` pins the reason (colour needs layout), not today's names.
 */
export const DISABLED_RULES: string[] = axe
  .getRules(["cat.color"])
  .map((rule) => (rule as unknown as { ruleId: string }).ruleId)
  .sort();

/**
 * WCAG 2.1 A + AA, plus axe's own best-practice set.
 *
 * `best-practice` is in deliberately. It carries the rules for things this
 * codebase actually builds — `aria-dialog-name`, the `landmark-*` family,
 * `region` — and leaving it out would have made the first baseline read
 * considerably cleaner than the app is.
 */
const RUN_OPTIONS: axe.RunOptions = {
  runOnly: {
    type: "tag",
    values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"],
  },
  rules: Object.fromEntries(DISABLED_RULES.map((id) => [id, { enabled: false }])),
};

export interface AuditResult {
  /** Violating NODE counts keyed by axe rule id, e.g. `{ "button-name": 2 }`. */
  counts: Record<string, number>;
  /** Every rule axe actually evaluated — violations + passes + incomplete. */
  evaluated: string[];
  /** Human-readable detail, used only to build failure messages. */
  detail: string[];
}

/**
 * Run axe over everything currently on the page and report violations by rule.
 *
 * `document.body`, not the RTL container. Base UI's dialogs, the grid's
 * `ActionsMenu` and the toast stack all portal outside it, so auditing the
 * container would score every popup in this repo as an empty tree — a
 * false green on exactly the components most likely to be wrong. The cost is
 * that RTL's own wrapper `<div>`s are in scope, which is harmless: they carry
 * no roles and no text.
 *
 * Counts NODES, not violation records. axe groups every failing element for a
 * rule under one record, so `violations.length` is the number of distinct
 * rules broken — a page with fourteen unnamed buttons scores 1. A budget built
 * on that number would let thirteen new defects in without moving.
 */
export async function audit(): Promise<AuditResult> {
  const results = await axe.run(document.body, RUN_OPTIONS);

  const counts: Record<string, number> = {};
  const detail: string[] = [];
  for (const violation of results.violations) {
    counts[violation.id] = (counts[violation.id] ?? 0) + violation.nodes.length;
    for (const node of violation.nodes) {
      detail.push(
        `${violation.id} [${violation.impact}] ${node.target.join(" ")} — ${violation.help}`,
      );
    }
  }

  const evaluated = [...results.violations, ...results.passes, ...results.incomplete].map(
    (r) => r.id,
  );

  return { counts, evaluated, detail };
}
