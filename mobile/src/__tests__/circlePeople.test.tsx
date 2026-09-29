/**
 * 朋友圈, people (handoff 1f–1i) against core's real soul client, network scripted.
 * Every "is shown" is paired with the "is not" beside it: a past life with a
 * follow button, or a search result carrying the code it was found by, would
 * otherwise pass.
 */
import { NavigationContainer } from "@react-navigation/native";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { FlatList, ScrollView } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { I18nProvider } from "../i18n";
import { installMobilePlatform } from "../platform";
import { SessionContext } from "../session";
import { CircleSearchScreen, FollowListScreen, MyCircleScreen, ReportScreen, SoulProfileScreen } from "../screens/circlePeople";
import { PROFILE, heldReply, stubApi } from "./stubApi";

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack, setOptions: jest.fn() }),
  useFocusEffect: () => {},
}));
const mockOpenDirect = jest.fn();
jest.mock("../chat", () => ({
  ...jest.requireActual("../chat"),
  useChat: () => ({ availability: "ready", openDirect: mockOpenDirect }),
}));

function wrap(children: ReactNode) {
  const session = { state: { status: "signedIn", profile: PROFILE } } as never;
  return render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
      <I18nProvider>
        <SessionContext.Provider value={session}>
          <NavigationContainer>{children}</NavigationContainer>
        </SessionContext.Provider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}

const page = (results: unknown[], next: string | null = null) => ({ status: 200, data: { count: results.length, next, previous: null, results } });

function profile(over: Record<string, unknown> = {}) {
  return {
    user_id: 7,
    display_name: "林照微",
    avatar: null,
    is_active: true,
    is_self: false,
    is_following: false,
    is_followed_by: false,
    is_mutual: false,
    followers_count: 112,
    following_count: 38,
    post_count: 1,
    ...over,
  };
}

beforeEach(() => {
  installMobilePlatform();
  mockNavigate.mockReset();
  mockGoBack.mockReset();
  mockOpenDirect.mockReset();
});

describe("another soul's page", () => {
  function open(over: Record<string, unknown> = {}) {
    const calls = stubApi({
      "GET /me/social/users/7/": { status: 200, data: profile(over) },
      "/me/social/feed/": page([]),
      "POST /me/social/users/7/follow/": { status: 200, data: { following: true } },
      "DELETE /me/social/users/7/follow/": { status: 200, data: { following: false } },
    });
    wrap(<SoulProfileScreen userId={7} />);
    return calls;
  }

  it("not followed: 关注, and the hint that more may show after", async () => {
    const calls = open();
    const button = await screen.findByTestId("follow");
    expect(button.props.accessibilityLabel).toBe("关注");
    expect(screen.getByTestId("more-hint")).toBeTruthy();
    expect(screen.queryByTestId("follows-you")).toBeNull();
    expect(calls.find((c) => c.url === "/me/social/feed/")?.params).toMatchObject({ author: 7 });
    fireEvent.press(button);
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url === "/me/social/users/7/follow/")).toBe(true));
  });

  it("they follow me: 回关 and 关注了你", async () => {
    open({ is_followed_by: true });
    expect(await screen.findByText("回关")).toBeTruthy();
    expect(screen.getByTestId("follows-you")).toBeTruthy();
  });

  it("mutual: 互相关注, no hint; pressing it unfollows", async () => {
    const calls = open({ is_following: true, is_followed_by: true, is_mutual: true });
    fireEvent.press(await screen.findByText("互相关注"));
    expect(screen.queryByTestId("more-hint")).toBeNull();
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE")).toBe(true));
  });

  it("a past life: the sealed note, and neither a follow button nor a ⋯", async () => {
    open({ is_active: false });
    expect(await screen.findByTestId("profile-reborn")).toBeTruthy();
    expect(screen.queryByTestId("follow")).toBeNull();
    expect(screen.queryByTestId("profile-more")).toBeNull();
  });

  it("⋯, not mutual: a letter goes as a request (with the 24 h rule); report opens the form", async () => {
    mockOpenDirect.mockResolvedValue({ id: "c9" });
    open();
    fireEvent.press(await screen.findByTestId("profile-more"));
    expect(screen.getByText("非互关 · 先发私聊请求")).toBeTruthy();
    expect(screen.getByTestId("menu-letter-rule")).toBeTruthy();
    fireEvent.press(screen.getByTestId("menu-letter"));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("Conversation", { id: "c9" }));
    expect(mockOpenDirect).toHaveBeenCalledWith(7);

    fireEvent.press(screen.getByTestId("profile-more"));
    fireEvent.press(screen.getByTestId("menu-report"));
    expect(mockNavigate).toHaveBeenLastCalledWith("CircleReport", { target: "USER", id: "7", preview: "林照微" });
  });

  it("⋯, mutual: straight into the conversation, no rule", async () => {
    open({ is_following: true, is_followed_by: true, is_mutual: true });
    fireEvent.press(await screen.findByTestId("profile-more"));
    expect(screen.getByText("互关 · 直接进会话")).toBeTruthy();
    expect(screen.queryByTestId("menu-letter-rule")).toBeNull();
  });
});

