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

  it("SYSTEM_ADMIN passes every ADMIN gate: all codenames, isAdmin, and (no hall) exempt + global-only", () => {
    mockUseTenant.mockReturnValue({ ...mockContext("SYSTEM_ADMIN"), tenantCode: null });
    const { result } = renderHook(() => usePermissions());
    expect(result.current.hasPermission("user.delete")).toBe(true);
    expect(result.current.hasPermission("menu.manage")).toBe(true);
    expect(result.current.isAdmin).toBe(true);
    expect(result.current.isSystemAdmin).toBe(true);
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

// 分殿 1A:后端 tests/tenancy_exempt_sites.py 的两种标签。SYSTEM_ONLY 问 isSystemAdmin;CIVILIZATION 问 ownsHall。
describe("isSystemAdmin / isCivilizationAdmin / ownsHall (后端 is_tenant_exempt / is_civilization_admin / reaches_hall)", () => {
  const impersonation = jest.requireMock("@/src/components/impersonation/useImpersonation") as { useImpersonation: jest.Mock };
  afterEach(() => impersonation.useImpersonation.mockReturnValue(null));
  const as = (role: UserRole, hall: { code: string } | null, civilization: string | null = null) => {
    mockUseTenant.mockReturnValue({ ...mockContext(role), user: { ...mockUser(role), tenant: hall, civilization } } as never);
    return renderHook(() => usePermissions()).result.current;
  };

  it("SYSTEM_ADMIN with no hall is the system administrator and owns every hall", () => {
    const p = as("SYSTEM_ADMIN", null);
    expect(p.isSystemAdmin).toBe(true);
    expect(p.isCivilizationAdmin).toBe(false);
    expect(p.ownsHall("GR_HADES")).toBe(true);
    expect(p.ownsHall(null)).toBe(true);
  });

  it("an ADMIN with no hall is a civilization ADMIN, not the system administrator: its civilization's halls only", () => {
    const p = as("ADMIN", null, "EGYPTIAN");
    expect(p.isSystemAdmin).toBe(false);
    expect(p.isCivilizationAdmin).toBe(true);
    expect(p.ownsHall("EG_DUAT")).toBe(true);
    expect(p.ownsHall("CN_DIYU")).toBe(false);
    expect(p.ownsHall(null)).toBe(false);
    // a hall this build does not know the civilization of: fail closed
    expect(p.ownsHall("EG_NEW_HALL")).toBe(false);
  });

  it("a civilization ADMIN with no civilization recorded (an old cached session) owns nothing", () => {
    const p = as("ADMIN", null, null);
    expect(p.isCivilizationAdmin).toBe(true);
    expect(p.ownsHall("EG_DUAT")).toBe(false);
  });

  it("a civilization ADMIN whose session has no civilization field owns no unknown hall either", () => {
    // An envelope from before 1A has no `civilization` key at all. A hall this build does not know, asked without
    // the row's civilization, also resolves to undefined: undefined === undefined must not read as "same civilization".
    const { civilization: _dropped, ...userWithoutCivilization } = { ...mockUser("ADMIN"), tenant: null, civilization: null };
    mockUseTenant.mockReturnValue({ ...mockContext("ADMIN"), user: userWithoutCivilization } as never);
    const p = renderHook(() => usePermissions()).result.current;
    expect(p.isCivilizationAdmin).toBe(true);
    expect(p.ownsHall("EG_NEW_HALL")).toBe(false);
    expect(p.ownsHall("EG_NEW_HALL", null)).toBe(false);
    expect(p.ownsHall("EG_NEW_HALL", "")).toBe(false);
    // the seeded hall and a row that names its civilization stay refused too
    expect(p.ownsHall("EG_DUAT")).toBe(false);
    expect(p.ownsHall("EG_NEW_HALL", "EGYPTIAN")).toBe(false);
  });

  it("a hall-bound ADMIN and a no-hall non-ADMIN are neither; the bound one owns its own hall", () => {
    const bound = as("ADMIN", { code: "CN_DIYU" });
    expect(bound.isSystemAdmin).toBe(false);
    expect(bound.isCivilizationAdmin).toBe(false);
    expect(bound.ownsHall("CN_DIYU")).toBe(true);
    expect(bound.ownsHall("EU_HEAVEN_HELL")).toBe(false);
    const judge = as("JUDGE", null, "CHINESE");
    expect(judge.isSystemAdmin).toBe(false);
    expect(judge.isCivilizationAdmin).toBe(false);
    expect(judge.ownsHall("CN_DIYU")).toBe(false);
  });

  it("viewing a hall (or a person), neither admin helper holds and only one's own hall counts", () => {
    impersonation.useImpersonation.mockReturnValue({ id: 1, target: { id: 0, name: "", role: "ADMIN", hall: {} }, hallView: { code: "EG_DUAT" } });
    const sys = as("SYSTEM_ADMIN", null);
    expect(sys.isSystemAdmin).toBe(false);
    expect(sys.ownsHall("EG_DUAT")).toBe(false);
    impersonation.useImpersonation.mockReturnValue({ id: 1, target: { id: 2, name: "x", role: "JUDGE", hall: null } });
    const civ = as("ADMIN", null, "EGYPTIAN");
    expect(civ.isCivilizationAdmin).toBe(false);
    expect(civ.ownsHall("EG_DUAT")).toBe(false);
  });
});

describe("global-only codenames (后端 GLOBAL_ONLY_CODENAMES,P-07)", () => {
  const withHall = (role: UserRole, hall: { code: string } | null, permissions: string[] = []) => ({
    ...mockContext(role, permissions),
    user: { ...mockUser(role, permissions), tenant: hall },
  });

  it("a hall-bound ADMIN does not hold menu.manage, even when the reported list says so", () => {
    mockUseTenant.mockReturnValue(withHall("ADMIN", { code: "CN_DIYU" }, ["menu.manage"]) as never);
    const { result } = renderHook(() => usePermissions());
    expect(result.current.hasPermission("menu.manage")).toBe(false);
    expect(result.current.hasPermission("menu.manage", { evenWhileViewing: true })).toBe(false);
    // the ADMIN short-circuit still answers everything else
    expect(result.current.hasPermission("soul.create")).toBe(true);
  });

  it("SYSTEM_ADMIN does; a civilization ADMIN does not (stage 1A); no other role does, whatever it was granted", () => {
    mockUseTenant.mockReturnValue(withHall("SYSTEM_ADMIN", null) as never);
    expect(renderHook(() => usePermissions()).result.current.hasPermission("menu.manage")).toBe(true);
    expect(renderHook(() => usePermissions()).result.current.hasPermission("system.cross_civilization")).toBe(true);
    mockUseTenant.mockReturnValue(withHall("ADMIN", null) as never);
    expect(renderHook(() => usePermissions()).result.current.hasPermission("menu.manage")).toBe(false);
    expect(renderHook(() => usePermissions()).result.current.hasPermission("system.cross_civilization")).toBe(false);
    // the ADMIN short-circuit still answers everything else
    expect(renderHook(() => usePermissions()).result.current.hasPermission("soul.create")).toBe(true);
    mockUseTenant.mockReturnValue(withHall("JUDGE", null, ["menu.manage"]) as never);
    expect(renderHook(() => usePermissions()).result.current.hasPermission("menu.manage")).toBe(false);
  });
});
