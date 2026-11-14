/**
 * 滑卡审判(v4 S09 / S10):三个圆钮的路径。拖动本身 jest 看不见(CLAUDE.md:按住 / 滑动手势要上模拟器),
 * 这里验的是按钮发出去的东西、被天平挡住的方向、「不过」没选理由时不能落印、待定要理由。
 */
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { AccessibilityInfo, Animated, AppState, StyleSheet, type AppStateStatus } from "react-native";

import { PASS_UNDO_MS, SwipeScreen } from "../screens/swipe";
import { sealReadbackWished, setSealReadbackWished } from "../prefs";
import { READBACK_BUTTON_H, READBACK_SEAL_FLEX } from "../screens/rejectSheet";
import { ToastProvider } from "../shared";
import { renderOfficer } from "./harness";

const mockList = jest.fn();
const mockCounts = jest.fn();
const mockGet = jest.fn();
const mockConclude = jest.fn();
const mockDefer = jest.fn();
jest.mock("@soulledger/core/api/judgment", () => ({
  ...jest.requireActual("@soulledger/core/api/judgment"),
  judgmentApi: {
    list: (...a: unknown[]) => mockList(...a),
    queueCounts: () => mockCounts(),
    get: (...a: unknown[]) => mockGet(...a),
    conclude: (...a: unknown[]) => mockConclude(...a),
    defer: (...a: unknown[]) => mockDefer(...a),
    undefer: jest.fn(async () => ({})),
    negativeConfessions: jest.fn(async () => ({ items: [] })),
  },
}));

const CASE = {
  id: "j-1",
  case_number: "DY-2026-0412",
  soul: "s-1",
  soul_name: "李青竹",
  civilization: "CHINESE",
  created_at: "2026-11-01T00:00:00Z",
  merit_score: 42,
  demerit_score: 18,
  deadline_remaining_seconds: 86_400 * 3,
  conclude_refusal: "",
  admitted_balance: {},
};

function serve(c: Record<string, unknown> = CASE) {
  mockList.mockResolvedValue({ data: { results: [c], count: 1 } });
  mockCounts.mockResolvedValue({ data: { mine: 1, unclaimed: 0, others: 0, deferred: 0, total: 1 } });
  mockGet.mockResolvedValue({ data: c });
  mockConclude.mockResolvedValue({ data: {} });
  mockDefer.mockResolvedValue({ data: {} });
}

beforeEach(() => jest.clearAllMocks());

/**
 * 落印成功后卡片先飞出(Animated.timing,约 200ms),动画结束才从卡堆里拿掉并重取列表与计数。
 * 等到卡片没了、空状态出来,再把重取的那两个请求冲掉 —— 否则动画的更新落在测试之后(act 警告,jest.setup.js 判红)。
 */
async function settled() {
  await waitFor(() => expect(screen.queryByTestId("swipe-card-j-1")).toBeNull());
  expect(await screen.findByTestId("swipe-empty")).toBeTruthy();
  await act(async () => {});
}

const PENDING = "已通过 · 3 秒后落印。判下一件、离开或切到后台即刻落印";
const tick = (ms: number) => act(async () => void jest.advanceTimersByTime(ms));
const enabled = (id: string) => waitFor(() => expect(screen.getByTestId(id).props.accessibilityState.disabled).toBe(false));