describe("my page and the lists", () => {
  it("my page asks for my own profile and posts, and its counts open the lists", async () => {
    const calls = stubApi({
      "/me/social/status/": { status: 200, data: { user_id: 1, can_write: true, muted_until: null, reports_remaining: 10 } },
      "GET /me/social/users/1/": { status: 200, data: profile({ user_id: 1, display_name: "陈砚舟", is_self: true, following_count: 24, followers_count: 31 }) },
      "/me/social/feed/": page([]),
    });
    wrap(<MyCircleScreen />);
    fireEvent.press(await screen.findByTestId("my-followers"));
    expect(mockNavigate).toHaveBeenCalledWith("CircleFollows", { relation: "followers" });
    await waitFor(() => expect(calls.some((c) => c.url === "/me/social/feed/")).toBe(true));
    // Never asked for "author 0" while my id was still unknown.
    expect(calls.filter((c) => c.url === "/me/social/feed/").map((c) => c.params?.author)).toEqual([1]);
  });

  it("each row's button follows both directions; a past life has none", async () => {
    stubApi({
      "/me/social/followers/": page([
        { user_id: 2, display_name: "林照微", avatar: null, is_active: true, is_following: true, is_followed_by: true },
        { user_id: 3, display_name: "许南", avatar: null, is_active: true, is_following: false, is_followed_by: true },
        { user_id: 4, display_name: "顾衡", avatar: null, is_active: false, is_following: false, is_followed_by: true },
      ]),
    });
    wrap(<FollowListScreen relation="followers" />);
    expect(await screen.findByText("被关注 3")).toBeTruthy();
    expect(screen.getByText("互相关注")).toBeTruthy();
    expect(screen.getByText("回关")).toBeTruthy();
    expect(screen.getAllByTestId("follow")).toHaveLength(2);
    expect(screen.getByText("已转世的灵魂留在列表里但不再有按钮。")).toBeTruthy();
  });
});

