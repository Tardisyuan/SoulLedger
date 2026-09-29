/**
 * 朋友圈 (handoff 1a–1e) against core's real soul client, network scripted.
 *
 * The eternal light is final on the server (409 `eternal_light_locked`); here
 * the app must ask before lighting it, and once lit offer no way to take it
 * back or trade it — every assertion on the lamp is paired with one that the
 * other four still work, or a screen that disables everything would pass.
 */
import { NavigationContainer } from "@react-navigation/native";
import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { FlatList, RefreshControl, StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { I18nProvider } from "../i18n";
import { installMobilePlatform } from "../platform";
import { CircleScreen, ComposePostScreen, PostScreen, usePaged } from "../screens/circle";
import { themeFor, type ColorScheme } from "../theme";
import { ThemeContext } from "../ui";
import { heldReply, stubApi } from "./stubApi";
import * as Haptics from "expo-haptics";

const mockPopTo = jest.fn();
const mockNavigate = jest.fn();
const mockSetOptions = jest.fn();
const mockGoBack = jest.fn();
let mockParams: object | undefined;
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => ({ navigate: mockNavigate, popTo: mockPopTo, goBack: mockGoBack, setOptions: mockSetOptions }),
  useRoute: () => ({ params: mockParams }),
  useFocusEffect: () => {},
}));
// The lamp is felt (交互与动效 第 2 轮 §长明灯): the real module, its one call recorded.
jest.mock("expo-haptics", () => ({ ...jest.requireActual("expo-haptics"), notificationAsync: jest.fn(async () => {}) }));

function wrap(children: ReactNode) {
  return render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
      <I18nProvider>
        <NavigationContainer>{children}</NavigationContainer>
      </I18nProvider>
    </SafeAreaProvider>
  );
}

const ZERO = { LIKE: 0, LOVE: 0, RESPECT: 0, SYMPATHY: 0, ETERNAL_LIGHT: 0 };

