/**
 * Tests for src/components/rbac/RouteGuard.tsx
 */
import { render, screen } from "@testing-library/react";
import { RouteGuard } from "@/src/components/rbac/RouteGuard";

// Mock the usePermissions hook
const mockHasPermission = jest.fn();

jest.mock("@/src/hooks/usePermissions", () => ({
  usePermissions: () => ({
    hasPermission: mockHasPermission,
    hasAnyPermission: (perms: string[]) => perms.some(p => mockHasPermission(p)),
    hasAllPermissions: (perms: string[]) => perms.every(p => mockHasPermission(p)),
    permissions: [],
  }),
}));

describe("RouteGuard", () => {
  beforeEach(() => {
    mockHasPermission.mockReset();
  });

  it("renders children when permission is granted", () => {
    mockHasPermission.mockReturnValue(true);
    render(
      <RouteGuard permission="soul.view">
        <div>Protected Content</div>
      </RouteGuard>
    );
    expect(screen.getByText("Protected Content")).toBeInTheDocument();
  });

  it("does not render children when permission is denied", () => {
    mockHasPermission.mockReturnValue(false);
    render(
      <RouteGuard permission="soul.delete">
        <div>Protected Content</div>
      </RouteGuard>
    );
    expect(screen.queryByText("Protected Content")).not.toBeInTheDocument();
  });

  it("renders fallback when permission is denied", () => {
    mockHasPermission.mockReturnValue(false);
    render(
      <RouteGuard permission="admin.panel" fallback={<div>Access Denied</div>}>
        <div>Protected Content</div>
      </RouteGuard>
    );
    expect(screen.getByText("Access Denied")).toBeInTheDocument();
    expect(screen.queryByText("Protected Content")).not.toBeInTheDocument();
  });

  it("renders nothing when permission is denied and no fallback", () => {
    mockHasPermission.mockReturnValue(false);
    const { container } = render(
      <RouteGuard permission="forbidden">
        <div>Protected Content</div>
      </RouteGuard>
    );
    expect(container.textContent).toBe("");
  });

  it("calls hasPermission with correct permission string", () => {
    mockHasPermission.mockReturnValue(true);
    render(
      <RouteGuard permission="judgment.review">
        <div>Content</div>
      </RouteGuard>
    );
    expect(mockHasPermission).toHaveBeenCalledWith("judgment.review");
  });

  it("handles permission check returning true for admin", () => {
    mockHasPermission.mockReturnValue(true);
    render(
      <RouteGuard permission="soul.delete">
        <div>Admin Content</div>
      </RouteGuard>
    );
    expect(screen.getByText("Admin Content")).toBeInTheDocument();
  });
});
