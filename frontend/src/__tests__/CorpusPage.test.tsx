/**
 * app/corpus/page.tsx —— 律条阅读页。
 *
 * 钉住的几条,每一条都有一个「更整齐」却错误的写法:
 *
 *   1. 每个节号是它自己体系的(§ 27 / 42 带分母、614b 是转录的斯特方页码、功過格按
 *      門內序號)—— 断言逐字,并断言裸 ordinal 不出现。
 *   2. 衬线只给原文与今译:阅读栏里恰好两段 `.font-serif`。
 *   3. 原文只在真按原语转录的功過格上有;别的五部写「未记录」,不拿译文冒充。
 *   4. citation_count 的 0 与 null 可区分;「被引用」清单读 `?statute=`,新的在前、分页;
 *      「版本」没有接口,写明缺口。
 *   5. 检索命中用 <mark>(底色 + 2 px 强调下线,不改字重);输入节号直达那一条。
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CorpusPage from "@/app/corpus/page";
import { I18nProvider } from "@/src/contexts/I18nContext";
import { judgmentApi } from "@soulledger/core/api";

jest.mock("@soulledger/core/api", () => ({
  PAGE_SIZE: 20,
  judgmentApi: { statutes: jest.fn(), list: jest.fn() },
}));

const mockedStatutes = judgmentApi.statutes as jest.Mock;
const mockedList = judgmentApi.list as jest.Mock;

const citing = (id: string, verdict: string | null, day: string) => ({
  id,
  soul_name: `魂-${id}`,
  verdict,
  created_at: `2026-0${day}T00:00:00Z`,
  concluded_at: verdict ? `2026-0${day}T12:00:00Z` : null,
});

type Fixture = Record<string, unknown> & { id: string; civilization: string; corpus: string; ordinal: number };
function statute(o: Fixture) {
  return {
    code: `CODE-${o.id}`,
    polarity: "OFFENCE",
    title_zh: "",
    title_en: "",
    title_egy: "",
    text_zh: "",
    text_en: "",
    text_egy: "",
    display_title: `title-${o.id}`,
    display_text: `text-${o.id}`,
    is_derived: false,
    source: `source-${o.id}`,
    source_notes: [],
    payload_json: {},
    citation_count: 0,
    ...o,
  };
}

const FIXTURES = [
  statute({
    id: "cn-17",
    civilization: "CHINESE",
    corpus: "GONGGUOGE",
    ordinal: 17,
    polarity: "MERIT",
    payload_json: { gate: "救濟門", gate_ordinal: 6 },
    text_zh: "凡善多而口业未净者，勿遽转生。",
    text_en: "One whose good is great but whose speech is not yet clean shall not be reborn in haste.",
    display_text: "凡善多而口业未净者，勿遽转生。",
    source_notes: ["编者注:期三年为上限。"],
    citation_count: 3,
  }),
  statute({ id: "eu-ds-7", civilization: "EUROPEAN", corpus: "DEADLY_SIN", ordinal: 7, citation_count: 0 }),
  statute({ id: "eu-inf-26", civilization: "EUROPEAN", corpus: "INFERNO", ordinal: 26, payload_json: { circle: 9 }, citation_count: null }),
  statute({ id: "eg-27", civilization: "EGYPTIAN", corpus: "NEGATIVE_CONFESSION", ordinal: 27, polarity: "DENIAL", citation_count: 12 }),
  statute({ id: "gr-er-4", civilization: "GREEK", corpus: "REPUBLIC_ER", ordinal: 4, polarity: "PROCEDURE", payload_json: { stephanus: "614b" } }),
];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <I18nProvider>{children}</I18nProvider>
    </QueryClientProvider>
  );
  return render(<CorpusPage />, { wrapper: Wrapper });
}

const search = () => screen.getByRole("searchbox");
const sigil = () => screen.getByTestId("corpus-sigil").textContent?.trim();
async function open(query: string) {
  fireEvent.change(search(), { target: { value: query } });
  await waitFor(() => expect(screen.getByTestId("corpus-reading")).toBeInTheDocument());
}

beforeEach(() => {
  jest.clearAllMocks();
  // Two pages, so the walk over `next` is exercised.
  mockedStatutes.mockImplementation((params: Record<string, string>) =>
    Promise.resolve({
      data:
        params.page === "1"
          ? { count: 5, next: "p2", previous: null, results: FIXTURES.slice(0, 3) }
          : { count: 5, next: null, previous: "p1", results: FIXTURES.slice(3) },
    })
  );
  mockedList.mockResolvedValue({ data: { count: 0, next: null, previous: null, results: [] } });
});

describe("loading the corpus", () => {
  it("walks every page of the list endpoint in code order", async () => {
    renderPage();
    await screen.findByTestId("corpus-reading");
    expect(mockedStatutes.mock.calls.map((c) => c[0])).toEqual([
      { ordering: "code", page: "1" },
      { ordering: "code", page: "2" },
    ]);
    expect(screen.getByTestId("corpus-hit-count")).toHaveTextContent("5 条");
  });

  it("opens on the first article of the first rulebook", async () => {
    renderPage();
    await screen.findByTestId("corpus-reading");
    expect(sigil()).toBe("救濟門 · 六");
  });

  it("says a failure is a failure", async () => {
    mockedStatutes.mockRejectedValue(new Error("500"));
    renderPage();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByTestId("corpus-reading")).toBeNull();
  });
});

describe("typing a code jumps straight to it — each in its own system", () => {
  it.each([
    ["IX · XXVI", "IX · XXVI"],
    ["ix·xxvi", "IX · XXVI"],
    ["§ 27 / 42", "§ 27 / 42"],
    ["614b", "614b"],
    ["VII", "VII"],
    ["救濟門 · 六", "救濟門 · 六"],
  ])("%s opens %s", async (typed, expected) => {
    renderPage();
    await screen.findByTestId("corpus-reading");
    await open(typed);
    expect(sigil()).toBe(expected);
  });

  it("never prints a bare ordinal where the system's sigil belongs", async () => {
    renderPage();
    await screen.findByTestId("corpus-reading");
    await open("§ 27 / 42");
    expect(sigil()).not.toBe("27");
    await open("614b");
    expect(sigil()).not.toBe("4");
  });
});

describe("serif, original and translation", () => {
  it("sets exactly two serif passages — 原文 and 今译 — for the 功過格, original = text_zh", async () => {
    renderPage();
    const reading = await screen.findByTestId("corpus-reading");
    expect(reading.querySelectorAll(".font-serif")).toHaveLength(2);
    expect(within(reading).getByTestId("corpus-original")).toHaveTextContent("凡善多而口业未净者");
    expect(within(reading).getByTestId("corpus-translation")).toHaveTextContent("shall not be reborn in haste");
    // Editor notes and metadata are sans.
    expect(within(reading).getByText("编者注:期三年为上限。").closest(".font-serif")).toBeNull();
    expect(within(reading).getByTestId("corpus-sigil").className).toContain("font-mono");
  });

  it("does not pass a translation off as the original for a rulebook stored only in translation", async () => {
    renderPage();
    await screen.findByTestId("corpus-reading");
    await open("IX · XXVI");
    const reading = screen.getByTestId("corpus-reading");
    const original = within(reading).getByTestId("corpus-original");
    expect(original.querySelector('[data-missing="unrecorded"]')).not.toBeNull();
    expect(original).not.toHaveTextContent("text-eu-inf-26");
    expect(within(reading).getByTestId("corpus-translation")).toHaveTextContent("text-eu-inf-26");
    expect(reading.querySelectorAll(".font-serif")).toHaveLength(1);
  });

  it("caps the reading column at 72ch", async () => {
    renderPage();
    const reading = await screen.findByTestId("corpus-reading");
    expect(reading.querySelector(".max-w-\\[72ch\\]")).not.toBeNull();
  });
});

describe("search", () => {
  it("marks hits with a tint and a 2px accent underline, not a weight change", async () => {
    renderPage();
    await screen.findByTestId("corpus-reading");
    fireEvent.change(search(), { target: { value: "口业" } });
    const hit = await screen.findAllByText("口业", { selector: "mark" });
    expect(hit[0].className).toContain("--color-surface-2");
    expect(hit[0].className).toContain("inset_0_-2px_0_oklch(var(--color-accent))");
    expect(hit[0].className).not.toMatch(/font-(semibold|bold|medium)/);
    expect(screen.getByTestId("corpus-hit-count")).toHaveTextContent("1 条");
  });

  it("says nothing matched, with a way out", async () => {
    renderPage();
    await screen.findByTestId("corpus-reading");
    fireEvent.change(search(), { target: { value: "口孽" } });
    expect(await screen.findByText("没有匹配「口孽」的律条")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "清除检索" }));
    await screen.findByTestId("corpus-reading");
  });
});

describe("the right rail", () => {
  it("formats the citation as 〔rulebook · sigil〕", async () => {
    renderPage();
    await screen.findByTestId("corpus-reading");
    expect(screen.getByTestId("corpus-citation").textContent).toMatch(/^〔.+ · 救濟門 · 六〕$/);
  });

  it("prints a recorded zero as a count, and a typed miss — not a zero — for null", async () => {
    renderPage();
    await screen.findByTestId("corpus-reading");
    await open("VII");
    expect(screen.getByTestId("corpus-cited-by")).toHaveTextContent("被引用 0 件");
    // Nothing to list, so nothing is asked for.
    expect(mockedList).not.toHaveBeenCalledWith(expect.objectContaining({ statute: "eu-ds-7" }));
    await open("IX · XXVI");
    const miss = screen.getByTestId("corpus-cited-by");
    expect(miss.querySelector('[data-missing="unrecorded"]')).not.toBeNull();
    expect(miss).not.toHaveTextContent("0");
  });

  it("states the version gap instead of inventing one — and no longer claims the cited-by list is missing", async () => {
    renderPage();
    await screen.findByTestId("corpus-reading");
    const rail = screen.getByTestId("corpus-rail");
    expect(rail).not.toHaveTextContent("接口不能按律条查判决");
    expect(within(rail).getByTestId("corpus-versions")).toHaveTextContent("律条没有版本记录");
    expect(rail).not.toHaveTextContent("v1");
  });

  it("lists the citing judgments newest first: soul, verdict glyph, date — and pages", async () => {
    mockedList.mockImplementation((params: Record<string, string>) =>
      Promise.resolve({
        data:
          params.page === "1"
            ? { count: 21, next: "p2", previous: null, results: [citing("j2", "FAILED", "3-02"), citing("j1", null, "2-01")] }
            : { count: 21, next: null, previous: "p1", results: [citing("j0", "PASSED", "1-01")] },
      })
    );
    renderPage();
    await screen.findByTestId("corpus-reading");
    expect(screen.getByTestId("corpus-cited-by")).toHaveTextContent("被引用 3 件");
    const list = await screen.findByTestId("corpus-cited-list");
    expect(mockedList).toHaveBeenCalledWith({ statute: "cn-17", ordering: "-created_at", page: "1" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("魂-j2");
    expect(rows[0]).toHaveTextContent("✕");
    expect(rows[0]).toHaveTextContent("2026-03-02");
    expect(within(rows[0]).getByRole("link")).toHaveAttribute("href", "/judgment/j2");
    // An open case has no verdict glyph, and says it is open.
    expect(rows[1]).toHaveTextContent("未结");
    expect(rows[1]).not.toHaveTextContent("?");
    expect(list).toHaveTextContent("1 / 2");
    fireEvent.click(within(list).getByRole("button", { name: /下一页|next/i }));
    await waitFor(() => expect(within(screen.getByTestId("corpus-cited-list")).getByText("魂-j0")).toBeInTheDocument());
    expect(mockedList).toHaveBeenLastCalledWith({ statute: "cn-17", ordering: "-created_at", page: "2" });
  });
});
