/**
 * The panels that report an absence, the copy they do it with, and the
 * exhaustiveness guarantee that keeps a panel from being absent itself.
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
 */
import { render, screen } from "@testing-library/react";

import {
  POENA_MISSING_INPUTS,
  READING_KINDS,
  SENTENCE_MISSING_INPUTS,
  UNAVAILABLE_REASON_CODES,
  type LedgerReading,
  type LedgerReadingKind,
  type PoenaMissingInput,
  type SentenceMissingInput,
} from "@/lib/api/ledger";
import { I18nProvider } from "@/src/contexts/I18nContext";
import { SoulReadingPanel } from "@/src/components/souls/SoulReadingPanel";

import en from "../../messages/en.json";
import egy from "../../messages/egy.json";
import zhHans from "../../messages/zh-Hans.json";

const BUNDLES: Record<string, unknown> = { en, "zh-Hans": zhHans, egy };

/** The provider's default locale, so these are the strings that render below. */
const ZH = {
  absolution: "是否已获赦免",
  satisfaction: "应偿补赎多少",
  penance: "已行补赎多少",
  unavailableExplanation:
    "该灵魂所属租户尚未映射到任何文明宇宙观，因此没有可呈现的解读——仅显示下方原始账目。",
  unavailableCta: "请为该租户配置文明映射以启用解读。",
  owedLabel: "所欠刑期",
  owedDetail: "桩在案过错 · 每桩 10 倍偿还",
  circuit: "以 1000 年为一个周期计量——这是偿还的单位，不是本刑期的长度。",
  elapsedLabel: "已服",
  poenaHeading: "无法计算",
  elapsedHeading: "本账本未记",
  termStart: "刑期何时开始",
  timeServed: "已服了多少",
};

function renderPanel(reading: LedgerReading) {
  return render(
    <I18nProvider>
      <SoulReadingPanel reading={reading} meritScore={30} demeritScore={12} karmicBalance={18} />
    </I18nProvider>
  );
}

function guiltAndPenalty(poenaMissing: PoenaMissingInput[]): LedgerReading {
  return {
    kind: "GUILT_AND_PENALTY",
    civilization: "EUROPEAN",
    culpa: 12,
    culpa_record_count: 2,
    poena: null,
    poena_missing: poenaMissing,
  };
}

function bulletTexts(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("li")).map((li) => li.textContent ?? "");
}

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
// GREEK — the panel that did not exist
// ---------------------------------------------------------------------------
//
// `f92ed35` gave the Greek reading `kind: "SENTENCE"`. `lib/api/ledger.ts`
// declared four kinds, this component switched over those four with no
// `default`, and so a SENTENCE payload fell out of the switch, the function
// returned `undefined`, and React 18 rendered that as nothing. A Greek soul's
// ledger card was blank — not broken-looking, blank, indistinguishable from a
// soul with no ledger at all — and `tsc`, `eslint` and the whole Jest suite
// were green throughout, because a switch is exhaustive over the union the
// frontend declares and the union was the half nobody updated.
//
// Everything below is that failure written down as assertions.

function sentence(overrides: Partial<Extract<LedgerReading, { kind: "SENTENCE" }>> = {}): LedgerReading {
  return {
    kind: "SENTENCE",
    civilization: "GREEK",
    wrongs: 4,
    repayment_multiple: 10,
    circuit_years: 1000,
    elapsed_years: null,
    elapsed_missing: [...SENTENCE_MISSING_INPUTS],
    ...overrides,
  };
}

