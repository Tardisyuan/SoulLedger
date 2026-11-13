/**
 * 官员端 App items of the 2026-11-01 review: typed words that a tab switch or a sheet's reset threw away, the two
 * conclusions that went out on one tap, the city god page offline, the search lost on the way back, the readable
 * ⋯ / unread, the raw court names, the reason with no length limit and the to-do group names the web uses.
 */
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react-native";

import { OnlineContext } from "../../../mobile/src/online";
import { TabBar } from "../kit";
import { TODO_GROUPS, reasonMaxLength } from "../rules";
import { CityGodCase } from "../screens/cityGod";
import { Detail } from "../screens/detail";
import { QueueTab } from "../screens/queue";
import { SearchTab } from "../screens/search";
import { WangsiReview } from "../screens/wangsi";
import { translate } from "../shared";
import { OFFICER, renderOfficer } from "./harness";

const settle = () => act(async () => {});

const mockGet = jest.fn();
const mockComments = jest.fn();
const mockDecide = jest.fn();
const mockList = jest.fn();
const mockCityGod = jest.fn();
jest.mock("@soulledger/core/api/judgment", () => ({
  ...jest.requireActual("@soulledger/core/api/judgment"),
  judgmentApi: {
    get: (...a: unknown[]) => mockGet(...a),
    comments: (...a: unknown[]) => mockComments(...a),
    addComment: jest.fn(),
    list: (...a: unknown[]) => mockList(...a),
    queueCounts: jest.fn(async () => ({ data: {} })),
  },
  wangsiApi: { decideGrievance: (...a: unknown[]) => mockDecide(...a) },
  cityGodCasesApi: { get: (...a: unknown[]) => mockCityGod(...a), sendOn: jest.fn(), returnCase: jest.fn() },
}));
const mockSouls = jest.fn();
jest.mock("@soulledger/core/api/souls", () => ({
  ...jest.requireActual("@soulledger/core/api/souls"),
  soulsApi: { list: (...a: unknown[]) => mockSouls(...a) },
}));
const mockItem = jest.fn();
jest.mock("@soulledger/core/api/officer-app", () => ({
  ...jest.requireActual("@soulledger/core/api/officer-app"),
  officerAppApi: { item: (...a: unknown[]) => mockItem(...a), signerCandidates: jest.fn(async () => ({ data: [] })) },
}));

const zh = (key: string, vars?: Record<string, string>) => translate("zh-Hans", key, vars);
const JUDGMENT = { id: "j-1", case_number: "CN-2026-1", soul: "s-1", soul_name: "张三", court: "Tenth Court", claimed_by_name: "阎罗", is_final: false };
const WANGSI = {
  id: "j-1", case_number: "CN-2026-0061", soul: "s-1", soul_name: "钱谦益", city_god_name: "常熟县城隍", city_god_status: "SENT_ON",
  untimely: true, held_until: "2999-11-03", wangsi_held: true, wrongful_death_cause: "VICTIM", grievance_level: "MINOR",
  grievance_status: "FILED", grievance_plea: "请查。", verdict: null, is_final: false,
};
const CITY_GOD = {
  id: "cg-1", case_number: "CN-1", city_god_name: "城隍甲", soul_name: "李白", city_god_status: "PENDING", untimely: false,
  origin_location: "长安", soul_birth_year: 701, soul_death_year: 762, soul_fated_death_year: 762, registered_via: "MANUAL",
  created_at: "2026-10-09T01:00:00Z", can_act: true, returned_at: null, city_god_note: "",
};
const APPROVAL = {
  kind: "approval", id: "wf-1", title: "转生配额审批", created_at: "2026-10-09T01:00:00Z", actionable: true, state: "actionable",
  handled_by: null, handled_at: null, // no workflow_id: the segments block (workflowApi) stays out of this
};

beforeEach(() => {
  jest.clearAllMocks();
  mockComments.mockResolvedValue({ data: [] });
});