function post(over: Record<string, unknown> = {}) {
  return {
    id: "p1",
    author: { user_id: 7, display_name: "沈蘅", avatar: null, is_active: true },
    content: "想念母亲做的腌笃鲜。",
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
const MUTED = { status: 200, data: { user_id: 1, can_write: false, muted_until: "2026-09-25T00:00:00", reports_remaining: 5 } };

beforeEach(() => {
  installMobilePlatform();
  mockPopTo.mockReset();
  mockNavigate.mockReset();
  mockSetOptions.mockReset();
  mockGoBack.mockReset();
  mockParams = undefined;
});

describe("feed", () => {
  it("opens on 关注 (following=true), and 本文明 asks without the filter", async () => {
    const calls = stubApi({ "/me/social/feed/": page([post()]) });
    wrap(<CircleScreen />);
    await screen.findByTestId("post-p1");
    expect(screen.getByTestId("circle-following").props.accessibilityState).toEqual({ selected: true });
    fireEvent.press(screen.getByTestId("circle-tenant"));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls.map((c) => c.params?.following)).toEqual([true, false]);
  });

  it("empty, failing, retrying", async () => {
    stubApi({ "/me/social/feed/": ["offline", page([])] });
    wrap(<CircleScreen />);
    expect(await screen.findByText("朋友圈未能连上。你的帖子都还在，只是此刻取不到。")).toBeTruthy();
    expect(screen.queryByTestId("circle-empty")).toBeNull();
    fireEvent.press(screen.getByText("重试"));
    expect(await screen.findByTestId("circle-empty")).toBeTruthy();
    expect(screen.getByText("还没有可看的帖子")).toBeTruthy();
    // 文明气质 1e: a whole-page empty state carries the illustration (neutral here: no theme provided).
    expect(within(screen.getByTestId("circle-empty")).getByTestId("empty-hero-neutral")).toBeTruthy();
    fireEvent.press(screen.getByTestId("circle-write"));
    expect(mockNavigate).toHaveBeenCalledWith("ComposePost");
  });

  it("a card counts each kind apart and shows only the ones that happened", async () => {
    stubApi({ "/me/social/feed/": page([post({ reaction_counts: { ...ZERO, LIKE: 12, ETERNAL_LIGHT: 3 }, comment_count: 6 })]) });
    wrap(<CircleScreen />);
    await screen.findByTestId("post-p1");
    expect(screen.getByTestId("count-LIKE")).toBeTruthy();
    expect(screen.getByTestId("count-ETERNAL_LIGHT")).toBeTruthy();
    expect(screen.queryByTestId("count-LOVE")).toBeNull();
    expect(screen.getByText("评论 6")).toBeTruthy();
  });

  it("my pending post says so, and the banner shows over the feed after sending it", async () => {
    mockParams = { pendingId: "mine" };
    stubApi({ "/me/social/feed/": page([post({ id: "mine", is_mine: true, moderation_status: "PENDING" }), post()]) });
    wrap(<CircleScreen />);
    expect(await screen.findByTestId("pending-banner")).toBeTruthy();
    expect(screen.getByTestId("pending-mine")).toBeTruthy();
    expect(screen.queryByTestId("pending-p1")).toBeNull();
  });

  it("a past life's post is marked 已转世", async () => {
    stubApi({ "/me/social/feed/": page([post({ author: { user_id: 3, display_name: "顾衡", avatar: null, is_active: false } })]) });
    wrap(<CircleScreen />);
    expect(await screen.findByTestId("reborn-p1")).toBeTruthy();
  });
});

describe("feed paging (a FlatList read to its end)", () => {
  const feedPage = (results: unknown[], next: string | null) => ({ status: 200, data: { count: 3, next, previous: null, results } });
  const feedPages = (calls: { url: string; params?: Record<string, unknown> }[]) =>
    calls.filter((c) => c.url === "/me/social/feed/").map((c) => c.params?.page);

  it("nearing the end reads the next page once while it is on its way, and nothing past the last page", async () => {
    const held = heldReply();
    const calls = stubApi({ "/me/social/feed/": [feedPage([post({ id: "p1" }), post({ id: "p2" })], "?page=2"), held.reply] });
    wrap(<CircleScreen />);
    await screen.findByTestId("post-p2");
    // What the list calls on nearing its end, read fresh each time (it changes with the page held).
    const endReached = () => act(async () => screen.UNSAFE_getByType(FlatList).props.onEndReached?.({ distanceFromEnd: 0 }));
    await endReached();
    await endReached();
    await endReached();
    expect(feedPages(calls)).toEqual([1, 2]);
    // While it is on its way the foot says so, and offers no second press.
    expect(screen.getByTestId("circle-more-loading")).toBeTruthy();
    expect(screen.queryByTestId("circle-more")).toBeNull();

    await act(async () => held.answer(feedPage([post({ id: "p3" })], null)));
    expect(screen.getByTestId("post-p3")).toBeTruthy();
    await endReached();
    expect(feedPages(calls)).toEqual([1, 2]);
    expect(screen.queryByTestId("circle-more")).toBeNull();
    expect(screen.queryByTestId("circle-more-loading")).toBeNull();
  });

  it("the foot's button reads the next page too (for a screen reader)", async () => {
    const calls = stubApi({ "/me/social/feed/": [feedPage([post({ id: "p1" })], "?page=2"), feedPage([post({ id: "p2" })], null)] });
    wrap(<CircleScreen />);
    fireEvent.press(await screen.findByTestId("circle-more"));
    expect(await screen.findByTestId("post-p2")).toBeTruthy();
    expect(feedPages(calls)).toEqual([1, 2]);
  });

  it("rows are keyed by post, so a refresh that puts a new post on top keeps the rows already drawn", async () => {
    stubApi({ "/me/social/feed/": [page([post({ id: "p1" })]), page([post({ id: "p0" }), post({ id: "p1" })])] });
    wrap(<CircleScreen />);
    const before = await screen.findByTestId("post-p1");
    await act(async () => screen.UNSAFE_getByType(RefreshControl).props.onRefresh());
    await screen.findByTestId("post-p0");
    expect(screen.getByTestId("post-p1")).toBe(before);
  });
});

describe("reactions", () => {
  function detail(over: Record<string, unknown> = {}, status: typeof STATUS | typeof MUTED = STATUS, scheme?: ColorScheme) {
    const calls = stubApi({
      "GET /me/social/posts/p1/": { status: 200, data: post(over) },
      "/me/social/posts/p1/comments/": page([]),
      "/me/social/status/": status,
      "POST /me/social/posts/p1/reaction/": { status: 200, data: { reacted: true, reaction_type: "LIKE" } },
    });
    const screenEl = <PostScreen id="p1" />;
    wrap(scheme ? <ThemeContext.Provider value={themeFor(null, scheme)}>{screenEl}</ThemeContext.Provider> : screenEl);
    return calls;
  }
  const reacts = (calls: { method: string; url: string }[]) => calls.filter((c) => c.method === "POST");

  it("the four ordinary ones go at once; the lamp asks first", async () => {
    const calls = detail();
    await screen.findByTestId("reactions");
    // Five, as they were; the lamp last (补足 C17, 2026-09-30).
    expect(screen.getAllByTestId(/^react-/).map((e) => e.props.testID)).toEqual(["react-LIKE", "react-LOVE", "react-RESPECT", "react-SYMPATHY", "react-ETERNAL_LIGHT"]);
    await waitFor(() => expect(screen.getByTestId("react-LIKE").props.accessibilityState.disabled).toBe(false));
    fireEvent.press(screen.getByTestId("react-LIKE"));
    await waitFor(() => expect(reacts(calls)).toHaveLength(1));
    expect(screen.queryByTestId("lamp-sheet")).toBeNull();

    fireEvent.press(screen.getByTestId("react-ETERNAL_LIGHT"));
    expect(await screen.findByTestId("lamp-sheet")).toBeTruthy();
    expect(screen.getByText("为 沈蘅 点一盏长明灯？")).toBeTruthy();
    expect(reacts(calls)).toHaveLength(1);
    fireEvent.press(screen.getByTestId("lamp-cancel"));
    expect(reacts(calls)).toHaveLength(1);
    expect(screen.queryByTestId("lamp-sheet")).toBeNull();
    // An ordinary reaction is not felt; only the lamp, below.
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId("react-ETERNAL_LIGHT"));
    fireEvent.press(await screen.findByTestId("lamp-confirm"));
    await waitFor(() => expect(reacts(calls)).toHaveLength(2));
    expect(reacts(calls)[1]).toMatchObject({ body: { reaction_type: "ETERNAL_LIGHT" } });
    await waitFor(() => expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1));
    expect(Haptics.notificationAsync).toHaveBeenCalledWith(Haptics.NotificationFeedbackType.Success);
    expect(screen.queryByTestId("lamp-sheet")).toBeNull();
  });

  // Design 定稿:浅色下「点灯」反色 —— 深金底、米色字;深色下仍是亮金底、深色字。
  // 字面色值,不读 t.lamp:主题里两值对调,这里要红。
  it.each([
    ["light", "#6A3E00", "#FBF1DC"], // 文明气质 1i, confirmed 2026-09-27 (was #845A0F)
    ["dark", "#F2CC7A", "#241B0C"],
  ] as const)("%s: the lamp button is %s with %s text", async (scheme, bg, ink) => {
    detail({}, STATUS, scheme);
    await waitFor(() => expect(screen.getByTestId("react-ETERNAL_LIGHT").props.accessibilityState.disabled).toBe(false));
    fireEvent.press(screen.getByTestId("react-ETERNAL_LIGHT"));
    const button = await screen.findByTestId("lamp-confirm");
    expect(StyleSheet.flatten(button.props.style)).toMatchObject({ backgroundColor: bg });
    const label = within(button).getByText("点灯");
    expect(StyleSheet.flatten(label.props.style)).toMatchObject({ color: ink });
  });

  it("once lit, nothing can be pressed and it says why", async () => {
    const calls = detail({ my_reaction: "ETERNAL_LIGHT", reaction_counts: { ...ZERO, ETERNAL_LIGHT: 1 } });
    expect(await screen.findByTestId("lamp-locked")).toBeTruthy();
    expect(screen.getByText("已点长明灯 · 不可更改")).toBeTruthy();
    await act(async () => {});
    for (const type of ["LIKE", "LOVE", "RESPECT", "SYMPATHY", "ETERNAL_LIGHT"]) {
      expect(screen.getByTestId(`react-${type}`).props.accessibilityState.disabled).toBe(true);
      fireEvent.press(screen.getByTestId(`react-${type}`));
    }
    expect(screen.queryByTestId("lamp-sheet")).toBeNull();
    expect(reacts(calls)).toHaveLength(0);
  });

  it("another reaction of mine is not a lock", async () => {
    detail({ my_reaction: "LOVE", reaction_counts: { ...ZERO, LOVE: 1 } });
    await screen.findByTestId("reactions");
    await act(async () => {});
    expect(screen.queryByTestId("lamp-locked")).toBeNull();
    expect(screen.getByTestId("react-LOVE").props.accessibilityState).toMatchObject({ selected: true, disabled: false });
  });

  it("muted: the comment box becomes the dashed note with the end time", async () => {
    detail({}, MUTED);
    expect(await screen.findByTestId("muted-lock")).toBeTruthy();
    expect(screen.getByText("你被禁言，期间不能发帖和评论。写给殿司的书信不受影响。")).toBeTruthy();
    expect(screen.getByText("2026-09-25 00:00")).toBeTruthy();
    expect(screen.queryByTestId("comment-composer")).toBeNull();
  });

  it("⋯ on someone else's comment reports it; on mine it does not", async () => {
    stubApi({
      "GET /me/social/posts/p1/": { status: 200, data: post() },
      "/me/social/posts/p1/comments/": page([
        { id: "c1", post: "p1", parent: null, author: { user_id: 7, display_name: "许南", avatar: null, is_active: true }, content: "春笋", moderation_status: "PUBLISHED", is_mine: false, create_time: "2026-09-17T09:30:00Z" },
        { id: "c2", post: "p1", parent: null, author: { user_id: 1, display_name: "我", avatar: null, is_active: true }, content: "我的", moderation_status: "PUBLISHED", is_mine: true, create_time: "2026-09-17T09:31:00Z" },
      ]),
      "/me/social/status/": STATUS,
    });
    wrap(<PostScreen id="p1" />);
    fireEvent.press(await screen.findByTestId("comment-more-c1"));
    expect(mockNavigate).toHaveBeenCalledWith("CircleReport", { target: "COMMENT", id: "c1", preview: "春笋" });
    mockNavigate.mockReset();
    fireEvent.press(screen.getByTestId("comment-more-c2"));
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(await screen.findByTestId("delete-menu")).toBeTruthy();
    await waitFor(() => expect(mockSetOptions).toHaveBeenCalled());
  });

  it("the title bar's ⋯ reports someone else's post", async () => {
    detail();
    await waitFor(() => expect(mockSetOptions).toHaveBeenCalled());
    const action = headerAction();
    expect(action.label).toBe("举报帖子");
    act(() => action.onPress());
    expect(mockNavigate).toHaveBeenCalledWith("CircleReport", { target: "POST", id: "p1", preview: "想念母亲做的腌笃鲜。" });
    expect(screen.queryByTestId("delete-menu")).toBeNull();
  });

  it("a pending post takes no reactions and no comments", async () => {
    detail({ moderation_status: "PENDING", is_mine: true });
    await screen.findByTestId("pending-p1");
    await act(async () => {});
    expect(screen.queryByTestId("reactions")).toBeNull();
    expect(screen.queryByTestId("comment-composer")).toBeNull();
  });
});

