/**
 * 书信里的图片(2026-10-10):入口、一次最多 4 张、图与文字是两条消息、发送中的遮罩与进度、
 * 失败重试不重复发出、重启之后待发的图仍在、全屏查看(黑底、点一下关、没有保存)。
 *
 * 屏幕测试给 ConversationScreen 一个固定的聊天状态(同 chat.test.tsx);发件箱测试走**真的 ChatProvider**
 * 与 core 的真客户端(`soulHttp` 只换掉网络),Synapse 换成一个只会登录和等待的替身 ——
 * 图片不经 Synapse 发送(文件在后端),所以替身不需要会发消息。
 * 图库与压缩是系统界面 / 原生模块,换成替身(同 circleMedia.test.tsx)。
 * 每个「能」旁边配一个「不能」。
 */
import type { SoulConversation } from "@soulledger/core/api/soul-chat";
import { EMPTY_TIMELINE, matrixHttp, type ChatMessage } from "@soulledger/core/api/matrix";
import { NavigationContainer } from "@react-navigation/native";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";
import { Image } from "expo-image";
import type { ReactNode } from "react";
import { Dimensions, StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ChatContext, ChatProvider, OUTBOX_KEY, type Chat, type Outgoing, useChat } from "../chat";
import { I18nProvider } from "../i18n";
import { installMobilePlatform, persistentStore } from "../platform";
import { ConversationScreen } from "../screens/conversation";
import { forgetChatImageUrls } from "../screens/chatImages";
import { heldReply, stubApi, type Reply } from "./stubApi";

const mockNavigate = jest.fn();
jest.mock("@react-navigation/native", () => {
  const actual = jest.requireActual("@react-navigation/native");
  const { useEffect } = jest.requireActual("react");
  return {
    ...actual,
    useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  };
});

const mockLaunch = jest.fn();
jest.mock("expo-image-picker", () => ({
  launchImageLibraryAsync: (...args: unknown[]) => mockLaunch(...args),
  UIImagePickerPreferredAssetRepresentationMode: { Compatible: "compatible" },
}));

jest.mock("expo-image-manipulator", () => {
  const ref = (uri: string, w: number, h: number) => ({
    uri,
    width: w,
    height: h,
    saveAsync: async () => ({ uri: `file:///cache/${uri.split("/").pop()}-${w}x${h}.jpg`, width: w, height: h }),
  });
  const manipulate = (source: string | ReturnType<typeof ref>) => {
    let size: [number, number] = typeof source === "string" ? [4000, 3000] : [source.width, source.height];
    const from = typeof source === "string" ? source : source.uri;
    const ctx = {
      resize: ({ width, height }: { width?: number; height?: number }) => {
        const [w, h] = size;
        size = width ? [width, Math.round((h * width) / w)] : [Math.round((w * (height ?? h)) / h), height ?? h];
        return ctx;
      },
      renderAsync: async () => ref(from, size[0], size[1]),
    };
    return ctx;
  };
  return { ImageManipulator: { manipulate }, SaveFormat: { JPEG: "jpeg" } };
});

const ME = "@me:hs.test";
const PEER = "@peer:hs.test";
const NOW = Date.parse("2026-10-10T10:45:00+08:00");
const IMG_A = "1b9e8f2a-0000-4000-8000-00000000000a";
const IMG_B = "1b9e8f2a-0000-4000-8000-00000000000b";

const conv = (o: Partial<SoulConversation> = {}) =>
  ({
    id: "c-direct", kind: "DIRECT", room_id: "!direct:hs.test", peer_user: 7, peer_name: "吴长明", hall: "", throttled: false,
    last_request_at: null, responded_at: null, last_message_at: null, created_at: "2026-09-10T00:00:00Z", mutual: true,
    initiated_by_me: false, next_request_at: null, refusal: null, ...o,
  }) as SoulConversation;
const hall = (o: Partial<SoulConversation> = {}) =>
  conv({ id: "c-hall", kind: "OFFICER_INBOX", room_id: "!hall:hs.test", peer_user: null, peer_name: "", hall: "第五殿", mutual: false, ...o });

