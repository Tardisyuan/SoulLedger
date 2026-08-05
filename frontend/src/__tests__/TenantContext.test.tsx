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
import { permApi } from "@/lib/api";

jest.mock("@/lib/api", () => ({
  permApi: {
    myRolePermissions: jest.fn(),
  },
}));

const mockMyRolePermissions = permApi.myRolePermissions as jest.Mock;

const USER_KEY = "soulledger_user";

function seedStoredUser() {
  localStorage.setItem(
    USER_KEY,
    JSON.stringify({
      user: {
        id: 1,
        username: "judge1",
        display_name: "Judge One",
        email: "judge1@test.com",
        role: "JUDGE",
        tenant: { id: 1, code: "CN_DIYU", display_name: "地狱" },
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
