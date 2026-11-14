/**
 * Design 第五十批: C1 the detail after sealing (「已落印」 strip, content at 55 %, the new bar), C2 查询 (groups with
 * counts, 5 cases + 「看全部」, 3 people, the match bold and underlined, the no-results hint with this hall's prefix,
 * 「清除」 on 最近打开). The 「下一件」 bar's caption and the last row's 「今天的都办完了」 are in nextAndRecent.test.tsx.
 */
import { act, fireEvent, screen } from "@testing-library/react-native";
import { platform } from "@soulledger/core/platform";
import { Pressable, StyleSheet } from "react-native";

import { USER_KEY } from "../owner";
import { RECENT_KEY, noteOpened, readRecent } from "../recentOpened";
import { caseNumberExample } from "../rules";
import { Detail } from "../screens/detail";
import { CASES_SHOWN, PEOPLE_SHOWN, SearchTab, marked } from "../screens/search";
import { family } from "../shared";
import { renderOfficer } from "./harness";

// The seal sheet's hold-to-seal is its own test (sealSheet.test.tsx); here it just seals.
jest.mock("../screens/sealSheet", () => ({
  SealSheet: ({ open, onSealed }: { open: boolean; onSealed: () => void }) => (open ? <Pressable testID="mock-seal" onPress={onSealed} /> : null),
}));
const mockList = jest.fn();
const mockGet = jest.fn();
jest.mock("@soulledger/core/api/judgment", () => ({
  ...jest.requireActual("@soulledger/core/api/judgment"),
  judgmentApi: {
    list: (...a: unknown[]) => mockList(...a),
    get: (...a: unknown[]) => mockGet(...a),
    comments: jest.fn(async () => ({ data: [] })),
    addComment: jest.fn(),
  },
}));
const mockSouls = jest.fn();
jest.mock("@soulledger/core/api/souls", () => ({
  ...jest.requireActual("@soulledger/core/api/souls"),
  soulsApi: { list: (...a: unknown[]) => mockSouls(...a) },
}));

const settle = () => act(async () => {});
const search = (text: string) => {
  fireEvent.changeText(screen.getByTestId("soul-search"), text);
  fireEvent(screen.getByTestId("soul-search"), "submitEditing");
};
const judgment = (i: number, over: object = {}) => ({ id: `j-${i}`, case_number: `CN-2026-00${10 + i}`, soul_name: `王${i}`, court: "第一殿", claimed_by: null, concluded_at: null, ...over });
const soul = (i: number) => ({ id: `s-${i}`, name: `王魂${i}`, current_state: "JUDGING", tenant_code: "CN_DIYU" });

beforeEach(() => {
  jest.clearAllMocks();
  mockList.mockResolvedValue({ data: { results: [], count: 0 } });
  mockSouls.mockResolvedValue({ data: { results: [], count: 0, next: null } });
});
afterEach(() => {
  platform().persistent.remove(USER_KEY);
  platform().persistent.remove(RECENT_KEY);
});

describe("C1 · after sealing, the detail stays and says so", () => {
  it("shows 「已落印」 with the seal under the title, dims the dossier to 55 %, and swaps the bar for 「下一件」", async () => {
    mockGet.mockResolvedValue({
      data: { id: "j-1", case_number: "CN-2026-0021", soul: "s-1", soul_name: "赵志强", civilization: "CHINESE_UNDERWORLD", court: "第一殿", claimed_by: 7, claimed_by_name: "阎罗", is_final: true, concluded_at: null },
    });
    const onNext = jest.fn();
    renderOfficer(<Detail target={{ type: "judgment", id: "j-1" }} from="审判" onBack={() => {}} onSettled={() => {}} next={{ name: "王桂兰", left: 5, onNext }} />);
    fireEvent.press(await screen.findByTestId("judgment-judge"));
    expect(screen.queryByTestId("detail-sealed")).toBeNull();
    fireEvent.press(screen.getByTestId("mock-seal"));
    expect(await screen.findByTestId("detail-sealed")).toHaveTextContent("已落印 · 进入审批");
    expect(screen.getByTestId("detail-sealed")).toHaveTextContent("驳回会重开一案");
    expect(screen.getByTestId("detail-dimmed")).toHaveStyle({ opacity: 0.55 });
    expect(screen.queryByTestId("judgment-seal")).toBeNull(); // the strip carries the seal, not the header
    expect(screen.queryByTestId("judgment-actions")).toBeNull();
    expect(screen.getByTestId("detail-next-caption")).toHaveTextContent("王桂兰 · 还剩 5 件");
    // Opened from 审判, not 待办: 「回到审判」.
    expect(screen.getByTestId("detail-leave")).toHaveTextContent("回到审判");
    fireEvent.press(screen.getByTestId("detail-next"));
    expect(onNext).toHaveBeenCalled();
  });
});

