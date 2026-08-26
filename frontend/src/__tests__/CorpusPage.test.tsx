/**
 * Tests for app/corpus/page.tsx — the corpus browser.
 *
 * Three properties here are structural claims about the material rather than
 * about the component, and each one has a plausible "tidier" implementation
 * that is wrong:
 *
 *   1. GREECE HAS ONE COLUMN FEWER. Twenty of the twenty-two Greek articles are
 *      PROCEDURE, because neither the Gorgias myth nor the Myth of Er contains
 *      a code of offences. A table that keeps the column and leaves it blank
 *      asserts that Plato has offences and this deployment failed to transcribe
 *      them. So the assertion is on the cell COUNT, which a blank column would
 *      pass — an emptiness check would not distinguish the two.
 *
 *   2. TWO CORPORA NEVER SHARE A TABLE, AND NO LINE IS DRAWN BETWEEN THEM.
 *      Europe's seven terraces and nine circles, Greece's two Platonic myths.
 *      A rule between the two cards reads as a grouping line inside one table,
 *      which is exactly the "one list with sections" claim the split exists to
 *      deny. Whitespace separates; a line joins.
 *
 *   3. EVERY SIGIL IS ITS OWN SYSTEM'S. `§ 27 / 42` keeps its denominator
 *      because the Negative Confession is answered in full or not at all;
 *      `614b` is transcribed and never derived from an ordinal. The assertions
 *      are on exact strings, and the Egyptian one additionally asserts that the
 *      bare ordinal is NOT what appears — a fallback to `statute.ordinal` would
 *      print a number in the right place meaning nothing, and "27 is somewhere
 *      on the page" is true either way.
 *
 * The `citation_count` pair is the same shape: `0` and a miss must be
 * distinguishable, so the null row asserts the absence of "0" as well as the
 * presence of the typed miss.
 */
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CorpusPage from "@/app/corpus/page";
import { I18nProvider } from "@/src/contexts/I18nContext";
import { judgmentApi } from "@/lib/api";

jest.mock("@/lib/api", () => ({
  PAGE_SIZE: 20,
  judgmentApi: { statutes: jest.fn() },
}));

const mockedStatutes = judgmentApi.statutes as jest.Mock;

let container: HTMLElement;

interface StatuteFixture {
  id: string;
  code: string;
  civilization: string;
  corpus: string;
  ordinal: number;
  polarity: string;
  display_title: string;
  display_text: string;
  payload_json: Record<string, unknown>;
  citation_count: number | null;
}

function statute(overrides: Partial<StatuteFixture> & Pick<StatuteFixture, "id" | "civilization" | "corpus" | "ordinal">): StatuteFixture {
  return {
    code: `CODE-${overrides.id}`,
    polarity: "OFFENCE",
    display_title: `title-${overrides.id}`,
    display_text: `text-${overrides.id}`,
    payload_json: {},
    citation_count: 0,
    ...overrides,
  } as StatuteFixture;
}

/**
 * One article from each of the six rulebooks, with the payload each numbering
 * system actually needs: the 門 for a 功過格 article, the circle for an Inferno
 * one, the Stephanus page for both Platonic myths, and nothing at all for the
 * Egyptian Forty-Two, whose sigil is built from the ordinal and the doctrine's
 * total.
 */
const FIXTURES: StatuteFixture[] = [
  statute({
    id: "cn-17",
    civilization: "CHINESE",
    corpus: "GONGGUOGE",
    ordinal: 17,
    polarity: "MERIT",
    payload_json: { gate: "救濟門", gate_ordinal: 6 },
    citation_count: 3,
  }),
  statute({
    id: "eu-ds-7",
    civilization: "EUROPEAN",
    corpus: "DEADLY_SIN",
    ordinal: 7,
    citation_count: 0,
  }),
  statute({
    id: "eu-inf-26",
    civilization: "EUROPEAN",
    corpus: "INFERNO",
    ordinal: 26,
    payload_json: { circle: 9 },
    citation_count: null,
  }),
  statute({
    id: "eg-27",
    civilization: "EGYPTIAN",
    corpus: "NEGATIVE_CONFESSION",
    ordinal: 27,
    polarity: "DENIAL",
    citation_count: 12,
  }),
  statute({
    id: "gr-grg-3",
    civilization: "GREEK",
    corpus: "GORGIAS",
    ordinal: 3,
    polarity: "PROCEDURE",
    payload_json: { stephanus: "523a-b" },
    citation_count: 1,
  }),
  statute({
    id: "gr-er-4",
    civilization: "GREEK",
    corpus: "REPUBLIC_ER",
    ordinal: 4,
    polarity: "PROCEDURE",
    payload_json: { stephanus: "614b" },
    citation_count: 5,
  }),
];

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>{children}</I18nProvider>
    </QueryClientProvider>
  );
  return render(<CorpusPage />, { wrapper: Wrapper });
}

