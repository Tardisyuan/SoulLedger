/**
 * 写给本殿 (Design 第二十八批 S5): the form, and that it is a letter -- through the REAL ChatProvider and core's real soul
 * client, so the outbox is the letters' own: queued when offline, kept across a restart, and the state under the form is
 * the letters' receipt. Synapse is a double that only logs in and waits (letters to the hall go through the backend);
 * the photo library and the compressor are doubles (same as chatImages.test.tsx).
 */
import type { SoulConversation } from "@soulledger/core/api/soul-chat";
import { matrixHttp } from "@soulledger/core/api/matrix";
import { NavigationContainer } from "@react-navigation/native";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ChatProvider, OUTBOX_KEY } from "../chat";
import { I18nProvider } from "../i18n";
import { installMobilePlatform, persistentStore } from "../platform";
import { FEEDBACK_SHOT_MAX, FeedbackScreen } from "../screens/writeToHall";
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
    const size: [number, number] = typeof source === "string" ? [1000, 800] : [source.width, source.height];
    const from = typeof source === "string" ? source : source.uri;
    const ctx = { resize: () => ctx, renderAsync: async () => ref(from, size[0], size[1]) };
    return ctx;
  };
  return { ImageManipulator: { manipulate }, SaveFormat: { JPEG: "jpeg" } };
});

const ME = "@me:hs.test";
const SESSION: Reply = { status: 200, data: { homeserver: "http://hs.test", user_id: ME, login_type: "org.matrix.login.jwt", token: "jwt", expires_in: 60 } };
const HALL = {
  id: "c-hall", kind: "OFFICER_INBOX", room_id: "!hall:hs.test", peer_user: null, peer_name: "", hall: "第五殿", throttled: false,
  last_request_at: null, responded_at: null, last_message_at: null, created_at: "2026-09-10T00:00:00Z", mutual: false,
  initiated_by_me: false, next_request_at: null, refusal: null,
} as SoulConversation;
const SEND = "/me/chat/conversations/c-hall/messages/";
const UPLOAD = "/me/chat/conversations/c-hall/images/";
const IMG = (n: number) => `1b9e8f2a-0000-4000-8000-00000000000${n}`;

/** Synapse as far as the hall needs it: log in, then a long-poll that waits. */
class QuietSynapse {
  private waiters: (() => void)[] = [];
  /** Resolves when the provider has logged in and is waiting on /sync: everything it does on the way up has landed. */
  polling: Promise<void>;
  private polled!: () => void;
  constructor() {
    this.polling = new Promise<void>((resolve) => (this.polled = resolve));
  }
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
        if (Number(config.params?.timeout) > 0) {
          this.polled();
          await new Promise<void>((resolve) => this.waiters.push(resolve));
        }
        return ok({ next_batch: "1", rooms: {} });
      }
      throw new AxiosError(`unscripted Matrix request: ${method} ${url}`, "ERR_BAD_REQUEST", config);
    };
  }
}

const picked = (n: number) => ({
  canceled: false,
  assets: Array.from({ length: n }, (_, i) => ({ type: "image", uri: `file:///s${i + 1}.png`, fileName: `s${i + 1}.png`, mimeType: "image/png" })),
});

let synapse: QuietSynapse;
function renderForm() {
  return render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
      <I18nProvider>
        <ChatProvider account="QU33Q9FW5F">
          <NavigationContainer>
            <FeedbackScreen />
          </NavigationContainer>
        </ChatProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}

const type = (text: string) => fireEvent.changeText(screen.getByTestId("feedback-body"), text);
/** The provider is up (list loaded, signed in to Synapse, waiting on /sync); updates after this are the test's own. */
const up = () => act(async () => void (await synapse.polling));
const sends = (calls: { method: string; url: string; body: unknown }[]) => calls.filter((c) => c.url === SEND);
const stored = () => JSON.parse(persistentStore.get(OUTBOX_KEY) ?? "null");

beforeEach(() => {
  installMobilePlatform();
  persistentStore.remove(OUTBOX_KEY);
  mockNavigate.mockReset();
  mockLaunch.mockReset();
  synapse = new QuietSynapse();
  synapse.install();
});
afterEach(() => synapse.release());

