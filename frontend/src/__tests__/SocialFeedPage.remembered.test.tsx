/**
 * /social 的「关注 / 全部」页签记在本浏览器(`soulledger.social.filters`):默认「关注」不写任何东西,
 * 选了「全部」才写,回到「关注」就删掉;存的值不认识时当作没有。
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import SocialFeedPage from "@/app/social/page";

const mockUseFeed = jest.fn();
const mockUsePosts = jest.fn();
jest.mock("@soulledger/core/hooks/useSocial", () => ({
  useFeed: (...a: unknown[]) => mockUseFeed(...a),
  usePosts: (...a: unknown[]) => mockUsePosts(...a),
  useMyProfile: () => ({ data: undefined }),
}));
jest.mock("@soulledger/core/api", () => ({ PAGE_SIZE: 20 }));
jest.mock("@/src/contexts/I18nContext", () => ({ useI18n: () => ({ t: (k: string) => k, locale: "en", hydrated: true }) }));
jest.mock("@/src/components/layout/MenuGloss", () => ({ MenuGloss: () => null }));
jest.mock("@/src/components/plaque/Plaque", () => ({ usePlaque: () => undefined }));
jest.mock("@/src/components/social/PostCard", () => ({ PostCard: () => null }));
jest.mock("@/src/components/social/PostComposer", () => ({ PostComposer: () => null }));
jest.mock("@/src/components/social/FollowPanel", () => ({ FollowPanel: () => null }));

const KEY = "soulledger.social.filters";
const result = { data: [], isLoading: false, isPlaceholderData: false, isError: false, refetch: jest.fn() };
const tab = (name: string) => screen.getByRole("button", { name });
/** The `enabled` flag each query was last asked with: which tab is really on. */
const enabled = (m: jest.Mock) => m.mock.calls[m.mock.calls.length - 1][1].enabled;

beforeEach(() => {
  mockUseFeed.mockReturnValue(result);
  mockUsePosts.mockReturnValue(result);
});

it("a stored 「全部」 comes back on mount: only the all-posts query runs", async () => {
  localStorage.setItem(KEY, JSON.stringify({ tab: "all" }));
  render(<SocialFeedPage />);
  await waitFor(() => expect(enabled(mockUsePosts)).toBe(true));
  expect(enabled(mockUseFeed)).toBe(false);
  expect(tab("social.all")).toHaveAttribute("aria-pressed", "true");
  expect(tab("social.feed")).toHaveAttribute("aria-pressed", "false");
});

it("with nothing stored it opens on 关注 and writes nothing; an unknown stored value is ignored", () => {
  const first = render(<SocialFeedPage />);
  expect(tab("social.feed")).toHaveAttribute("aria-pressed", "true");
  expect(localStorage.getItem(KEY)).toBeNull();
  first.unmount();

  localStorage.setItem(KEY, JSON.stringify({ tab: "everyone" }));
  render(<SocialFeedPage />);
  expect(tab("social.feed")).toHaveAttribute("aria-pressed", "true");
});

it("choosing 全部 stores it; going back to 关注 removes it", async () => {
  render(<SocialFeedPage />);
  fireEvent.click(tab("social.all"));
  await waitFor(() => expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ tab: "all" }));
  fireEvent.click(tab("social.feed"));
  await waitFor(() => expect(localStorage.getItem(KEY)).toBeNull());
});
