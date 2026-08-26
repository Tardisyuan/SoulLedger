/**
 * The cited-grounds panel (src/components/judgment/JudgmentGroundsPanel.tsx).
 *
 * The feature's claim is that a decided case can say why. These pin the three
 * ways that claim degrades quietly:
 *
 *   1. A DERIVED article renders. The Egyptian 42 carry no stored body — the
 *      server resolves it out of the assessor's record into `display_text`.
 *      A panel that read `text_en` would render an empty article and look like
 *      a styling bug rather than a missing citation.
 *   2. MERIT AND OFFENCE DO NOT READ ALIKE. 功過相抵 is a rule of 冥律, so a
 *      cited 孝养父母 is credit; if the two share a tone the panel turns every
 *      ground into an accusation.
 *   3. THE SOURCE'S OWN CAVEATS SURVIVE. docs/03 says its Dante mapping is not
 *      one-to-one and docs/11's 十恶 table lists six. Dropping `source_notes`
 *      would present a documented uncertainty as an assertion.
 */
import { render, screen } from "@testing-library/react";
import { I18nProvider } from "@/src/contexts/I18nContext";
import { JudgmentGroundsPanel } from "@/src/components/judgment/JudgmentGroundsPanel";
import { MISSING_GLYPH } from "@/src/lib/domainDisplay";
import type { JudgmentCitation, Statute } from "@/lib/api";

function statute(overrides: Partial<Statute> = {}): Statute {
  return {
    id: "st-1",
    code: "CN-HL-O01",
    civilization: "CHINESE",
    corpus: "HELL_LAW",
    ordinal: 1,
    polarity: "OFFENCE",
    title_zh: "杀生",
    title_en: "Killing",
    title_egy: "",
    text_zh: "故意杀害人/动物。",
    text_en: "Deliberately killing a person or an animal.",
    text_egy: "",
    display_title: "杀生",
    display_text: "故意杀害人/动物。",
    is_derived: false,
    source: "docs/11 §4.1",
    source_notes: [],
    payload_json: {},
    ...overrides,
  };
}

