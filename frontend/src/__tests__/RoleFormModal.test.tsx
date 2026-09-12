/**
 * Tests for RoleFormModal component
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { RoleFormModal } from "@/src/components/permissions/RoleFormModal";
import type { Role } from "@soulledger/core/api";

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "common.cancel": "取消",
        "permissions.submit": "提交",
        "permissions.submitting": "提交中...",
        "permissions.role_name_label": "角色名称",
        "permissions.role_name_placeholder": "请输入角色名称",
        "permissions.display_name_label": "显示名称",
        "permissions.display_name_placeholder": "请输入显示名称",
        "permissions.role_name_builtin_hint": "内置角色,名称固定",
      };
      return map[key] ?? key;
    },
    locale: "en",
    hydrated: true,
  }),
}));

const defaultProps = {
  isOpen: true,
  onClose: jest.fn(),
  onSubmit: jest.fn(),
  isPending: false,
  error: null,
  title: "新建角色",
};

describe("RoleFormModal", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders nothing when isOpen is false", () => {
    const { container } = render(
      <RoleFormModal {...defaultProps} isOpen={false} />
    );
    expect(container.querySelector("[role='dialog']")).not.toBeInTheDocument();
  });

  it("renders the dialog when isOpen is true", () => {
    render(<RoleFormModal {...defaultProps} />);
    expect(screen.getByText("新建角色")).toBeInTheDocument();
  });

  it("renders form labels and inputs", () => {
    render(<RoleFormModal {...defaultProps} />);
    expect(screen.getByText("角色名称")).toBeInTheDocument();
    expect(screen.getByText("显示名称")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("请输入角色名称")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("请输入显示名称")).toBeInTheDocument();
  });

  it("renders cancel and submit buttons", () => {
    render(<RoleFormModal {...defaultProps} />);
    expect(screen.getByText("取消")).toBeInTheDocument();
    expect(screen.getByText("提交")).toBeInTheDocument();
  });

  it("calls onClose when cancel button is clicked", () => {
    const onClose = jest.fn();
    render(<RoleFormModal {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByText("取消"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders error message when error is provided", () => {
    render(<RoleFormModal {...defaultProps} error="角色名称已存在" />);
    expect(screen.getByText("角色名称已存在")).toBeInTheDocument();
  });

  it("does not render error when error is null", () => {
    render(<RoleFormModal {...defaultProps} error={null} />);
    expect(screen.queryByText("角色名称已存在")).not.toBeInTheDocument();
  });

  it("disables submit button when isPending is true", () => {
    render(<RoleFormModal {...defaultProps} isPending={true} />);
    expect(screen.getByText("提交中...")).toBeInTheDocument();
  });

  const adminRole: Role = {
    id: 1,
    name: "ADMIN",
    display_name: "管理员",
    scope: "global",
    organization: null,
    organization_name: null,
    user_count: 0,
    is_builtin: true,
    version: 1,
    update_time: "2026-01-01T00:00:00Z",
  };

  it("populates form fields with initialData", () => {
    render(<RoleFormModal {...defaultProps} initialData={adminRole} />);
    expect(screen.getByDisplayValue("ADMIN")).toBeInTheDocument();
    expect(screen.getByDisplayValue("管理员")).toBeInTheDocument();
  });

  it("makes a built-in role's name read-only and says why; a custom role's stays editable", () => {
    const { unmount } = render(<RoleFormModal {...defaultProps} initialData={adminRole} />);
    const builtinName = screen.getByDisplayValue("ADMIN");
    expect(builtinName).toHaveAttribute("readonly");
    expect(screen.getByText("内置角色,名称固定")).toBeInTheDocument();
    // Read-only, not disabled: the value still submits and stays readable.
    expect(builtinName).not.toBeDisabled();
    unmount();

    render(
      <RoleFormModal {...defaultProps} initialData={{ ...adminRole, id: 2, name: "SCRIBE", display_name: "书记", is_builtin: false }} />
    );
    const customName = screen.getByDisplayValue("SCRIBE");
    expect(customName).not.toHaveAttribute("readonly");
    expect(screen.queryByText("内置角色,名称固定")).not.toBeInTheDocument();
    fireEvent.change(customName, { target: { value: "ARCHIVIST" } });
    expect(customName).toHaveValue("ARCHIVIST");
  });

  it("updates input values when user types", () => {
    render(<RoleFormModal {...defaultProps} />);
    const nameInput = screen.getByPlaceholderText("请输入角色名称");
    const displayNameInput = screen.getByPlaceholderText("请输入显示名称");

    fireEvent.change(nameInput, { target: { value: "MODERATOR" } });
    fireEvent.change(displayNameInput, { target: { value: "版主" } });

    expect(nameInput).toHaveValue("MODERATOR");
    expect(displayNameInput).toHaveValue("版主");
  });
});
