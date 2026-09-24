/**
 * Tests for TenantContext session rehydration.
 *
 * The stored user is intentionally cached without `permissions` (see the
 * security comment in TenantContext.tsx), so on every mount the provider
 * must refetch the current permission list from the server. Nothing else
 * in the codebase exercises this path — the RequireButton/RequirePermission/
 * usePermissions tests all mock useTenant() wholesale, which is exactly why
 * they wouldn't catch the list arriving empty and staying empty.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { TenantProvider, useTenant } from "@/src/contexts/TenantContext";

import { permApi } from "@soulledger/core/api";
import { getAccessToken, getRefreshToken } from "@soulledger/core/platform";
import { installWebPlatform } from "@/lib/platform/web";

jest.mock("@soulledger/core/api", () => ({
  permApi: {
    myRolePermissions: jest.fn(),
  },
}));

const mockMyRolePermissions = permApi.myRolePermissions as jest.Mock;

const USER_KEY = "soulledger_user";

function seedStoredUser(tenantCode: string | null = "CN_DIYU") {
  localStorage.setItem(
    USER_KEY,
    JSON.stringify({
      user: {
        id: 1,
        username: "judge1",
        display_name: "Judge One",
        email: "judge1@test.com",
        role: "JUDGE",
        tenant: tenantCode === null ? null : { id: 1, code: tenantCode, display_name: tenantCode },
      },
      storedAt: Date.now(),
    })
  );
}

function wrapper({ children }: { children: React.ReactNode }) {
  return createElement(TenantProvider, null, children);
}

describe("TenantContext rehydration", () => {
  beforeEach(() => {
    localStorage.clear();
    mockMyRolePermissions.mockReset();
  });

  it("refetches permissions from the server after rehydrating a stored user", async () => {
    seedStoredUser();
    mockMyRolePermissions.mockResolvedValue({
      data: { role: "JUDGE", permissions: ["soul.read", "judgment.execute"], details: [] },
    });

    const { result } = renderHook(() => useTenant(), { wrapper });

    // Basic user info is restored synchronously; permissions start empty.
    expect(result.current.user?.role).toBe("JUDGE");
    expect(result.current.user?.permissions).toEqual([]);

    // Once the refetch resolves, the real permission list replaces it.
    await waitFor(() => {
      expect(result.current.user?.permissions).toEqual(["soul.read", "judgment.execute"]);
    });

    expect(mockMyRolePermissions).toHaveBeenCalledTimes(1);
  });

  it("takes the server's role over the cached one — a demotion lands immediately", async () => {
    /* 缓存的 envelope 里写着 ADMIN,而服务器说这个人现在是 VIEWER。

       此前 `.then(({ data }) => ...)` **只读 `data.permissions`,把 `role` 丢掉了**。
       role 于是一直是 localStorage 里那个值,而那个 envelope 的 TTL 是 **24 小时**,
       此后没有任何东西修正它。

       为什么这比一个过期的标签严重得多:`usePermissions.hasPermission` 的第一行是
       `if (user?.role === "ADMIN") return true`。一个被降为 VIEWER 的 ADMIN,
       在最长 24 小时内(跨刷新)对**每一个** `<RequirePermission>` 都照样放行。
       后端会 403,所以不泄露数据 —— 用户看到的是一屏 403,而不是「没有这个功能」。 */
    localStorage.setItem(
      USER_KEY,
      JSON.stringify({
        user: {
          id: 1,
          username: "was_admin",
          display_name: "Was Admin",
          email: "a@test.com",
          role: "ADMIN",
          tenant: { id: 1, code: "CN_DIYU", display_name: "CN_DIYU" },
        },
        storedAt: Date.now(),
      })
    );
    mockMyRolePermissions.mockResolvedValue({
      data: { role: "VIEWER", permissions: ["soul.read"], details: [] },
    });

    const { result } = renderHook(() => useTenant(), { wrapper });

    // 挂载那一刻仍是缓存里的值 —— 这一步是对的,UI 不该被网络阻塞。
    expect(result.current.user?.role).toBe("ADMIN");

    await waitFor(() => {
      expect(result.current.user?.role).toBe("VIEWER");
    });
    // 权限列表也要一起更新,否则「role 对了但权限还是旧的」是另一种半吊子状态。
    expect(result.current.user?.permissions).toEqual(["soul.read"]);
  });

  it("keeps the cached role when the server does not send one", async () => {
    /* 反对照。没有它,一个「无条件把 role 设成 data.role」的实现同样满足上面那条,
       而一个省略了该字段的响应会把角色抹成 undefined —— 那会让每一道门都关上,
       看起来像权限系统坏了。 */
    seedStoredUser();
    mockMyRolePermissions.mockResolvedValue({
      data: { permissions: ["soul.read"], details: [] },
    });

    const { result } = renderHook(() => useTenant(), { wrapper });

    await waitFor(() => {
      expect(result.current.user?.permissions).toEqual(["soul.read"]);
    });
    expect(result.current.user?.role).toBe("JUDGE");
  });

  it("leaves the gate closed (empty permissions) if the refetch fails", async () => {
    seedStoredUser();
    mockMyRolePermissions.mockRejectedValue(new Error("network error"));

    const { result } = renderHook(() => useTenant(), { wrapper });

    await waitFor(() => {
      expect(mockMyRolePermissions).toHaveBeenCalledTimes(1);
    });

    // A failed refetch must not fall back to "allow everything".
    expect(result.current.user?.permissions).toEqual([]);
  });

  it("does not call the API when there is no stored user", () => {
    const { result } = renderHook(() => useTenant(), { wrapper });

    expect(result.current.user).toBeNull();
    expect(mockMyRolePermissions).not.toHaveBeenCalled();
  });
});

