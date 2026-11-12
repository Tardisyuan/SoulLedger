/**
 * 案卷台(Design 第三十批 第 2 步):摞的规则(来源、分组、概览行、来源 chip、J / K)与键盘。
 * 键盘是这张台的界面本身,所以按界面测:J / K 挪当前行、↵ 打开卷宗、/ 进搜索、打字时不接。
 */
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { Judgment } from "@soulledger/core/api/judgment";
import { judgmentApi } from "@soulledger/core/api/judgment";
import { CaseDesk } from "@/src/components/desk/CaseDesk";
import { dedupeGroups, deskTag, matchesSearch, onDeskCount, overviewParts, sourceChips, sourceLabel, sourceOf, step, zongbuCivilizations } from "@/src/components/desk/deskRules";
import { doorGlyphClass } from "@/src/components/desk/DeskShell";
import egy from "@soulledger/core/messages/egy.json";
import { renderWithProviders } from "./support/render";

const mockPush = jest.fn();
const mockShowToast = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => "/desk",
}));
jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: { role: "JUDGE", permissions: ["judgment.read", "judgment.execute"] } }),
}));
jest.mock("@/src/contexts/ToastContext", () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));
jest.mock("@soulledger/core/api/judgment", () => ({
  ...jest.requireActual("@soulledger/core/api/judgment"),
  judgmentApi: {
    list: jest.fn(),
    queueCounts: jest.fn(),
    hallStats: jest.fn(),
    get: jest.fn(),
    claim: jest.fn().mockResolvedValue({ data: {} }),
    release: jest.fn().mockResolvedValue({ data: {} }),
  },
}));

jest.mock("@soulledger/core/api/souls", () => ({
  ...jest.requireActual("@soulledger/core/api/souls"),
  soulsApi: {
    get: jest.fn().mockResolvedValue({
      data: { id: "s-1", name: "赵志强", birth_date: { year: 1982, month: 8, day: 7 }, death_date: { year: 2026, month: 10, day: 22 }, origin_location: "洛阳", records: [] },
    }),
  },
}));

/** An echo `t`: the key, then `k=v` for each variable — enough to tell which branch a rule took. */
const t = (key: string, vars?: Record<string, string>) => (vars ? `${key}(${Object.entries(vars).map(([k, v]) => `${k}=${v}`).join(",")})` : key);

function row(id: string, over: Partial<Judgment> = {}): Judgment {
  return {
    id,
    case_number: `CN-2026-${id}`,
    soul: `s-${id}`,
    soul_name: `魂${id}`,
    civilization: "CHINESE",
    judge: null,
    judge_name: null,
    court: "第一殿",
    evidence_json: {},
    confession: "",
    verdict: null,
    notes: "",
    is_final: false,
    created_at: "2026-11-01T00:00:00Z",
    concluded_at: null,
    ...over,
  } as Judgment;
}

