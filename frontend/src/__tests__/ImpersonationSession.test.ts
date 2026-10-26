/**
 * 代看的会话切换(W6):开始把代看令牌换进 access 位置、管理员自己的那张收起来;退出把它放回,
 * 服务端那一步失败也照放回;代看期间 401 不走刷新(刷新会悄悄把管理员的令牌写回去)。
 */
import { api } from "@soulledger/core/api/client";
import {
  endImpersonation,
  getImpersonation,
  startHallView,
  startImpersonation,
} from "@soulledger/core/api/impersonation";
import { getAccessToken, setAccessToken, platform, REFRESH_TOKEN_KEY } from "@soulledger/core/platform";

const START_RESPONSE = {
  access: "viewing-token",
  impersonation_id: 7,
  started_at: "2026-10-12T14:20:00Z",
  expires_at: "2026-10-12T14:50:00Z",
  reason: "她说看不到「移交」菜单",
  target: { id: 3, name: "孟婆", role: "JUDGE", tenant_code: "CN_DIYU", hall: { "zh-Hans": "第十殿" } },
};

interface ResponseHandler {
  rejected?: Rejected;
}
type Rejected = typeof Promise.reject;

let post: jest.SpyInstance;
beforeEach(() => {
  sessionStorage.clear();
  setAccessToken("admin-token");
  post = jest.spyOn(api, "post");
});
afterEach(() => {
  post.mockRestore();
  sessionStorage.clear();
});

describe("进殿查看(第五十四批 O-2)", () => {
  it("同一条路:令牌换进 access 位置、管理员的收起;状态带上殿;退出放回同一条", async () => {
    post
      .mockResolvedValueOnce({
        data: {
          access: "hall-token",
          impersonation_id: 9,
          started_at: "2026-10-27T10:00:00Z",
          expires_at: "2026-10-27T10:30:00Z",
          code: "CN_DIYU",
          hall_names: { "zh-Hans": "酆都第十殿" },
        },
      })
      .mockResolvedValueOnce({ data: { ended: true } });

    const state = await startHallView("CN_DIYU");

    expect(post).toHaveBeenCalledWith("/tenants/CN_DIYU/view/");
    expect(getAccessToken()).toBe("hall-token");
    expect(state.hallView).toEqual({ code: "CN_DIYU" });
    expect(state.target.hall).toEqual({ "zh-Hans": "酆都第十殿" });
    expect(state.adminAccess).toBe("admin-token");

    await endImpersonation();
    expect(post).toHaveBeenLastCalledWith("/auth/impersonate/end/");
    expect(getAccessToken()).toBe("admin-token");
    expect(getImpersonation()).toBeNull();
  });
});

describe("开始与退出", () => {
  it("开始:access 位置换成代看令牌,管理员的令牌收起,倒计时按服务器与本机的时差校正", async () => {
    jest.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-12T14:21:00Z")); // 本机钟快 1 分钟
    post.mockResolvedValueOnce({ data: START_RESPONSE });

    const state = await startImpersonation(3, "她说看不到「移交」菜单");

    expect(post).toHaveBeenCalledWith("/auth/impersonate/", { user_id: 3, reason: "她说看不到「移交」菜单" });
    expect(getAccessToken()).toBe("viewing-token");
    expect(getImpersonation()).toEqual(state);
    expect(state.adminAccess).toBe("admin-token");
    expect(state.expiresAt).toBe(Date.parse("2026-10-12T14:51:00Z")); // 到点 = 服务器 14:50 + 本机快的 1 分钟
    jest.restoreAllMocks();
  });

  it("退出:放回管理员的令牌、清掉状态;刷新令牌全程没碰", async () => {
    platform().secure.set(REFRESH_TOKEN_KEY, "admin-refresh");
    post.mockResolvedValueOnce({ data: START_RESPONSE }).mockResolvedValueOnce({ data: { ended: true } });
    await startImpersonation(3, "x");

    await endImpersonation();

    expect(post).toHaveBeenLastCalledWith("/auth/impersonate/end/");
    expect(getAccessToken()).toBe("admin-token");
    expect(getAccessToken()).not.toBe("viewing-token");
    expect(getImpersonation()).toBeNull();
    expect(platform().secure.get(REFRESH_TOKEN_KEY)).toBe("admin-refresh");
  });

  it("服务端那一步失败(已到点 / 离线)也照样放回", async () => {
    post.mockResolvedValueOnce({ data: START_RESPONSE }).mockRejectedValueOnce(new Error("offline"));
    await startImpersonation(3, "x");
    await endImpersonation();
    expect(getAccessToken()).toBe("admin-token");
    expect(getImpersonation()).toBeNull();
  });

  it("开始失败:什么都没换", async () => {
    post.mockRejectedValueOnce(new Error("400"));
    await expect(startImpersonation(3, "x")).rejects.toThrow();
    expect(getAccessToken()).toBe("admin-token");
    expect(getImpersonation()).toBeNull();
  });
});

describe("代看期间的 401", () => {
  it("不刷新:管理员的刷新令牌没被用来换新的 access", async () => {
    platform().secure.set(REFRESH_TOKEN_KEY, "admin-refresh");
    post.mockResolvedValueOnce({ data: START_RESPONSE });
    await startImpersonation(3, "x");

    const handlers = (api.interceptors.response as unknown as { handlers: ResponseHandler[] }).handlers;
    const rejected = handlers.find((h) => h?.rejected)?.rejected;
    const error = { response: { status: 401 }, config: { url: "/souls/", _retry: false, headers: {} } };

    await expect(rejected?.(error)).rejects.toBe(error);
    expect(post).toHaveBeenCalledTimes(1); // 只有开始那一次,没有 /auth/refresh/
    expect(getAccessToken()).toBe("viewing-token");
  });
});
