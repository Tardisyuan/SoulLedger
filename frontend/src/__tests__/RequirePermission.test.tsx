/**
 * Tests for src/components/rbac/RequirePermission.tsx
 */
import { render, screen } from "@testing-library/react";
import { RequireAdmin, RequirePermission } from "@/src/components/rbac/RequirePermission";

// RequirePermission asks for the raw answer so ViewingLock can grey (not hide) write controls while viewing (rbac-web M-4).
const VIEWING = { evenWhileViewing: true };

// Mock the usePermissions hook
const mockHasPermission = jest.fn();
const mockHasAnyPermission = jest.fn();
const mockHasAllPermissions = jest.fn();

let mockReady: boolean | undefined = undefined;
let mockIsAdmin = false;

jest.mock("@/src/hooks/usePermissions", () => ({
  usePermissions: () => ({
    hasPermission: mockHasPermission,
    hasAnyPermission: mockHasAnyPermission,
    hasAllPermissions: mockHasAllPermissions,
    permissions: [],
    permissionsReady: mockReady,
    isAdmin: mockIsAdmin,
  }),
}));

describe("RequirePermission", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReady = undefined;
    mockIsAdmin = false;
  });

  // 2026-10-30 D3: after a reload the codes are still on their way; the refusal must not flash.
  it("shows a skeleton instead of the fallback while permissions are not ready", () => {
    mockHasAnyPermission.mockReturnValue(false);
    mockReady = false;

    render(
      <RequirePermission permissions="soul.create" fallback={<div>No Access</div>}>
        <div>Protected Content</div>
      </RequirePermission>
    );

    expect(screen.getByTestId("permissions-pending")).toBeInTheDocument();
    expect(screen.queryByText("No Access")).not.toBeInTheDocument();
    expect(screen.queryByText("Protected Content")).not.toBeInTheDocument();
  });

  it("shows the fallback once ready, and no skeleton", () => {
    mockHasAnyPermission.mockReturnValue(false);
    mockReady = true;

    render(
      <RequirePermission permissions="soul.create" fallback={<div>No Access</div>}>
        <div>Protected Content</div>
      </RequirePermission>
    );

    expect(screen.getByText("No Access")).toBeInTheDocument();
    expect(screen.queryByTestId("permissions-pending")).not.toBeInTheDocument();
  });

  it("a gate with no fallback (a hidden button) draws nothing while not ready — no skeleton per button", () => {
    mockHasAnyPermission.mockReturnValue(false);
    mockReady = false;

    const { container } = render(
      <RequirePermission permissions="soul.create">
        <div>Protected Content</div>
      </RequirePermission>
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("an answer already in hand is not held back by readiness", () => {
    mockHasAnyPermission.mockReturnValue(true);
    mockReady = false;

    render(
      <RequirePermission permissions="soul.create" fallback={<div>No Access</div>}>
        <div>Protected Content</div>
      </RequirePermission>
    );

    expect(screen.getByText("Protected Content")).toBeInTheDocument();
    expect(screen.queryByTestId("permissions-pending")).not.toBeInTheDocument();
  });

  it("RequireAdmin: skeleton while not ready, the fallback after", () => {
    mockReady = false;
    const { rerender } = render(<RequireAdmin fallback={<div>Admins only</div>}>secret</RequireAdmin>);
    expect(screen.getByTestId("permissions-pending")).toBeInTheDocument();
    expect(screen.queryByText("Admins only")).not.toBeInTheDocument();

    mockReady = true;
    rerender(<RequireAdmin fallback={<div>Admins only</div>}>secret</RequireAdmin>);
    expect(screen.getByText("Admins only")).toBeInTheDocument();
    expect(screen.queryByText("secret")).not.toBeInTheDocument();
  });

  it("should render children when the user has the required permission", () => {
    mockHasAnyPermission.mockReturnValue(true);

    render(
      <RequirePermission permissions="soul.create">
        <div>Protected Content</div>
      </RequirePermission>
    );

    expect(screen.getByText("Protected Content")).toBeInTheDocument();
  });

  it("should not render children when the user lacks the permission", () => {
    mockHasAnyPermission.mockReturnValue(false);

    render(
      <RequirePermission permissions="soul.create">
        <div>Protected Content</div>
      </RequirePermission>
    );

    expect(screen.queryByText("Protected Content")).not.toBeInTheDocument();
  });

  it("should render fallback when the user lacks the permission", () => {
    mockHasAnyPermission.mockReturnValue(false);

    render(
      <RequirePermission permissions="soul.create" fallback={<div>No Access</div>}>
        <div>Protected Content</div>
      </RequirePermission>
    );

    expect(screen.queryByText("Protected Content")).not.toBeInTheDocument();
    expect(screen.getByText("No Access")).toBeInTheDocument();
  });

  it("should default to not rendering anything (null fallback) when access is denied", () => {
    mockHasAnyPermission.mockReturnValue(false);

    const { container } = render(
      <RequirePermission permissions="soul.create">
        <div>Protected Content</div>
      </RequirePermission>
    );

    expect(screen.queryByText("Protected Content")).not.toBeInTheDocument();
    // container should have an empty fragment wrapper
    expect(container.textContent).toBe("");
  });

  // --- ADMIN role always has permission ---

  it("should render children for ADMIN role (all permissions granted)", () => {
    // For ADMIN, the hook returns true for any permission check
    mockHasAnyPermission.mockReturnValue(true);

    render(
      <RequirePermission permissions={["soul.create", "soul.delete", "judgment.review"]}>
        <div>Admin Content</div>
      </RequirePermission>
    );

    expect(screen.getByText("Admin Content")).toBeInTheDocument();
    expect(mockHasAnyPermission).toHaveBeenCalledWith([
      "soul.create",
      "soul.delete",
      "judgment.review",
    ], VIEWING);
  });

  // --- Multiple permissions (any) ---

  it("should use hasAnyPermission by default (requireAll=false)", () => {
    mockHasAnyPermission.mockReturnValue(true);

    render(
      <RequirePermission permissions={["soul.create", "soul.edit"]}>
        <div>Any Perm</div>
      </RequirePermission>
    );

    expect(mockHasAnyPermission).toHaveBeenCalledWith(["soul.create", "soul.edit"], VIEWING);
    expect(mockHasAllPermissions).not.toHaveBeenCalled();
    expect(screen.getByText("Any Perm")).toBeInTheDocument();
  });

  // --- Multiple permissions (all required) ---

  it("should use hasAllPermissions when requireAll=true", () => {
    mockHasAllPermissions.mockReturnValue(true);

    render(
      <RequirePermission permissions={["soul.create", "soul.edit"]} requireAll>
        <div>All Perms</div>
      </RequirePermission>
    );

    expect(mockHasAllPermissions).toHaveBeenCalledWith(["soul.create", "soul.edit"], VIEWING);
    expect(mockHasAnyPermission).not.toHaveBeenCalled();
    expect(screen.getByText("All Perms")).toBeInTheDocument();
  });

  it("should deny access when requireAll=true and not all permissions are present", () => {
    mockHasAllPermissions.mockReturnValue(false);

    render(
      <RequirePermission
        permissions={["soul.create", "soul.delete"]}
        requireAll
        fallback={<div>Need all</div>}
      >
        <div>All Perms Content</div>
      </RequirePermission>
    );

    expect(screen.queryByText("All Perms Content")).not.toBeInTheDocument();
    expect(screen.getByText("Need all")).toBeInTheDocument();
  });

  // --- String vs array permissions ---

  it("should convert a single string permission to an array", () => {
    mockHasAnyPermission.mockReturnValue(true);

    render(
      <RequirePermission permissions="soul.view">
        <div>Single Perm</div>
      </RequirePermission>
    );

    expect(mockHasAnyPermission).toHaveBeenCalledWith(["soul.view"], VIEWING);
  });
});