describe("paged pages are one FlatList each, read to their end one page at a time", () => {
  const ZERO = { LIKE: 0, LOVE: 0, RESPECT: 0, SYMPATHY: 0, ETERNAL_LIGHT: 0 };
  const post = (id: string) => ({
    id,
    author: { user_id: 7, display_name: "林照微", avatar: null, is_active: true },
    content: `帖子 ${id}`,
    visibility: "PUBLIC",
    moderation_status: "PUBLISHED",
    comment_count: 0,
    reaction_count: 0,
    reaction_counts: ZERO,
    my_reaction: null,
    media: [],
    is_mine: false,
    create_time: "2026-09-17T08:12:00Z",
  });
  const card = (user_id: number, over: Record<string, unknown> = {}) => ({
    user_id,
    display_name: `灵魂${user_id}`,
    avatar: null,
    is_active: true,
    is_following: false,
    is_followed_by: true,
    ...over,
  });
  const pageOf = (results: unknown[], next: string | null) => ({ status: 200, data: { count: 5, next, previous: null, results } });
  const pagesAsked = (calls: { url: string; params?: Record<string, unknown> }[], url: string) =>
    calls.filter((c) => c.url === url).map((c) => c.params?.page ?? 1);
  const endReached = () => act(async () => screen.UNSAFE_getByType(FlatList).props.onEndReached?.({ distanceFromEnd: 0 }));
  // Nothing nests: the FlatList's own scroller is the only one on the page.
  const oneScroller = () => expect(screen.UNSAFE_getAllByType(ScrollView)).toHaveLength(1);

  it("a soul's page: the head is the list's header, and the next page of posts is read once while on its way", async () => {
    const held = heldReply();
    const calls = stubApi({
      "GET /me/social/users/7/": { status: 200, data: profile() },
      "/me/social/feed/": [pageOf([post("p1"), post("p2")], "?page=2"), held.reply],
    });
    wrap(<SoulProfileScreen userId={7} />);
    await screen.findByTestId("post-p2");
    oneScroller();
    expect(screen.getByTestId("follow")).toBeTruthy();
    await endReached();
    await endReached();
    expect(pagesAsked(calls, "/me/social/feed/")).toEqual([1, 2]);
    expect(screen.getByTestId("circle-more-loading").props.accessibilityLabel).toBe("加载中…");
    await act(async () => held.answer(pageOf([post("p2"), post("p3")], null)));
    // p2 came again (the list moved under the pages): held once.
    expect(screen.getAllByTestId("post-p2")).toHaveLength(1);
    expect(screen.getByTestId("post-p3")).toBeTruthy();
    await endReached();
    expect(pagesAsked(calls, "/me/social/feed/")).toEqual([1, 2]);
    expect(screen.queryByTestId("circle-more")).toBeNull();
    // Under the last post, still: the hint that more may show after a follow.
    expect(screen.getByTestId("more-hint")).toBeTruthy();
  });

  it("my page with no posts: the head, no skeleton, no foot", async () => {
    stubApi({
      "/me/social/status/": { status: 200, data: { user_id: 1, can_write: true, muted_until: null, reports_remaining: 10 } },
      "GET /me/social/users/1/": { status: 200, data: profile({ user_id: 1, display_name: "陈砚舟", is_self: true }) },
      "/me/social/feed/": pageOf([], null),
    });
    wrap(<MyCircleScreen />);
    await screen.findByTestId("edit-name");
    await waitFor(() => expect(screen.UNSAFE_getByType(FlatList).props.data).toEqual([]));
    oneScroller();
    expect(screen.queryByLabelText("加载中…")).toBeNull();
    expect(screen.queryByTestId("circle-more")).toBeNull();
  });

  it("the follow list: the next page once while on its way, nothing past the last; a follow re-reads every page held", async () => {
    const held = heldReply();
    const calls = stubApi({
      "/me/social/followers/": [pageOf([card(2), card(3)], "?page=2"), held.reply, pageOf([card(2, { is_following: true }), card(3)], "?page=2"), pageOf([card(4)], null)],
      "POST /me/social/users/2/follow/": { status: 200, data: { following: true } },
    });
    wrap(<FollowListScreen relation="followers" />);
    await screen.findByTestId("soul-3");
    oneScroller();
    const list = screen.UNSAFE_getByType(FlatList);
    expect(list.props.data.map(list.props.keyExtractor)).toEqual(["2", "3"]);
    await endReached();
    await endReached();
    expect(pagesAsked(calls, "/me/social/followers/")).toEqual([1, 2]);
    expect(screen.getByTestId("follows-more-loading")).toBeTruthy();
    expect(screen.queryByTestId("follows-more")).toBeNull();
    await act(async () => held.answer(pageOf([card(4)], null)));
    expect(screen.getByTestId("soul-4")).toBeTruthy();
    await endReached();
    expect(pagesAsked(calls, "/me/social/followers/")).toEqual([1, 2]);
    expect(screen.queryByTestId("follows-more")).toBeNull();
    // Following one soul reads both pages again — the list is not folded back to its first page.
    fireEvent.press(within(screen.getByTestId("soul-2")).getByTestId("follow"));
    await waitFor(() => expect(pagesAsked(calls, "/me/social/followers/")).toEqual([1, 2, 1, 2]));
    expect(await screen.findByTestId("soul-4")).toBeTruthy();
  });

  it("the follow list's foot button reads the next page too (for a screen reader)", async () => {
    const calls = stubApi({ "/me/social/following/": [pageOf([card(2)], "?page=2"), pageOf([card(3)], null)] });
    wrap(<FollowListScreen relation="following" />);
    fireEvent.press(await screen.findByTestId("follows-more"));
    expect(await screen.findByTestId("soul-3")).toBeTruthy();
    expect(pagesAsked(calls, "/me/social/following/")).toEqual([1, 2]);
  });
});

describe("search", () => {
  it("says where it looks before asking", async () => {
    stubApi({});
    wrap(<CircleSearchScreen />);
    expect(screen.getByTestId("search-scope").props.children).toContain("中国地府");
  });

  it("by code: the exact-match label, and the code nowhere in the result", async () => {
    stubApi({ "/me/social/search/": { status: 200, data: [{ user_id: 5, display_name: "许南", avatar: null, is_active: true, is_following: false }] } });
    wrap(<CircleSearchScreen />);
    fireEvent(screen.getByTestId("search-input"), "submitEditing", { nativeEvent: { text: "4H8Q2MZT7C" } });
    expect(await screen.findByText("编号精确匹配")).toBeTruthy();
    expect(screen.queryByText("4H8Q2MZT7C")).toBeNull();
    fireEvent.press(screen.getByTestId("result-5"));
    expect(mockNavigate).toHaveBeenCalledWith("SoulProfile", { userId: 5 });
  });

  it("by name: a count; a miss: the one sentence", async () => {
    stubApi({ "/me/social/search/": [{ status: 200, data: [{ user_id: 5, display_name: "照微", avatar: null, is_active: true, is_following: false }] }, { status: 200, data: [] }] });
    wrap(<CircleSearchScreen />);
    fireEvent(screen.getByTestId("search-input"), "submitEditing", { nativeEvent: { text: "照微" } });
    expect(await screen.findByText("1 位")).toBeTruthy();
    expect(screen.queryByText("编号精确匹配")).toBeNull();
    fireEvent(screen.getByTestId("search-input"), "submitEditing", { nativeEvent: { text: "没有这人" } });
    expect(await screen.findByTestId("search-none")).toBeTruthy();
  });
});

