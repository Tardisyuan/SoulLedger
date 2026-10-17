/**
 * 互动消息 (Design 第四十批 S-a) against core's real soul client, network scripted: the rows' sentences, 今天 / 更早,
 * the dots, marking all read once the first page is in, and where each kind of row leads. Plus the comment a push
 * names, washed on the post page.
 */
import { NavigationContainer } from "@react-navigation/native";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ToastProvider } from "../feedback";
import { I18nProvider, translate } from "../i18n";
import { installMobilePlatform } from "../platform";
import { PostScreen } from "../screens/circle";
import { CircleInboxScreen, interactionStamp, mergedSentence } from "../screens/circleInbox";
import { stubApi } from "./stubApi";

const mockNavigate = jest.fn();
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn(), setOptions: jest.fn() }),
  useRoute: () => ({ params: undefined }),
  useFocusEffect: () => {},
}));

function wrap(children: ReactNode) {
  return render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
      <I18nProvider>
        <ToastProvider>
          <NavigationContainer>{children}</NavigationContainer>
        </ToastProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}

const POST = "11111111-1111-4111-8111-111111111111";
const COMMENT = "22222222-2222-4222-8222-222222222222";
const card = (user_id: number, display_name: string) => ({ user_id, display_name, avatar: null, is_active: true });
const now = new Date();
const earlier = new Date(now.getTime() - 3 * 24 * 3600 * 1000);

function row(over: Record<string, unknown>) {
  return { id: "r1", kind: "COMMENT", actor: card(2, "塞内布"), count: 1, post_id: POST, comment_id: COMMENT, excerpt: "", last_at: now.toISOString(), unread: true, ...over };
}

const page = (results: unknown[]) => ({ status: 200, data: { count: results.length, next: null, previous: null, results } });

beforeEach(() => {
  installMobilePlatform();
  mockNavigate.mockReset();
});

describe("互动消息", () => {
  it("writes each kind in Design's words, groups 今天 / 更早, and keeps the dots it arrived with", async () => {
    const calls = stubApi({
      "/me/social/interactions/": page([
        row({ id: "c", excerpt: "第九门我也排过，柱子是四十二根。" }),
        row({ id: "l", kind: "LAMP", actor: card(3, "阿尼"), count: 3, comment_id: null, excerpt: "今天在十二时门排到第九门…" }),
        row({ id: "r1", kind: "REACTION", actor: card(5, "赫努"), count: 1, comment_id: null }),
        row({ id: "f", kind: "FOLLOW", actor: card(4, "美丽塔"), count: 2, post_id: null, comment_id: null, last_at: earlier.toISOString(), unread: false }),
      ]),
      "POST /me/social/interactions/read/": { status: 204 },
    });
    wrap(<CircleInboxScreen />);
    const today = await screen.findByTestId("circle-inbox-today");
    expect(today.props.children).toBe("今天");
    expect(screen.getByTestId("circle-inbox-earlier").props.children).toBe("更早");
    expect(within(screen.getByTestId("interaction-c")).getByText(/评论了你的帖子/)).toBeTruthy();
    expect(within(screen.getByTestId("interaction-c")).getByText("「第九门我也排过，柱子是四十二根。」")).toBeTruthy();
    expect(within(screen.getByTestId("interaction-l")).getByText(/等 3 人为你的帖子点了长明灯/)).toBeTruthy();
    expect(within(screen.getByTestId("interaction-f")).getByText(/等 2 人关注了你/)).toBeTruthy();
    // 一个人用 _one 键,不写「等 1 人」。
    expect(within(screen.getByTestId("interaction-r1")).getByText(/对你的帖子表态/)).toBeTruthy();
    expect(within(screen.getByTestId("interaction-r1")).queryByText(/等 1 人/)).toBeNull();
    expect(screen.getByTestId("interaction-unread-c")).toBeTruthy();
    expect(screen.queryByTestId("interaction-unread-f")).toBeNull();
    expect(screen.getByTestId("circle-inbox-retention").props.children).toBe("只保留 90 天内的互动。");
    // Read once the page is in — and the dots stay until the page is left.
    await waitFor(() => expect(calls.filter((c) => c.method === "POST")).toHaveLength(1));
    expect(screen.getByTestId("interaction-unread-c")).toBeTruthy();
  });

  it("a comment opens the post at that comment; a lamp opens the post; a follow opens the first soul's page", async () => {
    stubApi({
      "/me/social/interactions/": page([
        row({ id: "c" }),
        row({ id: "l", kind: "LAMP", comment_id: null }),
        row({ id: "f", kind: "FOLLOW", actor: card(4, "美丽塔"), post_id: null, comment_id: null }),
      ]),
      "POST /me/social/interactions/read/": { status: 204 },
    });
    wrap(<CircleInboxScreen />);
    fireEvent.press(await screen.findByTestId("interaction-c"));
    fireEvent.press(screen.getByTestId("interaction-l"));
    fireEvent.press(screen.getByTestId("interaction-f"));
    expect(mockNavigate.mock.calls).toEqual([
      ["CirclePost", { id: POST, comment: COMMENT }],
      ["CirclePost", { id: POST }],
      ["SoulProfile", { userId: 4 }],
    ]);
  });

  it("none yet: says so", async () => {
    stubApi({ "/me/social/interactions/": page([]), "POST /me/social/interactions/read/": { status: 204 } });
    wrap(<CircleInboxScreen />);
    expect((await screen.findByTestId("circle-inbox-empty")).props.children).toBe("还没有互动");
  });

  it("today's rows show the clock, older ones the day", () => {
    const at = new Date(2026, 9, 17, 9, 12);
    expect(interactionStamp(at.toISOString(), new Date(2026, 9, 17, 23, 0))).toBe("09:12");
    expect(interactionStamp(new Date(2026, 9, 15, 8, 0).toISOString(), new Date(2026, 9, 17, 23, 0))).toBe("10-15");
  });
});