describe("通过:3 秒撤回,到点才发(用户 2026-11-14)", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it.each([false, true])("3 秒内不发,到了才发,只带裁决;读屏念出撤回(减少动态效果 %s 时同样 3 秒)", async (reduced) => {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(reduced);
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
    serve();
    renderOfficer(<SwipeScreen onBack={() => {}} />);
    expect(await screen.findByText("42/18")).toBeTruthy();
    await enabled("swipe-pass");
    await act(async () => fireEvent.press(screen.getByTestId("swipe-pass")));
    expect(await screen.findByTestId("swipe-pass-undo")).toHaveTextContent(PENDING, { exact: false });
    expect(announce).toHaveBeenCalledWith(PENDING);
    await tick(PASS_UNDO_MS - 100);
    expect(mockConclude).not.toHaveBeenCalled();
    await tick(100);
    expect(mockConclude).toHaveBeenCalledWith("j-1", { verdict: "PASSED" });
    await settled();
    expect(screen.queryByTestId("swipe-pass-undo")).toBeNull();
  });

  it("3 秒内撤回:什么都没发,卡片回来,还能再判", async () => {
    serve();
    renderOfficer(<SwipeScreen onBack={() => {}} />);
    await enabled("swipe-pass");
    await act(async () => fireEvent.press(screen.getByTestId("swipe-pass")));
    await tick(1000);
    const button = screen.getByTestId("swipe-pass-undo-button");
    expect(button.props.accessibilityRole ?? button.props.role).toBe("button");
    await act(async () => fireEvent.press(button));
    await tick(PASS_UNDO_MS * 3);
    expect(mockConclude).not.toHaveBeenCalled();
    expect(screen.queryByTestId("swipe-pass-undo")).toBeNull();
    expect(screen.getByTestId("swipe-card-j-1")).toBeTruthy();
    await enabled("swipe-pass");
  });

  it("判下一张:等着撤回的那一件立即发,下一张再等它自己的 3 秒", async () => {
    const second = { ...CASE, id: "j-2", case_number: "DY-2026-0413", soul_name: "王小二" };
    mockList.mockResolvedValue({ data: { results: [CASE, second], count: 2 } });
    mockCounts.mockResolvedValue({ data: { mine: 2, unclaimed: 0, others: 0, deferred: 0, total: 2 } });
    mockGet.mockImplementation(async (id: string) => ({ data: id === "j-2" ? second : CASE }));
    mockConclude.mockResolvedValue({ data: {} });
    renderOfficer(<SwipeScreen onBack={() => {}} />);
    await enabled("swipe-pass");
    await act(async () => fireEvent.press(screen.getByTestId("swipe-pass")));
    await tick(500); // 飞完,下一张顶上来
    expect(await screen.findByTestId("swipe-card-j-2")).toBeTruthy();
    await enabled("swipe-pass");
    expect(mockConclude).not.toHaveBeenCalled();
    await act(async () => fireEvent.press(screen.getByTestId("swipe-pass")));
    expect(mockConclude).toHaveBeenCalledWith("j-1", { verdict: "PASSED" });
    expect(mockConclude).toHaveBeenCalledTimes(1);
    await tick(PASS_UNDO_MS);
    expect(mockConclude).toHaveBeenLastCalledWith("j-2", { verdict: "PASSED" });
    await tick(500);
  });

  it("离开这一页、切到后台:立即发", async () => {
    serve();
    const view = renderOfficer(<SwipeScreen onBack={() => {}} />);
    await enabled("swipe-pass");
    await act(async () => fireEvent.press(screen.getByTestId("swipe-pass")));
    await tick(500);
    view.unmount();
    await act(async () => {});
    expect(mockConclude).toHaveBeenCalledWith("j-1", { verdict: "PASSED" });

    mockConclude.mockClear();
    // 只记下调用,照常订阅(不换实现:它若本身是 jest.fn,换掉的实现会留到后面的测试)。
    const subscribe = jest.spyOn(AppState, "addEventListener");
    renderOfficer(<SwipeScreen onBack={() => {}} />);
    await enabled("swipe-pass");
    await act(async () => fireEvent.press(screen.getByTestId("swipe-pass")));
    await tick(500);
    expect(mockConclude).not.toHaveBeenCalled();
    const listeners = subscribe.mock.calls.filter(([type]) => type === "change").map(([, fn]) => fn as (s: AppStateStatus) => void);
    expect(listeners.length).toBeGreaterThan(0);
    await act(async () => listeners.forEach((fn) => fn("background")));
    expect(mockConclude).toHaveBeenCalledWith("j-1", { verdict: "PASSED" });
    await settled();
  });

  it("前一次被拒留下的提示,这一次落印时撤下(DECISION_TOAST)", async () => {
    serve();
    mockConclude.mockRejectedValueOnce(new Error("offline"));
    renderOfficer(
      <ToastProvider>
        <SwipeScreen onBack={() => {}} />
      </ToastProvider>
    );
    await enabled("swipe-pass");
    await act(async () => fireEvent.press(screen.getByTestId("swipe-pass")));
    await tick(PASS_UNDO_MS);
    expect(await screen.findByTestId("toast")).toBeTruthy();
    await tick(2000); // 弹回
    await enabled("swipe-pass");
    await act(async () => fireEvent.press(screen.getByTestId("swipe-pass")));
    await tick(PASS_UNDO_MS);
    expect(mockConclude).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.queryByTestId("toast")).toBeNull());
    await settled();
  });
});

