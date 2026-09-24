/**
 * The 书信 tab (chat handoff 1a–1e): which state a conversation is in, how the
 * list is cut, what replaces the composer, and the outbox.
 *
 * Screens get a fixed chat state through `ChatContext` — the state choice
 * itself is `chatMode`, pure and tested first. The outbox is tested through the
 * REAL `ChatProvider` against a Synapse double that answers the way Synapse
 * v1.161 does (the same behaviours packages/core's matrix.test.ts pins; the
 * real server is `backend/tests/test_chat_synapse_integration.py`):
 * `PUT .../send/{txnId}` is idempotent per (device, txnId) — MSC3970 — and
 * `unsigned.transaction_id` is echoed only to the sender.
 */
import type { SoulConversation } from "@soulledger/core/api/soul-chat";
import { EMPTY_TIMELINE, matrixHttp, type ChatMessage, type MatrixEvent } from "@soulledger/core/api/matrix";
import { REFRESH_TOKEN_KEY } from "@soulledger/core/platform";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { NavigationContainer } from "@react-navigation/native";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";
import * as SecureStore from "expo-secure-store";
import type { ReactNode } from "react";
import { Platform, StyleSheet, TextInput } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ChatContext, ChatProvider, OUTBOX_KEY, readOutbox, useChat, type Chat } from "../chat";
import { chatMode, chatSections, dayOf, normalizeCode, sendsThroughBackend } from "../chatRules";
import { AppHeader } from "../chrome";
import { I18nProvider } from "../i18n";
import { RootNavigator } from "../navigation";
import { installMobilePlatform, persistentStore } from "../platform";
import { formatStamp } from "../rules";
import { ConversationScreen } from "../screens/conversation";
import { FindSoulScreen, LettersScreen, hallOf } from "../screens/letters";
import { SessionProvider } from "../session";
import { PROFILE, stubApi } from "./stubApi";

const mockNavigate = jest.fn();
jest.mock("@react-navigation/native", () => {
  const actual = jest.requireActual("@react-navigation/native");
  const { useEffect } = jest.requireActual("react");
  return {
    ...actual,
    // Screens rendered alone, outside a navigator. The navigator test below unmocks nothing it needs:
    // RootNavigator's own screens get their navigation from the real container.
    useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  };
});

const ME = "@me:hs.test";
const PEER = "@peer:hs.test";
const NOW = Date.parse("2026-09-15T10:45:00+08:00");

function conv(overrides: Partial<SoulConversation> = {}): SoulConversation {
  return {
    id: "c-direct",
    kind: "DIRECT",
    room_id: "!direct:hs.test",
    peer_user: 7,
    peer_name: "吴长明",
    hall: "",
    throttled: false,
    last_request_at: null,
    responded_at: null,
    last_message_at: null,
    created_at: "2026-09-10T00:00:00Z",
    mutual: true,
    initiated_by_me: false,
    next_request_at: null,
    refusal: null,
    ...overrides,
  } as SoulConversation;
}

const hall = (overrides: Partial<SoulConversation> = {}) =>
  conv({ id: "c-hall", kind: "OFFICER_INBOX", room_id: "!hall:hs.test", peer_user: null, peer_name: "", hall: "第五殿", mutual: false, ...overrides });

const msg = (id: string, sender: string, body: string, ts: number): ChatMessage => ({ eventId: id, sender, body, ts, officer: null, officerTitle: null, txnId: null });

const facts = (overrides = {}) => ({ now: NOW, peerHasSpoken: false, iHaveSpoken: false, refused: null, ...overrides });

// ── the state choice ──────────────────────────────────────────────────

describe("chatMode — the design's eight states from the server's facts", () => {
  it("① free: mutual", () => {
    expect(chatMode(conv(), facts()).kind).toBe("free");
  });

  it("② my request, a letter may go / locked until next_request_at", () => {
    const mine = conv({ throttled: true, initiated_by_me: true, mutual: false });
    expect(chatMode(mine, facts()).kind).toBe("outgoing_open");
    const next = new Date(NOW + 3_600_000).toISOString();
    expect(chatMode({ ...mine, next_request_at: next }, facts())).toEqual({ kind: "outgoing_locked", nextAt: next, rejected: false });
    // The time has come: open again, not locked forever.
    expect(chatMode({ ...mine, next_request_at: new Date(NOW - 1).toISOString() }, facts()).kind).toBe("outgoing_open");
    // They answered: free, before the backend lifts the throttle on the next send.
    expect(chatMode({ ...mine, next_request_at: next }, facts({ peerHasSpoken: true })).kind).toBe("free");
  });

  it("③ their request: incoming until I answer", () => {
    const theirs = conv({ throttled: true, initiated_by_me: false, mutual: false });
    expect(chatMode(theirs, facts()).kind).toBe("incoming");
    expect(chatMode(theirs, facts({ iHaveSpoken: true })).kind).toBe("free");
  });

  it("④ request_throttled: a refused send locks with the server's retry_at, marked as rejected", () => {
    const mine = conv({ throttled: true, initiated_by_me: true, mutual: false });
    const retry = "2026-09-16T19:30:00+08:00";
    expect(chatMode(mine, facts({ refused: { code: "request_throttled", retryAt: retry } }))).toEqual({
      kind: "outgoing_locked",
      nextAt: retry,
      rejected: true,
    });
  });

  it("⑤ muted, ⑥ closed / peer_retired — the server's refusal wins over everything else", () => {
    expect(chatMode(conv({ refusal: "muted" }), facts()).kind).toBe("muted");
    expect(chatMode(conv({ refusal: "closed", throttled: true, initiated_by_me: true }), facts())).toEqual({ kind: "closed", reason: "closed" });
    expect(chatMode(conv({ refusal: "peer_retired" }), facts())).toEqual({ kind: "closed", reason: "peer_retired" });
    // A refusal met on send is newer than the list.
    expect(chatMode(conv(), facts({ refused: { code: "muted", retryAt: null } })).kind).toBe("muted");
  });

  it("the hall: writable when current, sealed when left — and never 'muted' (a mute does not cut the hall)", () => {
    expect(chatMode(hall(), facts()).kind).toBe("hall");
    expect(chatMode(hall({ refusal: "not_current_hall" }), facts()).kind).toBe("hall_sealed");
    expect(chatMode(hall({ refusal: "muted" }), facts()).kind).toBe("hall");
  });
});

