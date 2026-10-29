/**
 * 灵魂详情(第三十九批 O-15):页签按权限码出现、功过按世分组且一次 20 条、事件按接口分页、
 * 一个页签载入失败只坏那一个、已归档 / 暂居的页头,以及从待办详情、审判详情点灵魂名进来。
 */
import type { LoginUser } from "@soulledger/core/api/auth";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react-native";
import { StyleSheet } from "react-native";

import { platform } from "@soulledger/core/platform";
import { LOCALE_COOKIE } from "@soulledger/core/config/locale";

import { Detail } from "../screens/detail";
import { karmaView, planStops, signed, soulTabs } from "../soulView";
import { OFFICER, httpError, renderOfficer } from "./harness";

const mockSoul = jest.fn();
const mockRecords = jest.fn();
const mockEvents = jest.fn();
const mockJudgments = jest.fn();
const mockJudgment = jest.fn();
const mockDispositions = jest.fn();
const mockReincarnations = jest.fn();
const mockPlans = jest.fn();
const mockItem = jest.fn();
const mockWarrants = jest.fn();
jest.mock("@soulledger/core/api/souls", () => ({
  ...jest.requireActual("@soulledger/core/api/souls"),
  soulsApi: { get: (...a: unknown[]) => mockSoul(...a), records: (...a: unknown[]) => mockRecords(...a) },
}));
jest.mock("@soulledger/core/api/dispatch", () => ({
  ...jest.requireActual("@soulledger/core/api/dispatch"),
  captureWarrantsApi: { list: (...a: unknown[]) => mockWarrants(...a) },
}));
jest.mock("@soulledger/core/api/events", () => ({ eventsApi: { list: (...a: unknown[]) => mockEvents(...a) } }));
jest.mock("@soulledger/core/api/judgment", () => ({
  ...jest.requireActual("@soulledger/core/api/judgment"),
  judgmentApi: {
    list: (...a: unknown[]) => mockJudgments(...a),
    get: (...a: unknown[]) => mockJudgment(...a),
    comments: jest.fn(async () => ({ data: [] })),
    attachments: jest.fn(async () => []),
  },
}));
jest.mock("@soulledger/core/api/disposition", () => ({ dispositionApi: { list: (...a: unknown[]) => mockDispositions(...a) } }));
jest.mock("@soulledger/core/api/reincarnation", () => ({ reincarnationApi: { list: (...a: unknown[]) => mockReincarnations(...a) } }));
jest.mock("@soulledger/core/api/sentence-plans", () => ({ sentencePlansApi: { list: (...a: unknown[]) => mockPlans(...a) } }));
jest.mock("@soulledger/core/api/soul-accounts", () => ({
  soulAccountsApi: { accounts: jest.fn(async () => ({ data: { results: [{ soul_code: "QU33Q9FW5F", retired_at: null }] } })) },
}));
jest.mock("@soulledger/core/api/officer-app", () => ({
  ...jest.requireActual("@soulledger/core/api/officer-app"),
  officerAppApi: { item: (...a: unknown[]) => mockItem(...a) },
}));

const SOUL = {
  id: "s1",
  name: "周阿满",
  civilization: "CHINESE",
  current_state: "JUDGING",
  birth_date: { year: 1891, month: 3, day: 2 },
  death_date: { year: 1958, month: 11, day: 20 },
  origin_location: "湖州",
  birth_name: "周满娣",
  description: "湖州丝户之女",
  life_index: 2,
  merit_score: 412,
  demerit_score: 158,
  karmic_balance: 254,
  date_problems: [],
  is_eval_identity: false,
};
const page = <T,>(results: T[], count = results.length, next: string | null = null) => ({ data: { results, count, next, previous: null } });
const record = (i: number, cycle = 0, type = "MERIT") => ({
  id: `r${i}`,
  record_type: type,
  category: "",
  civilization: "CHINESE",
  description: `事 ${i}`,
  weight: 3,
  event_date: null,
  is_milestone: false,
  recorded_at: `2026-01-${String(1 + (i % 28)).padStart(2, "0")}T00:00:00Z`,
  cycle,
  date_problems: [],
  evidence_source: "REGISTRY",
});
const event = (i: number) => ({ id: `e${i}`, soul: "s1", event_type: "STATE_CHANGED", payload: { old_state: "ALIVE", new_state: "JUDGING" }, actor: "system", create_time: "2026-10-01T00:00:00Z" });

