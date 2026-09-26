/**
 * 朋友圈帖子图片:动态流里的方格与全屏查看,写帖子时的上传格。
 *
 * 上传走 core 的真客户端(`soulSocialApi.uploadMedia` → `soulHttp`),只换掉网络;
 * 图库(expo-image-picker)换成一个按测试脚本返回的替身 —— 它是系统界面,不是本 App 的代码。
 * 压缩(expo-image-manipulator)是原生模块,也换成替身:它按 uri 报一个解码后的尺寸,记下缩放与保存参数。
 * 每个「能」都配一个「不能」:发出按钮可用的断言旁边,总有一条它在传图 / 失败时不可用。
 */
import { NavigationContainer } from "@react-navigation/native";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { Dimensions, Image, StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ToastProvider } from "../feedback";
import { I18nProvider } from "../i18n";
import { installMobilePlatform } from "../platform";
import { CircleScreen, ComposePostScreen } from "../screens/circle";
import { gridColumns } from "../screens/circleMedia";
import { themeFor, type ColorScheme } from "../theme";
import { ThemeContext } from "../ui";
import { heldReply, stubApi } from "./stubApi";

const mockPopTo = jest.fn();
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => ({ navigate: jest.fn(), popTo: mockPopTo, goBack: jest.fn(), setOptions: jest.fn() }),
  useRoute: () => ({ params: undefined }),
  useFocusEffect: () => {},
}));

const mockLaunch = jest.fn();
jest.mock("expo-image-picker", () => ({
  launchImageLibraryAsync: (...args: unknown[]) => mockLaunch(...args),
  UIImagePickerPreferredAssetRepresentationMode: { Compatible: "compatible" },
}));

/** uri → 解码后的 [宽, 高];没写的按 4032×3024(手机横拍原图)。`"broken"` 解不开。 */
const mockDims: Record<string, [number, number] | "broken"> = {};
const mockManip: { resize: unknown[]; save: unknown[] } = { resize: [], save: [] };
jest.mock("expo-image-manipulator", () => {
  const ref = (uri: string, w: number, h: number) => ({
    uri,
    width: w,
    height: h,
    saveAsync: async (opts: unknown) => {
      mockManip.save.push(opts);
      return { uri: `file:///cache/${uri.split("/").pop()}-${w}x${h}.jpg`, width: w, height: h };
    },
  });
  type MockRef = ReturnType<typeof ref>;
  const manipulate = (source: string | MockRef) => {
    const from = typeof source === "string" ? source : source.uri;
    let size: [number, number] | "broken" =
      typeof source === "string" ? (mockDims[from] ?? [4032, 3024]) : [source.width, source.height];
    const ctx = {
      resize: ({ width, height }: { width?: number; height?: number }) => {
        mockManip.resize.push({ width, height });
        if (size !== "broken") {
          const [w, h] = size;
          size = width ? [width, Math.round((h * width) / w)] : [Math.round((w * (height ?? h)) / h), height ?? h];
        }
        return ctx;
      },
      renderAsync: async () => {
        if (size === "broken") throw new Error("cannot decode");
        return ref(from, size[0], size[1]);
      },
    };
    return ctx;
  };
  return { ImageManipulator: { manipulate }, SaveFormat: { JPEG: "jpeg", PNG: "png", WEBP: "webp" } };
});

function wrap(children: ReactNode, scheme?: ColorScheme) {
  const inner = scheme ? <ThemeContext.Provider value={themeFor("CHINESE", scheme)}>{children}</ThemeContext.Provider> : children;
  return render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
      <I18nProvider>
        <ToastProvider>
          <NavigationContainer>{inner}</NavigationContainer>
        </ToastProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}

const ZERO = { LIKE: 0, LOVE: 0, RESPECT: 0, SYMPATHY: 0, ETERNAL_LIGHT: 0 };
const media = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `m${i + 1}`, url: `/api/v1/social-media/m${i + 1}/?t=sig${i + 1}`, width: 1080, height: 1080 }));