function citation(overrides: Partial<JudgmentCitation> = {}): JudgmentCitation {
  return {
    id: "c-1",
    statute: statute(),
    note: "",
    created_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function renderPanel(citations: JudgmentCitation[]) {
  return render(
    <I18nProvider>
      <JudgmentGroundsPanel citations={citations} />
    </I18nProvider>
  );
}

describe("JudgmentGroundsPanel", () => {
  it("says a verdict cited nothing rather than rendering an empty box", () => {
    renderPanel([]);
    // "No articles were cited" is a fact about the verdict, not a loading or
    // error state, so it has copy of its own.
    expect(screen.getByText(/未引用|No articles/)).toBeInTheDocument();
  });

  it("shows the article code, its title and its body", () => {
    renderPanel([citation()]);
    expect(screen.getByText("CN-HL-O01")).toBeInTheDocument();
    expect(screen.getByText("杀生")).toBeInTheDocument();
    expect(screen.getByText("故意杀害人/动物。")).toBeInTheDocument();
  });

  it("renders a derived article's body, which lives on the assessor not the statute", () => {
    renderPanel([
      citation({
        id: "c-eg",
        statute: statute({
          id: "st-eg",
          code: "EG-NC-04",
          civilization: "EGYPTIAN",
          corpus: "NEGATIVE_CONFESSION",
          polarity: "DENIAL",
          title_zh: "",
          display_title: "Am-khaibetu",
          // The stored columns are empty BY DESIGN for the Forty-Two.
          text_zh: "",
          text_en: "",
          display_text: "theft",
          is_derived: true,
          source: "Actor.powers_json['negative_confession'], Budge/Nebseni",
        }),
      }),
    ]);
    expect(screen.getByText("Am-khaibetu")).toBeInTheDocument();
    expect(screen.getByText("theft")).toBeInTheDocument();
    // And it says it is a reference rather than a transcription — the reader
    // has to be able to tell one source of truth from a second copy.
    expect(screen.getByText(/派生自|Derived from/)).toBeInTheDocument();
  });

  it("keeps merit and offence visually distinct", () => {
    const { container } = renderPanel([
      citation({ id: "c-o", statute: statute({ polarity: "OFFENCE" }) }),
      citation({
        id: "c-m",
        statute: statute({
          id: "st-m",
          code: "CN-HL-M01",
          polarity: "MERIT",
          display_title: "孝养父母",
          display_text: "赡养双亲。",
        }),
      }),
    ]);
    const offence = screen.getByTitle("OFFENCE").closest("span");
    const merit = screen.getByTitle("MERIT").closest("span");
    expect(offence).toBeTruthy();
    expect(merit).toBeTruthy();
    // Different tones, and neither is the other's.
    expect(offence?.parentElement?.className).not.toBe(merit?.parentElement?.className);
    // The 0.1 badge-tint cap applies to the FILL (borders are 0.3 by the
    // shared convention in ENUM_TONE_CLASSES). Nothing here declares its own
    // background, so every `bg-` on the panel comes from that one place.
    const fills = container.innerHTML.match(/bg-\[hsl\(var\(--color-status-[a-z]+\)\/[\d.]+\)\]/g) ?? [];
    expect(fills.length).toBeGreaterThan(0);
    expect(fills.every((fill) => fill.endsWith("/0.1)]"))).toBe(true);
  });

  it("carries the raw enum member in title and never into the text node", () => {
    renderPanel([citation()]);
    const badge = screen.getByTitle("HELL_LAW");
    expect(badge.textContent).not.toContain("HELL_LAW");
    expect(badge.textContent).toBe("冥律");
  });

  it("surfaces the source and the source's own caveats", () => {
    renderPanel([
      citation({
        statute: statute({
          source: "docs/03 §1/§4/§5",
          source_notes: [
            "docs/03 §4 states that the Inferno's circles and the Catholic seven do not correspond one-to-one.",
          ],
        }),
      }),
    ]);
    expect(screen.getByText(/docs\/03 §1/)).toBeInTheDocument();
    expect(screen.getByText(/do not correspond one-to-one/)).toBeInTheDocument();
  });

  /**
   * The sigil column — four numbering systems, one component, no branch on a
   * civilization name anywhere in it.
   *
   * These run through `formatSigil`, so they fail if the panel starts printing
   * `statute.ordinal` instead. That substitution is the failure worth pinning:
   * it renders, it is a number, it sits where a number belongs, and it is
   * wrong in three of the four systems — a 功過格 article is cited by 門 and
   * 條, an Inferno article by circle, and Plato by Stephanus page, whose
   * relationship to the seeder's insertion order is nil.
   */
  describe("numbers each article in its own civilization's system", () => {
    function sigilOf(statuteOverrides: Partial<Statute>, system: string): HTMLElement {
      renderPanel([citation({ statute: statute(statuteOverrides) })]);
      // The system's name is on the sigil's own element (it is also what a
      // reader gets as a tooltip), so this addresses the cell without
      // depending on any class name.
      return screen.getByTitle(system);
    }

    it("CHINESE — 門 · 條 in Han numerals, with the 門 passed through", () => {
      expect(
        sigilOf(
          { civilization: "CHINESE", corpus: "GONGGUOGE", ordinal: 17, payload_json: { gate: "救濟門" } },
          "功過格 門條"
        ).textContent
      ).toBe("救濟門 · 十七");
    });

    it("EUROPEAN — roman, circle first", () => {
      expect(
        sigilOf(
          { civilization: "EUROPEAN", corpus: "INFERNO", ordinal: 26, payload_json: { circle: 9 } },
          "Roman, circle first"
        ).textContent
      ).toBe("IX · XXVI");
    });

    it("EGYPTIAN — the denominator is the doctrine, so it is always printed", () => {
      expect(
        sigilOf(
          { civilization: "EGYPTIAN", corpus: "NEGATIVE_CONFESSION", ordinal: 4, payload_json: {} },
          "§ n / 42"
        ).textContent
      ).toBe("§ 4 / 42");
    });

    it("GREEK — the transcribed Stephanus page, verbatim", () => {
      expect(
        sigilOf(
          { civilization: "GREEK", corpus: "GORGIAS", ordinal: 3, payload_json: { stephanus: "523a-b" } },
          "Stephanus"
        ).textContent
      ).toBe("523a-b");
    });

    it("shows a MISS rather than the ordinal when the system's own key is absent", () => {
      // A Greek article with no transcribed page has no sigil. `22` is not a
      // degraded answer — it is the seeder's row number wearing a citation's
      // clothes. Asserting the glyph asserts the ABSENCE of that fallback:
      // the ordinal is 3 here and must not appear.
      const cell = sigilOf(
        { civilization: "GREEK", corpus: "REPUBLIC_ER", ordinal: 3, payload_json: {} },
        "Stephanus"
      );
      expect(cell.textContent).toBe(MISSING_GLYPH.unrecorded);
      expect(cell.textContent).not.toContain("3");
    });

    it("renders a miss, not a crash, for a civilization with no numbering system", () => {
      // `formatSigil` throws for an unknown civilization, which is right for a
      // programming error — but this value arrives as a wire string, and this
      // union has drifted from the backend before. One unmapped row must not
      // take the judgment page down.
      renderPanel([citation({ statute: statute({ civilization: "ATLANTEAN" }) })]);
      expect(screen.getByText("CN-HL-O01")).toBeInTheDocument();
    });
  });

  it("counts the grounds, since 功過相抵 turns on there being more than one", () => {
    renderPanel([
      citation({ id: "a" }),
      citation({ id: "b", statute: statute({ id: "st-2", code: "CN-HL-O04" }) }),
    ]);
    expect(screen.getByText(/2/)).toBeInTheDocument();
  });
});