describe("posting", () => {
  it("sends the text with the chosen audience; a pending answer lands the feed on its banner", async () => {
    const calls = stubApi({
      "/me/social/status/": STATUS,
      "POST /me/social/feed/": { status: 201, data: post({ id: "new", moderation_status: "PENDING", is_mine: true }) },
    });
    wrap(<ComposePostScreen />);
    fireEvent.changeText(screen.getByTestId("post-body"), "  一九八三年那件事。  ");
    fireEvent.press(screen.getByTestId("vis-FOLLOWERS"));
    await waitFor(() => expect(screen.getByTestId("post-submit")).toBeTruthy());
    await act(async () => {});
    fireEvent.press(screen.getByTestId("post-submit"));
    await waitFor(() => expect(mockPopTo).toHaveBeenCalled());
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ content: "一九八三年那件事。", visibility: "FOLLOWERS" });
    expect(mockPopTo).toHaveBeenCalledWith("Tabs", { screen: "Circle", params: { pendingId: "new" } });
  });

  it("muted: the send button's place holds the note, not a disabled button", async () => {
    stubApi({ "/me/social/status/": MUTED });
    wrap(<ComposePostScreen />);
    expect(await screen.findByTestId("muted-lock")).toBeTruthy();
    expect(screen.queryByTestId("post-submit")).toBeNull();
  });
});

