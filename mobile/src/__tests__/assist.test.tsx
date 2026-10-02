/**
 * 「问一问」 (canvas「灵魂簿 App · 问一问」 1a–1j, and「问一问 · 流式输出」) against
 * core's real soul client with a scripted transport (./stubApi). Questions stream
 * through `expo/fetch`, replaced here by a fake whose body the test writes event
 * by event; core's real `streamAssist` reads it (parser, timers, abort). The
 * drawer is rendered with the real `AssistProvider` and the real `AppHeader`; one
 * test boots the whole app to check the entry follows `/me/`'s `assistant_enabled`.
 */
import { ASSIST_EMPTY_ANSWER } from "@soulledger/core/api/soul-assist";
import { LOCALE_COOKIE } from "@soulledger/core/config/locale";
import { REFRESH_TOKEN_KEY } from "@soulledger/core/platform";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, render, screen, within } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import fs from "fs";
import path from "path";

import { AssistProvider, assistAckKey } from "../assist";
import { AssistPanel } from "../assistPanel";
import { AppHeader } from "../chrome";
import { I18nProvider } from "../i18n";
import { RootNavigator } from "../navigation";
import { installMobilePlatform, persistentStore } from "../platform";
import { SessionProvider } from "../session";
import { PROFILE, heldReply, life, stubApi } from "./stubApi";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AccessibilityInfo, StyleSheet } from "react-native";
import { motion, themeFor, v3, type Theme } from "../theme";
import { ThemeContext } from "../ui";

/** Wait out the drawer's 200ms exit (v3 MotionSpec 问一问抽屉 出场). */
const afterExit = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, motion.drawerOut + 50));
  });

type StreamEvent = Record<string, unknown> & { event: string };
interface Ask {
  body: Record<string, unknown>;
  send: (..._events: StreamEvent[]) => void;
  close: () => void;
  aborted: () => boolean;
}
type Script = (_ask: Ask) => { status: number; data: Record<string, string> } | void;
let asks: Ask[] = [];
let scripts: Script[] = [];
const frame = (e: StreamEvent) => `event: ${e.event}\ndata: ${JSON.stringify(e)}\n\n`;

jest.mock("expo/fetch", () => ({
  fetch: (url: string, init: { body: string; signal: { addEventListener: (_t: string, _f: () => void) => void } }) => mockStreamFetch(url, init),
}));
/** `expo/fetch` in a test: each ask runs the next script (reply / refuse / nothing yet); abort rejects the read. */
async function mockStreamFetch(_url: string, init: { body: string; signal: { addEventListener: (_t: string, _f: () => void) => void } }) {
  const queue: (string | null)[] = [];
  let wake: (() => void) | null = null;
  let aborted = false;
  init.signal.addEventListener("abort", () => {
    aborted = true;
    wake?.();
  });
  const ask: Ask = {
    body: JSON.parse(init.body),
    send: (...events) => {
      queue.push(events.map(frame).join(""));
      wake?.();
    },
    close: () => {
      queue.push(null);
      wake?.();
    },
    aborted: () => aborted,
  };
  asks.push(ask);
  const refused = scripts.shift()?.(ask);
  if (refused) return { ok: false, status: refused.status, json: async () => refused.data, body: null };
  const read = async (): Promise<{ done: boolean; value?: Uint8Array }> => {
    while (!queue.length && !aborted) await new Promise<void>((r) => (wake = r));
    if (aborted) throw new Error("AbortError");
    const next = queue.shift()!;
    return next === null ? { done: true } : { done: false, value: new TextEncoder().encode(next) };
  };
  return { ok: true, status: 200, json: async () => ({}), body: { getReader: () => ({ read }) } };
}

