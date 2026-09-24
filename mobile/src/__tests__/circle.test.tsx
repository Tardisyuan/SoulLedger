/**
 * 朋友圈 (handoff 1a–1e) against core's real soul client, network scripted.
 *
 * The eternal light is final on the server (409 `eternal_light_locked`); here
 * the app must ask before lighting it, and once lit offer no way to take it
 * back or trade it — every assertion on the lamp is paired with one that the
 * other four still work, or a screen that disables everything would pass.
 */
import { NavigationContainer } from "@react-navigation/native";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { I18nProvider } from "../i18n";
import { installMobilePlatform } from "../platform";
import { CircleScreen, ComposePostScreen, PostScreen } from "../screens/circle";
import { stubApi } from "./stubApi";

const mockPopTo = jest.fn();
const mockNavigate = jest.fn();
let mockParams: object | undefined;
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => ({ navigate: mockNavigate, popTo: mockPopTo, goBack: jest.fn() }),
  useRoute: () => ({ params: mockParams }),
  useFocusEffect: () => {},
}));

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

describe("reactions", () => {
  function detail(over: Record<string, unknown> = {}, status: typeof STATUS | typeof MUTED = STATUS) {
    const calls = stubApi({
      "GET /me/social/posts/p1/": { status: 200, data: post(over) },
      "/me/social/posts/p1/comments/": page([]),
      "/me/social/status/": status,
      "POST /me/social/posts/p1/reaction/": { status: 200, data: { reacted: true, reaction_type: "LIKE" } },
    });
    wrap(<PostScreen id="p1" />);
    return calls;
  }
  const reacts = (calls: { method: string; url: string }[]) => calls.filter((c) => c.method === "POST");

  it("the four ordinary ones go at once; the lamp asks first", async () => {
    const calls = detail();
    await screen.findByTestId("reactions");
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

    fireEvent.press(screen.getByTestId("react-ETERNAL_LIGHT"));
    fireEvent.press(await screen.findByTestId("lamp-confirm"));
    await waitFor(() => expect(reacts(calls)).toHaveLength(2));
    expect(reacts(calls)[1]).toMatchObject({ body: { reaction_type: "ETERNAL_LIGHT" } });
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