/** The title bar's action as the screen last set it (the header is the navigator's; mocked here). */
function headerAction() {
  const { header } = mockSetOptions.mock.calls.at(-1)[0];
  return header().props.action as { label: string; onPress: () => void };
}

function comment(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    post: "p1",
    parent: null,
    author: { user_id: 7, display_name: "许南", avatar: null, is_active: true },
    content: `评论${id}`,
    moderation_status: "PUBLISHED",
    is_mine: false,
    create_time: "2026-09-17T09:30:00Z",
    ...over,
  };
}
const MINE = { user_id: 1, display_name: "我", avatar: null, is_active: true };
const sent = (calls: { method: string; url: string; body: unknown }[], method: string) => calls.filter((c) => c.method === method);

describe("deleting my own", () => {
  it("post: ⋯ → 删除 → asked again → only then DELETE, and back to the list", async () => {
    const calls = stubApi({
      "GET /me/social/posts/p1/": { status: 200, data: post({ is_mine: true, author: MINE }) },
      "/me/social/posts/p1/comments/": page([]),
      "/me/social/status/": STATUS,
      "DELETE /me/social/posts/p1/": { status: 204 },
    });
    wrap(<PostScreen id="p1" />);
    await waitFor(() => expect(mockSetOptions).toHaveBeenCalled());
    const action = headerAction();
    expect(action.label).toBe("删除");
    act(() => action.onPress());
    expect(mockNavigate).not.toHaveBeenCalled();
    fireEvent.press(await screen.findByTestId("delete-row"));
    expect(screen.getByText("删除这条帖子？")).toBeTruthy();
    expect(sent(calls, "DELETE")).toHaveLength(0);

    // 取消 on the second step sends nothing either.
    fireEvent.press(screen.getByTestId("delete-cancel"));
    await waitFor(() => expect(screen.queryByTestId("delete-confirm-sheet")).not.toBeOnTheScreen());
    expect(sent(calls, "DELETE")).toHaveLength(0);

    act(() => headerAction().onPress());
    fireEvent.press(await screen.findByTestId("delete-row"));
    fireEvent.press(screen.getByTestId("delete-confirm"));
    await waitFor(() => expect(mockGoBack).toHaveBeenCalled());
    expect(sent(calls, "DELETE").map((c) => c.url)).toEqual(["/me/social/posts/p1/"]);
  });

  it("comment: the same two steps, then the comments and the count are read again", async () => {
    const calls = stubApi({
      "GET /me/social/posts/p1/": { status: 200, data: post({ comment_count: 2 }) },
      "/me/social/posts/p1/comments/": page([comment("c1"), comment("c2", { is_mine: true, author: MINE })]),
      "/me/social/status/": STATUS,
      "DELETE /me/social/comments/c2/": { status: 204 },
    });
    wrap(<PostScreen id="p1" />);
    fireEvent.press(await screen.findByTestId("comment-more-c2"));
    expect(mockNavigate).not.toHaveBeenCalled();
    fireEvent.press(await screen.findByTestId("delete-row"));
    expect(screen.getByText("删除这条评论？")).toBeTruthy();
    expect(sent(calls, "DELETE")).toHaveLength(0);
    const before = calls.length;
    fireEvent.press(screen.getByTestId("delete-confirm"));
    await waitFor(() =>
      expect(calls.slice(before).map((c) => `${c.method} ${c.url}`)).toEqual(
        expect.arrayContaining(["DELETE /me/social/comments/c2/", "GET /me/social/posts/p1/comments/", "GET /me/social/posts/p1/"])
      )
    );
    expect(mockGoBack).not.toHaveBeenCalled();
  });
});