describe("the form", () => {
  it("opens with the four categories (the first chosen), 「说说情况」, no screenshots yet, the note, and 「发出」 off until something is written", async () => {
    stubApi({ "/me/chat/conversations/": { status: 200, data: [HALL] }, "/me/chat/session/": SESSION });
    renderForm();
    await up();
    expect(["account", "record", "app", "other"].map((k) => within(screen.getByTestId(`kind-${k}`)).getAllByText(/./)[0].props.children)).toEqual(["登录与账号", "我的记录有误", "App 出了问题", "其他"]);
    expect(screen.getByTestId("kind-account").props.accessibilityState.checked).toBe(true);
    for (const k of ["record", "app", "other"]) expect(screen.getByTestId(`kind-${k}`).props.accessibilityState.checked).toBe(false);
    expect(screen.getByText("说说情况")).toBeTruthy();
    expect(screen.getByPlaceholderText("发生了什么、在哪一页")).toBeTruthy();
    expect(screen.getByText(/可选，最多 3 张/)).toBeTruthy();
    expect(screen.getByTestId("shot-add")).toBeTruthy();
    expect(screen.queryByTestId("shot-0")).toBeNull();
    expect(screen.getByTestId("feedback-note")).toHaveTextContent("本殿官员会在书信里回你，和平常的书信在一处。");
    expect(screen.getByTestId("feedback-send").props.accessibilityState.disabled).toBe(true);
    type("   ");
    expect(screen.getByTestId("feedback-send").props.accessibilityState.disabled).toBe(true);
    type("登录一直转圈");
    expect(screen.getByTestId("feedback-send").props.accessibilityState.disabled).toBe(false);
  });

  it("the grey line 「对审判结果有异议，请走申诉。」 shows for 「我的记录有误」 and for no other category", async () => {
    stubApi({ "/me/chat/conversations/": { status: 200, data: [HALL] }, "/me/chat/session/": SESSION });
    renderForm();
    await up();
    expect(screen.queryByTestId("feedback-appeal-hint")).toBeNull();
    fireEvent.press(screen.getByTestId("kind-record"));
    expect(screen.getByTestId("feedback-appeal-hint")).toHaveTextContent("对审判结果有异议，请走申诉。");
    expect(screen.getByTestId("kind-record").props.accessibilityState.checked).toBe(true);
    expect(screen.getByTestId("kind-account").props.accessibilityState.checked).toBe(false);
    for (const k of ["app", "other", "account"]) {
      fireEvent.press(screen.getByTestId(`kind-${k}`));
      expect(screen.queryByTestId("feedback-appeal-hint")).toBeNull();
    }
  });
});

describe("screenshots", () => {
  it("at most three: the picker is asked for what is left, the + goes when the third is in, and removing one brings it back", async () => {
    stubApi({ "/me/chat/conversations/": { status: 200, data: [HALL] }, "/me/chat/session/": SESSION });
    renderForm();
    mockLaunch.mockResolvedValueOnce(picked(2));
    fireEvent.press(screen.getByTestId("shot-add"));
    await screen.findByTestId("shot-1");
    expect(mockLaunch.mock.calls[0][0]).toMatchObject({ selectionLimit: FEEDBACK_SHOT_MAX, allowsMultipleSelection: true });
    expect(screen.getByTestId("shot-add")).toBeTruthy();
    mockLaunch.mockResolvedValueOnce(picked(1));
    fireEvent.press(screen.getByTestId("shot-add"));
    await screen.findByTestId("shot-2");
    expect(mockLaunch.mock.calls[1][0]).toMatchObject({ selectionLimit: 1 });
    expect(screen.queryByTestId("shot-add")).toBeNull();
    expect(screen.queryByTestId("shot-3")).toBeNull();
    fireEvent.press(screen.getByTestId("shot-remove-0"));
    expect(screen.queryByTestId("shot-2")).toBeNull();
    expect(screen.getByTestId("shot-add")).toBeTruthy();
  });

  it("a picker that returns more than asked still ends at three", async () => {
    stubApi({ "/me/chat/conversations/": { status: 200, data: [HALL] }, "/me/chat/session/": SESSION });
    renderForm();
    mockLaunch.mockResolvedValueOnce(picked(6));
    fireEvent.press(screen.getByTestId("shot-add"));
    await screen.findByTestId("shot-2");
    expect(screen.queryByTestId("shot-3")).toBeNull();
  });
});

