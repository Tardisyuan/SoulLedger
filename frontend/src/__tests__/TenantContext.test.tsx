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
import { renderHook, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { TenantProvider, useTenant } from "@/src/contexts/TenantContext";
import { CIVILIZATION_CODES } from "@soulledger/core/config/civilizations";
import { permApi } from "@/lib/api";

jest.mock("@/lib/api", () => ({
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
 * The [data-civ] stamp — surface-first civilization identity.
 *
 * This whitelist, not any missing token, is why every Greek screen rendered on
 * the neutral 240° fallback: globals.css had no `gr` entry either, but even
 * once it did, a tenant code the `if` does not recognise falls through to
 * `delete`, and a deleted attribute matches no [data-civ] rule. The failure is
 * silent by construction — nothing throws, nothing warns, the page simply
 * looks like a logged-out one.
 *
 * So the assertion is driven off CIVILIZATION_CODES rather than a literal list:
 * a fifth civilization added to the config turns this red without anyone
 * remembering this file exists. And each case asserts the attribute's VALUE,
 * not merely that it is set — `expect(...).toBeDefined()` would stay green if
 * every tenant stamped `cn`.
 */
describe("TenantContext [data-civ] stamp", () => {
  const CASES = Object.entries(CIVILIZATION_CODES).map(([civ, code]) => ({
    civ,
    code,
    expected: code.split("_")[0].toLowerCase(),
  }));

  beforeEach(() => {
    localStorage.clear();
    mockMyRolePermissions.mockReset();
    mockMyRolePermissions.mockResolvedValue({ data: { permissions: [] } });
    delete document.documentElement.dataset.civ;
  });

  it("has a case per civilization the frontend knows about", () => {
    expect(CASES.length).toBeGreaterThan(3);
  });

  it.each(CASES)("$civ ($code) stamps data-civ=\"$expected\"", async ({ code, expected }) => {
    seedStoredUser(code);
    renderHook(() => useTenant(), { wrapper });

    await waitFor(() => {
      expect(document.documentElement.dataset.civ).toBe(expected);
    });
  });

  it("every civilization gets a DISTINCT prefix — no two share a hue by accident", () => {
    const stamps = CASES.map((c) => c.expected);
    expect(new Set(stamps).size).toBe(stamps.length);
  });

  it("clears the attribute for a tenant this deployment does not map to a cosmology", async () => {
    // Not "leaves it alone" — actively cleared, so a user switching from a
    // mapped tenant to an unmapped one drops back to the neutral fallback
    // instead of keeping the previous civilization's tint.
    document.documentElement.dataset.civ = "cn";
    seedStoredUser("NO_HEL");
    renderHook(() => useTenant(), { wrapper });

    await waitFor(() => {
      expect(document.documentElement.dataset.civ).toBeUndefined();
    });
  });

  it("stamps nothing when there is no tenant at all", () => {
    document.documentElement.dataset.civ = "eg";
    renderHook(() => useTenant(), { wrapper });

    expect(document.documentElement.dataset.civ).toBeUndefined();
  });
});
