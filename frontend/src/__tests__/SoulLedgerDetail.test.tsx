/**
 * 灵魂详情「账簿 × 卷宗」版式里会算的那两块:户头进度的「当前」从哪来,
 * 以及「全部审判」的判词取哪一份、只有它是衬线。
 *
 * 真 I18nProvider,不用回显键的替身 —— 理由见 SoulLedgerBook.test.tsx 第 3 条。
 */
import { screen, waitFor, within } from "@testing-library/react";

import type { Judgment, Reincarnation, Soul } from "@soulledger/core/api";
import { I18nProvider } from "@/src/contexts/I18nContext";
import { stepStatuses } from "@/src/components/souls/detail/soulProgress";
import { SoulLedgerProgress } from "@/src/components/souls/detail/SoulLedgerProgress";
import { SoulJudgmentHistory, SoulLedgerSections } from "@/src/components/souls/detail/SoulLedgerSections";
import { renderWithProviders } from "./support/render";

// 行程块自己取两份数据:全部界域与这个灵魂的 path。
jest.mock("@soulledger/core/api", () => ({
  realmsApi: { list: jest.fn() },
  soulsApi: { path: jest.fn() },
}));
const coreApi = require("@soulledger/core/api") as {
  realmsApi: { list: jest.Mock };
  soulsApi: { path: jest.Mock };
};

const ALL = [true, true, true, true] as const;

describe("stepStatuses — the 当前 step comes from current_state, not from which data exists", () => {
  it("puts a second-life ALIVE soul at 01 even though it holds a previous life's records", () => {
    expect(stepStatuses("ALIVE", ALL)).toEqual(["current", "future", "future", "future"]);
  });

  it("walks JUDGING → 02, DISPOSED and SETTLED → 03, REINCARNATING → 04", () => {
    expect(stepStatuses("JUDGING", ALL)).toEqual(["done", "current", "future", "future"]);
    expect(stepStatuses("DISPOSED", ALL)).toEqual(["done", "done", "current", "future"]);
    expect(stepStatuses("SETTLED", ALL)).toEqual(["done", "done", "current", "future"]);
    expect(stepStatuses("REINCARNATING", ALL)).toEqual(["done", "done", "done", "current"]);
  });

  it("gives LOST (and an unknown state) no current step, marking only what has records", () => {
    expect(stepStatuses("LOST", [true, true, false, false])).toEqual(["done", "done", "future", "future"]);
    expect(stepStatuses("NOPE", [true, false, false, false])).toEqual(["done", "future", "future", "future"]);
  });
});

function judgment(over: Partial<Judgment> & Pick<Judgment, "id" | "created_at">): Judgment {
  return {
    case_number: "CN-2026-0001",
    soul: "s1",
    soul_name: "沈青梧",
    civilization: "CHINESE",
    judge: null,
    judge_name: null,
    court: "",
    evidence_json: {},
    confession: "",
    verdict: null,
    notes: "",
    citations: [],
    is_final: false,
    concluded_at: null,
    ...over,
  };
}

const SOUL = {
  id: "s1",
  name: "沈青梧",
  civilization: "CHINESE",
  current_state: "DISPOSED",
  birth_date: null,
  death_date: null,
  origin_location: "",
  description: "",
} as unknown as Soul;

const wrap = (ui: React.ReactElement) => {
  return renderWithProviders(<I18nProvider>{ui}</I18nProvider>, { i18n: false });
};

const court = (n: number) => ({
  id: `c${n}`,
  realm_code: `DY_COURT_0${n}_X`,
  name: `第${n}殿`,
  name_en: `Court ${n}`,
  civilization: "CHINESE",
  realm_type: "NEUTRAL",
  tier: n,
  is_eternal: false,
  order: n,
  kind: "HALL" as const,
});
const PEN = { ...court(0), id: "pen", realm_code: "DY_00_PURGATORY", order: null, kind: null };

beforeEach(() => {
  coreApi.realmsApi.list.mockResolvedValue({ data: { results: [PEN, court(1), court(2), court(3)], count: 4 } });
  coreApi.soulsApi.path.mockResolvedValue({
    data: [
      { id: "p1", sequence: 1, realm_id: "pen", realm_code: "DY_00_PURGATORY", entered_at: "2026-06-08T00:00:00Z", left_at: "2026-06-09T00:00:00Z" },
      { id: "p2", sequence: 2, realm_id: "c3", realm_code: "DY_COURT_03_X", entered_at: "2026-06-09T00:00:00Z", left_at: null },
    ],
  });
});