const userWith = (permissions: string[]): LoginUser => ({ ...OFFICER, permissions });

function openSoul(permissions = ["soul.read"]) {
  renderOfficer(<Detail target={{ type: "soul", id: "s1" }} onBack={() => {}} onSettled={() => {}} />, { user: userWith(permissions) });
  return screen.findByTestId("soul-detail");
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSoul.mockResolvedValue({ data: SOUL });
  mockRecords.mockResolvedValue({ data: [] });
  mockEvents.mockResolvedValue(page([]));
  mockJudgments.mockResolvedValue(page([]));
  mockDispositions.mockResolvedValue(page([]));
  mockReincarnations.mockResolvedValue(page([]));
  mockPlans.mockResolvedValue(page([]));
  mockWarrants.mockResolvedValue(page([]));
});

describe("soulView (pure)", () => {
  it("draws only the tabs the permission codes allow; identity, karma and events always", () => {
    expect(soulTabs([])).toEqual(["identity", "karma", "events"]);
    expect(soulTabs(["judgment.read"])).toEqual(["identity", "judgments", "karma", "events"]);
    expect(soulTabs(["reincarnation.read"])).toEqual(["identity", "karma", "fate", "events"]);
    expect(soulTabs(["disposition.read", "judgment.read"])).toEqual(["identity", "judgments", "karma", "fate", "events"]);
  });

  it("groups deeds by life, newest life first, counting the whole life while paging 20 at a time", () => {
    const rows = [...Array.from({ length: 22 }, (_, i) => record(i, 1)), ...Array.from({ length: 5 }, (_, i) => record(100 + i, 0)), { ...record(999, 1), record_type: "JUDGMENT" }];
    const first = karmaView(rows as never, 20);
    expect(first.total).toBe(27); // the JUDGMENT evidence row is not a deed
    expect(first.shown).toBe(20);
    expect(first.groups.map((g) => [g.cycle, g.count, g.rows.length])).toEqual([[1, 22, 20]]);
    const second = karmaView(rows as never, 40);
    expect(second.shown).toBe(27);
    expect(second.groups.map((g) => [g.cycle, g.count, g.rows.length])).toEqual([[1, 22, 22], [0, 5, 5]]);
  });

  it("signs with + and U+2212, never a bare minus", () => {
    expect([signed(4), signed(-12), signed(0)]).toEqual(["+4", "−12", "0"]);
  });

  it("marks the first live stop as current and drops removed ones", () => {
    const n = (id: string, order: number, status: string) => ({ id, order, status }) as never;
    const { nodes, current } = planStops({ nodes: [n("b", 2, "ACTIVE"), n("a", 1, "COMPLETED"), n("x", 3, "REMOVED")] });
    expect(nodes.map((x: { id: string }) => x.id)).toEqual(["a", "b"]);
    expect(current).toBe("b");
  });
});