const text = (id: string, sender: string, body: string, ts: number): ChatMessage => ({ eventId: id, sender, body, ts, officer: null, officerTitle: null, image: null, txnId: null });
const picture = (id: string, sender: string, imageId: string, ts: number, width = 800, height = 600): ChatMessage => ({
  ...text(id, sender, "[图片]", ts),
  image: { id: imageId, width, height },
});

function chatState(o: Partial<Chat> = {}): Chat {
  return {
    availability: "ready", conversations: [], listError: false, gone: {}, timeline: EMPTY_TIMELINE, me: ME, outbox: [], refused: {},
    progress: {}, reload: jest.fn(async () => {}), reconnect: jest.fn(), send: jest.fn(), sendImages: jest.fn(), resend: jest.fn(),
    loadOlder: jest.fn(async () => {}), markRead: jest.fn(), openInbox: jest.fn(async () => hall()), openDirect: jest.fn(async () => conv()), ...o,
  };
}

const frame = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
function shell(chat: Chat, children: ReactNode) {
  return (
    <SafeAreaProvider initialMetrics={frame}>
      <I18nProvider>
        <ChatContext.Provider value={chat}>
          <NavigationContainer>{children}</NavigationContainer>
        </ChatContext.Provider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}

function open(c: SoulConversation, messages: ChatMessage[] = [], extra: Partial<Chat> = {}) {
  const chat = chatState({
    conversations: [c],
    timeline: { since: "s", rooms: { [c.room_id]: { messages, unread: 0, readUpTo: {}, prevBatch: null } } },
    ...extra,
  });
  render(shell(chat, <ConversationScreen id={c.id} />));
  return chat;
}

const view = (id: string, width = 800, height = 600): Reply => ({
  status: 200,
  data: { id, url: `/api/v1/chat-images/${id}/?t=sig-${id}`, width, height },
});

/** As expo-image-picker 57 answers: a readable image has `type: "image"`. */
const picked = (n: number) => ({
  canceled: false,
  assets: Array.from({ length: n }, (_, i) => ({ type: "image", uri: `file:///p${i + 1}.heic`, fileName: `p${i + 1}.heic`, mimeType: "image/heic" })),
});

const outgoing = (o: Partial<Outgoing> = {}): Outgoing => ({
  txnId: "t1", conversationId: "c-direct", roomId: "!direct:hs.test", body: "", ts: NOW, state: "sending",
  image: { uri: "file:///cache/p1.jpg-2048x1536.jpg", name: "p1.jpg", type: "image/jpeg", width: 2048, height: 1536 }, ...o,
});

beforeEach(() => {
  installMobilePlatform();
  persistentStore.remove(OUTBOX_KEY);
  forgetChatImageUrls();
  mockNavigate.mockReset();
  mockLaunch.mockReset();
  jest.spyOn(Date, "now").mockReturnValue(NOW);
  jest.spyOn(Dimensions, "get").mockReturnValue({ width: 390, height: 844, scale: 1, fontScale: 1 });
});
afterEach(() => jest.restoreAllMocks());

// ── 入口 ───────────────────────────────────────────────────────────────

describe("the 图 key", () => {
  it("sits left of the field in a free conversation and in the hall, 44 square", () => {
    for (const c of [conv(), hall()]) {
      const view = render(shell(chatState({ conversations: [c] }), <ConversationScreen id={c.id} />));
      const key = screen.getByTestId("chat-image-add");
      expect(within(key).getByText("图")).toBeTruthy();
      expect(StyleSheet.flatten(key.props.style)).toMatchObject({ width: 44, height: 44 });
      // Left of the field: it comes first in the composer.
      const ids = screen.UNSAFE_root.findAll((n: { type: unknown; props: Record<string, unknown> }) => typeof n.type === "string" && !!n.props.testID).map((n: { props: Record<string, unknown> }) => n.props.testID);
      expect(ids.indexOf("chat-image-add")).toBeLessThan(ids.indexOf("compose"));
      view.unmount();
    }
  });

  it("is not there where an image cannot go: a request room, a locked request, muted, closed, a sealed hall", () => {
    const states: SoulConversation[] = [
      conv({ throttled: true, initiated_by_me: true, mutual: false }), // my request, open
      conv({ throttled: true, initiated_by_me: false, mutual: false }), // theirs, incoming
      conv({ throttled: true, initiated_by_me: true, mutual: false, next_request_at: new Date(NOW + 3_600_000).toISOString() }), // locked
      conv({ refusal: "muted" }),
      conv({ refusal: "closed" }),
      hall({ refusal: "not_current_hall" }),
    ];
    for (const c of states) {
      const rendered = render(shell(chatState({ conversations: [c] }), <ConversationScreen id={c.id} />));
      expect(screen.queryByTestId("chat-image-add")).toBeNull();
      rendered.unmount();
    }
  });

  it("at most 4 per pick: the picker is asked for 4, and a library that hands back more is cut to 4", async () => {
    mockLaunch.mockResolvedValue(picked(6));
    const chat = open(conv());
    fireEvent.press(screen.getByTestId("chat-image-add"));
    await waitFor(() => expect(chat.sendImages).toHaveBeenCalledTimes(1));
    expect(mockLaunch.mock.calls[0][0]).toMatchObject({ selectionLimit: 4, allowsMultipleSelection: true });
    const [, files] = (chat.sendImages as jest.Mock).mock.calls[0];
    expect(files).toHaveLength(4);
    // Compressed the way the circle does it (long edge 2048, JPEG), and the size comes with the file.
    expect(files[0]).toEqual({ uri: "file:///cache/p1.heic-2048x1536.jpg", name: "p1.jpg", type: "image/jpeg", width: 2048, height: 1536 });
  });

  it("while 4 are still on their way, picking more says so and sends nothing", async () => {
    const c = conv();
    const busy = [1, 2, 3, 4].map((n) => outgoing({ txnId: `t${n}`, conversationId: c.id, state: n === 1 ? "sending" : "queued" }));
    const chat = open(c, [], { outbox: busy });
    fireEvent.press(screen.getByTestId("chat-image-add"));
    await act(async () => {});
    expect(mockLaunch).not.toHaveBeenCalled();
    expect(chat.sendImages).not.toHaveBeenCalled();
  });

  it("no photo permission, or closing the picker: nothing is sent", async () => {
    mockLaunch.mockRejectedValueOnce(Object.assign(new Error("denied"), { code: "ERR_USER_REJECTED_PERMISSIONS" }));
    const chat = open(conv());
    fireEvent.press(screen.getByTestId("chat-image-add"));
    await act(async () => {});
    mockLaunch.mockResolvedValueOnce({ canceled: true, assets: null });
    fireEvent.press(screen.getByTestId("chat-image-add"));
    await act(async () => {});
    expect(mockLaunch).toHaveBeenCalledTimes(2);
    expect(chat.sendImages).not.toHaveBeenCalled();
  });
});

// ── 会话里的图片消息 ──────────────────────────────────────────────────

describe("an image in the thread", () => {
  it("is its own message beside the text, drawn at its ratio and at most 60% of the conversation width", async () => {
    stubApi({ [`/me/chat/images/${IMG_A}/`]: view(IMG_A, 800, 600) });
    open(conv(), [text("e1", PEER, "先看图", NOW - 120_000), picture("e2", PEER, IMG_A, NOW - 60_000), text("e3", PEER, "好看吗", NOW - 30_000)]);
    // Three messages, three kinds of row: text · image · text. The image row carries no text of its own.
    expect(screen.getByText("先看图")).toBeTruthy();
    expect(screen.getByText("好看吗")).toBeTruthy();
    const message = screen.getByTestId("chat-image-message");
    expect(within(message).queryByText("[图片]")).toBeNull();
    // 390 wide, 20 of gutter each side: the conversation is 350, 60% of it is 210; 800 × 600 is 4 : 3.
    const tile = StyleSheet.flatten(screen.getByTestId("chat-image").props.style);
    expect(tile).toMatchObject({ width: 210, aspectRatio: 800 / 600 });
    // No more than 60%: a panorama and a portrait both stay inside the same width.
    expect(tile.width).toBeLessThanOrEqual(0.6 * 350);
    await waitFor(() => expect(screen.UNSAFE_getAllByType(Image).length).toBeGreaterThan(0));
  });

  it("is fetched through the backend's signed path, cached by the image's id and not by the address", async () => {
    const calls = stubApi({ [`/me/chat/images/${IMG_A}/`]: view(IMG_A) });
    open(conv(), [picture("e2", PEER, IMG_A, NOW - 60_000)]);
    const image = await waitFor(() => {
      const found = screen.UNSAFE_getAllByType(Image).find((n) => n.props.source?.cacheKey);
      expect(found).toBeTruthy();
      return found!;
    });
    expect(image.props.source.uri).toMatch(/^http:\/\/(localhost|10\.0\.2\.2):8000\/api\/v1\/chat-images\/1b9e8f2a-0000-4000-8000-00000000000a\/\?t=sig-/);
    expect(image.props.source.cacheKey).toBe(`chat-image:${IMG_A}`);
    expect(image.props.source.cacheKey).not.toContain("?t=");
    expect(calls.filter((c) => c.url === `/me/chat/images/${IMG_A}/`)).toHaveLength(1);
    // The same image shown again does not ask again.
    expect(calls.every((c) => !c.url.includes("/send/"))).toBe(true);
  });

  it("the server refusing the address (not a party to the conversation) reads 图片加载失败, never a blank", async () => {
    stubApi({ [`/me/chat/images/${IMG_A}/`]: { status: 404, data: { detail: "找不到这张图片。", code: "not_found" } } });
    open(conv(), [picture("e2", PEER, IMG_A, NOW - 60_000)]);
    expect(await screen.findByTestId("chat-image-broken")).toBeTruthy();
    expect(screen.getByText("图片加载失败")).toBeTruthy();
    expect(screen.UNSAFE_queryAllByType(Image)).toHaveLength(0);
  });

  it("a build that does not know images shows the line [图片]: the same event is a plain text message to it", () => {
    // An event whose reference is malformed is not an image at all — it falls back to its body, in an ordinary bubble.
    const odd = { ...text("e9", PEER, "[图片]", NOW - 1000), image: null };
    stubApi({});
    open(conv(), [odd]);
    expect(screen.getByText("[图片]")).toBeTruthy();
    expect(screen.queryByTestId("chat-image-message")).toBeNull();
  });
});

describe("full screen", () => {
  it("black, paged across every image of the thread, one tap closes it — and nothing offers to save", async () => {
    stubApi({ [`/me/chat/images/${IMG_A}/`]: view(IMG_A), [`/me/chat/images/${IMG_B}/`]: view(IMG_B) });
    open(conv(), [picture("e1", PEER, IMG_A, NOW - 90_000), text("e2", PEER, "再来一张", NOW - 60_000), picture("e3", ME, IMG_B, NOW - 30_000)]);
    expect(screen.queryByTestId("chat-image-viewer")).toBeNull();
    // The thread is inverted: the newest (IMG_B) is first in the tree. Tap it — the second image in reading order.
    fireEvent.press(screen.getAllByTestId("chat-image")[0]);
    const viewer = await screen.findByTestId("chat-image-viewer");
    expect(StyleSheet.flatten(viewer.props.style).backgroundColor).toBe("#000000");
    expect(screen.getByTestId("chat-image-viewer-pages").props.horizontal).toBe(true);
    expect(screen.getByTestId("chat-image-viewer-pages").props.pagingEnabled).toBe(true);
    // Opened on the second image (the tapped one), with the first beside it.
    expect(screen.getByTestId("chat-image-viewer-pages").props.contentOffset).toEqual({ x: 390, y: 0 });
    await waitFor(() => expect(screen.getByTestId(`chat-viewer-image-${IMG_B}`)).toBeTruthy());
    expect(screen.getByTestId(`chat-viewer-image-${IMG_A}`).props.contentFit).toBe("contain");
    // No save, no share, no close button: the one control is a tap anywhere. (The "2 / 2" counter is read-only.)
    for (const word of [/保存/, /分享/, /下载/]) expect(screen.queryByText(word)).toBeNull();
    expect(screen.queryByLabelText(/保存|save/i)).toBeNull();
    fireEvent.press(screen.getAllByLabelText("关闭")[0]);
    await waitFor(() => expect(screen.queryByTestId("chat-image-viewer")).toBeNull());
  });

  it("counter: none for a single image", async () => {
    stubApi({ [`/me/chat/images/${IMG_A}/`]: view(IMG_A), [`/me/chat/images/${IMG_B}/`]: view(IMG_B) });
    open(conv(), [picture("e1", PEER, IMG_A, NOW - 90_000)]);
    fireEvent.press(screen.getAllByTestId("chat-image")[0]);
    await screen.findByTestId("chat-image-viewer");
    expect(screen.queryByTestId("chat-image-viewer-counter")).toBeNull(); // one image: nothing to count
    fireEvent.press(screen.getAllByLabelText("关闭")[0]);
    await waitFor(() => expect(screen.queryByTestId("chat-image-viewer")).toBeNull());
  });

  it("counter on several images follows the swipe", async () => {
    stubApi({ [`/me/chat/images/${IMG_A}/`]: view(IMG_A), [`/me/chat/images/${IMG_B}/`]: view(IMG_B) });
    open(conv(), [picture("e1", PEER, IMG_A, NOW - 90_000), picture("e3", ME, IMG_B, NOW - 30_000)]);
    fireEvent.press(screen.getAllByTestId("chat-image")[0]); // the newest: second in reading order
    await screen.findByTestId("chat-image-viewer");
    const counter = screen.getByTestId("chat-image-viewer-counter");
    expect(counter.props.children).toBe("2 / 2");
    const style = StyleSheet.flatten(counter.props.style);
    expect([style.fontSize, style.color]).toEqual([13, "#FFFFFF"]);
    expect(counter.props.accessibilityLabel).toBe("图片 2 / 2");
    fireEvent(screen.getByTestId("chat-image-viewer-pages"), "momentumScrollEnd", { nativeEvent: { contentOffset: { x: 0, y: 0 } } });
    expect(screen.getByTestId("chat-image-viewer-counter").props.children).toBe("1 / 2");
  });
});

// ── 发送中与失败 ───────────────────────────────────────────────────────

describe("an image on its way", () => {
  it("sending: the file under a translucent mask with the progress; still its own message, no text", () => {
    open(conv(), [], { outbox: [outgoing()], progress: { t1: 0.3 } });
    expect(screen.getByTestId("pending-image-sending")).toBeTruthy();
    const mask = screen.getByTestId("pending-image-mask");
    // The theme's scrim: translucent, not an opaque cover.
    expect(StyleSheet.flatten(mask.props.style).backgroundColor).toMatch(/^rgba\(/);
    expect(screen.getByTestId("pending-image-progress").props.children).toBe("上传中 30%");
    const local = screen.UNSAFE_getAllByType(Image)[0].props;
    expect([local.source.uri, local.cachePolicy]).toEqual(["file:///cache/p1.jpg-2048x1536.jpg", "memory"]);
    // No text bubble beside it, and nothing that offers a retry yet.
    expect(screen.queryByTestId("pending-sending")).toBeNull();
    expect(screen.queryByTestId("resend")).toBeNull();
    expect(screen.queryByTestId("pending-image-error")).toBeNull();
  });

  it("failed: '! 没能发出 · 重试' under the image, and the tap sends it again", () => {
    const chat = open(conv(), [], { outbox: [outgoing({ state: "failed" })] });
    expect(screen.getByTestId("pending-image-error").props.children).toBe("! 没能发出");
    expect(screen.queryByTestId("pending-image-mask")).toBeNull();
    const retry = screen.getByTestId("resend");
    expect(within(retry).getByText(" · 重试")).toBeTruthy();
    fireEvent.press(retry);
    expect(chat.resend).toHaveBeenCalledWith("t1");
  });

  it("failed for a reason that will not change (the file is refused, a mute): says why and offers no retry", () => {
    open(conv(), [], { outbox: [outgoing({ state: "failed", refused: { code: "too_large", retryAt: null } })] });
    expect(screen.getByTestId("pending-image-error")).toBeTruthy();
    expect(screen.getByTestId("pending-image-reason").props.children).toBe("每张不超过 5 MB");
    expect(screen.queryByTestId("resend")).toBeNull();
  });
});

// ── 发件箱(真 ChatProvider) ─────────────────────────────────────────

/** Synapse as far as images need it: log in, then a long-poll that waits. Images never go to Synapse. */
class QuietSynapse {
  private waiters: (() => void)[] = [];
  release() {
    this.waiters.splice(0).forEach((w) => w());
  }
  install() {
    matrixHttp.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
      const url = (config.url ?? "").replace("http://hs.test", "");
      const method = (config.method ?? "get").toUpperCase();
      const ok = (data: unknown) => ({ status: 200, data, headers: {}, config, statusText: "" }) as AxiosResponse;
      if (method === "POST" && url === "/_matrix/client/v3/login") return ok({ access_token: "tok", user_id: ME, device_id: "DEV1" });
      if (method === "GET" && url === "/_matrix/client/v3/sync") {
        if (Number(config.params?.timeout) > 0) await new Promise<void>((resolve) => this.waiters.push(resolve));
        return ok({ next_batch: "1", rooms: {} });
      }
      if (/\/receipt\//.test(url)) return ok({});
      throw new AxiosError(`unscripted Matrix request: ${method} ${url}`, "ERR_BAD_REQUEST", config);
    };
  }
}

describe("the outbox with images (real ChatProvider)", () => {
  let synapse: QuietSynapse;
  let probe: Chat;
  function Probe() {
    probe = useChat();
    return null;
  }
  const session = { status: 200, data: { homeserver: "http://hs.test", user_id: ME, login_type: "org.matrix.login.jwt", token: "jwt", expires_in: 60 } };
  const UP = "/me/chat/conversations/c-direct/images/";
  const files = [
    { uri: "file:///cache/a.jpg", name: "a.jpg", type: "image/jpeg", width: 2048, height: 1536 },
    { uri: "file:///cache/b.jpg", name: "b.jpg", type: "image/jpeg", width: 1000, height: 1000 },
  ];
  const stored = () => JSON.parse(persistentStore.get(OUTBOX_KEY) ?? "null");
  const start = (account = "SL-CN-000042") =>
    render(
      <ChatProvider account={account}>
        <Probe />
      </ChatProvider>
    );

  beforeEach(() => {
    synapse = new QuietSynapse();
    synapse.install();
  });
  afterEach(() => synapse.release());

  it("two images: uploaded and sent one at a time, in the order picked — each its own message, none of them text", async () => {
    const calls = stubApi({
      "/me/chat/conversations/": { status: 200, data: [conv()] },
      "/me/chat/session/": session,
      [UP]: [
        { status: 201, data: { id: IMG_A, width: 2048, height: 1536 } },
        { status: 201, data: { id: IMG_B, width: 1000, height: 1000 } },
      ],
      [`/me/chat/images/${IMG_A}/send/`]: { status: 201, data: { event_id: "$a" } },
      [`/me/chat/images/${IMG_B}/send/`]: { status: 201, data: { event_id: "$b" } },
    });
    const view = start();
    await waitFor(() => expect(probe.availability).toBe("ready"));
    await act(async () => probe.sendImages(conv(), files));
    await waitFor(() => expect(probe.outbox.map((o) => o.state)).toEqual(["sent", "sent"]));
    const image = calls.filter((c) => c.url.startsWith("/me/chat/") && /images/.test(c.url)).map((c) => `${c.method} ${c.url}`);
    expect(image).toEqual([`POST ${UP}`, `POST /me/chat/images/${IMG_A}/send/`, `POST ${UP}`, `POST /me/chat/images/${IMG_B}/send/`]);
    expect(probe.outbox.map((o) => [o.body, o.eventId])).toEqual([["", "$a"], ["", "$b"]]);
    // Not a single text send: images are never mixed into one.
    expect(calls.filter((c) => /\/messages\/$/.test(c.url))).toEqual([]);
    view.unmount();
  });

  it("progress is visible while the file goes up, and gone once it has", async () => {
    const held = heldReply();
    stubApi({
      "/me/chat/conversations/": { status: 200, data: [conv()] },
      "/me/chat/session/": session,
      [UP]: held.reply,
      [`/me/chat/images/${IMG_A}/send/`]: { status: 201, data: { event_id: "$a" } },
    });
    const view = start();
    await waitFor(() => expect(probe.availability).toBe("ready"));
    await act(async () => probe.sendImages(conv(), [files[0]]));
    const txn = probe.outbox[0].txnId;
    await waitFor(() => expect(probe.progress[txn]).toBe(0.3)); // the stub reports 30%
    expect(probe.outbox[0].state).toBe("sending");
    await act(async () => held.answer({ status: 201, data: { id: IMG_A, width: 2048, height: 1536 } }));
    await waitFor(() => expect(probe.outbox[0].state).toBe("sent"));
    expect(probe.progress[txn]).toBeUndefined();
    view.unmount();
  });

  it("a failed send is retried WITHOUT uploading again, and what the server gets twice is one image id — one letter, not two", async () => {
    const calls = stubApi({
      "/me/chat/conversations/": { status: 200, data: [conv()] },
      "/me/chat/session/": session,
      [UP]: { status: 201, data: { id: IMG_A, width: 2048, height: 1536 } },
      [`/me/chat/images/${IMG_A}/send/`]: [{ status: 500, data: { detail: "boom" } }, { status: 201, data: { event_id: "$a" } }],
    });
    const view = start();
    await waitFor(() => expect(probe.availability).toBe("ready"));
    await act(async () => probe.sendImages(conv(), [files[0]]));
    await waitFor(() => expect(probe.outbox[0].state).toBe("failed"));
    expect(probe.outbox[0].refused).toBeUndefined(); // a fault, not a verdict: the retry may work
    expect(probe.outbox[0].image?.imageId).toBe(IMG_A);
    await act(async () => probe.resend(probe.outbox[0].txnId));
    await waitFor(() => expect(probe.outbox[0].state).toBe("sent"));
    expect(calls.filter((c) => c.url === UP)).toHaveLength(1);
    expect(calls.filter((c) => c.url === `/me/chat/images/${IMG_A}/send/`)).toHaveLength(2);
    view.unmount();
  });

  it("a refusal about the file itself is final: no retry is offered, and the other images are not held up", async () => {
    stubApi({
      "/me/chat/conversations/": { status: 200, data: [conv()] },
      "/me/chat/session/": session,
      [UP]: [{ status: 400, data: { detail: "no", code: "too_large" } }, { status: 201, data: { id: IMG_B, width: 1000, height: 1000 } }],
      [`/me/chat/images/${IMG_B}/send/`]: { status: 201, data: { event_id: "$b" } },
    });
    const view = start();
    await waitFor(() => expect(probe.availability).toBe("ready"));
    await act(async () => probe.sendImages(conv(), files));
    await waitFor(() => expect(probe.outbox.map((o) => o.state)).toEqual(["failed", "sent"]));
    expect(probe.outbox[0].refused).toEqual({ code: "too_large", retryAt: null });
    // A verdict about one file is not a fact about the conversation.
    expect(probe.refused).toEqual({});
    view.unmount();
  });

  it("a conversation-wide refusal (muted) fails the image and is remembered for the conversation", async () => {
    stubApi({
      "/me/chat/conversations/": { status: 200, data: [conv()] },
      "/me/chat/session/": session,
      [UP]: { status: 403, data: { detail: "muted", code: "muted" } },
    });
    const view = start();
    await waitFor(() => expect(probe.availability).toBe("ready"));
    await act(async () => probe.sendImages(conv(), [files[0]]));
    await waitFor(() => expect(probe.outbox[0].state).toBe("failed"));
    expect(probe.outbox[0].refused?.code).toBe("muted");
    await waitFor(() => expect(probe.refused["c-direct"]?.code).toBe("muted"));
    view.unmount();
  });

  describe("across a restart", () => {
    it("killed before the file went up: the next start uploads it and sends it — once", async () => {
      stubApi({ "/me/chat/conversations/": { status: 200, data: [conv()] }, "/me/chat/session/": session, [UP]: "offline" });
      const first = start();
      await waitFor(() => expect(probe.availability).toBe("ready"));
      await act(async () => probe.sendImages(conv(), [files[0]]));
      await waitFor(() => expect(probe.outbox[0].state).toBe("queued"));
      // On disk: the compressed file's path, not the picture.
      expect(stored()).toMatchObject({ owner: "SL-CN-000042", items: [{ body: "", image: { uri: "file:///cache/a.jpg", name: "a.jpg" } }] });
      expect(JSON.stringify(stored())).not.toContain("base64");
      first.unmount();

      const calls = stubApi({
        "/me/chat/conversations/": { status: 200, data: [conv()] },
        "/me/chat/session/": session,
        [UP]: { status: 201, data: { id: IMG_A, width: 2048, height: 1536 } },
        [`/me/chat/images/${IMG_A}/send/`]: { status: 201, data: { event_id: "$a" } },
      });
      const second = start();
      await waitFor(() => expect(probe.outbox[0]?.state).toBe("sent"));
      expect(calls.filter((c) => c.url === UP)).toHaveLength(1);
      expect(calls.filter((c) => c.url.endsWith("/send/"))).toHaveLength(1);
      await waitFor(() => expect(persistentStore.get(OUTBOX_KEY)).toBeNull());
      second.unmount();
    });

    it("killed after the upload but before the send: the next start sends the SAME uploaded image — no second upload, no second letter", async () => {
      stubApi({
        "/me/chat/conversations/": { status: 200, data: [conv()] },
        "/me/chat/session/": session,
        [UP]: { status: 201, data: { id: IMG_A, width: 2048, height: 1536 } },
        [`/me/chat/images/${IMG_A}/send/`]: "offline",
      });
      const first = start();
      await waitFor(() => expect(probe.availability).toBe("ready"));
      await act(async () => probe.sendImages(conv(), [files[0]]));
      await waitFor(() => expect(probe.outbox[0].state).toBe("queued"));
      await waitFor(() => expect(stored()?.items[0]?.image?.imageId).toBe(IMG_A));
      first.unmount();

      const calls = stubApi({
        "/me/chat/conversations/": { status: 200, data: [conv()] },
        "/me/chat/session/": session,
        [`/me/chat/images/${IMG_A}/send/`]: { status: 201, data: { event_id: "$a" } },
      });
      const second = start();
      await waitFor(() => expect(probe.outbox[0]?.state).toBe("sent"));
      expect(calls.filter((c) => c.url === UP)).toEqual([]); // nothing uploaded again
      expect(calls.filter((c) => c.url.endsWith("/send/")).map((c) => c.url)).toEqual([`/me/chat/images/${IMG_A}/send/`]);
      second.unmount();
    });

    it("another account signing in finds none of it, and a record without a file path reads as nothing", async () => {
      stubApi({ "/me/chat/conversations/": { status: 200, data: [conv()] }, "/me/chat/session/": session, [UP]: "offline" });
      const first = start("SL-CN-000042");
      await waitFor(() => expect(probe.availability).toBe("ready"));
      await act(async () => probe.sendImages(conv(), [files[0]]));
      first.unmount();
      const second = start("SL-EU-000007");
      await waitFor(() => expect(probe.availability).toBe("ready"));
      expect(probe.outbox).toEqual([]);
      second.unmount();

      persistentStore.set(OUTBOX_KEY, JSON.stringify({ owner: "SL-CN-000042", items: [{ txnId: "t", conversationId: "c", roomId: "r", body: "", ts: 1, state: "queued", image: { name: "x" } }] }));
      const { readOutbox } = jest.requireActual("../chat") as typeof import("../chat");
      expect(readOutbox("SL-CN-000042").items).toEqual([]);
    });
  });
});
