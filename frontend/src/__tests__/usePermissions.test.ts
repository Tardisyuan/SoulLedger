/**
 * Tests for usePermissions hook
 */
import { renderHook } from "@testing-library/react";
import { createElement } from "react";
import { TenantProvider } from "@/src/contexts/TenantContext";
import { usePermissions } from "@/src/hooks/usePermissions";

// Mock useTenant to return different user roles
jest.mock("@/src/contexts/TenantContext", () => ({
  ...jest.requireActual("@/src/contexts/TenantContext"),
  useTenant: jest.fn(),
}));

import { useTenant } from "@/src/contexts/TenantContext";
const mockUseTenant = useTenant as jest.MockedFunction<typeof useTenant>;

describe("usePermissions", () => {
  beforeEach(() => {
    mockUseTenant.mockReset();
  });

  it("ADMIN has all permissions", () => {
    mockUseTenant.mockReturnValue({
      user: { role: "ADMIN", permissions: [] },
      isAdmin: true, isJudge: false, isGuardian: false, isViewer: false,
      setUser: jest.fn(), logout: jest.fn(), loading: false,
    });
    const { result } = renderHook(() => usePermissions());
    expect(result.current.hasPermission("soul.create")).toBe(true);
    expect(result.current.hasPermission("user.delete")).toBe(true);
    expect(result.current.hasPermission("any.permission")).toBe(true);
  });

  it("JUDGE has specific permissions", () => {
    mockUseTenant.mockReturnValue({
      user: { role: "JUDGE", permissions: ["soul.read", "judgment.execute"] },
      isAdmin: false, isJudge: true, isGuardian: false, isViewer: false,
      setUser: jest.fn(), logout: jest.fn(), loading: false,
    });
    const { result } = renderHook(() => usePermissions());
    expect(result.current.hasPermission("soul.read")).toBe(true);
    expect(result.current.hasPermission("judgment.execute")).toBe(true);
    expect(result.current.hasPermission("user.delete")).toBe(false);
  });

  it("VIEWER has no permissions", () => {
    mockUseTenant.mockReturnValue({
      user: { role: "VIEWER", permissions: [] },
      isAdmin: false, isJudge: false, isGuardian: false, isViewer: true,
      setUser: jest.fn(), logout: jest.fn(), loading: false,
    });
    const { result } = renderHook(() => usePermissions());
    expect(result.current.hasPermission("soul.read")).toBe(false);
    expect(result.current.hasPermission("user.delete")).toBe(false);
  });

  it("hasAnyPermission returns true if any permission matches", () => {
    mockUseTenant.mockReturnValue({
      user: { role: "JUDGE", permissions: ["soul.read"] },
      isAdmin: false, isJudge: true, isGuardian: false, isViewer: false,
      setUser: jest.fn(), logout: jest.fn(), loading: false,
    });
    const { result } = renderHook(() => usePermissions());
    expect(result.current.hasAnyPermission(["soul.read", "user.delete"])).toBe(true);
    expect(result.current.hasAnyPermission(["user.delete", "menu.create"])).toBe(false);
  });

  it("hasAllPermissions returns true if all permissions match", () => {
    mockUseTenant.mockReturnValue({
      user: { role: "JUDGE", permissions: ["soul.read", "judgment.execute"] },
      isAdmin: false, isJudge: true, isGuardian: false, isViewer: false,
      setUser: jest.fn(), logout: jest.fn(), loading: false,
    });
    const { result } = renderHook(() => usePermissions());
    expect(result.current.hasAllPermissions(["soul.read", "judgment.execute"])).toBe(true);
    expect(result.current.hasAllPermissions(["soul.read", "user.delete"])).toBe(false);
  });

  it("unauthenticated user has no permissions", () => {
    mockUseTenant.mockReturnValue({
      user: null,
      isAdmin: false, isJudge: false, isGuardian: false, isViewer: false,
      setUser: jest.fn(), logout: jest.fn(), loading: false,
    });
    const { result } = renderHook(() => usePermissions());
    expect(result.current.hasPermission("soul.read")).toBe(false);
  });
});