function card(corpus: string): HTMLElement {
  const found = container.querySelector<HTMLElement>(`[data-corpus="${corpus}"]`);
  if (found === null) throw new Error(`no card rendered for corpus ${corpus}`);
  return found;
}

/** The sigil is the first cell of the first row of that corpus's table. */
function sigilOf(corpus: string): string {
  const cell = card(corpus).querySelector("tbody tr td");
  return (cell?.textContent ?? "").trim();
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockedStatutes.mockResolvedValue({
    data: { count: FIXTURES.length, next: null, previous: null, results: FIXTURES },
  });
  const rendered = renderPage();
  container = rendered.container;
  // The grid only exists once the query resolves. Anchored on an article body
  // rather than on a sigil, so a broken sigil fails the sigil tests instead of
  // taking the whole file down in `beforeEach`.
  await screen.findByText("text-gr-er-4");
});

// ── Grouping ─────────────────────────────────────────────────────────

describe("corpus grouping", () => {
  it("renders one card per rulebook, never one card for two", () => {
    const cards = container.querySelectorAll("[data-corpus]");
    expect(cards.length).toBe(6);
    expect([...cards].map((node) => node.getAttribute("data-corpus")).sort()).toEqual([
      "DEADLY_SIN",
      "GONGGUOGE",
      "GORGIAS",
      "INFERNO",
      "NEGATIVE_CONFESSION",
      "REPUBLIC_ER",
    ]);
  });

  it("gives each of Europe's two corpora its own table — seven terraces are not nine circles", () => {
    expect(card("DEADLY_SIN").getAttribute("data-civilization")).toBe("EUROPEAN");
    expect(card("INFERNO").getAttribute("data-civilization")).toBe("EUROPEAN");
    expect(card("DEADLY_SIN").querySelectorAll("table").length).toBe(1);
    expect(card("INFERNO").querySelectorAll("table").length).toBe(1);
    // Neither table holds the other's article.
    expect(card("DEADLY_SIN").textContent).not.toContain("text-eu-inf-26");
    expect(card("INFERNO").textContent).not.toContain("text-eu-ds-7");
  });

  it("gives each of Plato's two myths its own table — the seal is not the circuit", () => {
    expect(card("GORGIAS").querySelectorAll("table").length).toBe(1);
    expect(card("REPUBLIC_ER").querySelectorAll("table").length).toBe(1);
    expect(card("GORGIAS").textContent).not.toContain("614b");
    expect(card("REPUBLIC_ER").textContent).not.toContain("523a-b");
  });

  it("separates the cards with 40px of nothing and draws no rule between them", () => {
    const grid = container.querySelector<HTMLElement>("[data-corpus-grid]");
    expect(grid).not.toBeNull();
    expect(grid!.className).toMatch(/\bgap-10\b/);
    // A `divide-y` on the grid would put a line between the rows of cards,
    // which is the "one table with sections" reading in another spelling.
    expect(grid!.className).not.toMatch(/\bdivide-/);

    // Each card's only rule is the 3px civilization mark on top. Any bottom or
    // side border would close the card into a box and re-join the pair.
    for (const node of container.querySelectorAll<HTMLElement>("[data-corpus]")) {
      expect(node.className).toMatch(/\bborder-t-3\b/);
      expect(node.className).not.toMatch(/\bborder-(b|l|r|y|x)\b/);
    }
  });
});

// ── One column fewer for Greece ──────────────────────────────────────

describe("the Greek table carries one column fewer", () => {
  it("flags both Greek corpora as naming no offences and the other three as naming them", () => {
    expect(card("GORGIAS").getAttribute("data-names-offences")).toBe("false");
    expect(card("REPUBLIC_ER").getAttribute("data-names-offences")).toBe("false");
    expect(card("GONGGUOGE").getAttribute("data-names-offences")).toBe("true");
    expect(card("INFERNO").getAttribute("data-names-offences")).toBe("true");
    expect(card("NEGATIVE_CONFESSION").getAttribute("data-names-offences")).toBe("true");
  });

  it("gives the Greek tables three columns and the others four", () => {
    // Header and body both, because a header that lost a cell while the rows
    // kept theirs is a table whose columns no longer mean what they say.
    for (const corpus of ["GORGIAS", "REPUBLIC_ER"]) {
      expect(card(corpus).querySelectorAll("thead th").length).toBe(3);
      expect(card(corpus).querySelectorAll("colgroup col").length).toBe(3);
      for (const row of card(corpus).querySelectorAll("tbody tr")) {
        expect(row.querySelectorAll("td").length).toBe(3);
      }
    }
    for (const corpus of ["GONGGUOGE", "DEADLY_SIN", "INFERNO", "NEGATIVE_CONFESSION"]) {
      expect(card(corpus).querySelectorAll("thead th").length).toBe(4);
      expect(card(corpus).querySelectorAll("colgroup col").length).toBe(4);
      for (const row of card(corpus).querySelectorAll("tbody tr")) {
        expect(row.querySelectorAll("td").length).toBe(4);
      }
    }
  });

  it("prints no polarity for a Greek article — 'rule of the court', twenty times, is not a column", () => {
    // The polarity lives inside the offence column, so a corpus with no offence
    // column has no polarity cell either. Asserted through the raw member,
    // which <DomainEnum> puts in `title`, so this does not depend on which
    // bundle the test happens to run under.
    expect(card("GORGIAS").querySelector('[title="PROCEDURE"]')).toBeNull();
    expect(card("REPUBLIC_ER").querySelector('[title="PROCEDURE"]')).toBeNull();
    // The three that do name offences still say which kind.
    expect(card("GONGGUOGE").querySelector('[title="MERIT"]')).not.toBeNull();
    expect(card("NEGATIVE_CONFESSION").querySelector('[title="DENIAL"]')).not.toBeNull();
  });

  it("still shows the Greek article's body and tally — the missing column is the offence, not the article", () => {
    expect(card("GORGIAS").textContent).toContain("text-gr-grg-3");
    expect(sigilOf("GORGIAS")).toBe("523a-b");
  });
});

