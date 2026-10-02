/**
 * app/corpus/page.tsx —— 律条阅读页。
 *
 * 钉住的几条,每一条都有一个「更整齐」却错误的写法:
 *
 *   1. 每个节号是它自己体系的(§ 27 / 42 带分母、614b 是转录的斯特方页码、功過格按
 *      門內序號)—— 断言逐字,并断言裸 ordinal 不出现。
 *   2. 衬线只给原文与译文:阅读栏里恰好两段 `.font-serif`。
 *   3. 原文只在真按原语转录的功過格上有;别的几部不放「原文」一节,不拿译文冒充。
 *   4. citation_count 的 0 与 null 可区分;「被引用」清单读 `?statute=`,新的在前、分页;
 *      「版本」没有接口,写明缺口。
 *   5. 检索命中用 <mark>(12% 墨底 + 2 px 墨下线,当前那处反白,不改字重);↑ ↓ 按目录顺序
 *      走过每一处;输入节号直达那一条。
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

// `?code=` deep link (ClauseLink). Empty by default: no query string.
const mockQuery = { current: "" };
jest.mock("next/navigation", () => ({
  ...jest.requireActual("next/navigation"),
  useSearchParams: () => new URLSearchParams(mockQuery.current),
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
    revision: 1,
    effective_from: "2026-08-27",
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
  statute({ id: "eu-ds-7", civilization: "EUROPEAN", corpus: "DEADLY_SIN", ordinal: 7, citation_count: 0, revision: 3, effective_from: "2026-09-30" }),
  // 旧接口:没有版本两列。
  statute({ id: "eu-inf-26", civilization: "EUROPEAN", corpus: "INFERNO", ordinal: 26, payload_json: { circle: 9 }, citation_count: null, revision: undefined, effective_from: undefined }),
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
  mockQuery.current = "";
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
  it("sets exactly two serif passages — 原文 and 译文 — for the 功過格, original = text_zh", async () => {
    renderPage();
    const reading = await screen.findByTestId("corpus-reading");
    expect(reading.querySelectorAll(".font-serif")).toHaveLength(2);
    expect(within(reading).getByTestId("corpus-original")).toHaveTextContent("凡善多而口业未净者");
    expect(within(reading).getByTestId("corpus-translation")).toHaveTextContent("shall not be reborn in haste");
    // Editor notes and metadata are sans.
    // (twice: a section from 1024 up, a <details> below it)
    const notes = within(reading).getAllByText("编者注:期三年为上限。");
    expect(notes).toHaveLength(2);
    for (const n of notes) expect(n.closest(".font-serif")).toBeNull();
    expect(reading.querySelector("details")).toHaveTextContent("编者注");
    // 条号是展示数字(规范 v3):Noto Serif SC 600,不是等宽。
    expect(within(reading).getByTestId("corpus-sigil").className).toContain("font-title");
    expect(within(reading).getByTestId("corpus-sigil").className).not.toContain("font-mono");
    // 宽屏 40(用户 2026-10-02,Design A3),窄屏 28(Design 393)。
    expect(within(reading).getByTestId("corpus-sigil").className.split(" ")).toEqual(
      expect.arrayContaining(["lg:text-display", "text-xl"])
    );
  });

  it("does not pass a translation off as the original for a rulebook stored only in translation", async () => {
    renderPage();
    await screen.findByTestId("corpus-reading");
    await open("IX · XXVI");
    const reading = screen.getByTestId("corpus-reading");
    expect(within(reading).queryByTestId("corpus-original")).toBeNull();
    expect(within(reading).queryByText("原文")).toBeNull();
    expect(within(reading).getByText("译文")).toBeInTheDocument();
    expect(within(reading).getByTestId("corpus-translation")).toHaveTextContent("text-eu-inf-26");
    expect(reading.querySelectorAll(".font-serif")).toHaveLength(1);
  });

  it("caps the passages at 34em", async () => {
    renderPage();
    const reading = await screen.findByTestId("corpus-reading");
    expect(within(reading).getByTestId("corpus-translation").className).toContain("max-w-[34em]");
  });
});

describe("search", () => {
  it("marks the current hit inverted, the others with a tint and a 2px ink underline — never a weight change", async () => {
    renderPage();
    await screen.findByTestId("corpus-reading");
    fireEvent.change(search(), { target: { value: "text-" } });
    await waitFor(() => expect(screen.getByTestId("corpus-hit-position")).toHaveTextContent("1 / 4"));
    const current = screen.getAllByText("text-", { selector: "mark" });
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAttribute("data-current");
    expect(current[0].className).toContain("bg-[oklch(var(--color-ink))]");
    expect(current[0].className).toContain("text-[oklch(var(--color-surface-1))]");
    expect(current[0].className).not.toMatch(/font-(semibold|bold|medium)/);
    expect(screen.getByTestId("corpus-hit-count")).toHaveTextContent("子串匹配 · 4 部中 4 处");
  });

  it("numbers hits title → translation within one article: the next one is the next drawn, the others tinted", async () => {
    mockedStatutes.mockImplementation(() =>
      Promise.resolve({
        data: {
          count: 1,
          next: null,
          previous: null,
          results: [statute({ id: "x", civilization: "EUROPEAN", corpus: "DEADLY_SIN", ordinal: 1, display_title: "ira", display_text: "ira et ira" })],
        },
      })
    );
    renderPage();
    await screen.findByTestId("corpus-reading");
    fireEvent.change(search(), { target: { value: "ira" } });
    await waitFor(() => expect(screen.getByTestId("corpus-hit-position")).toHaveTextContent("1 / 3"));
    const translationMarks = () => Array.from(screen.getByTestId("corpus-translation").querySelectorAll("mark"));
    expect(translationMarks()).toHaveLength(2);
    expect(translationMarks().some((m) => m.hasAttribute("data-current"))).toBe(false);
    expect(translationMarks()[1].className).toContain("bg-[oklch(var(--color-ink)/0.12)]");
    expect(translationMarks()[1].className).toContain("inset_0_-2px_0_oklch(var(--color-ink))");
    fireEvent.click(screen.getByRole("button", { name: "下一处" }));
    expect(screen.getByTestId("corpus-hit-position")).toHaveTextContent("2 / 3");
    expect(translationMarks()[0]).toHaveAttribute("data-current");
    expect(translationMarks()[1]).not.toHaveAttribute("data-current");
    expect(document.querySelectorAll("mark[data-current]")).toHaveLength(1);
  });

  it("↑ ↓ walk the hits across articles in contents order, wrapping at both ends", async () => {
    renderPage();
    await screen.findByTestId("corpus-reading");
    fireEvent.change(search(), { target: { value: "text-" } });
    await waitFor(() => expect(screen.getByTestId("corpus-translation")).toHaveTextContent("text-eu-inf-26"));
    fireEvent.click(screen.getByRole("button", { name: "下一处" }));
    expect(screen.getByTestId("corpus-hit-position")).toHaveTextContent("2 / 4");
    expect(screen.getByTestId("corpus-translation")).toHaveTextContent("text-eu-ds-7");
    fireEvent.keyDown(search(), { key: "Enter", shiftKey: true });
    fireEvent.keyDown(search(), { key: "Enter", shiftKey: true });
    expect(screen.getByTestId("corpus-hit-position")).toHaveTextContent("4 / 4");
    expect(screen.getByTestId("corpus-translation")).toHaveTextContent("text-gr-er-4");
    fireEvent.click(screen.getByRole("button", { name: "清除检索" }));
    expect(search()).toHaveValue("");
    expect(screen.queryByTestId("corpus-hit-position")).toBeNull();
  });

  it("says nothing matched, with a way out", async () => {
    renderPage();
    await screen.findByTestId("corpus-reading");
    fireEvent.change(search(), { target: { value: "口孽" } });
    expect(await screen.findByText("没有匹配「口孽」的律条")).toBeInTheDocument();
    // Two ways out: the ✕ in the box and the empty state's button.
    expect(screen.getAllByRole("button", { name: "清除检索" })).toHaveLength(2);
    fireEvent.click(screen.getByText("清除检索", { selector: "button" }));
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
    expect(screen.getByTestId("corpus-cited-by")).toHaveTextContent(/^0次被判词引用$/);
    // Nothing to list, so nothing is asked for.
    expect(mockedList).not.toHaveBeenCalledWith(expect.objectContaining({ statute: "eu-ds-7" }));
    await open("IX · XXVI");
    const miss = screen.getByTestId("corpus-cited-by");
    expect(miss.querySelector('[data-missing="unrecorded"]')).not.toBeNull();
    expect(miss).not.toHaveTextContent("0");
  });

  it("shows which revision the article is and since when — and a typed miss, not a made-up v1, when the API has none", async () => {
    renderPage();
    await screen.findByTestId("corpus-reading");
    const rail = screen.getByTestId("corpus-rail");
    expect(rail).not.toHaveTextContent("接口不能按律条查判决");
    expect(within(rail).getByTestId("corpus-versions")).toHaveTextContent(/^第 1 版自 2026-08-27 起施行$/);
    await open("VII");
    expect(screen.getByTestId("corpus-versions")).toHaveTextContent(/^第 3 版自 2026-09-30 起施行$/);
    await open("IX · XXVI");
    const miss = screen.getByTestId("corpus-versions");
    expect(miss.querySelector('[data-missing="unrecorded"]')).not.toBeNull();
    expect(miss).not.toHaveTextContent(/版|v1/);
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
    expect(screen.getByTestId("corpus-cited-by")).toHaveTextContent(/^3次被判词引用$/);
    expect(screen.getByTestId("corpus-cited-by").querySelector(".font-title")).toHaveTextContent(/^3$/);
    expect(screen.getByTestId("corpus-cited-by").querySelector(".font-title")!.className.split(" ")).toContain("lg:text-display");
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

describe("?code= — a ledger clause links to its article", () => {
  const tocGroup = (corpus: string) => document.querySelector(`[data-toc-corpus="${corpus}"] > button`) as HTMLElement;

  it("opens the article whose code matches and expands its group in the contents", async () => {
    mockQuery.current = "code=CODE-eg-27";
    renderPage();
    await waitFor(() => expect(screen.getByTestId("corpus-reading")).toHaveTextContent("title-eg-27"));
    expect(tocGroup("NEGATIVE_CONFESSION")).toHaveAttribute("aria-expanded", "true");
    const nav = screen.getByRole("navigation", { name: /目录|contents/i });
    expect(within(nav).getByRole("button", { current: true })).toHaveTextContent("title-eg-27");
    // Absence: not the first article, its group not opened, and no "unknown code" line.
    expect(screen.getByTestId("corpus-reading")).not.toHaveTextContent("title-cn-17");
    expect(tocGroup("GONGGUOGE")).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("corpus-unknown-code")).toBeNull();
  });

  it("an unknown code says so and reads from the first article; choosing one clears the notice", async () => {
    mockQuery.current = "code=%E6%95%91%E6%BF%9F%E9%96%80%2399";
    renderPage();
    const notice = await screen.findByTestId("corpus-unknown-code");
    expect(notice).toHaveTextContent("救濟門#99");
    expect(notice).toHaveAttribute("role", "status");
    expect(screen.getByTestId("corpus-reading")).toHaveTextContent("title-cn-17");
    fireEvent.click(within(screen.getByRole("navigation", { name: /目录|contents/i })).getByRole("button", { name: /title-cn-17/ }));
    expect(screen.queryByTestId("corpus-unknown-code")).toBeNull();
  });
});