const CONVERSATION = "11111111-1111-1111-1111-111111111111";
let answerId = 2;
const done = (content: string): StreamEvent => ({
  event: "done",
  conversation_id: CONVERSATION,
  answer: { id: (answerId += 1), role: "assistant", content, interruption: "", created_at: "2026-09-28T06:02:00Z" },
  usage: { input_tokens: 1, output_tokens: 1, cache_read_tokens: 0 },
});
const reply = (content: string): Script => (ask) => ask.send({ event: "meta", conversation_id: CONVERSATION }, { event: "delta", text: content }, done(content));
const refuse = (status: number, data: Record<string, string>): Script => () => ({ status, data });
/** The answer's whole text, as the block reads it to assistive tech. */
const answerText = () => screen.getByTestId("assist-answer-text").props.accessibilityLabel as string;

const ENABLED = { ...PROFILE, assistant_enabled: true } as never;
const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const LIST = "GET /me/assist/conversations/";
const openLetters = jest.fn();

/** The theme the next drawer renders under; null keeps the app's default (neutral). */
let drawerTheme: Theme | null = null;

function renderDrawer(profile = ENABLED) {
  const drawer = (
    <SafeAreaProvider initialMetrics={METRICS}>
      <I18nProvider>
        <AssistProvider profile={profile} onOpenLetters={openLetters}>
          <AppHeader title="转生申请" assist="applications" onAccount={() => {}} />
          <AssistPanel />
        </AssistProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
  return render(drawerTheme ? <ThemeContext.Provider value={drawerTheme}>{drawer}</ThemeContext.Provider> : drawer);
}

const conversation = (id: string, first_question: string) => ({
  id,
  screen: "sentence",
  created_at: "2026-09-24T13:40:00Z",
  last_active_at: "2026-09-24T13:40:00Z",
  first_question,
  messages: [{ id: 1, role: "user", content: first_question, created_at: "2026-09-24T13:40:00Z" }],
});

async function openAndAsk(script: Script | null, question = "我为什么不能申请？") {
  stubApi({ [LIST]: { status: 200, data: [] } });
  if (script) scripts.push(script);
  renderDrawer();
  fireEvent.press(screen.getByTestId("assist-entry"));
  await screen.findByTestId("assist-empty");
  await act(async () => {
    fireEvent.press(screen.getByText(question));
  });
  return asks[asks.length - 1];
}

const hhmm = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

beforeEach(async () => {
  installMobilePlatform();
  await AsyncStorage.clear();
  persistentStore.remove(LOCALE_COOKIE);
  // The first-use notice is its own test; everywhere else it has been seen.
  persistentStore.set(assistAckKey(PROFILE as never), "1");
  openLetters.mockReset();
  asks = [];
  scripts = [];
});

describe("the entry", () => {
  const secure = (SecureStore as unknown as { __store: Map<string, string> }).__store;
  const boot = async (enabled: boolean) => {
    secure.set(REFRESH_TOKEN_KEY, "R");
    const me = heldReply();
    stubApi({ "/me/": me.reply, "/me/life/": { status: 200, data: life(1) } });
    render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <I18nProvider>
          <SessionProvider>
            <RootNavigator />
          </SessionProvider>
        </I18nProvider>
      </SafeAreaProvider>
    );
    await act(async () => me.answer({ status: 200, data: { ...PROFILE, assistant_enabled: enabled } }));
    await screen.findByTestId("profile-card");
  };
  afterEach(() => secure.clear());

  it("is not rendered at all when /me/ says assistant_enabled: false (1a 三)", async () => {
    await boot(false);
    expect(screen.getByTestId("header-account")).toBeTruthy();
    expect(screen.queryByTestId("assist-entry")).toBeNull();
  });

  it("on the life tab (v3) it is a 48pt circle in the civilization's colour over the page, not in the band", async () => {
    await boot(true);
    const band = screen.getByTestId("plaque");
    const ids = (band as unknown as { findAll: (p: (n: { props: { testID?: unknown } }) => boolean) => { props: { testID: string } }[] })
      .findAll((n) => n.props.testID === "assist-entry" || n.props.testID === "header-account")
      .map((n) => n.props.testID);
    expect([...new Set(ids)]).toEqual(["header-account"]);
    const entry = StyleSheet.flatten(screen.getByTestId("assist-entry").props.style);
    expect(entry).toMatchObject({ position: "absolute", width: 48, height: 48, backgroundColor: v3.civ.cn.light });
    await act(async () => fireEvent.press(screen.getByTestId("assist-entry")));
    expect(screen.getByTestId("assist-panel")).toBeTruthy();
  });
});