describe("SoulReadingPanel — the Greek sentence renders at all", () => {
  it("renders the panel instead of nothing", () => {
    // The assertion that would have caught the whole defect. Before the
    // `SENTENCE` branch existed this rendered an empty container and every
    // more specific expectation below would have failed for the same reason,
    // so it is worth stating the crude one first: something is on screen.
    const { container } = renderPanel(sentence());

    expect(container).not.toBeEmptyDOMElement();
    expect((container.textContent ?? "").trim().length).toBeGreaterThan(0);
  });

  it("shows the wrongs count and the repayment rule as two separate facts", () => {
    const { container } = renderPanel(sentence({ wrongs: 4 }));

    expect(screen.getByText(ZH.owedLabel)).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText(ZH.owedDetail)).toBeInTheDocument();

    // Absence, and it is the point of the upper half. Tenfold repayment is the
    // rule Republic X states; 4 × 10 = 40 is a debt it does not, in a unit this
    // system has never defined — the "rule rendered as a balance" collapse the
    // whole readings module exists to stop making.
    expect(container.textContent ?? "").not.toContain("40");
  });

  it("presents the circuit as a period and never as this soul's term", () => {
    renderPanel(sentence());

    expect(screen.getByText(ZH.circuit)).toBeInTheDocument();
    // 1000 appears only inside that sentence, not as a headline figure. The
    // headline is the wrongs count; a large "1000" beside the word 刑期 would
    // say the soul was sentenced to a thousand years, which is a claim about
    // this soul that the circuit length is not.
    const headline = screen.getByText("4");
    expect(headline.className).toContain("text-xl");
    expect(screen.queryByText("1000")).not.toBeInTheDocument();
  });

  it("reports elapsed time as an em-dash absence, not as zero and not as progress", () => {
    const { container } = renderPanel(sentence());
    const text = container.textContent ?? "";

    expect(screen.getByText(ZH.elapsedLabel)).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText(ZH.elapsedHeading)).toBeInTheDocument();
    // A 0 would claim the term has not begun; the ledger does not know that
    // either. Same argument as poena, which is why the two are drawn alike.
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    // And no bar or percentage: the numerator is null and the denominator is a
    // term length nobody has computed, so a progress indicator invents both.
    expect(container.querySelector("progress")).toBeNull();
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
    expect(text).not.toContain("%");
  });

  it("names what is missing, one bullet per member, in the payload's order", () => {
    const { container } = renderPanel(sentence());

    expect(bulletTexts(container)).toEqual([ZH.termStart, ZH.timeServed]);
  });

  it("follows the payload when the list shrinks or is reordered", () => {
    const { container } = renderPanel(sentence({ elapsed_missing: ["TIME_SERVED"] }));

    expect(bulletTexts(container)).toEqual([ZH.timeServed]);
    expect(screen.queryByText(ZH.termStart)).not.toBeInTheDocument();
  });

  it("keeps the heading and drops the list when nothing is reported missing", () => {
    const { container } = renderPanel(sentence({ elapsed_missing: [] }));

    expect(container.querySelectorAll("ul")).toHaveLength(0);
    expect(screen.getAllByText(ZH.elapsedHeading).length).toBeGreaterThan(0);
  });

  it("never puts a raw member name or a raw key on screen", () => {
    const { container } = renderPanel(sentence());
    const text = container.textContent ?? "";

    for (const member of SENTENCE_MISSING_INPUTS) {
      expect(text).not.toContain(member);
    }
    expect(text).not.toContain("souls.detail.reading");
  });

  it("shows the raw key for a member no bundle has copy for", () => {
    const unknown = ["TERM_START", "PAROLE"] as unknown as SentenceMissingInput[];
    const { container } = renderPanel(sentence({ elapsed_missing: unknown }));

    expect(bulletTexts(container)).toEqual([
      ZH.termStart,
      "souls.detail.reading.elapsed_missing_parole",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Exhaustiveness — the property, not the four instances of it
// ---------------------------------------------------------------------------
//
// This is the half of the fix that matters more than the Greek panel itself.
// The panel is one bug fixed; these two are what makes the *next* kind loud.

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

// ---------------------------------------------------------------------------
// Every member the backend can send must have copy in every bundle
// ---------------------------------------------------------------------------
//
// Written the way `civilizationCopyCoverage.test.ts` is written, and for the
// same reason: three-bundle parity asks whether the bundles agree with each
// other, and three bundles that are all missing the same key agree perfectly.
// This asks whether they agree with the member list the wire actually carries.

function at(bundle: unknown, path: string): unknown {
  let node: unknown = bundle;
  for (const part of path.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

describe("reading copy coverage", () => {
  it.each(Object.keys(BUNDLES))("%s has a bullet for every poena_missing member", (locale) => {
    const missing: string[] = [];

    for (const member of POENA_MISSING_INPUTS) {
      // The key is built exactly the way SoulReadingPanel builds it. Spelling
      // it out a second way here would let the two drift and this test would
      // certify a key nothing renders.
      const key = `souls.detail.reading.poena_missing_${member.toLowerCase()}`;
      const value = at(BUNDLES[locale], key);
      if (typeof value !== "string" || value.trim() === "") missing.push(key);
    }

    expect(missing).toEqual([]);
  });

  it.each(Object.keys(BUNDLES))("%s has a bullet for every elapsed_missing member", (locale) => {
    const missing: string[] = [];

    for (const member of SENTENCE_MISSING_INPUTS) {
      const key = `souls.detail.reading.elapsed_missing_${member.toLowerCase()}`;
      const value = at(BUNDLES[locale], key);
      if (typeof value !== "string" || value.trim() === "") missing.push(key);
    }

    expect(missing).toEqual([]);
  });

  it.each(Object.keys(BUNDLES))("%s has the fixed copy the two panels need", (locale) => {
    // The SENTENCE panel's own labels, and the notice the `default` branch
    // renders. Not derived from a member list, so nothing else would miss them
    // — and a bundle without them renders a raw key where a label goes.
    const missing: string[] = [];

    for (const key of [
      "souls.detail.reading.sentence_owed_label",
      "souls.detail.reading.sentence_owed_detail",
      "souls.detail.reading.sentence_circuit",
      "souls.detail.reading.sentence_elapsed_label",
      "souls.detail.reading.elapsed_unavailable_heading",
      "souls.detail.reading.unrenderable_kind",
    ]) {
      const value = at(BUNDLES[locale], key);
      if (typeof value !== "string" || value.trim() === "") missing.push(key);
    }

    expect(missing).toEqual([]);
  });

  it.each(Object.keys(BUNDLES))("%s keeps the interpolations the panels pass", (locale) => {
    // `{{multiple}}`, `{{years}}` and `{{kind}}` are the numbers and the value
    // the copy is *about*. A translation that drops the placeholder reads as a
    // complete sentence and states nothing — the failure mode a missing key
    // does not have, because a missing key at least shows itself.
    const bundle = BUNDLES[locale];
    expect(at(bundle, "souls.detail.reading.sentence_owed_detail")).toContain("{{multiple}}");
    expect(at(bundle, "souls.detail.reading.sentence_circuit")).toContain("{{years}}");
    expect(at(bundle, "souls.detail.reading.unrenderable_kind")).toContain("{{kind}}");
  });

  it.each(Object.keys(BUNDLES))("%s has an explanation and a CTA for every reason code", (locale) => {
    const missing: string[] = [];

    for (const code of UNAVAILABLE_REASON_CODES) {
      for (const suffix of ["explanation", "cta"]) {
        const key = `souls.detail.reading.unavailable_${code.toLowerCase()}_${suffix}`;
        const value = at(BUNDLES[locale], key);
        if (typeof value !== "string" || value.trim() === "") missing.push(key);
      }
    }

    expect(missing).toEqual([]);
  });

  it("does not let a member's copy be the raw member", () => {
    // The other way to make the two tests above green without saying anything:
    // `"poena_missing_absolution": "ABSOLUTION"`. Copy that repeats its member
    // is the untranslated value reaching the screen by a second route.
    const offenders: string[] = [];

    for (const [locale, bundle] of Object.entries(BUNDLES)) {
      for (const member of POENA_MISSING_INPUTS) {
        const key = `souls.detail.reading.poena_missing_${member.toLowerCase()}`;
        if (at(bundle, key) === member) offenders.push(`${locale}:${key}`);
      }
      for (const member of SENTENCE_MISSING_INPUTS) {
        const key = `souls.detail.reading.elapsed_missing_${member.toLowerCase()}`;
        if (at(bundle, key) === member) offenders.push(`${locale}:${key}`);
      }
      for (const code of UNAVAILABLE_REASON_CODES) {
        for (const suffix of ["explanation", "cta"]) {
          const key = `souls.detail.reading.unavailable_${code.toLowerCase()}_${suffix}`;
          if (at(bundle, key) === code) offenders.push(`${locale}:${key}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("keeps the codeless keys gone, so a second reason code cannot inherit this one's copy", () => {
    // `unavailable_explanation` / `unavailable_cta` are what the panel read
    // before the code existed. Leaving them behind would be harmless today and
    // exactly the trap `ledger.civ.UNKNOWN` was: a plausible fallback waiting
    // for the next member to fall into it.
    for (const bundle of Object.values(BUNDLES)) {
      expect(at(bundle, "souls.detail.reading.unavailable_explanation")).toBeUndefined();
      expect(at(bundle, "souls.detail.reading.unavailable_cta")).toBeUndefined();
    }
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
describe("SoulReadingPanel — the absent value is not announced twice", () => {
  const CASES: Array<[string, () => LedgerReading, string]> = [
    ["poena", () => guiltAndPenalty([...POENA_MISSING_INPUTS]), ZH.poenaHeading],
    ["elapsed", () => sentence(), ZH.elapsedHeading],
  ];

  it.each(CASES)("%s: the heading is rendered once, not twice", (_name, build, heading) => {
    const { container } = renderPanel(build());

    // Once as visible copy...
    expect(screen.getAllByText(heading)).toHaveLength(1);
    // ...and never as an accessible name, which is what produced the double.
    expect(screen.queryAllByLabelText(heading)).toHaveLength(0);

    // The glyph is still there and still silent.
    const dash = Array.from(container.querySelectorAll("span")).find(
      (el) => el.textContent?.trim() === "—"
    );
    expect(dash).toBeDefined();
    expect(dash).toHaveAttribute("aria-hidden", "true");
  });

  it.each(CASES)("%s: hiding the glyph did not take the explanation with it", (_name, build, heading) => {
    const { container } = renderPanel(build());
    // Absence assertion's complement: silence here would pass the test above.
    expect(container.textContent).toContain(heading);
  });
});