describe("words survive leaving the detail (a tab switch unmounts it)", () => {
  it("a half-written comment is there again when the same judgment opens; another judgment's box is empty", async () => {
    mockGet.mockResolvedValue({ data: JUDGMENT });
    const first = renderOfficer(<Detail target={{ type: "judgment", id: "j-1" }} onBack={() => {}} onSettled={() => {}} />);
    fireEvent.changeText(await screen.findByTestId("comment-input"), "证据还缺一页");
    first.unmount();
    const again = renderOfficer(<Detail target={{ type: "judgment", id: "j-1" }} onBack={() => {}} onSettled={() => {}} />);
    expect((await screen.findByTestId("comment-input")).props.value).toBe("证据还缺一页");
    again.unmount();
    mockGet.mockResolvedValue({ data: { ...JUDGMENT, id: "j-2" } });
    renderOfficer(<Detail target={{ type: "judgment", id: "j-2" }} onBack={() => {}} onSettled={() => {}} />);
    expect((await screen.findByTestId("comment-input")).props.value).toBe("");
    await settle();
  });

  it("a reject reason survives closing the sheet and opening it again (a new key per opening), and has the server's limit", async () => {
    mockItem.mockResolvedValue({ data: APPROVAL });
    renderOfficer(<Detail target={{ type: "todo", kind: "approval", id: "wf-1" }} onBack={() => {}} onSettled={() => {}} />);
    fireEvent.press(await screen.findByTestId("action-reject"));
    const reason = await screen.findByTestId("decision-reason");
    expect(reason.props.maxLength).toBe(2000);
    fireEvent.changeText(reason, "材料不全");
    fireEvent.press(screen.getByTestId("decision-cancel"));
    fireEvent.press(screen.getByTestId("action-reject"));
    expect((await screen.findByTestId("decision-reason")).props.value).toBe("材料不全");
    await settle();
  });

  it("the reason limit follows the serializer of each kind", () => {
    expect(reasonMaxLength("reassignment")).toBe(1000); // DispatchRejectSerializer.reason
    expect(reasonMaxLength("cooldown")).toBe(2000); // CooldownShorteningRejectSerializer.note
    expect(reasonMaxLength("rebirth")).toBe(2000); // rejection_reason_for_soul
  });
});

describe("枉死申诉: 不属实 asks first, like the two 属实", () => {
  it("one tap on 不属实 sends nothing; 取消 keeps the note; 确认 sends", async () => {
    mockGet.mockResolvedValue({ data: WANGSI });
    mockDecide.mockResolvedValue({ data: {} });
    renderOfficer(<WangsiReview id="j-1" onSettled={jest.fn()} onDone={jest.fn()} />);
    fireEvent.changeText(await screen.findByTestId("wangsi-note"), "不实");
    fireEvent.press(screen.getByTestId("wangsi-reject"));
    expect(mockDecide).not.toHaveBeenCalled();
    expect(screen.getByText(zh("officer_app.wangsi.reject_title", { name: "钱谦益" }))).toBeTruthy();
    fireEvent.press(screen.getByTestId("wangsi-cancel"));
    expect(mockDecide).not.toHaveBeenCalled();
    expect(screen.getByTestId("wangsi-note").props.value).toBe("不实");
    fireEvent.press(screen.getByTestId("wangsi-reject"));
    fireEvent.press(screen.getByTestId("wangsi-confirm"));
    await waitFor(() => expect(mockDecide).toHaveBeenCalledWith("j-1", false, "不实", false));
    await settle();
  });

  it("属实(只记结论) after the fated day asks too", async () => {
    mockGet.mockResolvedValue({ data: { ...WANGSI, held_until: "2001-01-01", wangsi_held: false } });
    renderOfficer(<WangsiReview id="j-1" onSettled={jest.fn()} onDone={jest.fn()} />);
    fireEvent.changeText(await screen.findByTestId("wangsi-note"), "查实");
    fireEvent.press(screen.getByTestId("wangsi-uphold-late"));
    expect(mockDecide).not.toHaveBeenCalled();
    expect(screen.getByText(zh("officer_app.wangsi.late_title", { name: "钱谦益" }))).toBeTruthy();
    await settle();
  });
});

