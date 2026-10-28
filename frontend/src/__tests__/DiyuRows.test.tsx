/**
 * 地府的两行(2026-10-28):十三站(docs/06 §一)与出身部洲(docs/07 §人道)在灵魂详情身份栏里。
 * 只地府画;在世的不画十三站;没有 `soul.transition` 不给挪站;挪站发对的请求。
 * 时间线一行:换站写去处,勾魂写鬼差与城隍。
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

import { DiyuRows } from "@/src/components/souls/detail/DiyuRows";
import { describeSystemEvent, makeSystemEventLabels } from "@/src/components/souls/soulLifecycleRows";

const SOUL = {
  id: "s1",
  name: "张三",
  civilization: "CHINESE",
  current_state: "JUDGING",
  diyu_station: "WANGXIANG_TERRACE",
  birth_continent: "NANZHAN",
} as unknown as Soul;

function rows(soul: Partial<Soul>, canMove = false) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <dl>
        <DiyuRows soul={{ ...SOUL, ...soul } as Soul} canMove={canMove} />
      </dl>
    </QueryClientProvider>
  );
}

describe("DiyuRows", () => {
  it("写站名与第几站、部洲的词,不写原值", () => {
    rows({});
    const station = screen.getByTestId("soul-diyu-station");
    expect(station).toHaveTextContent("望乡台");
    expect(station).toHaveTextContent("第 3 / 13 站");
    expect(station).not.toHaveTextContent("WANGXIANG_TERRACE");
    expect(screen.getByTestId("soul-birth-continent")).toHaveTextContent("南瞻部洲");
    expect(screen.queryByTestId("soul-diyu-station-move")).toBeNull();
  });

  it("在世的不画十三站;部洲没登记写不详", () => {
    rows({ current_state: "ALIVE", diyu_station: "", birth_continent: "" } as Partial<Soul>);
    expect(screen.queryByTestId("soul-diyu-station")).toBeNull();
    expect(screen.getByTestId("soul-birth-continent")).toHaveTextContent("不详");
  });

  it("别的文明两行都不画", () => {
    rows({ civilization: "EUROPEAN" } as Partial<Soul>);
    expect(screen.queryByTestId("soul-diyu-station")).toBeNull();
    expect(screen.queryByTestId("soul-birth-continent")).toBeNull();
  });

  it("持 soul.transition 能挪站,发的是选中的那一站", async () => {
    mockMove.mockResolvedValue({ data: {} });
    rows({}, true);
    fireEvent.change(screen.getByLabelText("挪到"), { target: { value: "EIGHTEEN_HELLS" } });
    fireEvent.click(screen.getByRole("button", { name: "挪站" }));
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
});