function post(over: Record<string, unknown> = {}) {
  return {
    id: "p1",
    author: { user_id: 7, display_name: "沈蘅", avatar: null, is_active: true },
    content: "门里的桂花开了。",
    visibility: "PUBLIC",
    moderation_status: "PUBLISHED",
    comment_count: 0,
    reaction_count: 0,
    reaction_counts: ZERO,
    my_reaction: null,
    media: [],
    is_mine: false,
    create_time: "2026-09-17T08:12:00Z",
    ...over,
  };
}
const page = (results: unknown[]) => ({ status: 200, data: { count: results.length, next: null, previous: null, results } });
const STATUS = { status: 200, data: { user_id: 1, can_write: true, muted_until: null, reports_remaining: 5 } };
const uploaded = (id: string) => ({ status: 201, data: { id, url: `/api/v1/social-media/${id}/?t=x`, width: 64, height: 48, byte_size: 900, content_type: "image/png" } });
const picked = (n: number) => ({ canceled: false, assets: Array.from({ length: n }, (_, i) => ({ uri: `file:///p${i + 1}.jpg`, fileName: `p${i + 1}.jpg`, mimeType: "image/jpeg" })) });

beforeEach(() => {
  installMobilePlatform();
  mockPopTo.mockReset();
  mockLaunch.mockReset();
  for (const k of Object.keys(mockDims)) delete mockDims[k];
  mockManip.resize = [];
  mockManip.save = [];
});

describe("gridColumns", () => {
  it("1 is one large tile; 2–4 are two columns; 5–9 are three", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map(gridColumns)).toEqual([1, 2, 2, 2, 3, 3, 3, 3, 3]);
  });
});

describe("feed and viewer", () => {
  const tileWidth = (id: string) => StyleSheet.flatten(screen.getByTestId(id).props.style).width as number;

  it("draws one square tile per image, in the server's order, from the API host", async () => {
    stubApi({ "/me/social/feed/": page([post({ id: "a", media: media(3) }), post({ id: "b", media: [] })]) });
    wrap(<CircleScreen />);
    await screen.findByTestId("post-a");
    expect(screen.getAllByTestId(/^media-a-tile-\d$/)).toHaveLength(3);
    // 文字帖没有方格 —— 不是一个空的方格。
    expect(screen.queryByTestId("media-b")).toBeNull();
    const style = StyleSheet.flatten(screen.getByTestId("media-a-tile-0").props.style);
    expect(style.width).toBe(style.height);
    expect(style.borderRadius).toBe(0);
    const image = screen.getByTestId("media-a-tile-1").findByType(Image);
    expect(image.props.source.uri).toMatch(/^http:\/\/(localhost|10\.0\.2\.2):8000\/api\/v1\/social-media\/m2\/\?t=sig2$/);
  });

  it("one image is large; two columns for 2–4; three for 5–9", async () => {
    stubApi({ "/me/social/feed/": page([post({ id: "one", media: media(1) }), post({ id: "four", media: media(4) }), post({ id: "nine", media: media(9) })]) });
    wrap(<CircleScreen />);
    await screen.findByTestId("post-nine");
    const one = tileWidth("media-one-tile-0");
    const four = tileWidth("media-four-tile-0");
    const nine = tileWidth("media-nine-tile-0");
    expect(one).toBeGreaterThan(four);
    expect(four).toBeGreaterThan(nine);
    expect(screen.getAllByTestId(/^media-nine-tile-\d$/)).toHaveLength(9);
  });

  it("a tile opens the full-screen viewer at that image; close puts it away", async () => {
    stubApi({ "/me/social/feed/": page([post({ id: "a", media: media(3) })]) });
    wrap(<CircleScreen />);
    await screen.findByTestId("post-a");
    expect(screen.queryByTestId("media-viewer")).toBeNull();
    fireEvent.press(screen.getByTestId("media-a-tile-1"));
    expect(await screen.findByTestId("media-viewer")).toBeTruthy();
    expect(screen.getByTestId("media-viewer-counter").props.children).toBe("图片 2 / 3");
    expect(screen.getAllByTestId(/^media-viewer-image-\d$/)).toHaveLength(3);
    // 翻到第三张:计数跟着页走。
    fireEvent(screen.getByTestId("media-viewer-pages"), "momentumScrollEnd", { nativeEvent: { contentOffset: { x: 2 * Dimensions.get("window").width, y: 0 } } });
    expect(screen.getByTestId("media-viewer-counter").props.children).toBe("图片 3 / 3");
    fireEvent.press(screen.getByTestId("media-viewer-close"));
    await waitFor(() => expect(screen.queryByTestId("media-viewer")).toBeNull());
    // 再打开别的一张,从那一张开始,不是上次停下的地方。
    fireEvent.press(screen.getByTestId("media-a-tile-0"));
    expect((await screen.findByTestId("media-viewer-counter")).props.children).toBe("图片 1 / 3");
  });

  it("an image that will not load (expired link, hidden post) says so instead of a blank square", async () => {
    stubApi({ "/me/social/feed/": page([post({ id: "a", media: media(2) })]) });
    wrap(<CircleScreen />);
    await screen.findByTestId("post-a");
    const image = screen.getByTestId("media-a-tile-0").findByType(Image);
    act(() => image.props.onError({ nativeEvent: { error: "404" } }));
    expect(screen.getByTestId("media-a-tile-0-broken").props.children).toBe("图片加载失败");
    expect(screen.queryByTestId("media-a-tile-1-broken")).toBeNull();
  });

  it.each(["light", "dark"] as const)("%s: tiles take the theme's hairline and ground", async (scheme) => {
    stubApi({ "/me/social/feed/": page([post({ id: "a", media: media(2) })]) });
    wrap(<CircleScreen />, scheme);
    await screen.findByTestId("post-a");
    const t = themeFor("CHINESE", scheme);
    const style = StyleSheet.flatten(screen.getByTestId("media-a-tile-0").props.style);
    expect([style.borderColor, style.backgroundColor, style.borderRadius]).toEqual([t.hair, t.s2, 0]);
  });
});

