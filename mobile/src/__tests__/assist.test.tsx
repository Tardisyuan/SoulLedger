/**
 * 「问一问」 (canvas「灵魂簿 App · 问一问」 1a–1j) against core's real soul
 * client with a scripted transport (./stubApi). The drawer is rendered with the
 * real `AssistProvider` and the real `AppHeader`; one test boots the whole app to
 * check the entry follows `/me/`'s `assistant_enabled`.
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
import { PROFILE, heldReply, life, stubApi, type Reply } from "./stubApi";
import { SafeAreaProvider } from "react-native-safe-area-context";

const ENABLED = { ...PROFILE, assistant_enabled: true } as never;
const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const LIST = "GET /me/assist/conversations/";
const ASK = "POST /me/assist/";
const openLetters = jest.fn();

function renderDrawer(profile = ENABLED) {
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <I18nProvider>
        <AssistProvider profile={profile} onOpenLetters={openLetters}>
          <AppHeader title="转生申请" assist="applications" onAccount={() => {}} />
          <AssistPanel />
        </AssistProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}

const answer = (content: string) => ({
  status: 200,
  data: { conversation_id: "11111111-1111-1111-1111-111111111111", answer: { id: 2, role: "assistant", content, created_at: "2026-09-28T06:02:00Z" } },
});

const conversation = (id: string, first_question: string) => ({
  id,
  screen: "sentence",
  created_at: "2026-09-24T13:40:00Z",
  last_active_at: "2026-09-24T13:40:00Z",
  first_question,
  messages: [{ id: 1, role: "user", content: first_question, created_at: "2026-09-24T13:40:00Z" }],
});

async function openAndAsk(routes: Parameters<typeof stubApi>[0], question = "我为什么不能申请？") {
  const calls = stubApi({ [LIST]: { status: 200, data: [] }, ...routes });
  renderDrawer();
  fireEvent.press(screen.getByTestId("assist-entry"));
  await screen.findByTestId("assist-empty");
  await act(async () => {
    fireEvent.press(screen.getByText(question));
  });
  return calls;
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

  it("sits in the life tab's header when enabled, left of the account icon", async () => {
    await boot(true);
    const bar = screen.getByTestId("header-bar");
    const ids = (bar as unknown as { findAll: (p: (n: { props: { testID?: unknown } }) => boolean) => { props: { testID: string } }[] })
      .findAll((n) => n.props.testID === "assist-entry" || n.props.testID === "header-account")
      .map((n) => n.props.testID);
    expect(ids[0]).toBe("assist-entry");
    expect(ids).toContain("header-account");
  });
});

describe("the four notices (1g)", () => {
  it("① 503 assistant_not_configured: the notice, and the entry is gone once the drawer closes", async () => {
    await openAndAsk({ [ASK]: { status: 503, data: { detail: "x", code: "assistant_not_configured" } } });
    expect(screen.getByTestId("assist-not-configured")).toBeTruthy();
    fireEvent.press(screen.getByTestId("assist-letters"));
    expect(openLetters).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("assist-panel")).toBeNull();
    expect(screen.queryByTestId("assist-entry")).toBeNull();
  });

  it("② 429 rate_limited: says when from retry_at, keeps the question, and shows no count", async () => {
    const retryAt = "2026-09-28T07:02:00Z";
    await openAndAsk({ [ASK]: { status: 429, data: { detail: "x", code: "rate_limited", retry_at: retryAt } } });
    const body = screen.getByTestId("assist-limited-body").props.children as string;
    expect(body).toContain(hhmm(retryAt));
    expect(body).not.toMatch(/\d+\s*\/\s*\d+/);
    expect(screen.getByTestId("assist-input").props.value).toBe("我为什么不能申请？");
    expect(screen.queryByTestId("assist-answer")).toBeNull();
  });

  it("③ 503 assistant_unavailable: 未答, the question kept, retry sends it again", async () => {
    const calls = await openAndAsk({
      [ASK]: [{ status: 503, data: { detail: "x", code: "assistant_unavailable" } }, answer("你已有一份申请正在审批。")],
    });
    const unanswered = screen.getByTestId("assist-unanswered");
    expect(within(unanswered).getByText("我为什么不能申请？")).toBeTruthy();
    expect(screen.getByTestId("assist-input").props.value).toBe("我为什么不能申请？");
    await act(async () => {
      fireEvent.press(screen.getByTestId("assist-retry"));
    });
    expect(calls.filter((c) => c.method === "POST").map((c) => (c.body as { question: string }).question)).toEqual([
      "我为什么不能申请？",
      "我为什么不能申请？",
    ]);
    expect(screen.getByTestId("assist-answer-text").props.children).toBe("你已有一份申请正在审批。");
    expect(screen.queryByTestId("assist-unanswered")).toBeNull();
  });

  it("④ the server's fixed empty answer shows the letters card; an ordinary answer does not", async () => {
    await openAndAsk({ [ASK]: answer(ASSIST_EMPTY_ANSWER["zh-Hans"]) });
    expect(screen.getByTestId("assist-letters-card")).toBeTruthy();
    screen.unmount();

    await openAndAsk({ [ASK]: answer("帮助文档里没有写,不知道。请写信给殿司。") });
    expect(screen.getByTestId("assist-answer")).toBeTruthy();
    expect(screen.queryByTestId("assist-letters-card")).toBeNull();
  });
});

describe("waiting (1e)", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("one line, then after 6 s a second line and 取消; at 25 s a timeout that keeps the question", async () => {
    const never = new Promise<Reply>(() => {});
    const calls = await openAndAsk({ [ASK]: never });
    expect(calls.find((c) => c.method === "POST")?.body).toMatchObject({ question: "我为什么不能申请？", screen: "applications" });
    expect(screen.getByTestId("assist-waiting")).toBeTruthy();
    expect(screen.queryByTestId("assist-cancel")).toBeNull();
    expect(screen.getByTestId("assist-input").props.editable).toBe(false);

    await act(async () => {
      jest.advanceTimersByTime(6000);
    });
    expect(screen.getByTestId("assist-waiting-long")).toBeTruthy();
    expect(screen.getByTestId("assist-cancel")).toBeTruthy();

    await act(async () => {
      jest.advanceTimersByTime(19_000);
    });
    expect(screen.queryByTestId("assist-waiting")).toBeNull();
    expect(within(screen.getByTestId("assist-unanswered")).getByText(/超过 25 秒/)).toBeTruthy();
    expect(screen.getByTestId("assist-input").props.value).toBe("我为什么不能申请？");
    expect(screen.getByTestId("assist-input").props.editable).toBe(true);
  });

  it("取消 stops waiting without an error, and the late answer is not shown", async () => {
    const late = heldReply();
    await openAndAsk({ [ASK]: late.reply });
    await act(async () => {
      jest.advanceTimersByTime(6000);
    });
    fireEvent.press(screen.getByTestId("assist-cancel"));
    expect(screen.queryByTestId("assist-waiting")).toBeNull();
    await act(async () => late.answer(answer("迟到的回答")));
    expect(screen.queryByText("迟到的回答")).toBeNull();
    expect(screen.queryByTestId("assist-unanswered")).toBeNull();
  });
});

describe("the answer's language (1i)", () => {
  const withLocale = async (locale: string) => {
    persistentStore.set(LOCALE_COOKIE, locale);
    const q = locale === "zh-Hans" ? "我为什么不能申请？" : "Why can't I apply?";
    await openAndAsk({ [ASK]: answer("You already have a rebirth application under review.") }, q);
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