describe("the four notices (1g)", () => {
  it("① 503 assistant_not_configured: the notice, and the entry is gone once the drawer closes", async () => {
    await openAndAsk(refuse(503, { detail: "x", code: "assistant_not_configured" }));
    expect(screen.getByTestId("assist-not-configured")).toBeTruthy();
    fireEvent.press(screen.getByTestId("assist-letters"));
    expect(openLetters).toHaveBeenCalledTimes(1);
    // v3 出场: closed, the drawer sinks for 200ms (taking no touches), then it is gone.
    await afterExit();
    expect(screen.queryByTestId("assist-panel")).toBeNull();
    expect(screen.queryByTestId("assist-entry")).toBeNull();
  });

  it("② 429 rate_limited: says when from retry_at, keeps the question, and shows no count", async () => {
    const retryAt = "2026-09-28T07:02:00Z";
    await openAndAsk(refuse(429, { detail: "x", code: "rate_limited", retry_at: retryAt }));
    const body = screen.getByTestId("assist-limited-body").props.children as string;
    expect(body).toContain(hhmm(retryAt));
    expect(body).not.toMatch(/\d+\s*\/\s*\d+/);
    expect(screen.getByTestId("assist-input").props.value).toBe("我为什么不能申请？");
    expect(screen.queryByTestId("assist-answer")).toBeNull();
  });

  it("③ 503 assistant_unavailable: 未答, the question kept, retry sends it again", async () => {
    scripts.push(refuse(503, { detail: "x", code: "assistant_unavailable" }));
    await openAndAsk(reply("你已有一份申请正在审批。"));
    const unanswered = screen.getByTestId("assist-unanswered");
    expect(within(unanswered).getByText("我为什么不能申请？")).toBeTruthy();
    expect(screen.getByTestId("assist-input").props.value).toBe("我为什么不能申请？");
    await act(async () => {
      fireEvent.press(screen.getByTestId("assist-retry"));
    });
    expect(asks.map((a) => a.body.question)).toEqual(["我为什么不能申请？", "我为什么不能申请？"]);
    expect(answerText()).toBe("你已有一份申请正在审批。");
    expect(screen.queryByTestId("assist-unanswered")).toBeNull();
  });

  it("④ the server's fixed empty answer shows the letters card; an ordinary answer does not", async () => {
    await openAndAsk(reply(ASSIST_EMPTY_ANSWER["zh-Hans"]));
    expect(screen.getByTestId("assist-letters-card")).toBeTruthy();
    screen.unmount();

    await openAndAsk(reply("帮助文档里没有写,不知道。请写信给殿司。"));
    expect(screen.getByTestId("assist-answer")).toBeTruthy();
    expect(screen.queryByTestId("assist-letters-card")).toBeNull();
  });
});