describe("SoulLedgerProgress", () => {
  const progress = (soul: Soul = SOUL) =>
    wrap(
      <SoulLedgerProgress
        soul={soul}
        judgments={[]}
        dispositions={[]}
        reincarnations={[] as Reincarnation[]}
        birthDisplay={null}
        deathDisplay={null}
      />
    );
  /** The wide map's stations (jsdom has no ResizeObserver, so the map stays wide). */
  const stations = (route: HTMLElement) => Array.from(route.querySelectorAll<SVGGElement>('[role="list"] [role="listitem"]'));

  it("marks the current stage, says 未至 for later ones, and a MissingValue where a passed stage has no record", () => {
    progress();
    const steps = within(screen.getByTestId("soul-ledger-progress")).getAllByRole("listitem");
    expect(steps.map((s) => s.getAttribute("data-step-status"))).toEqual(["done", "done", "current", "future"]);
    expect(steps[2]).toHaveTextContent("处置");
    expect(steps[2]).toHaveTextContent("现在");
    expect(steps[2]).toHaveAttribute("aria-current", "step");
    expect(steps[3]).toHaveTextContent("未至");
    // 02 审判已过但没有一份判决:是「未记录」,不是编一个日期,也不是「未至」。
    expect(steps[1].querySelector('[data-missing="unrecorded"]')).not.toBeNull();
    expect(steps[1]).not.toHaveTextContent("未至");
  });

  it("draws the fourth stage as not-applicable 「不轮回」 where there is no wheel — not as a greyed to-do", () => {
    progress({ ...SOUL, civilization: "EGYPTIAN" } as Soul);
    const steps = within(screen.getByTestId("soul-ledger-progress")).getAllByRole("listitem");
    expect(steps.map((s) => s.getAttribute("data-step-status"))).toEqual(["done", "done", "current", "na"]);
    expect(steps[3]).toHaveTextContent("不轮回");
    expect(steps[3]).not.toHaveTextContent("未至");
  });

  it("draws the route from the soul's path on its civilization's shape — unrecorded stops before 现在 are passed, not recorded", async () => {
    const { container } = progress();
    const route = await screen.findByTestId("soul-route");
    await waitFor(() => expect(stations(route).length).toBeGreaterThan(0));
    expect(route.querySelector('[data-route-topology="line"]')?.getAttribute("data-schematic")).toBe("false");
    // 一线:第一、二殿没有记录,但「现在」在第三殿 —— 走不到第三殿而不经过它们:画成已行(已过未登记,不打勾)。
    expect(stations(route).map((g) => g.getAttribute("data-station-state"))).toEqual(["travelled", "travelled", "current"]);
    expect(stations(route).map((g) => g.getAttribute("data-implied"))).toEqual(["true", "true", null]);
    expect(stations(route)[0].getAttribute("aria-label")).toContain("已过（未登记）");
    expect(stations(route)[0].querySelector(".journey-check")).toBeNull();
    expect(stations(route)[2]).toHaveAttribute("aria-current", "step");
    expect(route.querySelectorAll('[data-segment="walked"]')).toHaveLength(2);
    expect(route.querySelector('[data-segment="ahead"]')).toBeNull();
    // 待审所不在一线上:作为支线列在下面,已行。
    const branches = within(route).getByTestId("topology-branches");
    expect(branches.querySelector("li")?.getAttribute("data-station-state")).toBe("travelled");
    // 标题写现在在哪:第 3 站(殿号)。
    expect(screen.getByTestId("soul-journey-title")).toHaveTextContent("第 3 站 · Court 3");
    // 待审所 + 两站已过未登记
    expect(screen.getByTestId("soul-journey-count")).toHaveTextContent("已行 3 站");
    expect(container.querySelectorAll("[aria-current=step]").length).toBeGreaterThan(0);
    expect(coreApi.soulsApi.path).toHaveBeenCalledWith("s1");
  });

  const eg = (id: string, order: number, extra: Record<string, unknown> = {}) => ({
    id, realm_code: id, name: id, civilization: "EGYPTIAN", realm_type: "PURGATORY", tier: order,
    is_eternal: false, order, is_judgment_hall: false, fork: null, ...extra,
  });
  const DUAT = [
    eg("EG_DUAT_ENTRY", 1),
    eg("EG_SEVEN_ARRWT", 2),
    eg("EG_HALL_TWO_TRUTHS", 3, { is_judgment_hall: true }),
    eg("EG_TWENTYONE_SEBKHET", 4, { fork: "PASS" }),
    eg("EG_AARU", 5, { fork: "PASS" }),
    eg("EG_ANNIHILATION", 4, { fork: "FAIL" }),
  ];
  const stop = (id: string, seq: number, left: string | null) => ({
    id: `p${seq}`, sequence: seq, realm_id: id, realm_code: id, entered_at: `2026-06-0${seq + 7}T00:00:00Z`, left_at: left,
  });

  it("draws an Egyptian soul's route on 称心二岔 before the weighing settles: both roads ahead, the fail road ends in a dashed square", async () => {
    coreApi.realmsApi.list.mockResolvedValue({ data: { results: DUAT, count: 6 } });
    coreApi.soulsApi.path.mockResolvedValue({
      data: [stop("EG_DUAT_ENTRY", 1, "2026-06-09T00:00:00Z"), stop("EG_HALL_TWO_TRUTHS", 2, null)],
    });
    progress({ ...SOUL, civilization: "EGYPTIAN" } as Soul);
    const route = await screen.findByTestId("soul-route");
    await waitFor(() => expect(stations(route).length).toBe(6));
    expect(route.querySelector('[data-route-topology="fork_two"]')?.getAttribute("data-schematic")).toBe("false");
    // 七道通路没有记录,但在称心之前:已过(未登记);称心未定,两条去路都是待行,不是「不在此路」。
    expect(stations(route).map((g) => [g.getAttribute("data-station-state"), g.getAttribute("data-route")])).toEqual([
      ["travelled", "on"],
      ["travelled", "on"],
      ["current", "on"],
      ["pending", "on"],
      ["pending", "on"],
      ["pending", "on"],
    ]);
    expect(route.querySelector('[data-edge="EG_HALL_TWO_TRUTHS>EG_ANNIHILATION"]')?.getAttribute("data-segment")).toBe("ahead");
    expect(route.querySelectorAll('[data-terminal="dashed"]')).toHaveLength(1);
    expect(stations(route)[5]).toHaveAttribute("data-terminal", "dashed");
    expect(route).toHaveTextContent("不是地方");
    expect(screen.getByTestId("soul-journey-count")).toHaveTextContent("之后两条路之一");
  });

  it("称心二岔, the FAIL road once walked: its segment is solid (path[] decides), its end stays a dashed square, the other road is off this route", async () => {
    // Design, 2026-09-26: a segment's line depends only on whether path[] records it; the end square's
    // dash depends only on whether the realm is a place. Neither affects the other.
    coreApi.realmsApi.list.mockResolvedValue({ data: { results: DUAT, count: 6 } });
    coreApi.soulsApi.path.mockResolvedValue({
      data: [
        stop("EG_DUAT_ENTRY", 1, "2026-06-09T00:00:00Z"),
        stop("EG_SEVEN_ARRWT", 2, "2026-06-10T00:00:00Z"),
        stop("EG_HALL_TWO_TRUTHS", 3, "2026-06-11T00:00:00Z"),
        stop("EG_ANNIHILATION", 4, null),
      ],
    });
    progress({ ...SOUL, civilization: "EGYPTIAN" } as Soul);
    const route = await screen.findByTestId("soul-route");
    await waitFor(() => expect(stations(route).length).toBe(6));
    const end = stations(route).find((g) => g.getAttribute("data-terminal") === "dashed")!;
    expect(end).toHaveAttribute("data-station-state", "current");
    expect(end).toHaveAttribute("aria-current", "step");
    // The segment into the second death: walked — solid main line, not the dashed "ahead" one.
    const into = route.querySelector('[data-edge="EG_HALL_TWO_TRUTHS>EG_ANNIHILATION"]')!;
    expect(into.getAttribute("data-segment")).toBe("walked");
    expect(into.getAttribute("class")).toBe("journey-walked");
    // The PASS road was not walked and now cannot be: dotted, off this route — not "ahead".
    const pass = route.querySelector('[data-edge="EG_HALL_TWO_TRUTHS>EG_TWENTYONE_SEBKHET"]')!;
    expect(pass.getAttribute("data-segment")).toBe("off");
    expect(pass.getAttribute("class")).toBe("journey-off");
    expect(route.querySelector('[data-segment="ahead"]')).toBeNull();
    expect(stations(route).filter((g) => g.getAttribute("data-route") === "off")).toHaveLength(2);
  });

  it("says under the title where the open case is heard, and keeps the shape name otherwise", async () => {
    const open = judgment({ id: "j1", created_at: "2026-06-09T00:00:00Z", court: "第五殿" });
    const judging = { ...SOUL, current_state: "JUDGING" } as Soul;
    const { unmount } = wrap(
      <SoulLedgerProgress soul={judging} judgments={[open]} dispositions={[]} reincarnations={[]} birthDisplay={null} deathDisplay={null} />
    );
    expect(await screen.findByTestId("soul-journey-sub")).toHaveTextContent("十殿 · 第五殿受审中");
    unmount();
    // 结了的审判不算「受审中」:写回形状名。
    wrap(
      <SoulLedgerProgress
        soul={judging}
        judgments={[{ ...open, concluded_at: "2026-06-10T00:00:00Z", verdict: "PASSED" }]}
        dispositions={[]}
        reincarnations={[]}
        birthDisplay={null}
        deathDisplay={null}
      />
    );
    expect(await screen.findByTestId("soul-journey-sub")).not.toHaveTextContent("受审中");
  });
});