describe("deskRules", () => {
  it("reads the source off the row, and a row without one is the queue", () => {
    expect(sourceOf(row("1", { source: "city_god" }))).toBe("city_god");
    expect(sourceOf(row("1", { source: "cross" }))).toBe("cross");
    expect(sourceOf(row("1"))).toBe("queue");
    // The second line writes 城隍初审 for a case the city god sent on (user 2026-11-13), not the chip's 城隍送来.
    expect(sourceLabel(t, row("1", { source: "city_god" }))).toBe("officer_app.desk.sources.city_god");
  });

  it("writes 无超期 unmarked when nothing is overdue, and 超期 N marked when something is", () => {
    expect(overviewParts(t, 7, 0, 22)).toEqual([
      { text: "officer_app.desk.overview.today(n=7)" },
      { text: "officer_app.desk.overview.no_overdue" },
      { text: "officer_app.desk.overview.month_done(pct=22)" },
    ]);
    expect(overviewParts(t, 7, 1, null)).toEqual([{ text: "officer_app.desk.overview.today(n=7)" }, { text: "officer_app.desk.overview.overdue(n=1)", neg: true }]);
    // An empty desk still says 无超期.
    expect(overviewParts(t, 0, 0, null)).toEqual([{ text: "officer_app.desk.overview.today(n=0)" }, { text: "officer_app.desk.overview.no_overdue" }]);
    // Nothing loaded yet: nothing written (not 「今日 0 件」).
    expect(overviewParts(t, null, null, null)).toEqual([]);
    expect(onDeskCount({ mine: 2, deferred: 1, unclaimed: 4 })).toBe(7);
    expect(onDeskCount(null)).toBeNull();
  });

  it("总簿: a global admin sees the four realms, a hall-bound admin only their own", () => {
    expect(zongbuCivilizations(null)).toEqual(["CHINESE", "EUROPEAN", "EGYPTIAN", "GREEK"]);
    expect(zongbuCivilizations({ code: "EG_DUAT", civilization: "EGYPTIAN" })).toEqual(["EGYPTIAN"]);
    // An envelope cached before `civilization` existed: the hall code's prefix decides.
    expect(zongbuCivilizations({ code: "GR_HADES" })).toEqual(["GREEK"]);
    // Unrecognised: the server scopes anyway, so the four columns stay (the others read 0).
    expect(zongbuCivilizations({ code: "XX_NOWHERE" })).toHaveLength(4);
  });

  it("keeps a case in the first group it appears in", () => {
    const out = dedupeGroups([
      { group: "mine", rows: [row("1")] },
      { group: "unclaimed", rows: [row("1"), row("2")] },
    ]);
    expect(out.map((g) => g.rows.map((r) => r.id))).toEqual([["1"], ["2"]]);
  });

  it("draws a chip only for a source with cases, and sends the elsewhere ones away", () => {
    const chips = sourceChips(t, {
      total: 9,
      sources: { queue: 6, city_god: 3, cross: 0 },
      elsewhere: { appeal: 2, city_god_review: 1, cross_judgment: null, capture_due: 0 },
    });
    expect(chips.map((c) => [c.kind, c.key, c.count])).toEqual([
      ["filter", "all", 9],
      ["filter", "queue", 6],
      ["filter", "city_god", 3],
      ["link", "appeal", 2],
      ["link", "city_god_review", 1],
    ]);
    // Two city-god chips (user 2026-11-13): 城隍送来 filters, 城隍初审中 leaves for /city-god-cases.
    expect(chips.find((c) => c.key === "city_god")?.label).toBe("officer_app.desk.chips.city_god");
    expect(chips.find((c) => c.key === "city_god_review")).toMatchObject({ kind: "link", href: "/city-god-cases" });
    expect(chips.some((c) => c.key === "cross" || c.key === "cross_judgment" || c.key === "capture_due")).toBe(false);
    expect(sourceChips(t, null)).toEqual([]);
  });

  it("tags overdue over returned over the group's own", () => {
    expect(deskTag(t, row("1", { is_overdue: true, deadline_remaining_seconds: -9 * 86400, retrial_of: "x" }), "mine").text).toBe("officer_app.desk.tag.overdue(n=9)");
    expect(deskTag(t, row("1", { retrial_of: "x" }), "mine").text).toBe("officer_app.desk.tag.returned");
    expect(deskTag(t, row("1", { is_overdue: true, deadline_remaining_seconds: -86400 }), "deferred").text).toBe("officer_app.desk.groups.deferred");
    expect(deskTag(t, row("1", { deadline_remaining_seconds: 5 * 86400 }), "unclaimed")).toMatchObject({ text: "queue.deadline.days(n=5)", deadline: true });
  });

  it("steps J / K within the stack and stops at both ends", () => {
    const ids = ["a", "b", "c"];
    expect(step(ids, null, 1)).toBe("a");
    expect(step(ids, null, -1)).toBe("c");
    expect(step(ids, "a", 1)).toBe("b");
    expect(step(ids, "c", 1)).toBe("c");
    expect(step(ids, "a", -1)).toBe("a");
    expect(step([], "a", 1)).toBeNull();
  });

  it("searches name and case number", () => {
    expect(matchesSearch(row("0021", { soul_name: "赵志强" }), "志强")).toBe(true);
    expect(matchesSearch(row("0021"), "cn-2026-0021")).toBe(true);
    expect(matchesSearch(row("0021"), "王")).toBe(false);
  });
});

const mockList = judgmentApi.list as jest.Mock;
const mockCounts = judgmentApi.queueCounts as jest.Mock;

function page(results: Judgment[]) {
  return { data: { count: results.length, next: null, previous: null, results } };
}

