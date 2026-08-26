/**
 * The panels that report an absence, and the exhaustiveness guarantee that
 * keeps a panel from being absent itself.
 *
 * Why this file exists
 * --------------------
 * `apps/ledger/readings.py` used to put two English sentences on the wire —
 * `poena_unavailable` and `reason` — that nothing in this repository read. The
 * panel rendered the same content from its own catalogue keys, and rendered it
 * better: three separate bullets where the sentence had one clause listing
 * three things. Two copies of one fact, and the panel's copy was the one that
 * could not move: the bullets were three hard-coded `<li>` elements, so a
 * fourth missing input added on the backend would have gone on rendering as
 * three, in a UI that says in as many words which three, with nothing red.
 *
 * The backend now sends `poena_missing` (members) and `reason_code` (a state),
 * and this file holds the two properties that replace the hard-coding:
 *
 *   1. the bullets are what the backend sent — a shorter list renders shorter,
 *      a reordered one renders reordered;
 *   2. the copy key is derived from the member, so the mapping cannot be
 *      half-written. A member with no key in a bundle puts the raw key on
 *      screen, which is ugly and therefore self-reporting — the property
 *      `civilizationCopyCoverage.test.ts` argues for, applied to members
 *      instead of civilizations.
 *
 * The real `I18nProvider` is used rather than a `t: (key) => key` stub. A stub
 * that returns the key would make every assertion below pass against a bundle
 * with no copy in it at all, which is the shape of test double
 * `WorkflowPage.test.tsx` was caught with: it reproduced the defect under test
 * and measured itself.
 *
 * The direction this file cannot see — a member, or a whole `kind`, added on
 * the backend and not to the constants in `lib/api/ledger.ts` — is held by
 * `apps/ledger/test_readings.py::TestFrontendMemberListsAgree`, which reads
 * this module's declarations as text and compares them to the Python tuples.
 * That blind spot is how the GREEK panel came to not exist for a release.
 *
 * Split out of this file, same subject:
 *   * `SoulReadingPanelSentence.test.tsx` — the Greek panel and its clock
 *   * `SoulReadingPanelFork.test.tsx`     — the fork's geometry
 *   * `soulReadingCopyCoverage.test.tsx`  — the three bundles' copy
 */
import { screen } from "@testing-library/react";

import {
  POENA_MISSING_INPUTS,
  READING_KINDS,
  type LedgerReading,
  type LedgerReadingKind,
  type PoenaMissingInput,
} from "@/lib/api/ledger";

import {
  ZH,
  assertScanned,
  bulletTexts,
  dashSpans,
  guiltAndPenalty,
  renderPanel,
  sentence,
} from "./support/soulReadingFixtures";

