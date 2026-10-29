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

jest.mock("@/src/components/impersonation/useImpersonation", () => ({
  ...jest.requireActual("@/src/components/impersonation/useImpersonation"),
  useImpersonation: jest.fn(() => null),
}));

import { useTenant } from "@/src/contexts/TenantContext";
import type { UserRole } from "@soulledger/core/api";
const mockUseTenant = useTenant as jest.MockedFunction<typeof useTenant>;

function mockUser(role: UserRole, permissions: string[] = []) {
  return { id: 1, username: "test", display_name: "Test", email: "test@test.com", role, permissions, tenant: null };
}

// `isJudge` / `isGuardian` / `isViewer` were built here too, and this file was
// the ONLY place in the repo that named them — the provider set them and
// nothing read them. They are gone from `TenantContextValue`; keeping them in
// the double would have left a test asserting a shape the real context no
// longer has, which is the failure mode where the double, not the code, is
// what the suite is measuring.
function mockContext(role: UserRole, permissions: string[] = []) {
  return {
    user: mockUser(role, permissions),
    tenantCode: "CN_DIYU",
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
      setUser: jest.fn(), logout: jest.fn(),
    });
    const { result } = renderHook(() => usePermissions());
    expect(result.current.hasPermission("soul.read")).toBe(false);
  });
});

// 代看 / 进殿查看(rbac-web M-4):只认读码,isAdmin 为假 —— 与后端 impersonation_read_only / is_tenant_exempt 一致。
describe("usePermissions while viewing", () => {
  const impersonation = jest.requireMock("@/src/components/impersonation/useImpersonation") as { useImpersonation: jest.Mock };
  afterEach(() => impersonation.useImpersonation.mockReturnValue(null));

  it("a judge being viewed keeps read codes and loses write codes", () => {
    impersonation.useImpersonation.mockReturnValue({ id: 1, target: { id: 2, name: "x", role: "JUDGE", hall: null } });
    mockUseTenant.mockReturnValue(mockContext("JUDGE", ["soul.read", "judgment.execute"]));
    const { result } = renderHook(() => usePermissions());
    expect(result.current.hasPermission("soul.read")).toBe(true);
    expect(result.current.hasPermission("judgment.execute")).toBe(false);
    expect(result.current.hasAnyPermission(["judgment.execute"])).toBe(false);
    // RequirePermission / RequireButton 要原始答案,好让 ViewingLock 置灰而不是藏掉
    expect(result.current.hasPermission("judgment.execute", { evenWhileViewing: true })).toBe(true);
    expect(result.current.hasPermission("user.delete", { evenWhileViewing: true })).toBe(false);
  });

  it("hall view: ADMIN is not admin and holds only read codes", () => {
    impersonation.useImpersonation.mockReturnValue({ id: 1, target: { id: 0, name: "", role: "ADMIN", hall: {} }, hallView: { code: "CN_DIYU" } });
    mockUseTenant.mockReturnValue(mockContext("ADMIN"));
    const { result } = renderHook(() => usePermissions());
    expect(result.current.isAdmin).toBe(false);
    expect(result.current.hasPermission("soul.read")).toBe(true);
    expect(result.current.hasPermission("recycle_bin.restore")).toBe(false);
  });

  it("not viewing: ADMIN is admin and holds write codes", () => {
    mockUseTenant.mockReturnValue(mockContext("ADMIN"));
    const { result } = renderHook(() => usePermissions());
    expect(result.current.isAdmin).toBe(true);
    expect(result.current.hasPermission("recycle_bin.restore")).toBe(true);
  });
});