describe("tabs by permission", () => {
  it("with soul.read only: 身份 · 功过 · 事件, no 审判, no 去向", async () => {
    await openSoul();
    expect(screen.getByTestId("soul-tab-identity")).toBeTruthy();
    expect(screen.getByTestId("soul-tab-karma")).toBeTruthy();
    expect(screen.getByTestId("soul-tab-events")).toBeTruthy();
    expect(screen.queryByTestId("soul-tab-judgments")).toBeNull();
    expect(screen.queryByTestId("soul-tab-fate")).toBeNull();
    expect(mockJudgments).not.toHaveBeenCalled();
  });

  it("去向 with reincarnation.read only shows the reincarnation part and never asks for dispositions", async () => {
    await openSoul(["soul.read", "reincarnation.read"]);
    fireEvent.press(screen.getByTestId("soul-tab-fate"));
    expect(await screen.findByTestId("soul-reincarnations")).toBeTruthy();
    expect(screen.queryByTestId("soul-dispositions")).toBeNull();
    expect(mockDispositions).not.toHaveBeenCalled();
  });

  it("审判 rows open the judgment detail; the plan sits at the bottom with ◐ on the current stop", async () => {
    mockJudgments.mockResolvedValue(page([{ id: "j1", case_number: "J-1958-0412", court: "第十殿", cycle: 2, verdict: null, is_final: false, created_at: "2026-10-01T00:00:00Z", soul: "s1", soul_name: "周阿满" }]));
    mockPlans.mockResolvedValue(page([{ id: "p1", cycle: 2, nodes: [{ id: "n1", order: 1, status: "ACTIVE", realm_code: "X", is_eternal: false, sentence_years: 3 }] }]));
    mockJudgment.mockResolvedValue({ data: { id: "j1", case_number: "J-1958-0412", soul: "s1", soul_name: "周阿满", court: "第十殿", is_final: false } });
    await openSoul(["soul.read", "judgment.read"]);
    fireEvent.press(screen.getByTestId("soul-tab-judgments"));
    expect(await screen.findByText("第 3 世 · 待决 · 未结")).toBeTruthy();
    expect(screen.getByTestId("soul-plan-current")).toBeTruthy();
    fireEvent.press(screen.getByTestId("soul-judgment-j1"));
    expect(await screen.findByTestId("judgment-detail")).toBeTruthy();
    expect(mockJudgment).toHaveBeenCalledWith("j1");
  });
});

describe("功过 and 事件 paging", () => {
  it("功过: 20 at a time from the one unpaged array, 已显示 20 / 25, then the rest and no button", async () => {
    mockRecords.mockResolvedValue({ data: Array.from({ length: 25 }, (_, i) => record(i)) });
    await openSoul();
    fireEvent.press(screen.getByTestId("soul-tab-karma"));
    expect(await screen.findByText("第 1 世 · 25 条")).toBeTruthy();
    expect(screen.getAllByTestId(/^soul-karma-row-/)).toHaveLength(20);
    expect(screen.getByTestId("soul-karma-count").props.children).toBe("已显示 20 / 25");
    fireEvent.press(screen.getByTestId("soul-karma-more"));
    expect(screen.getAllByTestId(/^soul-karma-row-/)).toHaveLength(25);
    expect(screen.getByTestId("soul-karma-count").props.children).toBe("已显示 25 / 25");
    expect(screen.queryByTestId("soul-karma-more")).toBeNull();
    expect(mockRecords).toHaveBeenCalledTimes(1);
  });

  it("事件: page 2 comes from the API; the count follows", async () => {
    mockEvents.mockImplementation(async (p: { page?: string }) =>
      p.page === "2" ? page(Array.from({ length: 10 }, (_, i) => event(20 + i)), 30) : page(Array.from({ length: 20 }, (_, i) => event(i)), 30, "next")
    );
    await openSoul();
    fireEvent.press(screen.getByTestId("soul-tab-events"));
    await screen.findByTestId("soul-events");
    expect(screen.getAllByTestId(/^soul-event-e/)).toHaveLength(20);
    expect(screen.getByTestId("soul-events-count").props.children).toBe("已显示 20 / 30");
    // 第一页若在第二页回来之前又取了一次(换了对象),多出的页按设计丢掉;全量并跑时偶尔撞上。
    // 先等取数落定再点;仍被丢就再点一次 —— 这里验的是「第二页来自接口、计数跟着变」,不是那次竞争。
    await act(async () => {});
    await waitFor(
      () => {
        if (screen.queryByTestId("soul-events-more")) fireEvent.press(screen.getByTestId("soul-events-more"));
        expect(screen.getAllByTestId(/^soul-event-e/)).toHaveLength(30);
      },
      { timeout: 3000 }
    );
    expect(mockEvents).toHaveBeenLastCalledWith({ soul: "s1", page: "2" });
    expect(screen.queryByTestId("soul-events-more")).toBeNull();
  });

  it("each tab has its own empty state", async () => {
    await openSoul();
    fireEvent.press(screen.getByTestId("soul-tab-karma"));
    expect(await screen.findByTestId("soul-karma-empty")).toBeTruthy();
    fireEvent.press(screen.getByTestId("soul-tab-events"));
    expect(await screen.findByTestId("soul-events-empty")).toBeTruthy();
  });
});