describe("composer", () => {
  const submit = () => screen.getByTestId("post-submit");
  const disabled = () => submit().props.accessibilityState.disabled;

  async function openWith(routes: Parameters<typeof stubApi>[0]) {
    const calls = stubApi({ "/me/social/status/": STATUS, ...routes });
    wrap(<ComposePostScreen />);
    await waitFor(() => expect(calls.some((c) => c.url === "/me/social/status/")).toBe(true));
    await act(async () => {});
    return calls;
  }
  async function pick(n: number) {
    mockLaunch.mockResolvedValueOnce(picked(n));
    await act(async () => {
      fireEvent.press(screen.getByTestId("media-add"));
    });
  }

  it("uploads each picked image with its progress; the post waits until all are done, then carries them in order", async () => {
    const first = heldReply();
    const second = heldReply();
    const calls = await openWith({
      "POST /me/social/media/": [first.reply, second.reply],
      "POST /me/social/feed/": { status: 201, data: post({ id: "new", is_mine: true }) },
    });
    fireEvent.changeText(screen.getByTestId("post-body"), "桂花");
    await pick(2);
    expect(mockLaunch).toHaveBeenCalledWith(expect.objectContaining({ selectionLimit: 9, allowsMultipleSelection: true, mediaTypes: ["images"] }));
    expect(screen.getByTestId("upload-0-progress").props.children).toBe("上传中 30%");
    expect(screen.getByTestId("upload-1-progress").props.children).toBe("上传中 30%");
    expect(disabled()).toBe(true);
    expect(screen.getByTestId("post-submit-reason").props.children).toBe("图片传完后才能发出");

    await act(async () => first.answer(uploaded("u1")));
    expect(screen.queryByTestId("upload-0-progress")).toBeNull();
    expect(disabled()).toBe(true); // 还有一张在传
    await act(async () => second.answer(uploaded("u2")));
    expect(disabled()).toBe(false);
    expect(screen.queryByTestId("post-submit-reason")).toBeNull();
    expect(screen.getByTestId("media-count").props.children).toBe("图片 2 / 9");

    fireEvent.press(submit());
    await waitFor(() => expect(mockPopTo).toHaveBeenCalled());
    expect(calls.find((c) => c.url === "/me/social/feed/")?.body).toEqual({ content: "桂花", visibility: "TENANT", media: ["u1", "u2"] });
    // 发出去的图属于帖子了:不删。
    expect(calls.filter((c) => c.method === "DELETE")).toEqual([]);
  });

  it("a failed upload blocks the post until it is retried or removed", async () => {
    const calls = await openWith({
      "POST /me/social/media/": [{ status: 400, data: { detail: "too big", code: "too_large" } }, uploaded("u2"), uploaded("u3")],
    });
    fireEvent.changeText(screen.getByTestId("post-body"), "两张");
    await pick(1);
    await waitFor(() => expect(screen.getByTestId("upload-0-failed")).toBeTruthy());
    expect(disabled()).toBe(true);
    expect(screen.getByTestId("post-submit-reason").props.children).toBe("有图片没传上去：重试或移除");
    expect(await screen.findByText("每张不超过 5 MB")).toBeTruthy(); // 原因:大小

    await act(async () => fireEvent.press(screen.getByTestId("upload-0-retry")));
    await waitFor(() => expect(screen.queryByTestId("upload-0-failed")).toBeNull());
    expect(disabled()).toBe(false);
    expect(calls.filter((c) => c.url === "/me/social/media/")).toHaveLength(2);
  });

  it("removing a failed image needs no request; removing an uploaded one deletes it on the server", async () => {
    const calls = await openWith({
      "POST /me/social/media/": [{ status: 400, data: { detail: "x", code: "not_an_image" } }, uploaded("u2")],
      "DELETE /me/social/media/u2/": { status: 204 },
    });
    await pick(2);
    await waitFor(() => expect(screen.getByTestId("upload-0-failed")).toBeTruthy());
    await waitFor(() => expect(screen.queryByTestId("upload-1-progress")).toBeNull());
    await act(async () => fireEvent.press(screen.getByTestId("upload-0-remove")));
    expect(calls.filter((c) => c.method === "DELETE")).toEqual([]);
    expect(screen.getAllByTestId(/^upload-\d$/)).toHaveLength(1);
    await act(async () => fireEvent.press(screen.getByTestId("upload-0-remove")));
    expect(calls.filter((c) => c.method === "DELETE").map((c) => c.url)).toEqual(["/me/social/media/u2/"]);
    expect(screen.queryByTestId("upload-0")).toBeNull();
  });

  it("images alone make a post; with neither text nor images the button stays off", async () => {
    const calls = await openWith({
      "POST /me/social/media/": uploaded("u1"),
      "POST /me/social/feed/": { status: 201, data: post({ id: "new", is_mine: true, content: "" }) },
    });
    expect(disabled()).toBe(true);
    await pick(1);
    await waitFor(() => expect(disabled()).toBe(false));
    fireEvent.press(submit());
    await waitFor(() => expect(mockPopTo).toHaveBeenCalled());
    expect(calls.find((c) => c.url === "/me/social/feed/")?.body).toEqual({ content: "", visibility: "TENANT", media: ["u1"] });
  });

  it("offers only the room left: nine picked, no add tile; the picker is asked for the remainder", async () => {
    await openWith({ "POST /me/social/media/": [uploaded("u1"), uploaded("u2"), uploaded("u3"), uploaded("u4"), uploaded("u5"), uploaded("u6"), uploaded("u7"), uploaded("u8"), uploaded("u9")] });
    await pick(7);
    expect(mockLaunch).toHaveBeenLastCalledWith(expect.objectContaining({ selectionLimit: 9 }));
    await pick(2);
    expect(mockLaunch).toHaveBeenLastCalledWith(expect.objectContaining({ selectionLimit: 2 }));
    await waitFor(() => expect(screen.getAllByTestId(/^upload-\d$/)).toHaveLength(9));
    expect(screen.queryByTestId("media-add")).toBeNull();
  });

  it("no photo access: says so, adds nothing", async () => {
    await openWith({});
    mockLaunch.mockRejectedValueOnce(new Error("permission denied"));
    await act(async () => fireEvent.press(screen.getByTestId("media-add")));
    expect(await screen.findByText("需要相册权限才能选图")).toBeTruthy();
    expect(screen.queryByTestId("upload-0")).toBeNull();
  });

  /**
   * What each upload appended as its `file` part. The app runs React Native's FormData, which sends
   * `{uri, name, type}` as a file; jest's FormData would stringify it, so the append itself is recorded.
   */
  let appended: unknown[] = [];
  beforeEach(() => {
    appended = [];
    const original = FormData.prototype.append;
    jest.spyOn(FormData.prototype, "append").mockImplementation(function (this: FormData, key: string, value: unknown) {
      if (key === "file") appended.push(value);
      return (original as (_k: string, _v: unknown) => void).call(this, key, value);
    });
  });
  afterEach(() => jest.restoreAllMocks());

  it("compresses before uploading: the long edge goes to 2048, re-encoded as JPEG 0.85", async () => {
    mockDims["file:///p1.jpg"] = [3024, 4032]; // portrait: the long edge is the height
    mockDims["file:///p2.jpg"] = [4032, 3024];
    const calls = await openWith({ "POST /me/social/media/": [uploaded("u1"), uploaded("u2")] });
    await pick(2);
    await waitFor(() => expect(calls.filter((c) => c.url === "/me/social/media/")).toHaveLength(2));
    expect(mockManip.resize).toEqual([{ width: undefined, height: 2048 }, { width: 2048, height: undefined }]);
    expect(mockManip.save).toEqual([{ format: "jpeg", compress: 0.85 }, { format: "jpeg", compress: 0.85 }]);
    const parts = appended;
    expect(parts).toEqual([
      { uri: "file:///cache/p1.jpg-1536x2048.jpg", name: "p1.jpg", type: "image/jpeg" },
      { uri: "file:///cache/p2.jpg-2048x1536.jpg", name: "p2.jpg", type: "image/jpeg" },
    ]);
    // Absence: the original file never goes up.
    expect(JSON.stringify(parts)).not.toContain('"file:///p1.jpg"');
  });

  it("a picture already within 2048 is not scaled, only re-encoded; a PNG comes out as JPEG", async () => {
    mockDims["file:///p1.jpg"] = [2048, 1000];
    const calls = await openWith({ "POST /me/social/media/": uploaded("u1") });
    mockLaunch.mockResolvedValueOnce({ canceled: false, assets: [{ uri: "file:///p1.jpg", fileName: "shot.png", mimeType: "image/png" }] });
    await act(async () => fireEvent.press(screen.getByTestId("media-add")));
    await waitFor(() => expect(calls.some((c) => c.url === "/me/social/media/")).toBe(true));
    expect(mockManip.resize).toEqual([]);
    expect(appended).toEqual([{
      uri: "file:///cache/p1.jpg-2048x1000.jpg",
      name: "shot.jpg",
      type: "image/jpeg",
    }]);
  });

  it("an image the manipulator cannot decode goes up as picked; the server still decides", async () => {
    mockDims["file:///p1.jpg"] = "broken";
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    await openWith({ "POST /me/social/media/": uploaded("u1") });
    await pick(1);
    await waitFor(() => expect(disabled()).toBe(false));
    expect(appended).toEqual([{
      uri: "file:///p1.jpg",
      name: "p1.jpg",
      type: "image/jpeg",
    }]);
    // …and the failure is not swallowed silently: a dev build says why.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("compressForUpload"), expect.objectContaining({ message: "cannot decode" }));
  });

  it("leaving without posting deletes what was uploaded", async () => {
    const calls = await openWith({
      "POST /me/social/media/": uploaded("u1"),
      "DELETE /me/social/media/u1/": { status: 204 },
    });
    await pick(1);
    await waitFor(() => expect(disabled()).toBe(false));
    await act(async () => screen.unmount());
    await waitFor(() => expect(calls.filter((c) => c.method === "DELETE").map((c) => c.url)).toEqual(["/me/social/media/u1/"]));
  });
});