describe("report", () => {
  it("needs a reason; sends it with the optional detail; then says what happens next", async () => {
    const calls = stubApi({ "POST /me/social/reports/": { status: 201, data: { counted: true, reports_remaining: 9 } } });
    wrap(<ReportScreen target="COMMENT" id="c1" preview="我记得扬州也有这道。" />);
    expect(screen.getByText("举报评论")).toBeTruthy();
    expect(screen.getByTestId("report-submit").props.accessibilityState.disabled).toBe(true);
    expect(screen.getByText("辱骂骚扰")).toBeTruthy();
    fireEvent.press(screen.getByTestId("reason-ABUSE"));
    await act(async () => {});
    fireEvent.press(screen.getByTestId("report-submit"));
    expect(await screen.findByTestId("report-done")).toBeTruthy();
    expect(calls[0].body).toEqual({ target_type: "COMMENT", target_id: "c1", reason: "ABUSE", detail: "" });
  });
});

describe("changing my circle name", () => {
  function mine(rename: { status: number; data?: unknown }) {
    const calls = stubApi({
      "/me/social/status/": { status: 200, data: { user_id: 1, can_write: true, muted_until: null, reports_remaining: 10 } },
      "GET /me/social/users/1/": { status: 200, data: profile({ user_id: 1, display_name: "陈砚舟", is_self: true }) },
      "/me/social/feed/": page([]),
      "PATCH /me/social/profile/": rename,
    });
    wrap(<MyCircleScreen />);
    return calls;
  }
  const profileReads = (calls: { method: string; url: string }[]) => calls.filter((c) => c.method === "GET" && c.url === "/me/social/users/1/").length;

  it("tap the name, edit, save: the new name is sent and my page is read again", async () => {
    const calls = mine({ status: 200, data: { user_id: 1, display_name: "砚舟", avatar: null, is_active: true } });
    fireEvent.press(await screen.findByTestId("edit-name"));
    expect(screen.getByTestId("name-input").props.value).toBe("陈砚舟");
    fireEvent.changeText(screen.getByTestId("name-input"), " 砚舟 ");
    fireEvent.press(screen.getByTestId("name-save"));
    await waitFor(() => expect(profileReads(calls)).toBe(2));
    await waitFor(() => expect(screen.queryByTestId("rename")).not.toBeOnTheScreen());
    expect(calls.filter((c) => c.method === "PATCH").map((c) => c.body)).toEqual([{ display_name: "砚舟" }]);
    expect(profileReads(calls)).toBe(2);
  });

  it.each([
    ["display_name_taken", 409, "本文明已有灵魂叫这个名字。"],
    ["display_name_sensitive", 400, "这个名字含有不允许的词，换一个吧。"],
    ["display_name_length", 400, "显示名要 2 到 20 个字。"],
  ])("refused with %s: the reason is said under the field, which stays open", async (code, status, text) => {
    const calls = mine({ status, data: { detail: "x", code } });
    fireEvent.press(await screen.findByTestId("edit-name"));
    fireEvent.changeText(screen.getByTestId("name-input"), "林照微");
    fireEvent.press(screen.getByTestId("name-save"));
    expect(await screen.findByTestId("name-refusal")).toBeTruthy();
    expect(within(screen.getByTestId("name-refusal")).getByText(text)).toBeTruthy();
    expect(screen.getByTestId("name-input").props.value).toBe("林照微");
    expect(profileReads(calls)).toBe(1);
    // Typing again clears the refusal.
    fireEvent.changeText(screen.getByTestId("name-input"), "林照");
    expect(screen.queryByTestId("name-refusal")).toBeNull();
  });

  it("cancel sends nothing", async () => {
    const calls = mine({ status: 200, data: {} });
    fireEvent.press(await screen.findByTestId("edit-name"));
    fireEvent.changeText(screen.getByTestId("name-input"), "别的");
    fireEvent.press(screen.getByTestId("name-cancel"));
    expect(screen.queryByTestId("rename")).toBeNull();
    await act(async () => {});
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
  });
});