/**
 * Logout has to revoke the credential the API client actually sends.
 *
 * `logout` cleared `localStorage` and three cookies — and the access token is
 * in NONE of those. It lives in `sessionStorage` (see `lib/platform/web.ts`),
 * which is where `api/client.ts`'s request interceptor reads it from. So after
 * "logging out" the interceptor kept attaching the old Bearer for the rest of
 * its 30-minute life, in the same tab, to every request the next screen made.
 * `tenant_id` stayed too.
 *
 * The real web adapter is installed for this block, not a probe: the claim is
 * about which browser facilities are emptied, and only the adapter knows.
 */
describe("logout clears the session, not just the cookies", () => {
  beforeEach(() => {
    installWebPlatform();
    localStorage.clear();
    sessionStorage.clear();
    mockMyRolePermissions.mockReset();
    mockMyRolePermissions.mockResolvedValue({ data: { role: "JUDGE", permissions: [] } });
  });

  it("the access token and the refresh token are both gone", async () => {
    seedStoredUser();
    sessionStorage.setItem("soulledger_access", "LIVE-BEARER");
    document.cookie = "soulledger_refresh=LIVE-REFRESH; path=/";

    const { result } = renderHook(() => useTenant(), { wrapper });
    await waitFor(() => expect(result.current.user).not.toBeNull());
    // Prove the seed is readable through the port before asserting its absence,
    // or the assertions below would pass against a store nothing ever filled.
    expect(getAccessToken()).toBe("LIVE-BEARER");
    expect(getRefreshToken()).toBe("LIVE-REFRESH");

    act(() => result.current.logout());

    expect(result.current.user).toBeNull();
    expect(getAccessToken()).toBeNull();
    // The raw facility as well as the port: the port could be re-pointed.
    expect(sessionStorage.getItem("soulledger_access")).toBeNull();
    expect(getRefreshToken()).toBeNull();
    expect(document.cookie).not.toContain("soulledger_refresh=LIVE-REFRESH");
    expect(localStorage.getItem(USER_KEY)).toBeNull();
  });
});
