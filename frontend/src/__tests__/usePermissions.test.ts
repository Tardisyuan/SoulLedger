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

function mockUser(role: "ADMIN" | "JUDGE" | "GUARDIAN" | "VIEWER", permissions: string[] = []) {
  return { id: 1, username: "test", display_name: "Test", email: "test@test.com", role, permissions, tenant: null };
}

function mockContext(role: "ADMIN" | "JUDGE" | "GUARDIAN" | "VIEWER", permissions: string[] = []) {
  const isAdmin = role === "ADMIN";
  const isJudge = role === "JUDGE";
  const isGuardian = role === "GUARDIAN";
  const isViewer = role === "VIEWER";
  return {
    user: mockUser(role, permissions),
    tenantCode: "CN_DIYU",
    isAdmin, isJudge, isGuardian, isViewer,
    setUser: jest.fn(), logout: jest.fn(),
  };
}

describe("usePermissions", () => {
  beforeEach(() => {
    mockUseTenant.mockReset();
  });

  it("ADMIN has all permissions", () => {
    mockUseTenant.mockReturnValue(mockContext("ADMIN"));
    const { result } = renderHook(() => usePermissions());
    expect(result.current.hasPermission("soul.create")).toBe(true);
    expect(result.current.hasPermission("user.delete")).toBe(true);
    expect(result.current.hasPermission("any.permission")).toBe(true);
  });

  it("JUDGE has specific permissions", () => {
    mockUseTenant.mockReturnValue(mockContext("JUDGE", ["soul.read", "judgment.execute"]));
    const { result } = renderHook(() => usePermissions());
    expect(result.current.hasPermission("soul.read")).toBe(true);
    expect(result.current.hasPermission("judgment.execute")).toBe(true);
    expect(result.current.hasPermission("user.delete")).toBe(false);
  });

  it("VIEWER has no permissions", () => {
    mockUseTenant.mockReturnValue(mockContext("VIEWER"));
    const { result } = renderHook(() => usePermissions());
    expect(result.current.hasPermission("soul.read")).toBe(false);
    expect(result.current.hasPermission("user.delete")).toBe(false);
  });

  it("hasAnyPermission returns true if any permission matches", () => {
    mockUseTenant.mockReturnValue(mockContext("JUDGE", ["soul.read"]));
    const { result } = renderHook(() => usePermissions());
    expect(result.current.hasAnyPermission(["soul.read", "user.delete"])).toBe(true);
    expect(result.current.hasAnyPermission(["user.delete", "menu.create"])).toBe(false);
  });

  it("hasAllPermissions returns true if all permissions match", () => {
    mockUseTenant.mockReturnValue(mockContext("JUDGE", ["soul.read", "judgment.execute"]));
    const { result } = renderHook(() => usePermissions());
    expect(result.current.hasAllPermissions(["soul.read", "judgment.execute"])).toBe(true);
    expect(result.current.hasAllPermissions(["soul.read", "user.delete"])).toBe(false);
  });

  it("unauthenticated user has no permissions", () => {
    mockUseTenant.mockReturnValue({
      user: null, tenantCode: null,
      isAdmin: false, isJudge: false, isGuardian: false, isViewer: false,
      setUser: jest.fn(), logout: jest.fn(),
    });
    const { result } = renderHook(() => usePermissions());
    expect(result.current.hasPermission("soul.read")).toBe(false);
  });
});