describe("replying", () => {
  function open(rows: unknown[]) {
    const calls = stubApi({
      "GET /me/social/posts/p1/": { status: 200, data: post() },
      "/me/social/posts/p1/comments/": page(rows),
      "/me/social/status/": STATUS,
      "POST /me/social/posts/p1/comments/": { status: 201, data: comment("new") },
    });
    wrap(<PostScreen id="p1" />);
    return calls;
  }

  it("回复 puts the composer in reply mode and the send carries the parent", async () => {
    const calls = open([comment("c1")]);
    fireEvent.press(await screen.findByTestId("comment-reply-c1"));
    expect(within(screen.getByTestId("replying")).getByText("回复 许南")).toBeTruthy();
    fireEvent.changeText(screen.getByTestId("comment-body"), "谢谢");
    fireEvent.press(screen.getByTestId("comment-send"));
    await waitFor(() => expect(sent(calls, "POST")).toHaveLength(1));
    expect(sent(calls, "POST")[0].body).toEqual({ content: "谢谢", parent: "c1" });
    await waitFor(() => expect(screen.queryByTestId("replying")).not.toBeOnTheScreen());
  });

  it("cancelled, it is a plain comment again — no parent at all", async () => {
    const calls = open([comment("c1")]);
    fireEvent.press(await screen.findByTestId("comment-reply-c1"));
    fireEvent.press(screen.getByTestId("reply-cancel"));
    expect(screen.queryByTestId("replying")).toBeNull();
    fireEvent.changeText(screen.getByTestId("comment-body"), "一句");
    fireEvent.press(screen.getByTestId("comment-send"));
    await waitFor(() => expect(sent(calls, "POST")).toHaveLength(1));
    expect(sent(calls, "POST")[0].body).toEqual({ content: "一句" });
  });

  it("a reply names whom it answers when that comment is loaded, and guesses nothing when it is not", async () => {
    open([
      comment("c1"),
      comment("c3", { parent: "c1", author: { user_id: 8, display_name: "顾衡", avatar: null, is_active: true } }),
      comment("c4", { parent: "not-loaded" }),
    ]);
    expect(await screen.findByTestId("reply-to-c3")).toBeTruthy();
    expect(within(screen.getByTestId("reply-to-c3")).getByText("回复 许南")).toBeTruthy();
    expect(screen.queryByTestId("reply-to-c1")).toBeNull();
    expect(screen.queryByTestId("reply-to-c4")).toBeNull();
  });

  it("muted: no 回复 anywhere", async () => {
    stubApi({
      "GET /me/social/posts/p1/": { status: 200, data: post() },
      "/me/social/posts/p1/comments/": page([comment("c1")]),
      "/me/social/status/": MUTED,
    });
    wrap(<PostScreen id="p1" />);
    await screen.findByTestId("muted-lock");
    expect(screen.getByTestId("comment-c1")).toBeTruthy();
    expect(screen.queryByTestId("comment-reply-c1")).toBeNull();
  });
});

