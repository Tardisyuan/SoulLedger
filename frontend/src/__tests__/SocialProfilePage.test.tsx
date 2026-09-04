/**
 * `app/social/profile/[id]` — 两个查询,两个失败位置。
 *
 * 这一页有 `useProfile` 和 `usePosts`,而只有前者有错误分支。posts 请求 500
 * 时,页面渲染 `social.no_posts` ——「这个用户还没发过帖」—— 而真相是请求失败。
 *
 * 为它写的那道守卫 `errorIsNotAnEmptyState.test.ts` **给这一页开了绿灯**,
 * 因为它是 per-FILE 的:它在第 85 行找到了 profile 查询的 `role="alert"` 就
 * 停下了。缺陷是 per-QUERY 的。这个套件是逐查询的那一版。
 */
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import UserProfilePage from "@/app/social/profile/[id]/page";
import { socialApi } from "@soulledger/core/api";

jest.mock("@soulledger/core/api", () => ({
  PAGE_SIZE: 20,
  socialApi: {
    getProfile: jest.fn(),
    listPosts: jest.fn(),
  },
}));

jest.mock("next/navigation", () => ({
  useParams: () => ({ id: "u1" }),
}));

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    formatDateTime: (v: string) => `dt(${v})`,
    locale: "en",
    hydrated: true,
  }),
}));

// 这两个只负责把内容画出来,和本套件要问的分支无关。桩掉它们是为了让断言
// 落在页面自己的分支上,而不是它们的内部结构。
jest.mock("@/src/components/social/ProfileCard", () => ({
  ProfileCard: () => <div data-testid="profile-card" />,
}));
jest.mock("@/src/components/social/PostCard", () => ({
  PostCard: ({ post }: { post: { content: string } }) => <div>{post.content}</div>,
}));

const mockGetProfile = socialApi.getProfile as jest.Mock;
const mockListPosts = socialApi.listPosts as jest.Mock;

const PROFILE = { id: "u1", username: "孟婆", bio: "", followers_count: 0, following_count: 0 };

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<UserProfilePage />, { wrapper: Wrapper });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetProfile.mockResolvedValue({ data: PROFILE });
});

describe("app/social/profile/[id]", () => {
  it("帖子请求失败时报错,而不是说「还没发过帖」", async () => {
    // profile 成功、posts 失败 —— 这正是 per-file 守卫看不见的那个组合:
    // 页面上确实有一个 role="alert",只是它属于另一个查询。
    mockListPosts.mockRejectedValue(new Error("500"));

    const { container } = renderPage();

    await waitFor(() =>
      expect(container.querySelector("[data-query-error]")).toBeInTheDocument()
    );
    // 缺席断言,而且是这条的全部要害。
    expect(screen.queryByText("social.no_posts")).not.toBeInTheDocument();
  });

  it("真的没发过帖时才说没发过帖", async () => {
    mockListPosts.mockResolvedValue({ data: { results: [], count: 0 } });

    const { container } = renderPage();

    expect(await screen.findByText("social.no_posts")).toBeInTheDocument();
    expect(container.querySelector("[data-query-error]")).toBeNull();
  });

  it("有帖子就画帖子,两条分支都不出现", async () => {
    mockListPosts.mockResolvedValue({
      data: { results: [{ id: "p1", content: "一碗汤" }], count: 1 },
    });

    const { container } = renderPage();

    expect(await screen.findByText("一碗汤")).toBeInTheDocument();
    expect(screen.queryByText("social.no_posts")).not.toBeInTheDocument();
    expect(container.querySelector("[data-query-error]")).toBeNull();
  });

  it("profile 失败而 posts 成功时,两个失败位置互不冒充", async () => {
    // 反方向:profile 那条错误分支本来就在,这里钉住修 posts 没有把它弄坏,
    // 也钉住 posts 的成功不会被 profile 的失败盖掉。
    mockGetProfile.mockRejectedValue(new Error("500"));
    mockListPosts.mockResolvedValue({
      data: { results: [{ id: "p1", content: "一碗汤" }], count: 1 },
    });

    const { container } = renderPage();

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByText("一碗汤")).toBeInTheDocument();
    expect(container.querySelector("[data-query-error]")).toBeNull();
  });
});
