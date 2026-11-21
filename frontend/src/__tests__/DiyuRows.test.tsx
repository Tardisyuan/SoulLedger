/**
 * 地府:出身部洲在身份栏一行;十三站是页头下的行程条(Design 第五十七批 S-1 / S-1b)。
 * 只地府画;不在路上只一行灰字;没有 `soul.transition` 不给挪站;挪站在弹层里,发对的请求。
 * 时间线一行:换站写去处,勾魂写鬼差与城隍;升天堂经地上乐园写一行小字(E-3)。
 */
import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { Soul, SoulEvent } from "@soulledger/core/api";
import { tZh } from "./support/zhBundle";

const mockShowToast = jest.fn();
const mockMove = jest.fn();

jest.mock("@/src/contexts/I18nContext", () => require("./support/mocks").i18nMock({ actual: true, zh: "stable", tf: (_k: string, f: string) => f, locale: "zh-Hans", hydrated: true }));
jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
jest.mock("@soulledger/core/api", () => ({
  ...jest.requireActual("@soulledger/core/api"),
  soulsApi: { moveStation: (...args: unknown[]) => mockMove(...args) },
  eventsApi: { list: () => Promise.resolve({ data: { results: [] } }) },
}));

import { DiyuRows, DiyuStationStrip } from "@/src/components/souls/detail/DiyuRows";
import { describeSystemEvent, makeSystemEventLabels, buildSystemRows, isBackwardStationMove } from "@/src/components/souls/soulLifecycleRows";
import { renderWithProviders } from "./support/render";
import { api } from "@soulledger/core/api/client";
import { soulsApi as realSoulsApi } from "@soulledger/core/api/souls";

const SOUL = {
  id: "s1",
  name: "张三",
  civilization: "CHINESE",
  current_state: "JUDGING",
  diyu_station: "WANGXIANG_TERRACE",
  birth_continent: "NANZHAN",
} as unknown as Soul;

function rows(soul: Partial<Soul>) {
  return renderWithProviders(
    <dl>
      <DiyuRows soul={{ ...SOUL, ...soul } as Soul} />
    </dl>,
    { retryOff: false, i18n: false },
  );
}

function strip(soul: Partial<Soul>, canMove = false) {
  return renderWithProviders(<DiyuStationStrip soul={{ ...SOUL, ...soul } as Soul} canMove={canMove} />, { retryOff: false, i18n: false });
}

describe("DiyuRows · 出身部洲", () => {
  it("写部洲的词,不写原值", () => {
    rows({});
    expect(screen.getByTestId("soul-birth-continent")).toHaveTextContent("南瞻部洲");
    expect(screen.getByTestId("soul-birth-continent")).not.toHaveTextContent("NANZHAN");
  });

  it("没登记写不详", () => {
    rows({ birth_continent: "" } as Partial<Soul>);
    expect(screen.getByTestId("soul-birth-continent")).toHaveTextContent("不详");
  });

  it("别的文明不画", () => {
    rows({ civilization: "EUROPEAN" } as Partial<Soul>);
    expect(screen.queryByTestId("soul-birth-continent")).toBeNull();
  });
});