describe("waiting (流式输出 A1)", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("dots and one line; at 20 s 「还在查……」 (no seconds); at 25 s with no text a timeout that keeps the question", async () => {
    const ask = await openAndAsk(null);
    expect(ask.body).toMatchObject({ question: "我为什么不能申请？", screen: "applications", stream: true });
    expect(screen.getByTestId("assist-dots", { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId("assist-waiting-text").props.children).toBe("正在查帮助文档与你的簿册");
    // The box stays open; the button is 「■ 停止」 (A5).
    expect(screen.getByTestId("assist-input").props.editable).not.toBe(false);
    expect(screen.getByTestId("assist-stop").props.accessibilityLabel).toBe("停止回答");
    expect(screen.queryByTestId("assist-send")).toBeNull();

    await act(async () => {
      jest.advanceTimersByTime(20_000);
    });
    expect(screen.getByTestId("assist-waiting-text").props.children).toBe("还在查……");
    await act(async () => {
      jest.advanceTimersByTime(5_000);
    });
    expect(ask.aborted()).toBe(true);
    expect(screen.queryByTestId("assist-waiting")).toBeNull();
    expect(within(screen.getByTestId("assist-unanswered")).getByText(/超过 25 秒/)).toBeTruthy();
    expect(screen.getByTestId("assist-input").props.value).toBe("我为什么不能申请？");
    expect(screen.getByTestId("assist-send")).toBeTruthy();
  });
});

describe("streaming (流式输出)", () => {
  const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
  beforeEach(() => announce.mockClear());

  it("A2/A10: text as it arrives, busy, with the ▍ cursor; done drops both and announces the whole answer", async () => {
    const ask = await openAndAsk(null);
    await act(async () => ask.send({ event: "meta", conversation_id: CONVERSATION }, { event: "delta", text: "你已有**一份**申请" }));
    const live = screen.getByTestId("assist-streaming");
    expect(live.props.accessibilityState).toEqual({ busy: true });
    expect(within(live).getByTestId("assist-cursor", { includeHiddenElements: true })).toBeTruthy();
    expect(within(live).getByText("一份").props.style).toEqual({ fontWeight: "600" });
    expect(announce).toHaveBeenLastCalledWith("正在回答");
    await act(async () => ask.send({ event: "delta", text: "正在审批。" }, done("你已有**一份**申请正在审批。")));
    expect(screen.queryByTestId("assist-streaming")).toBeNull();
    expect(screen.queryByTestId("assist-cursor", { includeHiddenElements: true })).toBeNull();
    expect(answerText()).toBe("你已有**一份**申请正在审批。");
    expect(announce).toHaveBeenLastCalledWith("你已有**一份**申请正在审批。");
    // Fragments were not announced one by one.
    expect(announce.mock.calls.map((c) => c[0])).toEqual(["正在查帮助文档与你的簿册", "正在回答", "你已有**一份**申请正在审批。"]);
  });

  it("A5/A6: stop keeps the text with 已停止 and no retry, even before the first text", async () => {
    const ask = await openAndAsk(null);
    await act(async () => ask.send({ event: "delta", text: "可以申诉" }));
    await act(async () => {
      fireEvent.press(screen.getByTestId("assist-stop"));
    });
    expect(ask.aborted()).toBe(true);
    expect(screen.getByTestId("assist-stopped").props.children).toBe("已停止");
    expect(answerText()).toBe("可以申诉");
    expect(screen.queryByTestId("assist-interrupted")).toBeNull();
    expect(screen.queryByTestId("assist-retry-interrupted")).toBeNull();
    expect(announce).toHaveBeenLastCalledWith("已停止 可以申诉");
  });

  it("A7: interrupted keeps the text, 「! 回答中断」 in the warning colour, and 重试 re-asks and replaces it", async () => {
    const ask = await openAndAsk(null);
    await act(async () =>
      ask.send(
        { event: "meta", conversation_id: CONVERSATION },
        { event: "delta", text: "可以，" },
        { event: "error", kind: "interrupted", text_sent: true, detail: "x", conversation_id: CONVERSATION, message_id: 55 }
      )
    );
    const marker = screen.getByTestId("assist-interrupted");
    expect(within(marker).getByText("! 回答中断")).toBeTruthy();
    expect(marker.props.style).toEqual(expect.arrayContaining([expect.objectContaining({ borderColor: expect.any(String) })]));
    scripts.push(reply("可以，在三十天内。"));
    await act(async () => {
      fireEvent.press(screen.getByTestId("assist-retry-interrupted"));
    });
    expect(asks[1].body).toMatchObject({ question: "我为什么不能申请？", conversation_id: CONVERSATION });
    expect(answerText()).toBe("可以，在三十天内。");
    expect(screen.queryByTestId("assist-interrupted")).toBeNull();
    expect(screen.getAllByTestId("assist-question")).toHaveLength(1);
  });

  it("A9: a conversation opened from history keeps its markers but offers no retry", async () => {
    stubApi({
      [LIST]: {
        status: 200,
        data: [
          {
            ...conversation("c1", "能申诉吗？"),
            messages: [
              { id: 1, role: "user", content: "能申诉吗？", interruption: "", created_at: "2026-09-24T13:40:00Z" },
              { id: 2, role: "assistant", content: "可以，", interruption: "interrupted", created_at: "2026-09-24T13:40:00Z" },
              { id: 3, role: "user", content: "多久？", interruption: "", created_at: "2026-09-24T13:41:00Z" },
              { id: 4, role: "assistant", content: "三十", interruption: "stopped", created_at: "2026-09-24T13:41:00Z" },
            ],
          },
        ],
      },
    });
    renderDrawer();
    fireEvent.press(screen.getByTestId("assist-entry"));
    await screen.findByTestId("assist-empty");
    await act(async () => {
      fireEvent.press(screen.getByTestId("assist-history"));
    });
    await act(async () => {
      fireEvent.press(await screen.findByText("能申诉吗？"));
    });
    expect(screen.getByTestId("assist-interrupted")).toBeTruthy();
    expect(screen.getByTestId("assist-stopped")).toBeTruthy();
    expect(screen.queryByTestId("assist-retry-interrupted")).toBeNull();
  });

  it("A4: scrolled up while streaming shows 「↓ 最新」; pressing it follows again", async () => {
    const ask = await openAndAsk(null);
    await act(async () => ask.send({ event: "delta", text: "第一段" }));
    expect(screen.queryByTestId("assist-jump")).toBeNull();
    fireEvent.scroll(screen.getByTestId("assist-scroll"), {
      nativeEvent: { contentOffset: { y: 100 }, contentSize: { height: 1000, width: 390 }, layoutMeasurement: { height: 300, width: 390 } },
    });
    expect(screen.getByTestId("assist-jump")).toBeTruthy();
    fireEvent.press(screen.getByTestId("assist-jump"));
    expect(screen.queryByTestId("assist-jump")).toBeNull();
  });

  it.each([
    [false, "rises from below the screen"],
    [true, "is in place at once"],
  ])("v3 drawer: with reduce motion %s the sheet %s, over a scrim that fades with it", async (reduced) => {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(reduced);
    stubApi({ [LIST]: { status: 200, data: [] } });
    renderDrawer();
    await act(async () => {}); // the reduce-motion answer
    fireEvent.press(screen.getByTestId("assist-entry"));
    const y = () => (StyleSheet.flatten(screen.getByTestId("assist-sheet").props.style).transform as { translateY: number }[])[0].translateY;
    const shade = () => StyleSheet.flatten(screen.getByTestId("assist-scrim-shade", { includeHiddenElements: true }).props.style).opacity;
    if (reduced) expect([y(), shade()]).toEqual([0, 1]);
    else {
      expect(y()).toBeGreaterThan(0);
      expect(shade()).toBe(0);
    }
    // (The rise runs on the native driver, which jest does not play back: the end state is the device's.)
    await screen.findByTestId("assist-empty");
  });

  it.each([
    ["assist-close", false],
    ["assist-close", true],
  ])("v3 drawer exit: %s with reduce motion %s", async (closer, reduced) => {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(reduced);
    stubApi({ [LIST]: { status: 200, data: [] } });
    renderDrawer();
    await act(async () => {}); // the reduce-motion answer
    fireEvent.press(screen.getByTestId("assist-entry"));
    await screen.findByTestId("assist-empty");
    fireEvent.press(screen.getByTestId(closer));
    if (reduced) {
      expect(screen.queryByTestId("assist-panel")).toBeNull();
      return;
    }
    // Still there for the sink, but no longer taking touches…
    expect(screen.getByTestId("assist-panel")).toBeTruthy();
    expect(screen.getByTestId("assist-overlay").props.pointerEvents).toBe("none");
    // …and gone once the 200ms are up. (No mid-way check: under load a real 120ms wait can
    // overrun the 200ms timer — the immediate check above is what proves the drawer stayed.)
    await afterExit();
    expect(screen.queryByTestId("assist-panel")).toBeNull();
  });

  it("A11 reduced motion: no cursor, still dots, and a whole paragraph at a time", async () => {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
    const ask = await openAndAsk(null);
    const dots = screen.getByTestId("assist-dots", { includeHiddenElements: true }).props.children as { props: { style: { opacity: number }[] } }[];
    expect(dots.map((d) => d.props.style[1].opacity)).toEqual([1, 1, 1]);
    await act(async () => ask.send({ event: "delta", text: "第一段正在写" }));
    const live = screen.getByTestId("assist-streaming");
    expect(within(live).queryByText(/第一段/)).toBeNull();
    await act(async () => ask.send({ event: "delta", text: "完。\n\n第二段" }));
    expect(within(live).getByText("第一段正在写完。")).toBeTruthy();
    expect(within(live).queryByText(/第二段/)).toBeNull();
    expect(screen.queryByTestId("assist-cursor", { includeHiddenElements: true })).toBeNull();
  });
});

describe("the answer's language (1i)", () => {
  const withLocale = async (locale: string) => {
    persistentStore.set(LOCALE_COOKIE, locale);
    const q = locale === "zh-Hans" ? "我为什么不能申请？" : "Why can't I apply?";
    await openAndAsk(reply("You already have a rebirth application under review."), q);
  };

  it("egy: English answer, the dotted EN badge, and the block read as English", async () => {
    await withLocale("egy");
    expect(screen.getByTestId("assist-en")).toBeTruthy();
    expect(screen.getByTestId("assist-answer-text").props.accessibilityLanguage).toBe("en");
  });

  it.each(["en", "zh-Hans"])("%s: no EN badge", async (locale) => {
    await withLocale(locale);
    expect(screen.getByTestId("assist-answer")).toBeTruthy();
    expect(screen.queryByTestId("assist-en")).toBeNull();
  });
});

describe("the 答 glyph (v3)", () => {
  afterEach(() => {
    drawerTheme = null;
  });

  it("is ink, not the civilization's colour — streaming and answered alike", async () => {
    const t = (drawerTheme = themeFor("CHINESE", "light"));
    expect(t.ink).not.toBe(t.plaque);
    const answerGlyph = (id: string) =>
      StyleSheet.flatten(within(screen.getByTestId(id)).getByText("答", { includeHiddenElements: true }).props.style).color;
    const ask = await openAndAsk(null);
    await act(async () => ask.send({ event: "meta", conversation_id: CONVERSATION }, { event: "delta", text: "你已有一份申请" }));
    expect(answerGlyph("assist-streaming")).toBe(t.ink);
    await act(async () => ask.send(done("你已有一份申请。")));
    expect(answerGlyph("assist-answer")).toBe(t.ink);
  });
});

describe("history (1f)", () => {
  it("delete asks first, calls DELETE, and removes only that row", async () => {
    const calls = stubApi({
      [LIST]: { status: 200, data: [conversation("c1", "下一站什么时候开始？"), conversation("c2", "我的帖子为什么别人看不到？")] },
      "DELETE /me/assist/conversations/c1/": { status: 204 },
    });
    renderDrawer();
    fireEvent.press(screen.getByTestId("assist-entry"));
    await screen.findByTestId("assist-empty");
    await act(async () => {
      fireEvent.press(screen.getByTestId("assist-history"));
    });
    fireEvent.press(await screen.findByTestId("assist-delete-c1"));
    // The list footer states the retention rule (Design), not that something was already deleted.
    expect(screen.getByText("会话保存 30 天，期满自动删除。")).toBeTruthy();
    expect(screen.queryByText("更早的会话已按期删除。")).toBeNull();
    expect(screen.getByTestId("assist-delete-sheet")).toBeTruthy();
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    await act(async () => {
      fireEvent.press(screen.getByTestId("assist-delete-confirm"));
    });
    expect(calls.filter((c) => c.method === "DELETE").map((c) => c.url)).toEqual(["/me/assist/conversations/c1/"]);
    expect(screen.queryByTestId("assist-row-c1")).toBeNull();
    expect(screen.getByTestId("assist-row-c2")).toBeTruthy();
    expect(screen.queryByTestId("assist-delete-sheet")).toBeNull();
  });
});

describe("first use (1h)", () => {
  it("replaces the empty state once per account; the retention item makes no 'improve answers' claim", async () => {
    persistentStore.remove(assistAckKey(PROFILE as never));
    stubApi({ [LIST]: { status: 200, data: [] } });
    renderDrawer();
    fireEvent.press(screen.getByTestId("assist-entry"));
    const intro = await screen.findByTestId("assist-intro");
    expect(within(intro).getByText("提问保存 30 天")).toBeTruthy();
    expect(within(intro).queryByText(/改进/)).toBeNull();
    expect(screen.queryByTestId("assist-empty")).toBeNull();
    fireEvent.press(screen.getByTestId("assist-ack"));
    expect(screen.getByTestId("assist-empty")).toBeTruthy();
    expect(persistentStore.get(assistAckKey(PROFILE as never))).toBe("1");
  });
});

describe("drift against the backend (docs/ARCHITECTURE-soul-assist.md §5.3)", () => {
  const ROOT = path.join(__dirname, "..", "..", "..");
  const SRC = path.join(__dirname, "..");

  /** Every screen id the App hands an 问一问 entry, read from the source as written. */
  function screensPassed(): string[] {
    const files = fs.readdirSync(SRC, { recursive: true, encoding: "utf8" }).filter((f) => /\.tsx?$/.test(f) && !f.includes("__tests__"));
    const text = files.map((f) => fs.readFileSync(path.join(SRC, f), "utf8")).join("\n");
    const ids = [...text.matchAll(/\bassist=(?:\{\s*)?"([a-z_]+)"/g), ...text.matchAll(/\bassist=\{[^}]*\?\s*"([a-z_]+)"\s*:\s*"([a-z_]+)"/g)].flatMap((m) =>
      m.slice(1).filter(Boolean)
    );
    return [...new Set(ids)].sort();
  }

  function helpScreens(): Set<string> {
    const dir = path.join(ROOT, "backend", "apps", "soul_assist", "help", "zh-Hans");
    const found = new Set<string>();
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".md"))) {
      const front = /^---\n([\s\S]*?)\n---/.exec(fs.readFileSync(path.join(dir, file), "utf8"))?.[1] ?? "";
      const list = /^screens:\s*\[([^\]]*)\]/m.exec(front)?.[1] ?? "";
      for (const s of list.split(",").map((x) => x.trim()).filter(Boolean)) found.add(s);
    }
    return found;
  }

  it("the harvest finds the six pages of 1b (a scanner that finds nothing passes everything)", () => {
    expect(screensPassed()).toEqual(["applications", "circle", "letters", "life", "sentence", "settings"]);
  });

  it("every page with an entry has at least one help entry listing it", () => {
    const covered = helpScreens();
    expect(covered.size).toBeGreaterThan(0);
    expect(screensPassed().filter((s) => !covered.has(s))).toEqual([]);
  });

  it("the fixed empty answer the App recognizes is the backend's EMPTY_ANSWER, word for word", () => {
    const service = fs.readFileSync(path.join(ROOT, "backend", "apps", "soul_assist", "service.py"), "utf8");
    const block = /EMPTY_ANSWER = \{([\s\S]*?)\n\}/.exec(service)?.[1] ?? "";
    const backend = Object.fromEntries([...block.matchAll(/"([\w-]+)":\s*"([^"]*)"/g)].map((m) => [m[1], m[2]]));
    expect(backend).toEqual(ASSIST_EMPTY_ANSWER);
  });
});
