/**
 * Tests for src/components/rbac/RequirePermission.tsx
 */
import { render, screen } from "@testing-library/react";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";

// Mock the usePermissions hook
const mockHasPermission = jest.fn();
const mockHasAnyPermission = jest.fn();
const mockHasAllPermissions = jest.fn();

jest.mock("@/src/hooks/usePermissions", () => ({
  usePermissions: () => ({
    hasPermission: mockHasPermission,
    hasAnyPermission: mockHasAnyPermission,
    hasAllPermissions: mockHasAllPermissions,
    permissions: [],
  }),
}));

describe("RequirePermission", () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
    ]);
  });

  // --- Multiple permissions (any) ---

  it("should use hasAnyPermission by default (requireAll=false)", () => {
    mockHasAnyPermission.mockReturnValue(true);

    render(
      <RequirePermission permissions={["soul.create", "soul.edit"]}>
        <div>Any Perm</div>
      </RequirePermission>
    );

    expect(mockHasAnyPermission).toHaveBeenCalledWith(["soul.create", "soul.edit"]);
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

    expect(mockHasAllPermissions).toHaveBeenCalledWith(["soul.create", "soul.edit"]);
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

    expect(mockHasAnyPermission).toHaveBeenCalledWith(["soul.view"]);
  });
});