describe("more comments", () => {
  it("更多评论 reads the next page and adds it below; a row already shown is not shown twice", async () => {
    const calls = stubApi({
      "GET /me/social/posts/p1/": { status: 200, data: post({ comment_count: 3 }) },
      "/me/social/posts/p1/comments/": [
        { status: 200, data: { count: 3, next: "?page=2", previous: null, results: [comment("c1"), comment("c2")] } },
        { status: 200, data: { count: 3, next: null, previous: "?page=1", results: [comment("c2"), comment("c3")] } },
      ],
      "/me/social/status/": STATUS,
    });
    wrap(<PostScreen id="p1" />);
    fireEvent.press(await screen.findByTestId("comments-more"));
    expect(await screen.findByTestId("comment-c3")).toBeTruthy();
    expect(screen.getAllByTestId("comment-c2")).toHaveLength(1);
    expect(screen.getByTestId("comment-c1")).toBeTruthy();
    expect(calls.filter((c) => c.url === "/me/social/posts/p1/comments/").map((c) => c.params?.page)).toEqual([1, 2]);
    expect(screen.queryByTestId("comments-more")).toBeNull();
  });
});

describe("usePaged", () => {
  type Row = { id: string };
  type Answer = { results: Row[]; next: string | null };

  it("an answer overtaken by a newer request is dropped", async () => {
    const answers: ((a: Answer) => void)[] = [];
    const fetchPage = () => new Promise<Answer>((resolve) => answers.push(resolve));
    const { result } = renderHook(() => usePaged<Row>("t", fetchPage));
    await act(async () => answers[0]({ results: [{ id: "a" }], next: "?page=2" }));
    expect(result.current.rows).toEqual([{ id: "a" }]);

    act(() => result.current.more?.()); // page 2; its answer is held back
    act(() => void result.current.reload()); // page 1 again, newer
    await act(async () => answers[2]({ results: [{ id: "a2" }], next: null }));
    await act(async () => answers[1]({ results: [{ id: "late" }], next: null }));
    expect(result.current.rows).toEqual([{ id: "a2" }]);
  });

  it("`more` twice before a re-render asks once", async () => {
    const answers: ((a: Answer) => void)[] = [];
    const fetchPage = () => new Promise<Answer>((resolve) => answers.push(resolve));
    const { result } = renderHook(() => usePaged<Row>("t", fetchPage));
    await act(async () => answers[0]({ results: [{ id: "a" }], next: "?page=2" }));
    const more = result.current.more;
    act(() => {
      more?.();
      more?.();
    });
    expect(answers).toHaveLength(2);
    await act(async () => answers[1]({ results: [{ id: "b" }], next: null }));
    act(() => more?.()); // the stale closure still sees no next page
    expect(answers).toHaveLength(2);
    expect(result.current.more).toBeNull();
  });
});
