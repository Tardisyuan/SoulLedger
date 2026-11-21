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
import { describeSystemEvent, makeSystemEventLabels, buildSystemRows } from "@/src/components/souls/soulLifecycleRows";
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

describe("挪站:往回挪要理由(决定 #11)", () => {
  beforeEach(() => {
    mockMove.mockReset();
    mockShowToast.mockReset();
  });
  const open = async () => {
    strip({}, true);
    fireEvent.click(screen.getByTestId("soul-diyu-station-move"));
    await screen.findByText("挪站 · 张三");
    return screen.getByLabelText("挪到") as HTMLSelectElement;
  };
  const confirm = () => screen.getByTestId("soul-diyu-station-move-confirm");

  it("往前挪:没有理由框,发的请求不带理由", async () => {
    mockMove.mockResolvedValue({ data: {} });
    await open();
    expect(screen.queryByLabelText(/往回挪的理由/)).toBeNull();
    expect(confirm()).toBeEnabled();
    fireEvent.click(confirm());
    await waitFor(() => expect(mockMove).toHaveBeenCalledWith("s1", "EVIL_DOG_VILLAGE", undefined));
  });

  it("往回挪:理由必填,空白时不能提交;写了就随请求发出(去掉首尾空白)", async () => {
    mockMove.mockResolvedValue({ data: {} });
    const select = await open();
    fireEvent.change(select, { target: { value: "TUDI_TEMPLE" } });
    const reason = screen.getByLabelText(/往回挪的理由/) as HTMLTextAreaElement;
    expect(reason).toBeRequired();
    expect(reason.maxLength).toBe(500);
    expect(confirm()).toBeDisabled();
    fireEvent.change(reason, { target: { value: "   " } });
    expect(confirm()).toBeDisabled();
    fireEvent.click(confirm());
    expect(mockMove).not.toHaveBeenCalled();
    fireEvent.change(reason, { target: { value: "  判错了站 " } });
    expect(confirm()).toBeEnabled();
    fireEvent.click(confirm());
    await waitFor(() => expect(mockMove).toHaveBeenCalledWith("s1", "TUDI_TEMPLE", "判错了站"));
  });

  it("改回往前挪,理由框收起,写过的理由也不发", async () => {
    mockMove.mockResolvedValue({ data: {} });
    const select = await open();
    fireEvent.change(select, { target: { value: "TUDI_TEMPLE" } });
    fireEvent.change(screen.getByLabelText(/往回挪的理由/), { target: { value: "判错了站" } });
    fireEvent.change(select, { target: { value: "EIGHTEEN_HELLS" } });
    expect(screen.queryByLabelText(/往回挪的理由/)).toBeNull();
    fireEvent.click(confirm());
    await waitFor(() => expect(mockMove).toHaveBeenCalledWith("s1", "EIGHTEEN_HELLS", undefined));
  });

  it.each([
    ["reason_required", "往回挪要写理由。"],
    ["soul_settled", "这个灵魂已经结案，不在路上了。"],
  ])("后端拒绝 %s:提示它自己那句,不是「出错了」", async (code, message) => {
    mockMove.mockRejectedValue({ response: { status: code === "reason_required" ? 400 : 409, data: { code } } });
    await open();
    fireEvent.click(confirm());
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(message, "error"));
    expect(mockShowToast).toHaveBeenCalledTimes(1);
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
    expect(describeSystemEvent(event("DIYU_STATION_CHANGED", { from: "FENGDU_CITY", to: "TUDI_TEMPLE", via: "officer", reason: "" }), labels))
      .toBe("十三站换站 · 土地庙");
  });

  it("往回挪写了理由:理由原样跟在去处后面", () => {
    expect(describeSystemEvent(
      event("DIYU_STATION_CHANGED", { from: "FENGDU_CITY", to: "TUDI_TEMPLE", via: "officer", reason: "判错了站" }), labels))
      .toBe("十三站换站 · 土地庙 · 判错了站");
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
