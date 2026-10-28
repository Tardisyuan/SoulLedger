/**
 * 地府:出身部洲在身份栏一行;十三站是页头下的行程条(Design 第五十七批 S-1 / S-1b)。
 * 只地府画;不在路上只一行灰字;没有 `soul.transition` 不给挪站;挪站在弹层里,发对的请求。
 * 时间线一行:换站写去处,勾魂写鬼差与城隍;升天堂经地上乐园写一行小字(E-3)。
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Soul, SoulEvent } from "@soulledger/core/api";
import { tZh } from "./support/zhBundle";

const mockShowToast = jest.fn();
const mockMove = jest.fn();

jest.mock("@/src/contexts/I18nContext", () => ({
  ...jest.requireActual("@/src/contexts/I18nContext"),
  useI18n: () => ({ t: tZh, tf: (_k: string, f: string) => f, locale: "zh-Hans", hydrated: true }),
}));
jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
jest.mock("@soulledger/core/api", () => ({
  ...jest.requireActual("@soulledger/core/api"),
  soulsApi: { moveStation: (...args: unknown[]) => mockMove(...args) },
}));

import { DiyuRows, DiyuStationStrip } from "@/src/components/souls/detail/DiyuRows";
import { describeSystemEvent, makeSystemEventLabels, buildSystemRows } from "@/src/components/souls/soulLifecycleRows";

const SOUL = {
  id: "s1",
  name: "张三",
  civilization: "CHINESE",
  current_state: "JUDGING",
  diyu_station: "WANGXIANG_TERRACE",
  birth_continent: "NANZHAN",
} as unknown as Soul;

function rows(soul: Partial<Soul>) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <dl>
        <DiyuRows soul={{ ...SOUL, ...soul } as Soul} />
      </dl>
    </QueryClientProvider>
  );
}

function strip(soul: Partial<Soul>, canMove = false) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <DiyuStationStrip soul={{ ...SOUL, ...soul } as Soul} canMove={canMove} />
    </QueryClientProvider>
  );
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
  it("13 站等宽:已过 ■、当前 ▪、未到 □;右上第 n / 13 站 · 站名;不写原值", () => {
    strip({});
    const states = Array.from(document.querySelectorAll("[data-station]")).map((li) => li.getAttribute("data-state"));
    expect(states).toEqual(["passed", "passed", "current", ...Array(10).fill("ahead")]);
    const cells = Array.from(document.querySelectorAll("[data-station]")).map((li) => li.textContent?.charAt(0));
    expect(cells.slice(0, 4)).toEqual(["■", "■", "▪", "□"]);
    expect(screen.getByTestId("soul-diyu-station-now")).toHaveTextContent("第 3 / 13 站 · 望乡台");
    expect(screen.getByTestId("soul-diyu-station")).not.toHaveTextContent("WANGXIANG_TERRACE");
    // 每站悬浮都有站名;窄屏只写当前站名(其余的名字在 xl 以下藏起)。
    expect(document.querySelector('[data-station="EIGHTEEN_HELLS"]')).toHaveAttribute("title", "十八层地狱");
    expect(document.querySelector('[data-station="WANGXIANG_TERRACE"]')).toHaveAttribute("aria-current", "step");
    expect(screen.queryByTestId("soul-diyu-station-move")).toBeNull();
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
    await waitFor(() => expect(mockMove).toHaveBeenCalledWith("s1", "EIGHTEEN_HELLS"));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith("已挪到十八层地狱", "success"));
  });
});

describe("时间线一行", () => {
  const labels = makeSystemEventLabels(tZh);
  const event = (event_type: string, payload: Record<string, unknown>) =>
    ({ event_type, payload } as unknown as SoulEvent);

  it("换站写去处", () => {
    expect(describeSystemEvent(event("DIYU_STATION_CHANGED", { from: "", to: "TUDI_TEMPLE", via: "death" }), labels))
      .toBe("十三站换站 · 土地庙");
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
    expect(via.title).toBe("出炼狱，升天堂");
    expect(via.note).toBe("经地上乐园 · 饮忘川、忆善河");
    expect(buildSystemRows([ascended("")], labels)[0].note).toBeUndefined();
    expect(buildSystemRows([{ ...ascended("X"), event_type: "STATE_CHANGED" } as SoulEvent], labels)[0].note).toBeUndefined();
  });
});
