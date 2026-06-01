/**
 * Tests for RequireButton component
 */
import { render, screen } from "@testing-library/react";
import { RequireButton } from "@/src/components/rbac/RequireButton";
import { usePermissions } from "@/src/hooks/usePermissions";

jest.mock("@/src/hooks/usePermissions");

const mockUsePermissions = usePermissions as jest.MockedFunction<typeof usePermissions>;

describe("RequireButton", () => {
  beforeEach(() => {
    mockUsePermissions.mockReset();
  });

  it("renders button when permission is granted", () => {
    mockUsePermissions.mockReturnValue({
      hasPermission: () => true,
      hasAnyPermission: () => true,
      hasAllPermissions: () => true,
      permissions: ["soul.create"],
    });
    render(
      <RequireButton permission="soul.create">
        <button>Create Soul</button>
      </RequireButton>
    );
    expect(screen.getByText("Create Soul")).toBeInTheDocument();
  });

  it("does not render button when permission is denied", () => {
    mockUsePermissions.mockReturnValue({
      hasPermission: () => false,
      hasAnyPermission: () => false,
      hasAllPermissions: () => false,
      permissions: [],
    });
    render(
      <RequireButton permission="soul.delete">
        <button>Delete Soul</button>
      </RequireButton>
    );
    expect(screen.queryByText("Delete Soul")).not.toBeInTheDocument();
  });

  it("renders fallback when permission is denied", () => {
    mockUsePermissions.mockReturnValue({
      hasPermission: () => false,
      hasAnyPermission: () => false,
      hasAllPermissions: () => false,
      permissions: [],
    });
    render(
      <RequireButton permission="soul.delete" fallback={<span>No Access</span>}>
        <button>Delete Soul</button>
      </RequireButton>
    );
    expect(screen.getByText("No Access")).toBeInTheDocument();
    expect(screen.queryByText("Delete Soul")).not.toBeInTheDocument();
  });

  it("checks code permission against buttons array", () => {
    mockUsePermissions.mockReturnValue({
      hasPermission: () => false,
      hasAnyPermission: () => false,
      hasAllPermissions: () => false,
      permissions: [],
    });
    render(
      <RequireButton code="create" buttons={[{ code: "create", permission: "soul.create" }]}>
        <button>Create</button>
      </RequireButton>
    );
    expect(screen.queryByText("Create")).not.toBeInTheDocument();
  });
});