describe("C2 · 查询", () => {
  it("the example is this hall's case-number prefix for the year, as the server forms it", () => {
    expect(caseNumberExample("CN_DIYU", 2026)).toBe("CN-2026");
    expect(caseNumberExample("eg-duat_x", 2027)).toBe("EGDUAT-2027");
    expect(caseNumberExample(null, 2026)).toBe("SL-2026");
  });

  it("marks the first match, case-insensitively, and nothing when it does not match", () => {
    expect(marked("CN-2026-0024", "cn-2026")).toEqual([{ text: "CN-2026", hit: true }, { text: "-0024", hit: false }]);
    expect(marked("王桂兰", "桂")).toEqual([{ text: "王", hit: false }, { text: "桂", hit: true }, { text: "兰", hit: false }]);
    expect(marked("王桂兰", "李")).toEqual([{ text: "王桂兰", hit: false }]);
  });

  it("cases first with their count, five shown and 「看全部」 for the rest; people under them, three, 「灵魂 · 殿名」", async () => {
    mockList.mockResolvedValue({ data: { results: Array.from({ length: 7 }, (_, i) => judgment(i, i === 0 ? { concluded_at: "2026-11-01T00:00:00Z" } : {})), count: 7 } });
    mockSouls.mockResolvedValue({ data: { results: [soul(1), soul(2), soul(3), soul(4)], count: 4, next: null } });
    renderOfficer(<SearchTab onOpenSoul={() => {}} onOpenJudgment={() => {}} />);
    search("王");
    expect(await screen.findByText("案件 · 7")).toBeTruthy();
    expect(await screen.findByText("人物 · 4")).toBeTruthy();
    expect(screen.getAllByTestId(/^case-row-j-\d+$/)).toHaveLength(CASES_SHOWN);
    expect(screen.getByTestId("case-row-j-0")).toHaveTextContent("已结");
    expect(screen.getByTestId("case-row-j-1")).toHaveTextContent("待认领");
    expect(screen.getByTestId("search-see-all")).toHaveTextContent("看全部 7 件 ›");
    fireEvent.press(screen.getByTestId("search-see-all"));
    expect(screen.getAllByTestId(/^case-row-j-\d+$/)).toHaveLength(7);
    expect(screen.queryByTestId("search-see-all")).toBeNull();
    expect(screen.getAllByTestId(/^soul-row-s-\d+$/)).toHaveLength(PEOPLE_SHOWN);
    expect(screen.getByTestId("soul-row-s-1")).toHaveTextContent("灵魂 · 酆都");
    // The typed 「王」 is the marked part of the name: bold and underlined, no colour of its own.
    const hit = screen.getAllByTestId("soul-row-s-1-hit")[0];
    expect(hit).toHaveTextContent("王");
    expect(hit).toHaveStyle({ textDecorationLine: "underline" });
    expect(StyleSheet.flatten(hit.props.style).fontFamily).toBe(family.title);
    expect(screen.queryByTestId("search-no-results")).toBeNull();
  });

  it("nothing found: the title with the term and the hint with this hall's prefix for this year", async () => {
    renderOfficer(<SearchTab onOpenSoul={() => {}} />);
    search("CN-2027");
    expect(await screen.findByText("没有找到「CN-2027」")).toBeTruthy();
    expect(screen.getByTestId("search-no-results")).toHaveTextContent(`如 CN-${new Date().getFullYear()}。`);
    expect(screen.queryByTestId("search-cases")).toBeNull();
    expect(screen.queryByTestId("search-people")).toBeNull();
  });

  it("「最近打开」: the name above the case number, when at the right; 「清除」 empties it and says so", async () => {
    platform().persistent.set(USER_KEY, JSON.stringify({ id: 7, username: "u7" }));
    noteOpened({ type: "judgment", id: "j-1", title: "CN-2026-0021", line: "赵志强", at: "2026-11-15T02:12:00Z" });
    renderOfficer(<SearchTab onOpenSoul={() => {}} onOpenJudgment={() => {}} />);
    expect(screen.getByTestId("recent-row-judgment-j-1")).toHaveTextContent(/赵志强.*CN-2026-0021/);
    fireEvent.press(screen.getByTestId("search-recent-clear"));
    expect(readRecent()).toEqual([]);
    expect(screen.queryByTestId("recent-row-judgment-j-1")).toBeNull();
    expect(screen.getByTestId("search-recent-empty")).toHaveTextContent("还没有打开过案件。");
    expect(screen.queryByTestId("search-recent-clear")).toBeNull();
    await settle();
  });

  it("the box has focus on arrival", async () => {
    renderOfficer(<SearchTab onOpenSoul={() => {}} />);
    expect(screen.getByTestId("soul-search").props.autoFocus).toBe(true);
    await settle();
  });
});