describe("failures", () => {
  it("a tab that fails says so inside itself; the header and the other tabs stay", async () => {
    mockRecords.mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce({ data: [record(1)] });
    await openSoul();
    fireEvent.press(screen.getByTestId("soul-tab-karma"));
    expect(await screen.findByTestId("soul-tab-failed")).toBeTruthy();
    expect(screen.getByTestId("soul-header")).toBeTruthy();
    expect(screen.queryByTestId("state-error")).toBeNull();
    fireEvent.press(screen.getByTestId("soul-tab-identity"));
    expect(screen.getByTestId("soul-identity")).toBeTruthy();
    fireEvent.press(screen.getByTestId("soul-tab-karma"));
    fireEvent.press(within(screen.getByTestId("soul-panel-karma")).getByText("重试"));
    expect(await screen.findByTestId("soul-karma-row-r1")).toBeTruthy();
    expect(screen.queryByTestId("soul-tab-failed")).toBeNull();
  });

  it("the soul itself failing is the whole-page error", async () => {
    mockSoul.mockRejectedValue(new Error("down"));
    renderOfficer(<Detail target={{ type: "soul", id: "s1" }} onBack={() => {}} onSettled={() => {}} />);
    expect(await screen.findByTestId("state-error")).toBeTruthy();
    expect(screen.queryByTestId("soul-tabs")).toBeNull();
  });
});

describe("header", () => {
  it("monogram, code · civilization · life, the state pill and the three signed figures", async () => {
    mockSoul.mockResolvedValue({ data: { ...SOUL, soul_code: "QU33Q9FW5F" } });
    await openSoul(["soul.read", "soul_account.read"]);
    expect(screen.getByTestId("soul-meta").props.children).toBe("QU3 3Q9F W5F · 中国 · 第 3 世");
    expect(screen.getByTestId("soul-state")).toBeTruthy();
    expect(screen.getByText("+412")).toBeTruthy();
    expect(screen.getByText("−158")).toBeTruthy();
    expect(screen.getByText("+254")).toBeTruthy();
    expect(screen.queryByTestId("soul-archived-pill")).toBeNull();
    expect(screen.queryByTestId("soul-residing")).toBeNull();
  });

  it("the code comes with the soul, so a judge without soul_account.read sees it too (Design 第四十批 第四节 4)", async () => {
    mockSoul.mockResolvedValue({ data: { ...SOUL, soul_code: "QU33Q9FW5F" } });
    await openSoul();
    expect(screen.getByTestId("soul-meta").props.children).toBe("QU3 3Q9F W5F · 中国 · 第 3 世");
  });

  it("a soul never given an account has no code, and nothing stands in for it", async () => {
    await openSoul(["soul.read", "soul_account.read"]);
    expect(screen.getByTestId("soul-meta").props.children).toBe("中国 · 第 3 世");
  });

  it("a soul that is gone (404 / 403) says so, not 没有权限 (Design 第四十批 O-c)", async () => {
    mockSoul.mockRejectedValue(Object.assign(new Error("HTTP 404"), { response: { status: 404 } }));
    renderOfficer(<Detail target={{ type: "soul", id: "s1" }} from="查询" onBack={() => {}} onSettled={() => {}} />);
    expect(await screen.findByTestId("state-gone")).toBeTruthy();
    expect(screen.getByText("回到查询")).toBeTruthy();
    expect(screen.queryByTestId("state-denied")).toBeNull();
  });

  // 数据范围(B8):范围外的灵魂 / 审判,后端一律 404。从推送或列表打开都是同一句「无权查看或已不存在」,
  // 不是报错、不给重试、不说「没有权限」(那等于承认它在)。
  it.each([
    ["soul", () => mockSoul],
    ["judgment", () => mockJudgment],
  ] as const)("an out-of-scope %s (404) reads 「无权查看或已不存在」, not the error state", async (type, mock) => {
    mock().mockRejectedValue(httpError(404));
    renderOfficer(<Detail target={{ type, id: "x1" }} from="通知" onBack={() => {}} onSettled={() => {}} />);
    expect(await screen.findByTestId("state-gone")).toBeTruthy();
    expect(screen.getByText("无权查看或已不存在")).toBeTruthy();
    expect(screen.getByText("回到通知")).toBeTruthy();
    expect(screen.queryByText("这条已经不在了")).toBeNull();
    expect(screen.queryByTestId("state-error")).toBeNull();
    expect(screen.queryByTestId("state-retry")).toBeNull();
    expect(screen.queryByTestId("state-denied")).toBeNull();
  });

  it("no 前世 tab or section: the earlier lives are read through the 第几世 groups (Design 第四十批 第四节 3)", async () => {
    await openSoul(["soul.read", "judgment.read", "ledger.read", "disposition.read", "reincarnation.read", "events.read"]);
    expect(screen.queryByText("前世")).toBeNull();
  });

  it("archived: □ 已归档 instead of the state, and who / when / why under the header", async () => {
    mockSoul.mockResolvedValue({ data: { ...SOUL, is_archived: true, archived_at: "2026-10-16T02:00:00Z", archived_by_name: "崔判官", archive_reason: "重复登记" } });
    await openSoul();
    expect(screen.getByText("□ 已归档")).toBeTruthy();
    expect(screen.queryByTestId("soul-state")).toBeNull();
    const banner = screen.getByTestId("soul-archive-banner").props.children as string;
    expect(banner).toContain("由崔判官归档");
    expect(banner).toContain("理由：重复登记");
  });

  it("residing: a second pill beside the state", async () => {
    mockSoul.mockResolvedValue({ data: { ...SOUL, is_residing: true, home_tenant: { code: "JP_YOMI", display_name: "冥土" } } });
    await openSoul();
    expect(screen.getByText("▲ 暂居中 · 原属 冥土")).toBeTruthy();
    expect(screen.getByTestId("soul-state")).toBeTruthy();
  });
});