describe("a post opened at a comment", () => {
  it("washes that comment and no other", async () => {
    const comment = (id: string) => ({
      id,
      post: POST,
      parent: null,
      author: card(2, "塞内布"),
      content: "评论",
      moderation_status: "PUBLISHED",
      is_mine: false,
      create_time: "2026-10-17T01:00:00Z",
    });
    stubApi({
      [`/me/social/posts/${POST}/`]: {
        status: 200,
        data: {
          id: POST,
          author: card(1, "我"),
          content: "帖子",
          visibility: "PUBLIC",
          moderation_status: "PUBLISHED",
          comment_count: 2,
          reaction_count: 0,
          reaction_counts: { LIKE: 0, LOVE: 0, RESPECT: 0, SYMPATHY: 0, ETERNAL_LIGHT: 0 },
          my_reaction: null,
          media: [],
          is_mine: true,
          create_time: "2026-10-17T00:00:00Z",
        },
      },
      [`/me/social/posts/${POST}/comments/`]: page([comment("other"), comment(COMMENT)]),
      "/me/social/status/": { status: 200, data: { user_id: 1, can_write: true, muted_until: null, reports_remaining: 5, unread_interactions: 0 } },
    });
    wrap(<PostScreen id={POST} comment={COMMENT} />);
    const landed = await screen.findByTestId(`comment-${COMMENT}`);
    expect(screen.getAllByTestId("landing-wash")).toHaveLength(1);
    expect(within(screen.getByTestId("comments-list")).getByTestId("landing-wash")).toBeTruthy();
    expect(landed).toBeTruthy();
  });
});

describe("互动消息 · 合并行的人数", () => {
  const say = (locale: "en" | "zh-Hans", kind: "REACTION" | "LAMP" | "FOLLOW", n: number) => {
    const [key, params] = mergedSentence(kind, n, locale);
    return translate(locale, key, { ...params, name: "A" });
  };
  it("en counts the others: 2 people is 'and 1 other', 4 is 'and 3 others'; one person names only them", () => {
    expect(say("en", "REACTION", 1)).toBe("A reacted to your post");
    expect(say("en", "REACTION", 2)).toBe("A and 1 other reacted to your post");
    expect(say("en", "LAMP", 4)).toBe("A and 3 others lit a lamp on your post");
  });
  it("zh counts everyone, and one person is not 「等 1 人」", () => {
    expect(say("zh-Hans", "FOLLOW", 4)).toBe("A 等 4 人关注了你");
    expect(say("zh-Hans", "FOLLOW", 2)).toBe("A 等 2 人关注了你");
    expect(say("zh-Hans", "FOLLOW", 1)).toBe("A 关注了你");
  });
});