describe("SoulJudgmentHistory — 全部审判", () => {
  const judgments = [
    judgment({ id: "old", created_at: "2026-06-01T00:00:00Z", concluded_at: "2026-06-02T00:00:00Z", is_final: true, verdict: "FAILED", notes: "旧判词", court: "第一殿", judge_name: "秦广王" }),
    judgment({ id: "new", created_at: "2026-06-09T00:00:00Z", concluded_at: "2026-06-15T00:00:00Z", is_final: true, verdict: "PURGATORY", notes: "功过相抵，暂入救濟門。", court: "第五殿", judge_name: "阎罗王" }),
    judgment({ id: "open", created_at: "2026-06-20T00:00:00Z", notes: "未结案的草稿" }),
  ];

  it("quotes the latest concluded judgment's notes, signed by its court and judge, in the page's only serif", () => {
    const { container } = wrap(
      <SoulJudgmentHistory judgments={judgments} />
    );
    const quote = screen.getByTestId("soul-verdict-quote");
    expect(quote).toHaveTextContent("功过相抵，暂入救濟門。");
    // 规范 v2 A3: quoted words are the 15/24 serif read step (v1 text-quote retired).
    expect(quote.className).toContain("font-serif");
    expect(quote.className).toContain("text-md");
    expect(container).toHaveTextContent("— 第五殿 阎罗王");
    // 缺席:旧判词与未结案的草稿都不进引文。
    expect(container).not.toHaveTextContent("旧判词");
    expect(container).not.toHaveTextContent("未结案的草稿");
    expect(container.querySelectorAll(".font-serif")).toHaveLength(1);
  });

  it("draws each verdict with its glyph and says 待决 for an open case", () => {
    wrap(<SoulJudgmentHistory judgments={judgments} />);
    const rows = screen.getAllByTestId("ledger-judgment-row");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("待决");
    expect(rows[1]).toHaveTextContent("◇");
    expect(rows[2]).toHaveTextContent("✕");
  });

  it("行标题是「第 N 世 · 种类」(cycle 0 = 第 1 世),庭与判官退到第二行", () => {
    wrap(
      <SoulJudgmentHistory
        judgments={[
          judgment({ id: "x", created_at: "2026-06-01T00:00:00Z", cycle: 3, kind: "AMENDMENT", court: "第五殿", judge_name: "阎罗王" }),
          judgment({ id: "y", created_at: "2026-05-01T00:00:00Z", cycle: 0, kind: "ORIGINAL" }),
        ]}
      />
    );
    const [fourth, first] = screen.getAllByTestId("judgment-life-kind");
    expect(fourth).toHaveTextContent(/^第 4 世 · 加减项$/);
    expect(first).toHaveTextContent(/^第 1 世 · 初审$/);
    // 庭与判官不在标题里,在下一行。
    expect(fourth).not.toHaveTextContent("第五殿");
    expect(screen.getAllByTestId("ledger-judgment-row")[0]).toHaveTextContent("第五殿 · 阎罗王");
  });
});

describe("SoulLedgerSections — no rebirth record yet", () => {
  it("says the soul waits to be reborn once it is REINCARNATING, and 需先完成处置 only before", () => {
    const waiting = wrap(<SoulLedgerSections dispositions={[]} reincarnations={[]} events={[]} awaitingRebirth />);
    expect(screen.getByTestId("soul-ledger-sections")).toHaveTextContent("处置已执行 · 等候转生");
    expect(screen.getByTestId("soul-ledger-sections")).not.toHaveTextContent("需先完成处置");
    waiting.unmount();
    wrap(<SoulLedgerSections dispositions={[]} reincarnations={[]} events={[]} />);
    expect(screen.getByTestId("soul-ledger-sections")).toHaveTextContent("需先完成处置");
    expect(screen.getByTestId("soul-ledger-sections")).not.toHaveTextContent("等候转生");
  });
});