describe("sending (the letters' own outbox)", () => {
  it("goes to the hall as one letter with its category, then shows the letters' 「已送达」 and the way to the thread; the form is gone", async () => {
    const calls = stubApi({
      "/me/chat/conversations/": { status: 200, data: [HALL] },
      "/me/chat/session/": SESSION,
      [`POST ${SEND}`]: { status: 201, data: { event_id: "$1" } },
    });
    renderForm();
    await waitFor(() => expect(calls.some((c) => c.url === "/me/chat/conversations/")).toBe(true));
    fireEvent.press(screen.getByTestId("kind-app"));
    type("  打开书信页就闪退  ");
    await act(async () => {
      fireEvent.press(screen.getByTestId("feedback-send"));
    });
    await waitFor(() => expect(screen.getByTestId("feedback-receipt")).toHaveTextContent("已送达"));
    const [letter] = sends(calls);
    expect(letter.body).toMatchObject({ body: "打开书信页就闪退", feedback_tag: "app" });
    expect((letter.body as { txn_id: string }).txn_id).toMatch(/^sl/);
    expect(sends(calls)).toHaveLength(1);
    // the form is gone, and the way on is the letters
    expect(screen.queryByTestId("feedback-send")).toBeNull();
    expect(screen.queryByTestId("feedback-body")).toBeNull();
    fireEvent.press(screen.getByTestId("feedback-see-letters"));
    expect(mockNavigate).toHaveBeenCalledWith("Tabs", { screen: "Letters" });
  });

  it("the category of the letter is the one chosen, whichever it is (the default is not hard-wired)", async () => {
    const calls = stubApi({
      "/me/chat/conversations/": { status: 200, data: [HALL] },
      "/me/chat/session/": SESSION,
      [`POST ${SEND}`]: { status: 201, data: { event_id: "$1" } },
    });
    renderForm();
    await waitFor(() => expect(calls.some((c) => c.url === "/me/chat/conversations/")).toBe(true));
    fireEvent.press(screen.getByTestId("kind-record"));
    type("功过少了一条");
    await act(async () => {
      fireEvent.press(screen.getByTestId("feedback-send"));
    });
    await waitFor(() => expect(sends(calls)).toHaveLength(1));
    expect(sends(calls)[0].body).toMatchObject({ feedback_tag: "record" });
  });

  it("offline it is queued, says 「等待送出」, is kept across a restart WITH its category, and goes out when the network is back", async () => {
    let calls = stubApi({
      "/me/chat/conversations/": { status: 200, data: [HALL] },
      "/me/chat/session/": SESSION,
      [`POST ${SEND}`]: "offline",
    });
    const view = renderForm();
    await waitFor(() => expect(calls.some((c) => c.url === "/me/chat/conversations/")).toBe(true));
    fireEvent.press(screen.getByTestId("kind-other"));
    type("想问一件事");
    await act(async () => {
      fireEvent.press(screen.getByTestId("feedback-send"));
    });
    await waitFor(() => expect(screen.getByTestId("feedback-receipt")).toHaveTextContent("等待送出"));
    await waitFor(() => expect(stored().items).toHaveLength(1));
    expect(stored().items[0]).toMatchObject({ body: "想问一件事", feedbackTag: "other", state: "queued" });
    view.unmount();
    synapse.release();

    // a new process: the same letter comes back from disk and goes with its category
    synapse = new QuietSynapse();
    synapse.install();
    calls = stubApi({
      "/me/chat/conversations/": { status: 200, data: [HALL] },
      "/me/chat/session/": SESSION,
      [`POST ${SEND}`]: { status: 201, data: { event_id: "$9" } },
    });
    renderForm();
    await waitFor(() => expect(sends(calls)).toHaveLength(1));
    expect(sends(calls)[0].body).toMatchObject({ body: "想问一件事", feedback_tag: "other" });
  });

  it("screenshots follow the text as letter images: upload then send, one at a time, in the order picked", async () => {
    const calls = stubApi({
      "/me/chat/conversations/": { status: 200, data: [HALL] },
      "/me/chat/session/": SESSION,
      [`POST ${SEND}`]: { status: 201, data: { event_id: "$1" } },
      [UPLOAD]: [
        { status: 201, data: { id: IMG(1), width: 1000, height: 800 } },
        { status: 201, data: { id: IMG(2), width: 1000, height: 800 } },
      ],
      [`/me/chat/images/${IMG(1)}/send/`]: { status: 201, data: { event_id: "$a" } },
      [`/me/chat/images/${IMG(2)}/send/`]: { status: 201, data: { event_id: "$b" } },
    });
    renderForm();
    await waitFor(() => expect(calls.some((c) => c.url === "/me/chat/conversations/")).toBe(true));
    mockLaunch.mockResolvedValueOnce(picked(2));
    fireEvent.press(screen.getByTestId("shot-add"));
    await screen.findByTestId("shot-1");
    type("页面是空白的");
    await act(async () => {
      fireEvent.press(screen.getByTestId("feedback-send"));
    });
    await waitFor(() => expect(screen.getByTestId("feedback-receipt")).toHaveTextContent("已送达"));
    const letter = calls.filter((c) => c.url.startsWith("/me/chat/") && (c.url === SEND || /images/.test(c.url))).map((c) => `${c.method} ${c.url}`);
    expect(letter).toEqual([`POST ${SEND}`, `POST ${UPLOAD}`, `POST /me/chat/images/${IMG(1)}/send/`, `POST ${UPLOAD}`, `POST /me/chat/images/${IMG(2)}/send/`]);
    // only the text carries the category; the pictures are plain letter images
    expect(sends(calls)[0].body).toMatchObject({ feedback_tag: "account" });
  });

  it("a letter the server refuses shows 「未送出」 with the letters' own 「重发」", async () => {
    const calls = stubApi({
      "/me/chat/conversations/": { status: 200, data: [HALL] },
      "/me/chat/session/": SESSION,
      [`POST ${SEND}`]: [{ status: 409, data: { detail: "x", code: "closed" } }, { status: 201, data: { event_id: "$2" } }],
    });
    renderForm();
    await waitFor(() => expect(calls.some((c) => c.url === "/me/chat/conversations/")).toBe(true));
    type("还能写吗");
    await act(async () => {
      fireEvent.press(screen.getByTestId("feedback-send"));
    });
    await waitFor(() => expect(screen.getByTestId("feedback-receipt")).toHaveTextContent("未送出"));
    await act(async () => {
      fireEvent.press(screen.getByTestId("feedback-resend"));
    });
    await waitFor(() => expect(screen.getByTestId("feedback-receipt")).toHaveTextContent("已送达"));
    expect(screen.queryByTestId("feedback-resend")).toBeNull();
  });

  it("while it is going out the receipt says so, and 「再写一封」 returns a clean form", async () => {
    const held = heldReply();
    const calls = stubApi({
      "/me/chat/conversations/": { status: 200, data: [HALL] },
      "/me/chat/session/": SESSION,
      [`POST ${SEND}`]: held.reply,
    });
    renderForm();
    await waitFor(() => expect(calls.some((c) => c.url === "/me/chat/conversations/")).toBe(true));
    type("慢一点");
    await act(async () => {
      fireEvent.press(screen.getByTestId("feedback-send"));
    });
    expect(screen.getByTestId("feedback-receipt")).toHaveTextContent("正在送出");
    await act(async () => held.answer({ status: 201, data: { event_id: "$3" } }));
    await waitFor(() => expect(screen.getByTestId("feedback-receipt")).toHaveTextContent("已送达"));
    fireEvent.press(screen.getByTestId("feedback-another"));
    expect(screen.getByTestId("feedback-body").props.value).toBe("");
    expect(screen.queryByTestId("shot-0")).toBeNull();
  });

  it("when the phone has never seen the hall and cannot reach it, nothing is queued and the form keeps what was written", async () => {
    const calls = stubApi({
      "/me/chat/conversations/": [{ status: 200, data: [] }],
      "/me/chat/session/": SESSION,
      "POST /me/chat/conversations/": "offline",
    });
    renderForm();
    await waitFor(() => expect(calls.some((c) => c.url === "/me/chat/conversations/")).toBe(true));
    type("没网也想写");
    await act(async () => {
      fireEvent.press(screen.getByTestId("feedback-send"));
    });
    await screen.findByTestId("feedback-failed");
    expect(screen.getByText("没有发出去。检查网络后再试。")).toBeTruthy();
    expect(screen.getByTestId("feedback-body").props.value).toBe("没网也想写");
    expect(screen.queryByTestId("feedback-sent")).toBeNull();
    expect(sends(calls)).toHaveLength(0);
    expect(persistentStore.get(OUTBOX_KEY)).toBeNull();
  });

  it("a deployment without letters says so and does not offer to send", async () => {
    stubApi({
      "/me/chat/conversations/": { status: 503, data: { detail: "x", code: "chat_not_configured" } },
      "/me/chat/session/": { status: 503, data: { detail: "x", code: "chat_not_configured" } },
    });
    renderForm();
    await screen.findByTestId("feedback-not-configured");
    type("写了也发不出");
    expect(screen.getByTestId("feedback-send").props.accessibilityState.disabled).toBe(true);
  });
});