describe("SoulReadingPanel — poena bullets follow the payload", () => {
  it("renders one bullet per member the backend sent, in that order", () => {
    const { container } = renderPanel(guiltAndPenalty([...POENA_MISSING_INPUTS]));

    expect(bulletTexts(container)).toEqual([ZH.absolution, ZH.satisfaction, ZH.penance]);
  });

  it("renders fewer bullets when the backend reports fewer missing inputs", () => {
    // The assertion the three hard-coded `<li>` elements could never fail. If
    // this list ever legitimately shrinks — because the ledger starts
    // recording absolution, say — the panel must shrink with it rather than go
    // on naming a fact the backend no longer claims is missing.
    const { container } = renderPanel(guiltAndPenalty(["PENANCE"]));

    expect(bulletTexts(container)).toEqual([ZH.penance]);
    // Absence, not just presence: the other two must be gone from the whole
    // panel, not merely absent from the list.
    expect(screen.queryByText(ZH.absolution)).not.toBeInTheDocument();
    expect(screen.queryByText(ZH.satisfaction)).not.toBeInTheDocument();
  });

  it("follows the payload's order rather than a fixed one", () => {
    const { container } = renderPanel(guiltAndPenalty(["PENANCE", "ABSOLUTION"]));

    expect(bulletTexts(container)).toEqual([ZH.penance, ZH.absolution]);
  });

  it("drops the list entirely, keeping the heading, when nothing is reported missing", () => {
    // readings.py keeps `poena_missing` non-empty for as long as `poena` is
    // null and pins that; this is what the panel does if it ever arrives empty
    // anyway. An empty `<ul>` renders as a stray bullet gutter, and a crash
    // here would take the whole soul detail page with it.
    const { container } = renderPanel(guiltAndPenalty([]));

    expect(container.querySelectorAll("ul")).toHaveLength(0);
    expect(bulletTexts(container)).toEqual([]);
    expect(screen.getAllByText("无法计算").length).toBeGreaterThan(0);
  });

  it("never puts a raw member name on screen", () => {
    // The defect `soulLifecycleRows` was fixed for and `civilizationCopyCoverage`
    // guards against: the untranslated value reaching the screen beside — or
    // instead of — its label. Asserted over the panel's whole text, so a member
    // leaking into an attribute-free corner still fails.
    const { container } = renderPanel(guiltAndPenalty([...POENA_MISSING_INPUTS]));
    const text = container.textContent ?? "";

    // The loop below is `not.toContain` per member: over an empty member list
    // it asserts nothing and passes. Measured at 3 (ABSOLUTION, SATISFACTION,
    // PENANCE) against `lib/api/ledger.ts`.
    assertScanned("poena members swept for raw leakage", POENA_MISSING_INPUTS.length, 3);
    for (const member of POENA_MISSING_INPUTS) {
      expect(text).not.toContain(member);
    }
    // And no untranslated key either, which is the other way a member reaches
    // the screen unspoken for.
    expect(text).not.toContain("souls.detail.reading");
  });

  it("shows the raw key for a member no bundle has copy for", () => {
    // Not an endorsement of the raw key, a statement of which failure mode was
    // chosen. A member the frontend has never heard of is a real possibility
    // between a backend deploy and a frontend one, and the alternatives are
    // silently dropping the bullet — the exact defect this change removed — or
    // throwing. A visible key is the one that reports itself.
    const unknown = ["ABSOLUTION", "PURGATION"] as unknown as PoenaMissingInput[];
    const { container } = renderPanel(guiltAndPenalty(unknown));

    expect(bulletTexts(container)).toEqual([
      ZH.absolution,
      "souls.detail.reading.poena_missing_purgation",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Exhaustiveness — the property, not the four instances of it
// ---------------------------------------------------------------------------
//
// `f92ed35` gave the Greek reading `kind: "SENTENCE"`. `lib/api/ledger.ts`
// declared four kinds, the component switched over those four with no
// `default`, and so a SENTENCE payload fell out of the switch, the function
// returned `undefined`, and React 18 rendered that as nothing. A Greek soul's
// ledger card was blank — not broken-looking, blank — and `tsc`, `eslint` and
// the whole Jest suite were green throughout, because a switch is exhaustive
// over the union the frontend declares and the union was the half nobody
// updated.
//
// This is the half of that fix which matters more than the Greek panel itself.
// The panel is one bug fixed; these are what makes the *next* kind loud.

/** One payload per kind. Keyed by kind so the check below can be total. */
const SAMPLES: Record<LedgerReadingKind, LedgerReading> = {
  BALANCE: { kind: "BALANCE", civilization: "CHINESE", balance: 18, merit: 30, demerit: 12 },
  THRESHOLD: {
    kind: "THRESHOLD", civilization: "EGYPTIAN",
    heart_weight: 12, counterweight: 1, heavier_than_feather: true,
  },
  GUILT_AND_PENALTY: guiltAndPenalty([...POENA_MISSING_INPUTS]),
  SENTENCE: sentence(),
  UNAVAILABLE: { kind: "UNAVAILABLE", civilization: "UNKNOWN", reason_code: "TENANT_NOT_MAPPED" },
};

describe("SoulReadingPanel — every kind renders something", () => {
  it("has a sample for every kind and no sample for a kind that does not exist", () => {
    // `Record<LedgerReadingKind, ...>` already makes a missing entry a `tsc`
    // error; this is the run-time half, and the half that survives someone
    // widening the index signature to shut the compiler up.
    expect(Object.keys(SAMPLES).sort()).toEqual([...READING_KINDS].sort());

    // And the floor under the `it.each` below, which has to be stated from
    // outside it: `it.each([])` registers no tests, so an emptied
    // READING_KINDS would delete four assertions and report nothing but a
    // smaller test count. Measured at 5 — BALANCE, THRESHOLD,
    // GUILT_AND_PENALTY, SENTENCE, UNAVAILABLE.
    assertScanned("kinds enumerated for the blank-render sweep", READING_KINDS.length, 5);
  });

  it.each([...READING_KINDS])("%s does not render blank", (kind) => {
    // The generalised form of the defect: not "SENTENCE was missing" but "a
    // kind can be missing and nothing says so". `undefined` from the switch
    // produces an empty container and no error of any sort.
    const { container } = renderPanel(SAMPLES[kind]);

    expect(container).not.toBeEmptyDOMElement();
    expect((container.textContent ?? "").trim()).not.toBe("");
  });

  it("says so out loud when the backend sends a kind this build has never heard of", () => {
    // The window between a backend deploy and a frontend one, which is exactly
    // the window `f92ed35` opened and nobody closed. `tsc` cannot help here —
    // the payload is data, not a type — so the `default` branch is the only
    // thing between this and a blank card.
    const unknown = { kind: "ORDEAL", civilization: "NORSE" } as unknown as LedgerReading;
    const { container } = renderPanel(unknown);

    expect(container).not.toBeEmptyDOMElement();
    expect(screen.getByRole("status")).toBeInTheDocument();
    // The kind is named, because a notice that does not say which kind is a
    // shrug. This is the one place a raw wire value on screen is the intent.
    expect(container.textContent ?? "").toContain("ORDEAL");
    expect(container.textContent ?? "").not.toContain("souls.detail.reading");
  });
});

describe("SoulReadingPanel — the unmapped tenant's copy is keyed on the reason", () => {
  it("renders the explanation and the CTA for the code it was given", () => {
    renderPanel({ kind: "UNAVAILABLE", civilization: "UNKNOWN", reason_code: "TENANT_NOT_MAPPED" });

    expect(screen.getByText(ZH.unavailableExplanation)).toBeInTheDocument();
    expect(screen.getByText(ZH.unavailableCta)).toBeInTheDocument();
  });

  it("never puts the raw reason code on screen", () => {
    const { container } = renderPanel({
      kind: "UNAVAILABLE",
      civilization: "UNKNOWN",
      reason_code: "TENANT_NOT_MAPPED",
    });
    const text = container.textContent ?? "";

    expect(text).not.toContain("TENANT_NOT_MAPPED");
    expect(text).not.toContain("souls.detail.reading");
  });
});

/**
 * The em-dash occupies the slot a number would have taken. It used to carry an
 * `aria-label` set to the *same* catalogue key as the sentence rendered
 * directly beneath it, so a screen reader announced that sentence twice — once
 * as the value, once as itself. Raised in review against the shipped panel.
 *
 * The fix is `aria-hidden`, not a second shorter string: the explanation is the
 * next thing read either way, and adding a distinct name would put two
 * descriptions of one absence into the catalogue for translators to drift apart.
 *
 * What must NOT happen is the glyph acquiring an accessible name again, and
 * what must not happen either is the explanation disappearing along with it —
 * silence in that position would leave the row saying nothing at all. Both
 * halves are asserted, in both branches.
 */
const CASES: Array<[string, () => LedgerReading, string, number]> = [
  // The trailing number is the measured span count of that payload's panel —
  // the floor `dashSpans` scans against, so a selector that stopped matching
  // fails instead of reporting the glyph absent.
  ["poena", () => guiltAndPenalty([...POENA_MISSING_INPUTS]), ZH.poenaHeading, 6],
  ["elapsed", () => sentence(), ZH.elapsedHeading, 16],
];

// Stated outside the `describe`, because `it.each([])` registers no tests and
// so cannot guard its own list. Measured at 2: the two panels that draw an
// absence.
assertScanned("absence panels enumerated", CASES.length, 2);

describe("SoulReadingPanel — the absent value is not announced twice", () => {
  it.each(CASES)("%s: the heading is rendered once, not twice", (_name, build, heading, spans) => {
    const { container } = renderPanel(build());

    // Once as visible copy...
    expect(screen.getAllByText(heading)).toHaveLength(1);
    // ...and never as an accessible name, which is what produced the double.
    expect(screen.queryAllByLabelText(heading)).toHaveLength(0);

    // The glyph is still there and still silent.
    const dash = dashSpans(container, spans)[0];
    expect(dash).toBeDefined();
    expect(dash).toHaveAttribute("aria-hidden", "true");
  });

  it.each(CASES)("%s: hiding the glyph did not take the explanation with it", (_name, build, heading) => {
    const { container } = renderPanel(build());
    // Absence assertion's complement: silence here would pass the test above.
    expect(container.textContent).toContain(heading);
  });
});