describe("十三站行程条(第五十七批 S-1)", () => {
  it("13 站卡(第二十五批):已过窄条带勾、当前展开写「现在 · 第 n 站」、未到虚线框;右上第 n / 13 站 · 站名;不写原值", () => {
    strip({});
    const states = Array.from(document.querySelectorAll("[data-station]")).map((li) => li.getAttribute("data-state"));
    expect(states).toEqual(["passed", "passed", "current", ...Array(10).fill("ahead")]);
    const cells = Array.from(document.querySelectorAll("[data-station]")).map((li) => li.textContent ?? "");
    expect(cells[0].startsWith("✓1")).toBe(true);
    expect(cells[2].startsWith("现在 · 第 3 站望乡台")).toBe(true);
    expect(cells[3].startsWith("4")).toBe(true);
    expect(cells[3]).not.toContain("✓");
    expect(screen.getByTestId("soul-diyu-station-now")).toHaveTextContent("第 3 / 13 站 · 望乡台");
    expect(screen.getByTestId("soul-diyu-station")).not.toHaveTextContent("WANGXIANG_TERRACE");
    // v4 S07 卡头:「{soul} 走到了哪一步」,不再是 v3 的「十三站」小字栏目名。
    expect(screen.getByTestId("soul-diyu-station-title")).toHaveTextContent("张三 走到了哪一步");
    expect(screen.getByTestId("soul-diyu-station-title")).not.toHaveTextContent("十三站");
    // 每站悬浮都有站名;窄屏只写当前站名(其余的名字在 xl 以下藏起)。
    expect(document.querySelector('[data-station="EIGHTEEN_HELLS"]')).toHaveAttribute("title", "十八层地狱");
    expect(document.querySelector('[data-station="WANGXIANG_TERRACE"]')).toHaveAttribute("aria-current", "step");
    expect(screen.queryByTestId("soul-diyu-station-move")).toBeNull();
    // 藏起的站名是 sr-only(读屏念得到),不是 display:none(`hidden`)。
    const hiddenName = Array.from(document.querySelectorAll('[data-station="EIGHTEEN_HELLS"] span')).find(
      (el) => el.textContent === "十八层地狱"
    );
    expect(hiddenName).toHaveClass("sr-only", "xl:not-sr-only");
    expect(hiddenName).not.toHaveClass("hidden");
  });

  it("不在路上(在世 / 已转世)不画条,只一行灰字", () => {
    strip({ current_state: "ALIVE", diyu_station: "" } as Partial<Soul>);
    expect(screen.getByTestId("soul-diyu-station")).toHaveTextContent("十三站 · 不在路上");
    expect(document.querySelector("[data-station]")).toBeNull();
  });

  it("别的文明什么都不画", () => {
    strip({ civilization: "EUROPEAN" } as Partial<Soul>);
    expect(screen.queryByTestId("soul-diyu-station")).toBeNull();
  });

  it("持 soul.transition:「挪站…」开弹层,当前站不可选,发的是选中的那一站", async () => {
    mockMove.mockResolvedValue({ data: {} });
    strip({}, true);
    expect(screen.queryByRole("combobox")).toBeNull(); // 不常驻下拉
    fireEvent.click(screen.getByTestId("soul-diyu-station-move"));
    expect(await screen.findByText("挪站 · 张三")).toBeInTheDocument();
    expect(screen.getByText("现在：第 3 站 · 望乡台")).toBeInTheDocument();
    const select = screen.getByLabelText("挪到") as HTMLSelectElement;
    expect(select.value).toBe("EVIL_DOG_VILLAGE"); // 默认下一站
    const here = Array.from(select.options).find((o) => o.value === "WANGXIANG_TERRACE")!;
    expect(here.disabled).toBe(true);
    expect(here.textContent).toContain("现在");
    fireEvent.change(select, { target: { value: "EIGHTEEN_HELLS" } });
    fireEvent.click(screen.getByTestId("soul-diyu-station-move-confirm"));
    await waitFor(() => expect(mockMove).toHaveBeenCalledWith("s1", "EIGHTEEN_HELLS", undefined));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith("已挪到十八层地狱", "success"));
  });
});