describe("sendsThroughBackend — the path each send takes", () => {
  it("my request and the hall go through the backend; the answer to THEIR request goes to Synapse", () => {
    expect(sendsThroughBackend(conv({ throttled: true, initiated_by_me: true }))).toBe(true);
    expect(sendsThroughBackend(hall())).toBe(true);
    // The backend refuses the receiver on its path (409 not_initiator); in Synapse the receiver speaks at 50.
    expect(sendsThroughBackend(conv({ throttled: true, initiated_by_me: false }))).toBe(false);
    expect(sendsThroughBackend(conv())).toBe(false);
  });
});

describe("chatSections — halls and souls are never interleaved", () => {
  it("current hall on top, halls left behind under it, souls newest first", () => {
    const old = hall({ id: "old", refusal: "not_current_hall", last_message_at: "2026-09-15T00:00:00Z" });
    const a = conv({ id: "a", room_id: "!a", last_message_at: "2026-09-12T00:00:00Z" });
    const b = conv({ id: "b", room_id: "!b", last_message_at: "2026-09-14T00:00:00Z" });
    const cur = hall({ last_message_at: "2026-09-01T00:00:00Z" });
    const sections = chatSections([a, old, b, cur], (room) => (room === "!a" ? Date.parse("2026-09-15T01:00:00Z") : 0));
    expect(sections.hall?.id).toBe("c-hall");
    expect(sections.sealedHalls.map((c) => c.id)).toEqual(["old"]);
    // The newest hall letter does not pull the hall down among the souls, and a newer timeline beats the list.
    expect(sections.souls.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("the code as typed is normalised the way the server does, and no further", () => {
    expect(normalizeCode("  2p6r41wz88 ")).toBe("2P6R41WZ88");
    expect(normalizeCode("2P6R-41WZ88")).toBe("2P6R-41WZ88");
  });
});

// ── screens with a fixed chat state ───────────────────────────────────

function chatState(overrides: Partial<Chat> = {}): Chat {
  return {
    availability: "ready",
    conversations: [],
    listError: false,
    gone: {},
    timeline: EMPTY_TIMELINE,
    me: ME,
    outbox: [],
    refused: {},
    reload: jest.fn(async () => {}),
    reconnect: jest.fn(),
    send: jest.fn(),
    resend: jest.fn(),
    loadOlder: jest.fn(async () => {}),
    markRead: jest.fn(),
    openInbox: jest.fn(async () => hall()),
    openDirect: jest.fn(async () => conv()),
    ...overrides,
  };
}

const withRoom = (roomId: string, messages: ChatMessage[], extra = {}) => ({
  since: "s1",
  rooms: { [roomId]: { messages, unread: 0, readUpTo: {}, prevBatch: null, ...extra } },
});

function wrap(chat: Chat, children: ReactNode) {
  return render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
      <I18nProvider>
        <ChatContext.Provider value={chat}>
          <NavigationContainer>{children}</NavigationContainer>
        </ChatContext.Provider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}

beforeEach(() => {
  installMobilePlatform();
  mockNavigate.mockReset();
  jest.spyOn(Date, "now").mockReturnValue(NOW);
});
afterEach(() => jest.restoreAllMocks());

/** A host node as react-test-renderer hands it out (its own types are not installed here). */
type Node = { type: unknown; props: Record<string, unknown> };
const hostIds = (root: { findAll: (p: (n: Node) => boolean) => Node[] }) =>
  root.findAll((n) => typeof n.type === "string" && !!n.props.testID).map((n) => n.props.testID as string);
/** Every testID in render order. */
const order = () => hostIds(screen.UNSAFE_root);

describe("the list", () => {
  it("puts the hall section above one solid rule and the souls below it — a newer hall letter stays on top", () => {
    const soulA = conv({ id: "a", room_id: "!a", peer_name: "吴长明" });
    const soulB = conv({ id: "b", room_id: "!b", peer_name: "柳素英", throttled: true, initiated_by_me: true, mutual: false });
    const sealed = hall({ id: "old", room_id: "!old", hall: "泰山殿", refusal: "not_current_hall" });
    wrap(
      chatState({
        conversations: [soulA, soulB, sealed, hall()],
        timeline: {
          since: "s",
          rooms: {
            "!a": { messages: [msg("e1", PEER, "明天一起去等榜吧。", NOW - 60_000)], unread: 1, readUpTo: {}, prevBatch: null },
            // The hall's letter is the newest of all — and still does not sort among the souls.
            "!hall:hs.test": { messages: [msg("e2", "@officer:hs.test", "申诉已收。", NOW)], unread: 0, readUpTo: {}, prevBatch: null },
          },
        },
      }),
      <LettersScreen />
    );
    const ids = order().filter((id) => /^(hall-row|hall-sealed-|section-rule|soul-row-)/.test(id) && !id.endsWith("-unread"));
    expect(ids).toEqual(["hall-row", "hall-sealed-old", "section-rule", "soul-row-a", "soul-row-b"]);
    expect(StyleSheet.flatten(screen.getByTestId("section-rule").props.style)).toMatchObject({ height: 1 });
    expect(screen.getByTestId("soul-row-a-unread")).toBeTruthy();
    // My request waiting for an answer is tagged; the mutual one is not.
    expect(screen.getByTestId("awaiting-b")).toBeTruthy();
    expect(screen.queryByTestId("awaiting-a")).toBeNull();
    expect(within(screen.getByTestId("hall-row")).getByText("第五殿 · 殿司")).toBeTruthy();
  });

  it("a request whose other soul is gone reads 已闭, not 待回复", () => {
    const gone = conv({ id: "g", room_id: "!g", throttled: true, initiated_by_me: true, mutual: false, refusal: "peer_retired" });
    wrap(chatState({ conversations: [gone] }), <LettersScreen />);
    expect(screen.getByTestId("closed-g")).toBeTruthy();
    expect(screen.queryByTestId("awaiting-g")).toBeNull();
  });

  it("an empty list still has the hall to write to, and the empty souls section offers to find someone", () => {
    wrap(chatState({ conversations: [] }), <LettersScreen />);
    expect(screen.getByTestId("hall-row")).toBeTruthy();
    expect(screen.getByText("还没有往来")).toBeTruthy();
    fireEvent.press(screen.getByTestId("chat-empty-find"));
    expect(mockNavigate).toHaveBeenCalledWith("FindSoul");
  });
});

/** The conversation screen for one conversation and its room's timeline. */
function openConversation(c: SoulConversation, messages: ChatMessage[] = [], extra: Partial<Chat> = {}, landed = false) {
  const chat = chatState({ conversations: [c], timeline: withRoom(c.room_id, messages), ...extra });
  wrap(chat, <ConversationScreen id={c.id} landed={landed} />);
  return chat;
}

const composerGone = () => {
  expect(screen.queryByTestId("composer")).toBeNull();
  expect(screen.queryByTestId("compose")).toBeNull();
  // Not a disabled box: no text input anywhere on the screen.
  expect(screen.UNSAFE_root.findAll((n: Node) => n.type === "TextInput")).toHaveLength(0);
};

describe("the conversation's eight states", () => {
  it("① free, landed from a push: the newest letter from them gets the 3px bar and the 新 tag", () => {
    openConversation(conv(), [msg("e1", ME, "枯树下等你，别等太久。", NOW - 180_000), msg("e2", PEER, "明天一起去等榜吧。", NOW - 60_000)], {}, true);
    expect(screen.getByTestId("conversation-free")).toBeTruthy();
    const landed = screen.getByTestId("landing-highlight");
    expect(StyleSheet.flatten(landed.props.style)).toMatchObject({ borderLeftWidth: 3 });
    expect(within(landed).getByText("明天一起去等榜吧。")).toBeTruthy();
    expect(screen.getByTestId("landing-tag").props.children).toBe("新");
    // Only that one — my own letter is not highlighted.
    expect(screen.getAllByTestId("landing-highlight")).toHaveLength(1);
    expect(screen.getByTestId("compose")).toBeTruthy();
    expect(screen.getByTestId("relation").props.children).toBe("互关");
  });

  it("① not landed: no highlight at all", () => {
    openConversation(conv(), [msg("e2", PEER, "明天一起去等榜吧。", NOW - 60_000)]);
    expect(screen.queryByTestId("landing-highlight")).toBeNull();
  });

  it("② my request, waiting: a dotted line and the mono time it opens — never a disabled box", () => {
    const next = "2026-09-16T19:30:00+08:00";
    openConversation(conv({ throttled: true, initiated_by_me: true, mutual: false, next_request_at: next }), [
      msg("e1", ME, "你说的那个渡口，我也去过。", NOW - 3_600_000),
    ]);
    expect(screen.getByTestId("conversation-outgoing_locked")).toBeTruthy();
    expect(screen.getByTestId("hint-outgoing")).toBeTruthy();
    const dock = screen.getByTestId("dock-locked");
    expect(within(dock).getByText("等对方回话")).toBeTruthy();
    expect(within(screen.getByTestId("next-at")).getByText(formatStamp(next)!)).toBeTruthy();
    composerGone();
    expect(screen.getByTestId("relation").props.children).toBe("未互关");
  });

  it("③ their request: reply to accept, with the reply placeholder", () => {
    openConversation(conv({ throttled: true, initiated_by_me: false, mutual: false }), [msg("e1", PEER, "是不是扬州西边的？", NOW - 60_000)]);
    expect(screen.getByTestId("conversation-incoming")).toBeTruthy();
    expect(screen.getByTestId("hint-incoming")).toBeTruthy();
    expect(screen.getByTestId("compose").props.placeholder).toBe("回一句……");
    // No accept / ignore buttons: replying is accepting.
    expect(screen.queryByText("接受")).toBeNull();
  });

  it("④ request_throttled: the refused letter stays, marked 未送出, with the time it may go", () => {
    const c = conv({ throttled: true, initiated_by_me: true, mutual: false });
    const retry = "2026-09-16T19:30:00+08:00";
    const refused = { code: "request_throttled", retryAt: retry };
    openConversation(c, [msg("e1", ME, "你说的那个渡口，我也去过。", NOW - 3_600_000)], {
      refused: { [c.id]: refused },
      outbox: [{ txnId: "t1", conversationId: c.id, roomId: c.room_id, body: "在不在？", ts: NOW, state: "failed", refused }],
    });
    expect(screen.getByTestId("conversation-outgoing_locked")).toBeTruthy();
    const failed = screen.getByTestId("pending-failed");
    expect(within(failed).getByText("在不在？")).toBeTruthy();
    expect(within(failed).getByText("未送出")).toBeTruthy();
    // Not resendable before its time.
    expect(screen.queryByTestId("resend")).toBeNull();
    expect(within(screen.getByTestId("request-throttled")).getByText(formatStamp(retry)!)).toBeTruthy();
    composerGone();
  });

  it("⑤ muted: no composer, the reason with days and time, the hall button right under it; history not dimmed", async () => {
    const until = new Date(NOW + 6.5 * 86_400_000).toISOString();
    stubApi({ "/me/social/status/": { status: 200, data: { can_write: false, muted_until: until, reports_remaining: 3 } } });
    const chat = openConversation(conv({ refusal: "muted" }), [msg("e1", PEER, "明天一起去等榜吧。", NOW - 60_000)]);
    const band = screen.getByTestId("muted-band");
    // Until /me/social/status/ answers, the reason is the plain sentence; then days and time, in mono.
    await waitFor(() => expect(within(screen.getByTestId("muted-reason")).getByText("7")).toBeTruthy());
    expect(within(screen.getByTestId("muted-reason")).getByText(formatStamp(until)!)).toBeTruthy();
    // The button is inside the band, after the reason — not at the bottom of the screen.
    const inBand = hostIds(screen.getByTestId("muted-band"));
    expect(inBand.indexOf("muted-to-hall")).toBeGreaterThan(inBand.indexOf("muted-reason"));
    composerGone();
    // 1c ⑤: "不遮挡、不模糊" — no ancestor of the letter is faded.
    let node = screen.getByText("明天一起去等榜吧。").parent;
    while (node) {
      expect(StyleSheet.flatten(node.props.style)?.opacity ?? 1).toBe(1);
      node = node.parent;
    }
    await act(async () => fireEvent.press(within(band).getByTestId("muted-to-hall")));
    expect(chat.openInbox).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith("Conversation", { id: "c-hall" });
  });

  it("⑥ closed: read-only with the reason, and the composer is gone", () => {
    openConversation(conv({ refusal: "closed", peer_name: "周芸", closed_at: new Date(NOW).toISOString() }), [msg("e1", PEER, "盖子换了是好事。", NOW - 86_400_000)]);
    expect(screen.getByTestId("conversation-closed")).toBeTruthy();
    // The thread ends where the server closed it — after the last letter, dated by `closed_at`.
    expect(screen.getByTestId("closed-marker").props.children).toBe(`${dayOf(NOW)} 转生 · 会话止于此`);
    const ids = hostIds(screen.getByTestId("conversation-closed"));
    expect(ids.indexOf("closed-marker")).toBeGreaterThan(-1);
    expect(screen.getByTestId("closed-reason").props.children).toBe("她已转生去了。这段话留着，不能再添。");
    expect(screen.getByTestId("closed-tag")).toBeTruthy();
    composerGone();
  });

  it("⑥ peer_retired: the same screen, only the sentence differs", () => {
    openConversation(conv({ refusal: "peer_retired" }));
    expect(screen.queryByTestId("closed-marker")).toBeNull(); // no `closed_at`: no end marker
    expect(screen.getByTestId("closed-reason").props.children).toBe("这个账号已停用。这段话留着，不能再添。");
    composerGone();
  });

  it("⑦ chat_unavailable: the composer stays and takes text; only the send key steps down", () => {
    const chat = openConversation(conv(), [], { availability: "unavailable" });
    expect(screen.getByTestId("chat-unavailable")).toBeTruthy();
    expect(screen.getByTestId("send-secondary")).toBeTruthy();
    expect(screen.queryByTestId("send-primary")).toBeNull();
    fireEvent.changeText(screen.getByTestId("compose"), "枯树那边风大");
    fireEvent.press(screen.getByTestId("send"));
    expect(chat.send).toHaveBeenCalledWith(expect.objectContaining({ id: "c-direct" }), "枯树那边风大");
    fireEvent.press(screen.getByTestId("chat-reconnect"));
    expect(chat.reconnect).toHaveBeenCalled();
  });

  it("⑦ a queued letter shows as 等待送出", () => {
    const c = conv();
    openConversation(c, [], {
      availability: "unavailable",
      outbox: [{ txnId: "t1", conversationId: c.id, roomId: c.room_id, body: "枯树那边风大", ts: NOW, state: "queued" }],
    });
    expect(within(screen.getByTestId("pending-queued")).getByText("等待送出")).toBeTruthy();
  });

  it("the hall: officer bubbles, writable; a hall left behind is sealed and offers the current one", () => {
    openConversation(
      hall({ hall: "第五殿", hall_names: { "zh-Hans": "第五殿", en: "The Fifth Court", egy: "Yanluo Qedi" } }),
      [{ ...msg("e1", "@officer:hs.test", "申诉已收。", NOW), officer: "崔珏", officerTitle: "判官" }]
    );
    expect(screen.getByTestId("conversation-hall")).toBeTruthy();
    // The byline: the hall's display name, the officer's position, the officer — as the backend stamped them.
    expect(within(screen.getByTestId("officer-bubble")).getByText("第五殿 · 判官 崔珏")).toBeTruthy();
    expect(screen.getByTestId("compose").props.placeholder).toBe("向殿司陈情……");
  });

  it("a hall is named in the interface language, falling back to the server's hall", () => {
    const c = hall({ hall: "第五殿", hall_names: { "zh-Hans": "第五殿", en: "The Fifth Court", egy: "Yanluo Qedi" } });
    expect([hallOf(c, "zh-Hans"), hallOf(c, "en"), hallOf(c, "egy")]).toEqual(["第五殿", "The Fifth Court", "Yanluo Qedi"]);
    expect(hallOf(hall({ hall: "第五殿", hall_names: null }), "en")).toBe("第五殿");
  });

  it("a sealed hall has no composer, only the way to the current hall", () => {
    openConversation(hall({ refusal: "not_current_hall" }));
    expect(screen.getByTestId("conversation-hall_sealed")).toBeTruthy();
    expect(screen.getByTestId("go-current-hall")).toBeTruthy();
    composerGone();
  });
});

describe("the title bar per platform (handoff 1e): Android sets the title left and goes back with an arrow", () => {
  const ARROW = "M15 9H3M8 4L3 9l5 5";
  const CHEVRON = "M11 3L5 9l6 6";
  const drawn = () => new Set(screen.UNSAFE_root.findAll((n: Node) => typeof n.props.d === "string").map((n: Node) => n.props.d as string));
  const titleStyle = () => StyleSheet.flatten(screen.getByRole("header").props.style);
  /** The first thing drawn in the bar, left to right (a host node). */
  const firstInBar = () => {
    let n = screen.getByTestId("header-bar").children[0] as unknown as { type: unknown; children: unknown[] };
    while (typeof n.type !== "string") n = n.children[0] as typeof n;
    return n;
  };

  it("iOS, unchanged: the 书信 title centred; back is the chevron", () => {
    wrap(chatState(), <AppHeader title="书信" />);
    expect(titleStyle()).toMatchObject({ textAlign: "center" });
    // The back key's place is held open on the left, so the title is centred on the bar.
    expect(firstInBar()).not.toBe(screen.getByRole("header"));
    screen.unmount();
    wrap(chatState(), <AppHeader title="找人" onBack={jest.fn()} />);
    expect(drawn().has(CHEVRON)).toBe(true);
    expect(drawn().has(ARROW)).toBe(false);
  });

  it("Android: the 书信 title at the left edge, no empty back slot before it", () => {
    jest.replaceProperty(Platform, "OS", "android");
    wrap(chatState(), <AppHeader title="书信" />);
    expect(titleStyle()).toMatchObject({ textAlign: "left", paddingLeft: 10 });
    // The title is the bar's first child: nothing is held open where iOS keeps the back key's place.
    expect(firstInBar()).toBe(screen.getByRole("header"));
  });

  it("Android: back is an arrow — in the shared bar and in the conversation's own", () => {
    jest.replaceProperty(Platform, "OS", "android");
    wrap(chatState(), <AppHeader title="找人" onBack={jest.fn()} />);
    expect(drawn().has(ARROW)).toBe(true);
    expect(drawn().has(CHEVRON)).toBe(false);
    screen.unmount();
    openConversation(conv());
    expect(drawn().has(ARROW)).toBe(true);
    expect(drawn().has(CHEVRON)).toBe(false);
  });
});

describe("the send key and a composing keyboard (iOS pinyin: marked text)", () => {
  // The native field, as UIKit drives it: focused while typing; resigning commits the marked text
  // and then reports the committed text in onEndEditing. Only these three methods are doubled.
  function nativeField() {
    jest.spyOn(TextInput.prototype, "isFocused").mockReturnValue(true);
    const calls: string[] = [];
    jest.spyOn(TextInput.prototype, "blur").mockImplementation(() => void calls.push("blur"));
    jest.spyOn(TextInput.prototype, "focus").mockImplementation(() => void calls.push("focus"));
    return calls;
  }

  it("the send key commits first and sends what was committed — never the syllables still being composed", () => {
    const calls = nativeField();
    const chat = openConversation(conv());
    // Mid-composition: the field's text includes the marked syllables.
    fireEvent.changeText(screen.getByTestId("compose"), "明天ming'tian");
    fireEvent.press(screen.getByTestId("send"));
    expect(chat.send).not.toHaveBeenCalled();
    // Resign (UIKit commits the marked text), then straight back: the keyboard stays.
    expect(calls).toEqual(["blur", "focus"]);
    fireEvent(screen.getByTestId("compose"), "endEditing", { nativeEvent: { text: "明天见" } });
    expect(chat.send).toHaveBeenCalledTimes(1);
    expect(chat.send).toHaveBeenCalledWith(expect.objectContaining({ id: "c-direct" }), "明天见");
    expect(screen.getByTestId("compose").props.value).toBe("");
  });

  it("the field ending on its own (keyboard dismissed) sends nothing", () => {
    nativeField();
    const chat = openConversation(conv());
    fireEvent.changeText(screen.getByTestId("compose"), "明天见");
    fireEvent(screen.getByTestId("compose"), "endEditing", { nativeEvent: { text: "明天见" } });
    expect(chat.send).not.toHaveBeenCalled();
    expect(screen.getByTestId("compose").props.value).toBe("明天见");
  });

  it("the field not focused (nothing can be composing): the send key sends at once", () => {
    const calls = nativeField();
    jest.spyOn(TextInput.prototype, "isFocused").mockReturnValue(false);
    const chat = openConversation(conv());
    fireEvent.changeText(screen.getByTestId("compose"), "明天见");
    fireEvent.press(screen.getByTestId("send"));
    expect(calls).toEqual([]);
    expect(chat.send).toHaveBeenCalledWith(expect.objectContaining({ id: "c-direct" }), "明天见");
  });

  it("Android is unchanged: the send key sends at once", () => {
    const calls = nativeField();
    jest.replaceProperty(Platform, "OS", "android");
    const chat = openConversation(conv());
    fireEvent.changeText(screen.getByTestId("compose"), "明天见");
    fireEvent.press(screen.getByTestId("send"));
    expect(calls).toEqual([]);
    expect(chat.send).toHaveBeenCalledWith(expect.objectContaining({ id: "c-direct" }), "明天见");
  });
});

describe("find someone by code", () => {
  beforeEach(() => {
    stubApi({
      "/me/social/following/": { status: 200, data: { results: [] } },
      "/me/social/followers/": { status: 200, data: { results: [] } },
      "POST /me/chat/lookup/": { status: 404, data: { code: "not_found", detail: "找不到这个灵魂。" } },
    });
  });

  it("a miss is one sentence, whatever the reason", async () => {
    wrap(chatState(), <FindSoulScreen />);
    // A code is letters and digits: an ASCII keyboard, or a pinyin keyboard composes it into words.
    expect(screen.getByTestId("find-code").props.keyboardType).toBe("ascii-capable");
    fireEvent.changeText(screen.getByTestId("find-code"), "8q0x15mb43");
    await act(async () => fireEvent.press(screen.getByTestId("find-submit")));
    expect(await screen.findByText("未找到。")).toBeTruthy();
    // The quiet "nothing here", not an error box: a miss is not a failure to show.
    expect(screen.getByTestId("find-not-found")).toBeTruthy();
    expect(screen.queryByTestId("find-error")).toBeNull();
    expect(screen.queryByTestId("find-result")).toBeNull();
  });

  it("the return key searches for what the field holds, not what the last render saw", async () => {
    const calls = stubApi({
      "/me/social/following/": { status: 200, data: { results: [] } },
      "/me/social/followers/": { status: 200, data: { results: [] } },
      "POST /me/chat/lookup/": { status: 404, data: { code: "not_found" } },
    });
    wrap(chatState(), <FindSoulScreen />);
    // A fast typist's submit can arrive before the last keystroke's state update.
    fireEvent.changeText(screen.getByTestId("find-code"), "73ngc3zyj");
    await act(async () => fireEvent(screen.getByTestId("find-code"), "submitEditing", { nativeEvent: { text: "73ngc3zyj8" } }));
    expect(calls.find((c) => c.url === "/me/chat/lookup/")?.body).toEqual({ soul_code: "73NGC3ZYJ8" });
  });

  it("an incomplete code is refused here, without asking the server", async () => {
    const calls = stubApi({
      "/me/social/following/": { status: 200, data: { results: [] } },
      "/me/social/followers/": { status: 200, data: { results: [] } },
    });
    wrap(chatState(), <FindSoulScreen />);
    fireEvent.changeText(screen.getByTestId("find-code"), "2P6R41");
    await act(async () => fireEvent.press(screen.getByTestId("find-submit")));
    expect(screen.getByText("灵魂编号须为 10 位。")).toBeTruthy();
    expect(calls.some((c) => c.url === "/me/chat/lookup/")).toBe(false);
  });

  it("a hit writes to them: the code goes upper-cased in the body, and 写信 opens the conversation", async () => {
    const calls = stubApi({
      "/me/social/following/": { status: 200, data: { results: [] } },
      "/me/social/followers/": { status: 200, data: { results: [] } },
      "POST /me/chat/lookup/": { status: 200, data: { user_id: 7, display_name: "吴长明", avatar: "", is_active: true } },
    });
    const chat = chatState();
    wrap(chat, <FindSoulScreen />);
    fireEvent.changeText(screen.getByTestId("find-code"), " 2p6r41wz88");
    await act(async () => fireEvent.press(screen.getByTestId("find-submit")));
    expect(calls.find((c) => c.url === "/me/chat/lookup/")?.body).toEqual({ soul_code: "2P6R41WZ88" });
    await act(async () => fireEvent.press(await screen.findByTestId("find-write")));
    expect(chat.openDirect).toHaveBeenCalledWith(7);
    expect(mockNavigate).toHaveBeenCalledWith("Conversation", { id: "c-direct" });
  });
});

// ── the outbox, through the real provider and a Synapse double ─────────

class FakeSynapse {
  offline = false;
  /** Take the next send in, then drop the response — the case the txn id exists for. */
  loseNextSendResponse = false;
  /** A send does not wake the long-poll: its echo is not seen before the retry. */
  quiet = false;
  events: MatrixEvent[] = [];
  /** `device|txn` → event id: Synapse's transaction cache is per (user, device) — MSC3970. `clear()` = it expired. */
  txns = new Map<string, string>();
  /** The device each event was sent from: `unsigned.transaction_id` is echoed to that device only. */
  eventDevice = new Map<string, string>();
  sends: string[] = [];
  logins: Record<string, unknown>[] = [];
  private devices = 0;
  private waiters: (() => void)[] = [];

  release() {
    this.waiters.splice(0).forEach((w) => w());
  }

  install() {
    matrixHttp.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
      const url = (config.url ?? "").replace("http://hs.test", "");
      const method = (config.method ?? "get").toUpperCase();
      const body = config.data ? JSON.parse(config.data as string) : undefined;
      const ok = (data: unknown) => ({ status: 200, data, headers: {}, config, statusText: "" }) as AxiosResponse;
      if (this.offline) throw new AxiosError("Network Error", "ERR_NETWORK", config);
      if (method === "POST" && url === "/_matrix/client/v3/login") {
        this.logins.push(body);
        // Like Synapse: the device asked for, or a new one.
        const device = typeof body.device_id === "string" ? body.device_id : `DEV${++this.devices}`;
        return ok({ access_token: `tok-${device}`, user_id: ME, device_id: device });
      }
      const device = String(config.headers?.Authorization ?? "").replace(/^Bearer tok-/, "");
      const send = url.match(/\/rooms\/([^/]+)\/send\/m\.room\.message\/([^/]+)$/);
      if (method === "PUT" && send) {
        const txn = decodeURIComponent(send[2]);
        this.sends.push(txn);
        let eventId = this.txns.get(`${device}|${txn}`);
        if (!eventId) {
          eventId = `$e${this.events.length}`;
          this.txns.set(`${device}|${txn}`, eventId);
          this.eventDevice.set(eventId, device);
          this.events.push({ event_id: eventId, type: "m.room.message", sender: ME, origin_server_ts: NOW, content: { msgtype: "m.text", body: body.body }, unsigned: { transaction_id: txn } });
          if (!this.quiet) this.release();
        }
        if (this.loseNextSendResponse) {
          this.loseNextSendResponse = false;
          throw new AxiosError("Network Error", "ERR_NETWORK", config);
        }
        return ok({ event_id: eventId });
      }
      if (method === "GET" && url === "/_matrix/client/v3/sync") {
        const since = Number(config.params?.since ?? 0);
        if (since >= this.events.length && Number(config.params?.timeout) > 0) {
          await new Promise<void>((resolve) => this.waiters.push(resolve));
          if (this.offline) throw new AxiosError("Network Error", "ERR_NETWORK", config);
        }
        const events = this.events
          .slice(since)
          .map((e) => (this.eventDevice.get(e.event_id) === device ? e : { ...e, unsigned: {} }));
        return ok({
          next_batch: String(this.events.length),
          rooms: events.length ? { join: { "!direct:hs.test": { timeline: { events } } } } : {},
        });
      }
      if (method === "POST" && /\/receipt\//.test(url)) return ok({});
      if (method === "GET" && /\/messages$/.test(url)) return ok({ chunk: [] });
      throw new Error(`unscripted Matrix request: ${method} ${url}`);
    };
  }
}

describe("the outbox (real ChatProvider, Synapse double)", () => {
  let synapse: FakeSynapse;
  let probe: Chat;
  function Probe() {
    probe = useChat();
    return null;
  }

  beforeEach(() => {
    synapse = new FakeSynapse();
    synapse.install();
    stubApi({
      "/me/chat/conversations/": { status: 200, data: [conv()] },
      "/me/chat/session/": { status: 200, data: { homeserver: "http://hs.test", user_id: ME, login_type: "org.matrix.login.jwt", token: "jwt", expires_in: 60 } },
    });
  });

  afterEach(() => synapse.release());

  function start(account = "SL-CN-000042") {
    return render(
      <ChatProvider account={account}>
        <Probe />
      </ChatProvider>
    );
  }

  const stored = () => JSON.parse(persistentStore.get(OUTBOX_KEY) ?? "null");

  it("a send whose response was lost is queued, and the retry reuses the txn id — one letter, not two", async () => {
    const view = start();
    await waitFor(() => expect(probe.availability).toBe("ready"));
    synapse.loseNextSendResponse = true;
    synapse.quiet = true; // the retry goes out before the echo: Synapse's own de-duplication is what holds
    await act(async () => probe.send(conv(), "枯树那边风大"));
    await waitFor(() => expect(probe.outbox[0]?.state).toBe("queued"));
    expect(probe.availability).toBe("unavailable");
    await act(async () => probe.reconnect());
    await waitFor(() => expect(probe.outbox[0]?.state).toBe("sent"));
    expect(synapse.sends).toHaveLength(2);
    expect(synapse.sends[0]).toBe(synapse.sends[1]);
    expect(synapse.events).toHaveLength(1);
    view.unmount();
  });

  it("written while Synapse is down: queued at once, sent when it comes back", async () => {
    synapse.offline = true;
    const view = start();
    await waitFor(() => expect(probe.availability).toBe("unavailable"));
    await act(async () => probe.send(conv(), "枯树那边风大"));
    expect(probe.outbox[0].state).toBe("queued");
    expect(synapse.sends).toHaveLength(0);
    synapse.offline = false;
    await act(async () => probe.reconnect());
    await waitFor(() => expect(probe.outbox[0]?.state).toBe("sent"));
    expect(synapse.events.map((e) => e.content.body)).toEqual(["枯树那边风大"]);
    // The echo carries the txn id back, so the pending bubble and the timeline message are one.
    await waitFor(() => expect(probe.timeline.rooms["!direct:hs.test"]?.messages[0]?.txnId).toBe(probe.outbox[0].txnId));
    view.unmount();
  });

  describe("across a restart (the outbox is on disk)", () => {
    beforeEach(() => persistentStore.remove(OUTBOX_KEY));

    it("killed with a letter queued: the next start sends it, with the txn id it was given", async () => {
      synapse.offline = true;
      const first = start();
      await waitFor(() => expect(probe.availability).toBe("unavailable"));
      await act(async () => probe.send(conv(), "枯树那边风大"));
      const txn = probe.outbox[0].txnId;
      expect(stored()).toMatchObject({ owner: "SL-CN-000042", items: [{ txnId: txn, body: "枯树那边风大" }] });
      first.unmount();

      synapse.offline = false;
      const second = start();
      await waitFor(() => expect(probe.outbox[0]?.state).toBe("sent"));
      expect(synapse.sends).toEqual([txn]);
      expect(synapse.events.map((e) => e.content.body)).toEqual(["枯树那边风大"]);
      // Confirmed: nothing left on disk.
      await waitFor(() => expect(persistentStore.get(OUTBOX_KEY)).toBeNull());
      second.unmount();
    });

    it("killed after Synapse took it but the answer was lost: the next start logs in as the SAME device — one letter", async () => {
      const first = start();
      await waitFor(() => expect(probe.availability).toBe("ready"));
      synapse.loseNextSendResponse = true;
      await act(async () => probe.send(conv(), "枯树那边风大"));
      await waitFor(() => expect(probe.outbox[0]?.state).toBe("queued"));
      expect(stored()).toMatchObject({ device: "DEV1" });
      first.unmount();

      const second = start();
      await waitFor(() => expect(probe.outbox[0]?.state).toBe("sent"));
      expect(synapse.logins[1]).toMatchObject({ device_id: "DEV1" });
      expect(synapse.events).toHaveLength(1);
      second.unmount();
    });

    it("past Synapse's transaction cache: the letter's own echo in /sync says it arrived — it is not sent again", async () => {
      const first = start();
      await waitFor(() => expect(probe.availability).toBe("ready"));
      synapse.loseNextSendResponse = true;
      await act(async () => probe.send(conv(), "枯树那边风大"));
      await waitFor(() => expect(probe.outbox[0]?.state).toBe("queued"));
      first.unmount();

      synapse.txns.clear(); // an hour later: Synapse no longer remembers the txn id
      const second = start();
      await waitFor(() => expect(probe.outbox[0]?.state).toBe("sent"));
      expect(synapse.sends).toHaveLength(1);
      expect(synapse.events).toHaveLength(1);
      expect(probe.outbox[0].eventId).toBe(synapse.events[0].event_id);
      second.unmount();
    });

    it("restored while the conversation list cannot load: the letter keeps waiting, it is not dropped as unknown", async () => {
      synapse.offline = true;
      const first = start();
      await waitFor(() => expect(probe.availability).toBe("unavailable"));
      await act(async () => probe.send(conv(), "枯树那边风大"));
      first.unmount();

      synapse.offline = false;
      stubApi({
        "/me/chat/conversations/": "offline",
        "/me/chat/session/": { status: 200, data: { homeserver: "http://hs.test", user_id: ME, login_type: "org.matrix.login.jwt", token: "jwt", expires_in: 60 } },
      });
      const second = start();
      await waitFor(() => expect(probe.availability).toBe("ready"));
      expect(probe.outbox[0]?.state).toBe("queued");
      expect(stored()?.items).toHaveLength(1);
      expect(synapse.sends).toEqual([]);
      second.unmount();
    });

    it("another account signing in finds nothing of the last one's, and its record replaces it", async () => {
      synapse.offline = true;
      const first = start("SL-CN-000042");
      await waitFor(() => expect(probe.availability).toBe("unavailable"));
      await act(async () => probe.send(conv(), "枯树那边风大"));
      first.unmount();

      const second = start("SL-EU-000007");
      await waitFor(() => expect(probe.availability).toBe("unavailable"));
      expect(probe.outbox).toEqual([]);
      await waitFor(() => expect(persistentStore.get(OUTBOX_KEY)).toBeNull());
      synapse.offline = false;
      await act(async () => probe.reconnect());
      expect(synapse.sends).toEqual([]);
      second.unmount();
    });

    it("what is on disk is checked before it is sent: garbage and foreign shapes read as nothing", () => {
      persistentStore.set(OUTBOX_KEY, "{not json");
      expect(readOutbox("SL-CN-000042").items).toEqual([]);
      persistentStore.set(OUTBOX_KEY, JSON.stringify({ owner: "SL-CN-000042", items: [{ txnId: 1 }, { txnId: "t", conversationId: "c", roomId: "r", body: "b", ts: 1, state: "sending" }] }));
      expect(readOutbox("SL-CN-000042").items).toEqual([{ txnId: "t", conversationId: "c", roomId: "r", body: "b", ts: 1, state: "queued", refused: undefined }]);
    });
  });
});

// ── the tab bar, through the real navigator ───────────────────────────

describe("the fourth tab", () => {
  // The whole app boots here (session, profile, navigator); under a full parallel run that alone passed 5 s once.
  jest.setTimeout(20_000);
  const secure = (SecureStore as unknown as { __store: Map<string, string> }).__store;

  async function signedIn(chatRoutes: Record<string, unknown>) {
    secure.clear();
    secure.set(REFRESH_TOKEN_KEY, "R");
    await AsyncStorage.clear();
    stubApi({
      "/auth/soul/refresh/": { status: 200, data: { access: "A", refresh: "R2" } },
      "/me/": { status: 200, data: PROFILE },
      "/me/life/": { status: 200, data: { cycle: 1, records: [], judgments: [], dispositions: [], rebirth_applications: [], reincarnation: null } },
      "/me/rebirth-applications/": { status: 200, data: { can_apply: false, reason: "not_eligible", cooldown_until: null, results: [] } },
      ...(chatRoutes as Record<string, { status: number; data?: unknown }>),
    });
    render(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
        <I18nProvider>
          <SessionProvider>
            <RootNavigator />
          </SessionProvider>
        </I18nProvider>
      </SafeAreaProvider>
    );
    await screen.findByTestId("tab-Life");
  }

  it("four tabs: 本世 / 转生 / 书信 / 朋友圈 — 前世 is no tab; 转生申请's tab reads 转生 while its screen keeps the full name", async () => {
    jest.restoreAllMocks(); // real time: the navigator's own timers
    await signedIn({
      "/me/chat/conversations/": { status: 200, data: [] },
      "/me/chat/session/": { status: 503, data: { code: "chat_unavailable" } },
    });
    const tabs = screen.getAllByRole("tab").map((tab) => tab.props.accessibilityLabel);
    expect(tabs).toEqual(["本世", "转生", "书信", "朋友圈"]);
    expect(screen.queryByTestId("tab-PastLives")).toBeNull();
    fireEvent.press(screen.getByTestId("tab-Applications"));
    expect(await screen.findByText("转生申请")).toBeTruthy();
  });

  it("chat not configured here: no 书信 tab at all", async () => {
    jest.restoreAllMocks();
    await signedIn({
      "/me/chat/conversations/": { status: 503, data: { code: "chat_not_configured" } },
      "/me/chat/session/": { status: 503, data: { code: "chat_not_configured" } },
    });
    await waitFor(() => expect(screen.queryByTestId("tab-Letters")).toBeNull(), { timeout: 5000 });
    expect(screen.getByTestId("tab-Applications")).toBeTruthy();
  });
});