describe("soul-name links", () => {
  it("审判详情: the name opens the soul, 返回 comes back to the judgment", async () => {
    mockJudgment.mockResolvedValue({ data: { id: "j1", case_number: "C-1", soul: "s1", soul_name: "周阿满", court: "第一殿", is_final: false } });
    renderOfficer(<Detail target={{ type: "judgment", id: "j1" }} onBack={() => {}} onSettled={() => {}} />);
    const link = await screen.findByTestId("judgment-soul-link");
    expect(link.props.accessibilityLabel).toBe("打开周阿满的灵魂详情");
    fireEvent.press(link);
    expect(await screen.findByTestId("soul-detail")).toBeTruthy();
    expect(mockSoul).toHaveBeenCalledWith("s1");
    fireEvent.press(screen.getByTestId("detail-back"));
    expect(screen.queryByTestId("soul-detail")).toBeNull();
    expect(screen.getByTestId("judgment-detail")).toBeTruthy();
  });

  it("待办详情: the name is a link, the code beside it is not", async () => {
    mockItem.mockResolvedValue({
      data: { kind: "approval", id: "wf-1", title: "审批", created_at: "2026-10-09T01:00:00Z", actionable: false, facts: { soul: { id: "s1", name: "周阿满", soul_code: "QU33Q9FW5F" } } },
    });
    renderOfficer(<Detail target={{ type: "todo", kind: "approval", id: "wf-1" }} onBack={() => {}} onSettled={() => {}} />);
    const link = await screen.findByTestId("facts-soul-link");
    expect(link.props.accessibilityLabel).toBe("打开周阿满的灵魂详情");
    expect(within(link).queryByText(/QU33Q9FW5F/)).toBeNull();
    expect(screen.getByText("QU33Q9FW5F")).toBeTruthy();
    fireEvent.press(link);
    expect(await screen.findByTestId("soul-detail")).toBeTruthy();
  });

  it("an older server with no soul id: plain text, no link", async () => {
    mockItem.mockResolvedValue({
      data: { kind: "approval", id: "wf-1", title: "审批", created_at: "2026-10-09T01:00:00Z", actionable: false, facts: { soul: { name: "周阿满", soul_code: "QU33Q9FW5F" } } },
    });
    renderOfficer(<Detail target={{ type: "todo", kind: "approval", id: "wf-1" }} onBack={() => {}} onSettled={() => {}} />);
    expect(await screen.findByText("周阿满 · QU33Q9FW5F")).toBeTruthy();
    expect(screen.queryByTestId("facts-soul-link")).toBeNull();
  });
});

