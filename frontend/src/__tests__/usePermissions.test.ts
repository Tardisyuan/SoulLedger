/**
 * Tests for usePermissions hook
 *
 * NOTE: `useTenant` 在下面被 mock 了,所以**真的 `TenantProvider` 从来没有跑过**。
 * 这个文件曾经 import 了 `TenantProvider` 与 `createElement` 而两个都不调用 ——
 * 两个 import 制造出「这条测试是在真实上下文里跑的」这个错觉。它不是:这里的
 * 一切都由那个 mock 的返回值驱动。删掉那两个 import 是诚实的版本。
 *
 * 它们藏了很久,因为 `src/__tests__/**` 整个在 eslint 的 `ignores` 里,
 * 而主块又把 `no-unused-vars` 关成了 off —— 两层遮蔽叠在一起。
 */
import { renderHook } from "@testing-library/react";
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
