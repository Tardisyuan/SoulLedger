/**
 * 书信申请的拒绝与拉黑 (2026-11-01 用户拍板 #3): the receiver of a request may turn it down this once or block its
 * sender; the blocked soul is told only 「无法送达」; 设置 › 已拉黑 undoes it. The rules are the server's
 * (backend/tests/test_chat_letters_block_and_decline.py); here, what each refusal code puts on screen, and that the
 * buttons call the right endpoint. The chat state is fixed through `ChatContext`, as in chat.test.tsx.
 */
import { soulChatApi, type SoulConversation } from "@soulledger/core/api/soul-chat";
import { EMPTY_TIMELINE } from "@soulledger/core/api/matrix";
import { NavigationContainer } from "@react-navigation/native";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ChatContext, type Chat } from "../chat";
import { CLOSED_REASONS, chatMode } from "../chatRules";
import { I18nProvider, translate } from "../i18n";
import { installMobilePlatform } from "../platform";
import { ChatBlocksScreen } from "../screens/chatBlocks";
import { ConversationScreen } from "../screens/conversation";

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock("@react-navigation/native", () => {
  const actual = jest.requireActual("@react-navigation/native");
  const { useEffect } = jest.requireActual("react");
  return {
    ...actual,
    useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  };
});

const zh = (key: string, params?: Record<string, string>) => translate("zh-Hans", key, params);
const NOW = Date.parse("2026-11-01T10:00:00+08:00");

function conv(overrides: Partial<SoulConversation> = {}): SoulConversation {
  return {
    id: "c-req",
    kind: "DIRECT",
    room_id: "!req:hs.test",
    peer_user: 7,
    peer_name: "吴长明",
    hall: "",
    throttled: true,
    last_request_at: null,
    responded_at: null,
    last_message_at: null,
    created_at: "2026-10-30T00:00:00Z",
    closed_at: null,
    mutual: false,
    initiated_by_me: false,
    next_request_at: null,
    refusal: null,
    ...overrides,
  } as SoulConversation;
}

function chatState(overrides: Partial<Chat> = {}): Chat {
  return {
    availability: "ready",
    conversations: [],
    listError: false,
    gone: {},
    timeline: EMPTY_TIMELINE,
    me: "@me:hs.test",
    outbox: [],
    refused: {},
    reload: jest.fn(async () => {}),
    reconnect: jest.fn(),
    send: jest.fn(),
    sendImages: jest.fn(),
    progress: {},
    resend: jest.fn(),
    loadOlder: jest.fn(async () => {}),
    markRead: jest.fn(),
    openInbox: jest.fn(async () => conv()),
    openDirect: jest.fn(async () => conv()),
    ...overrides,
  };
}

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
  mockGoBack.mockReset();
  jest.spyOn(Date, "now").mockReturnValue(NOW);
});
afterEach(() => jest.restoreAllMocks());

const facts = { now: NOW, peerHasSpoken: false, iHaveSpoken: false, refused: null };

describe("chatMode — the new refusals are read-only, each with its own reason", () => {
  it("declined / peer_blocked / undeliverable close the conversation, and a refusal met on send does too", () => {
    for (const reason of ["declined", "peer_blocked", "undeliverable"] as const) {
      expect(chatMode(conv({ refusal: reason }), facts)).toEqual({ kind: "closed", reason });
    }
    expect(chatMode(conv(), { ...facts, refused: { code: "undeliverable", retryAt: null } })).toEqual({ kind: "closed", reason: "undeliverable" });
    expect(CLOSED_REASONS).toEqual(["closed", "peer_retired", "declined", "peer_blocked", "undeliverable"]);
  });
});