// 第四十五批 O-1:身份页签里「籍贯」旁边是出身地域,只读。「不详」是一个词,不是「—」;
// 埃及文里亚洲没有词(egyPendingKeys),退回英文 Asia,不退回中文「亚洲」。
describe("出身地域 (Design 第四十五批 O-1)", () => {
  it("shows the region beside the birthplace, read-only", async () => {
    mockSoul.mockResolvedValue({ data: { ...SOUL, origin_region: "EUROPE" } });
    await openSoul();
    const identity = await screen.findByTestId("soul-identity");
    expect(within(identity).getByText("出身地域")).toBeTruthy();
    expect(screen.getByTestId("soul-origin-region").props.children).toBe("欧洲");
    expect(within(identity).queryByText("亚洲")).toBeNull();
    // Read-only: nothing in the identity tab is pressable.
    expect(within(identity).queryAllByRole("button")).toEqual([]);
  });

  it("a blank region reads 不详 as a word, not a dash", async () => {
    mockSoul.mockResolvedValue({ data: { ...SOUL, origin_region: "" } });
    await openSoul();
    await screen.findByTestId("soul-identity");
    expect(screen.getByTestId("soul-origin-region").props.children).toBe("不详");
    expect(screen.getByTestId("soul-origin-region").props.children).not.toBe("—");
  });

  it("in egy, ASIA falls back to the English Asia, not the Chinese", async () => {
    platform().persistent.set(LOCALE_COOKIE, "egy");
    try {
      mockSoul.mockResolvedValue({ data: { ...SOUL, origin_region: "ASIA" } });
      await openSoul();
      await screen.findByTestId("soul-identity");
      expect(screen.getByTestId("soul-origin-region").props.children).toBe("Asia");
      expect(screen.queryByText("亚洲")).toBeNull();
    } finally {
      platform().persistent.set(LOCALE_COOKIE, "zh-Hans");
    }
  });
});

// 第五十七批 六:地府灵魂的身份页签多两行只读 —— 十三站「第 n / 13 站 · 站名」与勾魂状态。挪站、发牒留在网页上。
describe("十三站与勾魂 (Design 第五十七批 六)", () => {
  it("on the road: station n of 13 by name; the latest warrant's status and escort, words not members", async () => {
    mockSoul.mockResolvedValue({ data: { ...SOUL, diyu_station: "WANGXIANG_TERRACE" } });
    mockWarrants.mockResolvedValue(
      page([
        { id: "w0", soul: "s1", status: "CANCELLED", escort: "WUCHANG", city_god_name: null, issued_at: "2026-10-01T00:00:00Z" },
        { id: "w1", soul: "s1", status: "CAPTURED", escort: "NIUTOU_MAMIAN", city_god_name: "常熟县城隍", issued_at: "2026-10-27T00:00:00Z" },
      ])
    );
    await openSoul();
    await screen.findByTestId("soul-identity");
    expect(screen.getByTestId("soul-diyu-station").props.children).toBe("第 3 / 13 站 · 望乡台");
    expect(await screen.findByTestId("soul-capture")).toBeTruthy();
    expect(screen.getByTestId("soul-capture").props.children).toBe("已拘到 · 牛头马面 · 常熟县城隍");
    expect(mockWarrants).toHaveBeenCalledWith({ soul: "s1" });
    expect(within(screen.getByTestId("soul-identity")).queryAllByRole("button")).toEqual([]);
  });

  it("off the road it says so; no warrant, no capture row", async () => {
    mockSoul.mockResolvedValue({ data: { ...SOUL, diyu_station: "" } });
    await openSoul();
    await screen.findByTestId("soul-identity");
    await waitFor(() => expect(mockWarrants).toHaveBeenCalled());
    expect(screen.getByTestId("soul-diyu-station").props.children).toBe("不在路上");
    expect(screen.queryByTestId("soul-capture")).toBeNull();
    expect(screen.queryByTestId("soul-capture-unavailable")).toBeNull();
  });

  it("a failed warrant fetch says so in grey, not the silence of 「no warrant」 (华为真机 10-29)", async () => {
    mockSoul.mockResolvedValue({ data: { ...SOUL, diyu_station: "WANGXIANG_TERRACE" } });
    mockWarrants.mockRejectedValue(new Error("network"));
    await openSoul();
    await screen.findByTestId("soul-identity");
    const line = await screen.findByTestId("soul-capture-unavailable");
    expect(line.props.children).toBe("勾魂状态暂时读不到");
    // Grey: not the ink the other facts' values are written in.
    const colour = (el: { props: { style?: unknown } }) => (StyleSheet.flatten(el.props.style as never) as { color?: string }).color;
    expect(colour(line)).toBeTruthy();
    expect(colour(line)).not.toBe(colour(screen.getByTestId("soul-diyu-station")));
    expect(screen.queryByTestId("soul-capture")).toBeNull();
  });

  it("another civilization has neither row and never asks for warrants", async () => {
    mockSoul.mockResolvedValue({ data: { ...SOUL, civilization: "EUROPEAN" } });
    await openSoul();
    await screen.findByTestId("soul-identity");
    expect(screen.queryByTestId("soul-diyu-station")).toBeNull();
    expect(screen.queryByTestId("soul-capture")).toBeNull();
    expect(mockWarrants).not.toHaveBeenCalled();
  });
});

