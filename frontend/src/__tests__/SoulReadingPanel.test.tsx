/**
 * The two panels that report an absence, and the copy they report it with.
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
 * The direction this file cannot see — a member added on the backend and not
 * to `POENA_MISSING_INPUTS` here — is held by
 * `apps/ledger/test_readings.py::TestFrontendMemberListsAgree`, which reads
 * this module's declarations as text and compares them to the Python tuples.
 */
import { render, screen } from "@testing-library/react";

import {
  POENA_MISSING_INPUTS,
  UNAVAILABLE_REASON_CODES,
  type LedgerReading,
  type PoenaMissingInput,
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