describe("挪站:理由(决定 #11,Design 第六十三批 一)", () => {
  beforeEach(() => {
    mockMove.mockReset();
    mockShowToast.mockReset();
  });
  const open = async () => {
    const view = strip({}, true);
    fireEvent.click(screen.getByTestId("soul-diyu-station-move"));
    await screen.findByText("挪站 · 张三");
    return { view, select: screen.getByLabelText("挪到") as HTMLSelectElement };
  };
  const confirm = () => screen.getByTestId("soul-diyu-station-move-confirm");
  const reasonBox = () => document.getElementById("soul-diyu-station-reason") as HTMLTextAreaElement;
  const labelOf = () => document.querySelector('label[for="soul-diyu-station-reason"]')!.textContent;

  it("往前挪:理由框一直在,标签「理由」、帮助句「往前挪可以不写」,不写也能挪,请求不带理由", async () => {
    mockMove.mockResolvedValue({ data: {} });
    await open();
    expect(reasonBox()).toBeInTheDocument();
    expect(labelOf()).toBe("理由");
    expect(screen.getByText("往前挪可以不写。")).toBeInTheDocument();
    expect(screen.queryByText("往回挪要写理由。")).toBeNull();
    expect(reasonBox()).not.toHaveAttribute("aria-required");
    expect(reasonBox().placeholder).toBe("例如：上一站记错了");
    expect(reasonBox().maxLength).toBe(500);
    fireEvent.click(confirm());
    await waitFor(() => expect(mockMove).toHaveBeenCalledWith("s1", "EVIL_DOG_VILLAGE", undefined));
  });

  it("往前挪写了理由:理由一样随请求发出(去掉首尾空白)", async () => {
    mockMove.mockResolvedValue({ data: {} });
    await open();
    fireEvent.change(reasonBox(), { target: { value: "  城隍补报 " } });
    fireEvent.click(confirm());
    await waitFor(() => expect(mockMove).toHaveBeenCalledWith("s1", "EVIL_DOG_VILLAGE", "城隍补报"));
  });

  it("选到更早的一站:还是同一个框,标签成「理由 · 必填」,帮助句换成「往回挪要写理由」;确认键不灰", async () => {
    const { select } = await open();
    const box = reasonBox();
    fireEvent.change(select, { target: { value: "TUDI_TEMPLE" } });
    expect(reasonBox()).toBe(box); // 不出现、不收起:同一个元素
    expect(labelOf()).toBe("理由 · 必填");
    expect(reasonBox()).toHaveAttribute("aria-required", "true");
    expect(screen.getByText("往回挪要写理由。")).toBeInTheDocument();
    expect(screen.queryByText("往前挪可以不写。")).toBeNull();
    expect(confirm()).toBeEnabled();
    fireEvent.change(select, { target: { value: "EIGHTEEN_HELLS" } });
    expect(reasonBox()).toBe(box);
    expect(labelOf()).toBe("理由");
  });

  it("往回挪没写(只有空白也算空)就点确认:行内报错替换帮助句,框转 invalid,焦点回框里,不发请求", async () => {
    const { select } = await open();
    fireEvent.change(select, { target: { value: "TUDI_TEMPLE" } });
    fireEvent.change(reasonBox(), { target: { value: "   " } });
    fireEvent.click(confirm());
    expect(mockMove).not.toHaveBeenCalled();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("往回挪要写理由。");
    expect(alert.id).toBe("soul-diyu-station-reason-error");
    expect(reasonBox()).toHaveAttribute("aria-invalid", "true");
    expect(reasonBox()).toHaveFocus();
    // 报错替换了帮助句,不是两句并排。
    expect(document.getElementById("soul-diyu-station-reason-description")).toBeNull();
    expect(mockShowToast).not.toHaveBeenCalled();
    // 写了就消掉报错,再点就发。
    fireEvent.change(reasonBox(), { target: { value: "  判错了站 " } });
    expect(screen.queryByRole("alert")).toBeNull();
    mockMove.mockResolvedValue({ data: {} });
    fireEvent.click(confirm());
    await waitFor(() => expect(mockMove).toHaveBeenCalledWith("s1", "TUDI_TEMPLE", "判错了站"));
  });

  it("后端回 reason_required:同一处行内报错,焦点回框里,不弹提示", async () => {
    mockMove.mockRejectedValue({ response: { status: 400, data: { code: "reason_required" } } });
    await open();
    fireEvent.click(confirm());
    expect(await screen.findByRole("alert")).toHaveTextContent("往回挪要写理由。");
    expect(reasonBox()).toHaveAttribute("aria-invalid", "true");
    await waitFor(() => expect(reasonBox()).toHaveFocus());
    expect(screen.queryByTestId("soul-diyu-station-move-error")).toBeNull();
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it("soul_settled:正文顶上一句,弹层不关,下拉与理由框禁用、「挪站」灰掉,只剩「取消」;关掉后刷新灵魂详情", async () => {
    mockMove.mockRejectedValue({ response: { status: 409, data: { code: "soul_settled" } } });
    const { view, select } = await open();
    const invalidate = jest.spyOn(view.client, "invalidateQueries");
    fireEvent.click(confirm());
    expect(await screen.findByTestId("soul-diyu-station-move-error")).toHaveTextContent("这个灵魂已终局，不能再挪站。");
    expect(screen.getByText("挪站 · 张三")).toBeInTheDocument();
    expect(select).toBeDisabled();
    expect(reasonBox()).toBeDisabled();
    expect(confirm()).toBeDisabled();
    const cancel = screen.getByRole("button", { name: "取消" });
    expect(cancel).toBeEnabled();
    expect(mockShowToast).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
    fireEvent.click(cancel);
    await waitFor(() => expect(screen.queryByText("挪站 · 张三")).toBeNull());
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["souls"] });
  });

  it.each([
    ["not_diyu", "只有地府的亡魂走十三站。"],
    ["alive", "在世的灵魂不在路上。"],
    ["something_new", "出错了"],
  ])("别的拒绝 %s:同一处写它自己那句(新码退回 common.error),弹层仍可再试", async (code, message) => {
    mockMove.mockRejectedValue({ response: { status: 409, data: { code } } });
    await open();
    fireEvent.click(confirm());
    expect(await screen.findByTestId("soul-diyu-station-move-error")).toHaveTextContent(message);
    expect(confirm()).toBeEnabled();
    expect(reasonBox()).toBeEnabled();
    expect(mockShowToast).not.toHaveBeenCalled();
  });
});