describe("their request", () => {
  it("拒绝 turns it down this once, reloads the list and leaves the screen", async () => {
    const decline = jest.spyOn(soulChatApi, "decline").mockResolvedValue(undefined);
    const chat = chatState({ conversations: [conv()] });
    wrap(chat, <ConversationScreen id="c-req" />);
    expect(screen.getByTestId("conversation-incoming")).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByTestId("request-decline")));
    expect(decline).toHaveBeenCalledWith("c-req");
    expect(chat.reload).toHaveBeenCalled();
    expect(mockGoBack).toHaveBeenCalled();
  });

  it("拉黑 asks first: cancel sends nothing, confirm blocks and reloads", async () => {
    const block = jest.spyOn(soulChatApi, "block").mockResolvedValue({ id: "b-1", peer_user: 7, peer_name: "吴长明", created_at: "2026-11-01T02:00:00Z" });
    const chat = chatState({ conversations: [conv()] });
    wrap(chat, <ConversationScreen id="c-req" />);
    fireEvent.press(screen.getByTestId("request-block"));
    expect(screen.getByText(zh("soul_app.chat.block.confirm_title", { name: "吴长明" }))).toBeTruthy();
    fireEvent.press(screen.getByTestId("block-cancel"));
    expect(block).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId("request-block"));
    await act(async () => fireEvent.press(screen.getByTestId("block-confirm")));
    expect(block).toHaveBeenCalledWith("c-req");
    expect(chat.reload).toHaveBeenCalled();
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  it("a conversation that is not a request has no 拒绝 / 拉黑 band buttons", () => {
    wrap(chatState({ conversations: [conv({ throttled: false, mutual: true })] }), <ConversationScreen id="c-req" />);
    expect(screen.queryByTestId("request-decline")).toBeNull();
    expect(screen.queryByTestId("request-block")).toBeNull();
  });
});

describe("what each side reads", () => {
  it("the blocked soul reads only 无法送达 — nothing about a block, no composer, no rebirth line", () => {
    wrap(chatState({ conversations: [conv({ initiated_by_me: true, refusal: "undeliverable" })] }), <ConversationScreen id="c-req" />);
    expect(screen.getByTestId("closed-reason").props.children).toBe(zh("soul_app.chat.closed.undeliverable"));
    expect(screen.queryByText(zh("soul_app.chat.closed.peer_blocked"))).toBeNull();
    expect(zh("soul_app.chat.closed.undeliverable")).not.toContain("拉黑");
    expect(screen.queryByTestId("closed-marker")).toBeNull();
  });

  it("a declined request says so, without the 转生 · 会话止于此 line its closed_at would otherwise draw", () => {
    wrap(
      chatState({ conversations: [conv({ initiated_by_me: true, refusal: "declined", closed_at: "2026-10-31T00:00:00Z" })] }),
      <ConversationScreen id="c-req" />
    );
    expect(screen.getByTestId("closed-reason").props.children).toBe(zh("soul_app.chat.closed.declined"));
    expect(screen.queryByTestId("closed-marker")).toBeNull();
  });

  it("the soul who blocked reads where to undo it, and its ⋯ no longer offers 拉黑", () => {
    wrap(chatState({ conversations: [conv({ refusal: "peer_blocked" })] }), <ConversationScreen id="c-req" />);
    expect(screen.getByTestId("closed-reason").props.children).toBe(zh("soul_app.chat.closed.peer_blocked"));
    fireEvent.press(screen.getByTestId("chat-menu"));
    expect(screen.queryByTestId("chat-menu-block")).toBeNull();
    expect(screen.getByTestId("chat-menu-report")).toBeTruthy();
  });
});

describe("设置 › 已拉黑", () => {
  it("lists the blocked souls; 解除 removes a row only after the server says yes", async () => {
    jest.spyOn(soulChatApi, "blocks").mockResolvedValue([
      { id: "b-1", peer_user: 7, peer_name: "吴长明", created_at: "2026-11-01T02:00:00Z" },
      { id: "b-2", peer_user: 8, peer_name: "柳素英", created_at: "2026-10-30T02:00:00Z" },
    ]);
    let answer!: (ok: boolean) => void;
    const unblock = jest.spyOn(soulChatApi, "unblock").mockImplementation(
      () => new Promise<undefined>((resolve, reject) => (answer = (ok) => (ok ? resolve(undefined) : reject(new Error("x")))))
    );
    wrap(chatState(), <ChatBlocksScreen />);
    expect(await screen.findByText("吴长明")).toBeTruthy();
    fireEvent.press(screen.getByTestId("unblock-b-1"));
    expect(unblock).toHaveBeenCalledWith("b-1");
    expect(screen.getByTestId("block-b-1")).toBeTruthy(); // not removed on a guess
    await act(async () => answer(true));
    await waitFor(() => expect(screen.queryByTestId("block-b-1")).toBeNull());
    expect(screen.getByTestId("block-b-2")).toBeTruthy();

    fireEvent.press(screen.getByTestId("unblock-b-2"));
    await act(async () => answer(false));
    expect(screen.getByTestId("block-b-2")).toBeTruthy(); // refused: the row stays
  });

  it("says so when nobody is blocked", async () => {
    jest.spyOn(soulChatApi, "blocks").mockResolvedValue([]);
    wrap(chatState(), <ChatBlocksScreen />);
    expect(await screen.findByTestId("chat-blocks-empty")).toBeTruthy();
  });
});