// ── Sigils ───────────────────────────────────────────────────────────

describe("each corpus is numbered in its own system", () => {
  it("numbers a 功過格 article by 門 and Han numeral — not by 卷, which the text does not have", () => {
    // 六, from `gate_ordinal: 6` — NOT 十七 from `ordinal: 17`. This fixture
    // already carried both numbers and the expectation used the wrong one.
    // 門 are contiguous ranges of the corpus-wide count, so an `ordinal`
    // printed beside a 門 name is a citation that resolves to nothing.
    expect(sigilOf("GONGGUOGE")).toBe("救濟門 · 六");
  });

  it("numbers an Inferno article in roman with the circle first, and a terrace article bare", () => {
    expect(sigilOf("INFERNO")).toBe("IX · XXVI");
    // The seven terraces are a different structure and carry no circle, so a
    // bare numeral is the correct output there rather than a degraded one.
    expect(sigilOf("DEADLY_SIN")).toBe("VII");
  });

  it("prints the Egyptian denominator — forty-one declarations is no declaration", () => {
    expect(sigilOf("NEGATIVE_CONFESSION")).toBe("§ 27 / 42");
    // And not the bare ordinal: a formatter that dropped the doctrine would
    // still put a 27 in this cell.
    expect(sigilOf("NEGATIVE_CONFESSION")).not.toBe("27");
    expect(sigilOf("NEGATIVE_CONFESSION")).toContain("/ 42");
  });

  it("prints the transcribed Stephanus page and never the ordinal", () => {
    expect(sigilOf("GORGIAS")).toBe("523a-b");
    expect(sigilOf("REPUBLIC_ER")).toBe("614b");
    // Ordinals 3 and 4 are artefacts of the seeder's insertion order.
    expect(sigilOf("GORGIAS")).not.toBe("3");
    expect(sigilOf("REPUBLIC_ER")).not.toBe("4");
  });
});

// ── Citation tally ───────────────────────────────────────────────────

describe("citation_count", () => {
  function tallyCell(corpus: string): HTMLElement {
    const cells = card(corpus).querySelectorAll<HTMLElement>("tbody tr td");
    return cells[cells.length - 1];
  }

  it("prints a recorded zero as a digit — the article exists and nothing rests on it", () => {
    const cell = tallyCell("DEADLY_SIN");
    expect(cell.textContent?.trim()).toBe("0");
    expect(cell.querySelector('[data-zero="true"]')).not.toBeNull();
    expect(cell.querySelector("[data-missing]")).toBeNull();
  });

  it("prints a typed miss for null, and specifically not a zero", () => {
    const cell = tallyCell("INFERNO");
    expect(cell.querySelector('[data-missing="unrecorded"]')).not.toBeNull();
    // The defect this guards: `citation_count ?? 0` invents a reading of the
    // tenant's case history out of a field the response did not carry.
    expect(cell.textContent).not.toContain("0");
  });

  it("prints the number when there is one", () => {
    expect(tallyCell("GONGGUOGE").textContent?.trim()).toBe("3");
    expect(tallyCell("NEGATIVE_CONFESSION").textContent?.trim()).toBe("12");
  });
});

// ── Request wiring ───────────────────────────────────────────────────

describe("ordering follows the corpus filter", () => {
  it("asks for code order while several rulebooks can share a page", () => {
    // Unfiltered, `ordinal` interleaves six documents' article 1s; `code` is
    // the only allowed field that keeps a document contiguous.
    expect(mockedStatutes).toHaveBeenCalledWith(
      expect.objectContaining({ ordering: "code", page: "1" })
    );
    expect(mockedStatutes).not.toHaveBeenCalledWith(
      expect.objectContaining({ ordering: "ordinal" })
    );
  });
});