describe("soulsApi.moveStation 的请求体", () => {
  // 上面 mock 的是 "@soulledger/core/api" 的 soulsApi;这里用 souls 模块的真身,只把 HTTP 动词换掉。
  const soulsApi = realSoulsApi;
  let post: jest.SpyInstance;
  beforeEach(() => {
    post = jest.spyOn(api, "post").mockResolvedValue({ data: {} } as never);
  });
  afterEach(() => post.mockRestore());

  it("不带理由时没有 reason 字段;带了就发", async () => {
    await soulsApi.moveStation("s1", "FENGDU_CITY");
    expect(post).toHaveBeenLastCalledWith("/souls/s1/station/", { station: "FENGDU_CITY" });
    expect(post.mock.calls[0][1]).not.toHaveProperty("reason");
    await soulsApi.moveStation("s1", "TUDI_TEMPLE", "判错了站");
    expect(post).toHaveBeenLastCalledWith("/souls/s1/station/", { station: "TUDI_TEMPLE", reason: "判错了站" });
  });
});

describe("时间线一行", () => {
  const labels = makeSystemEventLabels(tZh);
  const event = (event_type: string, payload: Record<string, unknown>) =>
    ({ event_type, payload } as unknown as SoulEvent);

  it("换站写去处;没有理由就不多写", () => {
    expect(describeSystemEvent(event("DIYU_STATION_CHANGED", { from: "", to: "TUDI_TEMPLE", via: "death" }), labels))
      .toBe("十三站换站 · 土地庙");
    expect(describeSystemEvent(event("DIYU_STATION_CHANGED", { from: "TUDI_TEMPLE", to: "YELLOW_SPRINGS_ROAD", via: "officer", reason: "" }), labels))
      .toBe("十三站换站 · 黄泉路");
  });

  const moved = (payload: Record<string, unknown>) =>
    ({ id: `e-${String(payload.to)}`, soul: "s1", actor: "崔判官", create_time: "2026-11-21T06:02:00Z",
      event_type: "DIYU_STATION_CHANGED", payload } as unknown as SoulEvent);

  it("第六十三批 一:往回挪(from / to 的站序比出来)是「↺ 退回 · 站名」,理由在下一行「理由：……」全文", () => {
    const long = "上一站记错了：她还没过黄泉路就被记成了到恶狗岭。".repeat(20);
    const [back] = buildSystemRows([moved({ from: "EVIL_DOG_VILLAGE", to: "YELLOW_SPRINGS_ROAD", via: "officer", reason: ` ${long} ` })], labels);
    expect(back.title).toBe("↺ 退回 · 黄泉路");
    expect(back.title).not.toContain("十三站换站");
    expect(back.title).not.toContain(long.slice(0, 6));
    expect(back.note).toBe(`理由：${long}`);
  });

  it("往前挪照旧「十三站换站 · 站名」;写了理由也在下一行;没写就没有第二行", () => {
    const [forward] = buildSystemRows([moved({ from: "YELLOW_SPRINGS_ROAD", to: "WANGXIANG_TERRACE", via: "officer", reason: "城隍补报，已到望乡台。" })], labels);
    expect(forward.title).toBe("十三站换站 · 望乡台");
    expect(forward.title).not.toContain("↺");
    expect(forward.note).toBe("理由：城隍补报，已到望乡台。");
    expect(buildSystemRows([moved({ from: "YELLOW_SPRINGS_ROAD", to: "WANGXIANG_TERRACE", via: "officer", reason: "  " })], labels)[0].note).toBeUndefined();
    // 死亡时到第一站(from 为空)不是往回挪。
    expect(buildSystemRows([moved({ from: "", to: "TUDI_TEMPLE", via: "death" })], labels)[0].title).toBe("十三站换站 · 土地庙");
  });

  it("isBackwardStationMove:只在两端都是十三站、且去处更早时为真", () => {
    expect(isBackwardStationMove("FENGDU_CITY", "TUDI_TEMPLE")).toBe(true);
    expect(isBackwardStationMove("TUDI_TEMPLE", "FENGDU_CITY")).toBe(false);
    expect(isBackwardStationMove("TUDI_TEMPLE", "TUDI_TEMPLE")).toBe(false);
    expect(isBackwardStationMove("", "TUDI_TEMPLE")).toBe(false);
    expect(isBackwardStationMove("NOT_A_STATION", "TUDI_TEMPLE")).toBe(false);
    expect(isBackwardStationMove(undefined, "TUDI_TEMPLE")).toBe(false);
  });

  it("勾魂写鬼差与发牒城隍,不写原值", () => {
    const line = describeSystemEvent(
      event("CAPTURE_WARRANT_ISSUED", { escort: "NIUTOU_MAMIAN", city_god_name: "杭州府城隍" }), labels);
    expect(line).toBe("发勾魂牒 · 牛头马面 · 杭州府城隍");
    expect(line).not.toContain("NIUTOU_MAMIAN");
  });

  it("自炼狱升天堂经过山顶时,标题下一行小字;没经过(through 为空)或别的事件没有", () => {
    const ascended = (through: string) =>
      ({ id: `e-${through || "none"}`, soul: "s1", actor: "system", create_time: "2026-10-28T09:00:00Z",
        event_type: "PURGATORY_ASCENDED", payload: { through, realm: "EU_HEAVEN" } } as unknown as SoulEvent);
    const [via] = buildSystemRows([ascended("EU_EARTHLY_PARADISE")], labels);
    expect(via.title).toBe("出炼狱，升天国");
    expect(via.note).toBe("经地上乐园 · 饮忘川、忆善河");
    expect(buildSystemRows([ascended("")], labels)[0].note).toBeUndefined();
    expect(buildSystemRows([{ ...ascended("X"), event_type: "STATE_CHANGED" } as SoulEvent], labels)[0].note).toBeUndefined();
  });
});