describe("lost banner (第五十批 M-1)", () => {
  it("draws the latest → 失踪 change under the header, read-only, only while LOST", async () => {
    mockSoul.mockResolvedValue({ data: { ...SOUL, current_state: "LOST" } });
    mockEvents.mockResolvedValue(
      page([
        { ...event(1), payload: { old_state: "DISPOSED", new_state: "LOST", reason: "押送途中走失" }, actor: "陆判", create_time: "2026-10-20T02:00:00Z" },
        { ...event(2), payload: { old_state: "DISPOSED", new_state: "LOST", reason: "旧的一次" }, actor: "旧人", create_time: "2026-09-01T02:00:00Z" },
      ]),
    );
    await openSoul();
    const banner = await screen.findByTestId("soul-lost-banner");
    expect(within(banner).getByText(/陆判/)).toBeTruthy();
    expect(within(banner).getByText("押送途中走失")).toBeTruthy();
    expect(within(banner).queryByText("旧的一次")).toBeNull();
    expect(within(banner).queryByRole("button")).toBeNull();
  });

  it("is absent when the soul is not LOST", async () => {
    await openSoul();
    expect(screen.queryByTestId("soul-lost-banner")).toBeNull();
  });
});

// 官员 7(2026-10-29):审判看得到、流程不在本殿范围(跨域、本殿没有自己那一段)时 item 答 404。
describe("查看审批流程 when the flow is not readable from this hall", () => {
  it("says why instead of 「已不在」, and does not grey the row the judgment came from", async () => {
    mockJudgment.mockResolvedValue({
      data: { id: "j1", case_number: "C-1", soul: "s1", soul_name: "周阿满", court: "第一殿", is_final: false,
              flow_progress: { workflow: "wf-9", status: "IN_PROGRESS", index: 2, total: 5, waiting: null } },
    });
    mockItem.mockRejectedValue(httpError(404, { detail: "Not found." }));
    const onGone = jest.fn();
    renderOfficer(<Detail target={{ type: "judgment", id: "j1" }} from="搜索" onBack={() => {}} onSettled={() => {}} onGone={onGone} />);
    fireEvent.press(await screen.findByTestId("judgment-flow-open"));
    expect(await screen.findByTestId("flow-not-here")).toBeTruthy();
    expect(mockItem).toHaveBeenCalledWith("approval", "wf-9");
    expect(screen.getByText("这条审批流程由别的殿主办，本殿在其中没有一段，这里看不到详情；进度见上一页。")).toBeTruthy();
    expect(screen.queryByTestId("state-gone")).toBeNull();
    expect(onGone).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId("detail-back"));
    expect(screen.getByTestId("judgment-detail")).toBeTruthy();
  });
});