it("左边圆钮:先选理由;没选时「不过 · 落印」是灰的,选了才发,带罪目", async () => {
  serve();
  renderOfficer(<SwipeScreen onBack={() => {}} />);
  await waitFor(() => expect(screen.getByTestId("swipe-fail").props.accessibilityState.disabled).toBe(false));
  fireEvent.press(screen.getByTestId("swipe-fail"));
  expect(screen.getByTestId("reject-confirm").props.accessibilityState.disabled).toBe(true);
  fireEvent.press(screen.getByTestId("reject-TRADE_FRAUD"));
  expect(screen.getByTestId("reject-preview")).toBeTruthy();
  await act(async () => fireEvent.press(screen.getByTestId("reject-confirm")));
  await waitFor(() =>
    expect(mockConclude).toHaveBeenCalledWith("j-1", { verdict: "FAILED", fail_reasons: ["TRADE_FRAUD"], fail_reason_note: "" })
  );
  await settled();
});

it("埃及:天平判了通过,左边圆钮不可点", async () => {
  serve({ ...CASE, civilization: "EGYPTIAN", admitted_balance: { weighing: { weighed_verdict: "PASSED" } } });
  renderOfficer(<SwipeScreen onBack={() => {}} />);
  await waitFor(() => expect(screen.getByTestId("swipe-pass").props.accessibilityState.disabled).toBe(false));
  expect(screen.getByTestId("swipe-fail").props.accessibilityState.disabled).toBe(true);
});

it("欧洲:七宗罪不上卡面(用户 2026-11-07,只在炼狱判决里列)", async () => {
  serve({ ...CASE, civilization: "EUROPEAN", cited_deadly_sins: ["pride", "wrath"] });
  renderOfficer(<SwipeScreen onBack={() => {}} />);
  expect(await screen.findByText("李青竹")).toBeTruthy();
  await waitFor(() => expect(mockGet).toHaveBeenCalledWith("j-1"));
  await act(async () => {});
  expect(screen.queryByText(/七宗罪/)).toBeNull();
  expect(screen.queryByText(/傲慢|愤怒/)).toBeNull();
});

it("按住待定:松手后要写理由,空着不发", async () => {
  serve();
  renderOfficer(<SwipeScreen onBack={() => {}} />);
  await waitFor(() => expect(screen.getByTestId("swipe-hold").props.accessibilityState.disabled).toBe(false));
  const hold = screen.getByTestId("swipe-hold");
  fireEvent(hold, "pressIn");
  fireEvent(hold, "longPress");
  fireEvent(hold, "pressOut");
  const sheet = await screen.findByTestId("swipe-defer-sheet");
  expect(sheet).toBeTruthy();
  fireEvent.press(screen.getByTestId("judgment-sheet-confirm"));
  expect(mockDefer).not.toHaveBeenCalled();
  fireEvent.changeText(screen.getByTestId("judgment-reason"), "等证据");
  await act(async () => fireEvent.press(screen.getByTestId("judgment-sheet-confirm")));
  await waitFor(() => expect(mockDefer).toHaveBeenCalledWith("j-1", "等证据"));
  expect(await screen.findByTestId("swipe-undo")).toBeTruthy();
});

it("手上没有能判的:空状态", async () => {
  serve({ ...CASE, conclude_refusal: "at_city_god" });
  renderOfficer(<SwipeScreen onBack={() => {}} />);
  expect(await screen.findByTestId("swipe-empty")).toBeTruthy();
});

describe("落印失败时卡片回原位", () => {
  afterEach(() => jest.restoreAllMocks());
  const failOnce = async (reduced: boolean) => {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(reduced);
    // 弹回的 spring 要跑一秒多,每一帧都更新 Animated(View):记下它何时停,等它停了才结束测试(否则 act 警告)。
    const realSpring = Animated.spring;
    const springsDone: Promise<void>[] = [];
    const spring = jest.spyOn(Animated, "spring").mockImplementation((value, config) => {
      const anim = realSpring(value, config);
      const start: typeof anim.start = (cb) => {
        springsDone.push(
          new Promise<void>((done) =>
            anim.start((r) => {
              cb?.(r);
              done();
            })
          )
        );
      };
      return { ...anim, start };
    });
    serve();
    mockConclude.mockRejectedValue(new Error("offline"));
    renderOfficer(<SwipeScreen onBack={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("swipe-pass").props.accessibilityState.disabled).toBe(false));
    await act(async () => fireEvent.press(screen.getByTestId("swipe-pass")));
    // 通过要等 3 秒撤回窗口才发。
    await act(async () => void (await new Promise((r) => setTimeout(r, PASS_UNDO_MS))));
    await waitFor(() => expect(mockConclude).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId("swipe-pass").props.accessibilityState.disabled).toBe(false));
    // 拒绝早于飞出(200ms)结束:旧 pan 被 detach、飞出以 finished=false 收尾,不能再把弹回来的卡拿走
    // (flyOut 里不看 `finished` 就会拿走 —— 这条断言守的是那一处)。
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
      await Promise.all(springsDone);
    });
    expect(screen.getByTestId("swipe-card-j-1")).toBeTruthy();
    return spring;
  };
  it("平常:弹回去(spring)", async () => {
    expect(await failOnce(false)).toHaveBeenCalled();
  });
  it("减少动态效果:直接回原位，不弹 —— spring 没有 duration,`ms()` 管不到它", async () => {
    expect(await failOnce(true)).not.toHaveBeenCalled();
  });
});