describe("CaseDesk", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const groups: Record<string, Judgment[]> = {
      mine: [row("1", { soul_name: "赵志强" })],
      deferred: [],
      unclaimed: [row("2", { soul_name: "哪吒", source: "city_god" }), row("3", { soul_name: "沉香", source: "cross" })],
      others: [row("4", { soul_name: "窦娥", claimed_by_name: "崔判官" })],
    };
    mockList.mockImplementation((params: Record<string, string>) => Promise.resolve(page(groups[params.group] ?? [])));
    mockCounts.mockResolvedValue({ data: { mine: 1, deferred: 0, unclaimed: 2, others: 1, total: 4, overdue: 0, sources: { queue: 2, city_god: 1, cross: 1 }, elsewhere: { appeal: 1, city_god_review: null, cross_judgment: 0, capture_due: null } } });
    (judgmentApi.hallStats as jest.Mock).mockResolvedValue({ data: { month_done_pct: 22 } });
    (judgmentApi.get as jest.Mock).mockImplementation((id: string) => Promise.resolve({ data: row(id) }));
  });

  const current = () => document.querySelector('[data-desk-row][aria-current="true"]')?.getAttribute("data-testid");

  it("groups the stack 我认领 / 待定 / 待认领 / 他人手上 and writes 无超期 in the overview", async () => {
    renderWithProviders(<CaseDesk />);
    await screen.findByText("赵志强", { selector: "button span" });
    const order = [...document.querySelectorAll("[data-testid^='desk-group-']")].map((el) => el.getAttribute("data-testid"));
    // 待定 is empty and not drawn; 他人手上 is last.
    expect(order).toEqual(["desk-group-mine", "desk-group-unclaimed", "desk-group-others"]);
    const overview = await screen.findByTestId("desk-overview");
    await waitFor(() => expect(overview).toHaveTextContent("无超期"));
    expect(overview).toHaveTextContent("今日 3 件");
    expect(overview).not.toHaveTextContent("超期 0");
    // The row's second line: 城隍初审 for a case the city god sent on; the chip says 城隍送来.
    expect(within(screen.getByTestId("desk-row-2")).getByText(/城隍初审/)).toBeInTheDocument();
    expect(screen.getByTestId("desk-source-city_god")).toHaveTextContent("城隍送来");
    expect(screen.getByTestId("desk-source-appeal")).toHaveAttribute("href", "/judgment/appeals");
    expect(screen.queryByTestId("desk-source-city_god_review")).not.toBeInTheDocument();
  });

  it("moves with J and K, opens with Enter, and announces the move", async () => {
    renderWithProviders(<CaseDesk />);
    await screen.findByTestId("desk-row-1");
    expect(current()).toBe("desk-row-1");
    fireEvent.keyDown(window, { key: "j" });
    expect(current()).toBe("desk-row-2");
    expect(screen.getByTestId("desk-announce")).toHaveTextContent("第 2 / 4 件 · 哪吒");
    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "k" });
    expect(current()).toBe("desk-row-2");
    fireEvent.keyDown(document.body, { key: "Enter" });
    expect(mockPush).toHaveBeenCalledWith("/judgment/2");
  });

  it("takes / to the search box and ignores J and Enter while typing there", async () => {
    renderWithProviders(<CaseDesk />);
    await screen.findByTestId("desk-row-1");
    fireEvent.keyDown(window, { key: "/" });
    const search = screen.getByTestId("desk-search");
    expect(search).toHaveFocus();
    fireEvent.keyDown(search, { key: "j" });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(current()).toBe("desk-row-1");
    expect(mockPush).not.toHaveBeenCalled();
    fireEvent.change(search, { target: { value: "沉香" } });
    expect(screen.queryByTestId("desk-row-1")).not.toBeInTheDocument();
    expect(current()).toBe("desk-row-3");
  });

  it("claims the current 待认领 case with C, and only that one", async () => {
    renderWithProviders(<CaseDesk />);
    await screen.findByTestId("desk-row-1");
    // On 我认领: C does nothing.
    fireEvent.keyDown(window, { key: "c" });
    expect(judgmentApi.claim).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "j" });
    await act(async () => {
      fireEvent.keyDown(window, { key: "c" });
    });
    expect(judgmentApi.claim).toHaveBeenCalledWith("2");
  });

  it("filters the stack by source through the API", async () => {
    renderWithProviders(<CaseDesk />);
    fireEvent.click(await screen.findByTestId("desk-source-cross"));
    await waitFor(() => expect(mockList).toHaveBeenCalledWith(expect.objectContaining({ group: "unclaimed", source: "cross" })));
    expect(mockCounts).toHaveBeenCalledWith({ source: "cross" });
  });
});

// Design egy batch 31: the door glyphs are short words in egy (Wedja, Sesh … up to 6 letters). jsdom cannot measure,
// so this pins the switch: more than one character takes the 12px no-wrap class; one Han character or en letter stays 18.
describe("the door rail's glyph size", () => {
  it("every egy door glyph longer than one character takes the word size; one character keeps the full size", () => {
    const rail = (egy as unknown as { caseDesk: { rail: Record<string, string> } }).caseDesk.rail;
    const glyphs = Object.entries(rail)
      .filter(([k]) => k.endsWith("_glyph"))
      .map(([, v]) => v);
    expect(glyphs.length).toBeGreaterThanOrEqual(6);
    expect(glyphs.filter((g) => Array.from(g).length > 1).length).toBeGreaterThan(0);
    for (const g of glyphs) expect(doorGlyphClass(g)).toBe(Array.from(g).length > 1 ? "doorGlyph doorGlyphWord" : "doorGlyph");
    expect(doorGlyphClass("审")).toBe("doorGlyph");
    expect(doorGlyphClass("L")).toBe("doorGlyph");
    expect(doorGlyphClass("Remetj")).toBe("doorGlyph doorGlyphWord");
  });
});
