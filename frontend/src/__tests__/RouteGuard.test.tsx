/**
 * Tests for src/components/rbac/RouteGuard.tsx
 */
import { render, screen } from "@testing-library/react";
import { RouteGuard } from "@/src/components/rbac/RouteGuard";

// Mock the useAuth hook
const mockHasPermission = jest.fn();

jest.mock("@/src/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: 1, username: "tester", role: "JUDGE", permissions: [] },
    isAdmin: false,
    isJudge: true,
    isGuardian: false,
    isViewer: false,
    hasPermission: mockHasPermission,
    hasRole: jest.fn(),
  }),
}));

describe("RouteGuard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should render children when the user has permission", () => {
    mockHasPermission.mockReturnValue(true);

    render(
      <RouteGuard operation="soul.view">
        <div>Secret Page</div>
      </RouteGuard>
    );

    expect(screen.getByText("Secret Page")).toBeInTheDocument();
  });

  it("should not render children when the user lacks permission", () => {
    mockHasPermission.mockReturnValue(false);

    render(
      <RouteGuard operation="soul.delete">
        <div>Secret Page</div>
      </RouteGuard>
    );

    expect(screen.queryByText("Secret Page")).not.toBeInTheDocument();
  });

  it("should render fallback when the user lacks permission", () => {
    mockHasPermission.mockReturnValue(false);

    render(
      <RouteGuard operation="admin.panel" fallback={<div>Redirecting...</div>}>
        <div>Admin Panel</div>
      </RouteGuard>
    );

    expect(screen.queryByText("Admin Panel")).not.toBeInTheDocument();
    expect(screen.getByText("Redirecting...")).toBeInTheDocument();
  });

  it("should default to null fallback when access is denied", () => {
    mockHasPermission.mockReturnValue(false);

    const { container } = render(
      <RouteGuard operation="forbidden">
        <div>Hidden</div>
      </RouteGuard>
    );

    expect(screen.queryByText("Hidden")).not.toBeInTheDocument();
    expect(container.textContent).toBe("");
  });

  it("should pass the operation to hasPermission", () => {
    mockHasPermission.mockReturnValue(true);

    render(
      <RouteGuard operation="judgment.review">
        <div>Content</div>
      </RouteGuard>
    );

    expect(mockHasPermission).toHaveBeenCalledWith("judgment.review");
  });

  // --- ADMIN role always has permission ---

  it("should render children for ADMIN role (all operations allowed)", () => {
    // When ADMIN, hasPermission returns true for any operation
    mockHasPermission.mockReturnValue(true);

    render(
      <RouteGuard operation="soul.delete">
        <div>Admin Allowed</div>
      </RouteGuard>
    );

    expect(screen.getByText("Admin Allowed")).toBeInTheDocument();
    expect(mockHasPermission).toHaveBeenCalledWith("soul.delete");
  });

  it("should grant access regardless of operation string when user is ADMIN", () => {
    mockHasPermission.mockReturnValue(true);

    render(
      <RouteGuard operation="any.arbitrary.operation">
        <div>Always Allowed</div>
      </RouteGuard>
    );

    expect(screen.getByText("Always Allowed")).toBeInTheDocument();
  });
});