describe("城隍初审", () => {
  const view = (offline = false) =>
    renderOfficer(
      <OnlineContext.Provider value={{ offline, back: 0 }}>
        <CityGodCase id="cg-1" onSettled={() => {}} onDone={() => {}} />
      </OnlineContext.Provider>,
      { user: { ...OFFICER, permissions: ["city_god.read", "city_god.execute"] } }
    );
  const disabled = (testID: string) => screen.getByTestId(testID).props.accessibilityState?.disabled;

  it("offline: 解送 / 退回 are grey and the line says why; online they are live and the line is absent", async () => {
    mockCityGod.mockResolvedValue({ data: CITY_GOD });
    const off = view(true);
    expect(await screen.findByTestId("city-god-offline")).toBeTruthy();
    expect(disabled("city-god-send-on")).toBe(true);
    expect(disabled("city-god-return")).toBe(true);
    off.unmount();
    view(false);
    await screen.findByTestId("city-god-send-on");
    expect(screen.queryByTestId("city-god-offline")).toBeNull();
    expect(disabled("city-god-send-on")).toBeFalsy();
  });

  it("the 退回 note survives 取消, and is not the 解送 note", async () => {
    mockCityGod.mockResolvedValue({ data: CITY_GOD });
    view();
    fireEvent.press(await screen.findByTestId("city-god-return"));
    fireEvent.changeText(screen.getByTestId("city-god-note"), "籍贯有误");
    fireEvent.press(screen.getByTestId("city-god-cancel"));
    fireEvent.press(screen.getByTestId("city-god-return"));
    expect(screen.getByTestId("city-god-note").props.value).toBe("籍贯有误");
    fireEvent.press(screen.getByTestId("city-god-cancel"));
    fireEvent.press(screen.getByTestId("city-god-send-on"));
    expect(screen.getByTestId("city-god-note").props.value).toBe("");
  });
});

describe("查询 keeps its search across a soul and back", () => {
  it("opens with the kept query and asks it again; a new search is handed up", async () => {
    mockSouls.mockResolvedValue({ data: { results: [{ id: "s-1", name: "李白", current_state: "JUDGING" }], next: null } });
    const onSearch = jest.fn();
    renderOfficer(<SearchTab onOpenSoul={() => {}} initialQuery="李白" onSearch={onSearch} />);
    expect(screen.getByTestId("soul-search").props.value).toBe("李白");
    expect(await screen.findByTestId("soul-row-s-1")).toBeTruthy();
    expect(mockSouls).toHaveBeenCalledWith({ search: "李白" });
    fireEvent.changeText(screen.getByTestId("soul-search"), "杜甫");
    fireEvent(screen.getByTestId("soul-search"), "submitEditing");
    expect(onSearch).toHaveBeenLastCalledWith("杜甫");
    await settle();
  });

  it("with nothing kept, nothing is asked", async () => {
    renderOfficer(<SearchTab onOpenSoul={() => {}} />);
    expect(screen.getByTestId("soul-search").props.value).toBe("");
    await settle();
    expect(mockSouls).not.toHaveBeenCalled();
  });
});

describe("read aloud", () => {
  it("我 says it has unread in its label, not only with a drawn dot", () => {
    const first = renderOfficer(<TabBar current="todo" onSelect={() => {}} unread />);
    expect(screen.getByTestId("door-me").props.accessibilityLabel).toBe(zh("officer_app.doors.me_unread"));
    first.unmount();
    renderOfficer(<TabBar current="todo" onSelect={() => {}} unread={false} />);
    expect(screen.getByTestId("door-me").props.accessibilityLabel).toBe(zh("officer_app.doors.me.label"));
    expect(screen.queryByTestId("door-me-unread")).toBeNull();
  });

  it("the judgment's ⋯ is read as words", async () => {
    mockGet.mockResolvedValue({ data: { ...JUDGMENT, claimed_by: OFFICER.id, is_final: true } });
    renderOfficer(<Detail target={{ type: "judgment", id: "j-1" }} onBack={() => {}} onSettled={() => {}} />);
    const more = await screen.findByTestId("judgment-more");
    expect(more.props.accessibilityLabel).toBe(zh("officer_app.letter.more"));
    expect(more.props.accessibilityLabel).not.toBe("⋯");
    await settle();
  });
});

describe("names, not codes", () => {
  it("a queue row names the court in the interface language, not the stored English", async () => {
    mockList.mockResolvedValue({ data: { results: [{ ...JUDGMENT, is_final: true }] } });
    renderOfficer(<QueueTab onOpen={() => {}} />);
    const row = await screen.findByTestId("queue-row-j-1");
    expect(within(row).getByText(/ · 第十殿$/)).toBeTruthy(); // 案卷台: 「来源 · 殿」 on the second line
    expect(within(row).queryByText("Tenth Court")).toBeNull();
  });

  it("待回书信 and 受刑计划变更 are named as the web names them", () => {
    const label = (kind: string) => zh(TODO_GROUPS.find((g) => g.kind === kind)!.label);
    expect(label("letter")).toBe(zh("dashboard.todo.letters"));
    expect(label("sentence_change")).toBe(zh("sentence_plan.inbox_title"));
  });
});
