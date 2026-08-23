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
import { CIVILIZATION_CODES } from "@/src/config/civilizations";
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