describe("落印前先确认(用户 2026-11-14,WCAG 2.2.1 的「可关」):通过先回读,不计时", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    setSealReadbackWished(true);
  });
  afterEach(() => {
    setSealReadbackWished(false);
    jest.useRealTimers();
  });

  it("默认关:开关是设备上的一个值,关着时不在 persistent 里留东西", () => {
    setSealReadbackWished(false);
    expect(sealReadbackWished()).toBe(false);
    setSealReadbackWished(true);
    expect(sealReadbackWished()).toBe(true);
  });

  it("回读人名、案号、判决;没按「落印」什么都不发,也没有 3 秒撤回条;按了当场发", async () => {
    serve();
    renderOfficer(<SwipeScreen onBack={() => {}} />);
    await enabled("swipe-pass");
    await act(async () => fireEvent.press(screen.getByTestId("swipe-pass")));
    expect(await screen.findByTestId("swipe-readback-sheet")).toBeTruthy();
    expect(screen.getByTestId("readback-name")).toHaveTextContent("李青竹");
    expect(screen.getByTestId("readback-case")).toHaveTextContent("DY-2026-0412");
    expect(screen.getByTestId("readback-verdict")).toHaveTextContent("通过");
    // 没有计时:等多久都不发,撤回条不出现。
    await tick(PASS_UNDO_MS * 3);
    expect(mockConclude).not.toHaveBeenCalled();
    expect(screen.queryByTestId("swipe-pass-undo")).toBeNull();
    await act(async () => fireEvent.press(screen.getByTestId("readback-confirm")));
    await waitFor(() => expect(mockConclude).toHaveBeenCalledWith("j-1", { verdict: "PASSED" }));
    // Absence: 落印之后也没有 3 秒窗口。
    expect(screen.queryByTestId("swipe-pass-undo")).toBeNull();
    await settled();
  });

  it("第四十六批第 8 条:三行同网页的字号;「返回 / 落印」并排,返回在前,落印宽 1.4 倍,两键高 52", async () => {
    serve();
    renderOfficer(<SwipeScreen onBack={() => {}} />);
    await enabled("swipe-pass");
    await act(async () => fireEvent.press(screen.getByTestId("swipe-pass")));
    await screen.findByTestId("swipe-readback-sheet");
    const flat = (id: string) => StyleSheet.flatten(screen.getByTestId(id).props.style);
    expect(flat("readback-name")).toMatchObject({ fontSize: 18 });
    expect(flat("readback-case")).toMatchObject({ fontSize: 16 });
    expect(flat("readback-verdict")).toMatchObject({ fontSize: 20 });
    expect(READBACK_SEAL_FLEX).toBe(1.4);
    expect(READBACK_BUTTON_H).toBe(52);
    expect(flat("readback-confirm")).toMatchObject({ flex: 1.4, minHeight: 52 });
    expect(flat("readback-cancel")).toMatchObject({ flex: 1, minHeight: 52 });
    // 「返回」,不是「取消」;排在「落印」前面(右边是落印)。
    expect(screen.getByTestId("readback-cancel")).toHaveTextContent("返回");
    expect(screen.getByTestId("readback-cancel")).not.toHaveTextContent("取消");
    const order = screen.root.findAll((n) => n.props.testID === "readback-cancel" || n.props.testID === "readback-confirm").map((n) => n.props.testID);
    expect(order.indexOf("readback-cancel")).toBeLessThan(order.indexOf("readback-confirm"));
    await settled();
  });

  it("回读层上取消:不发,卡片回原位,还能再判", async () => {
    serve();
    renderOfficer(<SwipeScreen onBack={() => {}} />);
    await enabled("swipe-pass");
    await act(async () => fireEvent.press(screen.getByTestId("swipe-pass")));
    await act(async () => fireEvent.press(await screen.findByTestId("readback-cancel")));
    await tick(PASS_UNDO_MS * 3);
    expect(mockConclude).not.toHaveBeenCalled();
    expect(screen.getByTestId("swipe-card-j-1")).toBeTruthy();
    await enabled("swipe-pass");
  });
});
