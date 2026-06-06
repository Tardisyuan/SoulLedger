/**
 * Tests for PermissionFormModal component
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { PermissionFormModal } from "@/src/components/permissions/PermissionFormModal";
import type { Permission } from "@/lib/api";

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "common.cancel": "取消",
        "permissions.submit": "提交",
        "permissions.submitting": "提交中...",
        "permissions.codename_label": "权限代码",
        "permissions.codename_placeholder": "请输入权限代码",
        "permissions.name_label": "权限名称",
        "permissions.name_placeholder": "请输入权限名称",
        "permissions.category_label": "分类",
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
  title: "新建权限",
};

describe("PermissionFormModal", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders nothing when isOpen is false", () => {
    const { container } = render(
      <PermissionFormModal {...defaultProps} isOpen={false} />
    );
    expect(container.querySelector("[role='dialog']")).not.toBeInTheDocument();
  });

  it("renders the dialog when isOpen is true", () => {
    render(<PermissionFormModal {...defaultProps} />);
    expect(screen.getByText("新建权限")).toBeInTheDocument();
  });

  it("renders form labels and inputs", () => {
    render(<PermissionFormModal {...defaultProps} />);
    expect(screen.getByText("权限代码")).toBeInTheDocument();
    expect(screen.getByText("权限名称")).toBeInTheDocument();
    expect(screen.getByText("分类")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("请输入权限代码")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("请输入权限名称")).toBeInTheDocument();
  });

  it("renders cancel and submit buttons", () => {
    render(<PermissionFormModal {...defaultProps} />);
    expect(screen.getByText("取消")).toBeInTheDocument();
    expect(screen.getByText("提交")).toBeInTheDocument();
  });

  it("calls onClose when cancel button is clicked", () => {
    const onClose = jest.fn();
    render(<PermissionFormModal {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByText("取消"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders error message when error is provided", () => {
    render(<PermissionFormModal {...defaultProps} error="权限代码已存在" />);
    expect(screen.getByText("权限代码已存在")).toBeInTheDocument();
  });

  it("does not render error when error is null", () => {
    render(<PermissionFormModal {...defaultProps} error={null} />);
    expect(screen.queryByText("权限代码已存在")).not.toBeInTheDocument();
  });

  it("disables submit button when isPending is true", () => {
    render(<PermissionFormModal {...defaultProps} isPending={true} />);
    expect(screen.getByText("提交中...")).toBeInTheDocument();
  });

  it("populates form fields with initialData", () => {
    const initialData: Permission = {
      id: 1,
      codename: "soul.view",
      name: "查看灵魂",
      category: "soul",
    };
    render(<PermissionFormModal {...defaultProps} initialData={initialData} />);
    expect(screen.getByDisplayValue("soul.view")).toBeInTheDocument();
    expect(screen.getByDisplayValue("查看灵魂")).toBeInTheDocument();
  });

  it("renders category dropdown with all categories", () => {
    render(<PermissionFormModal {...defaultProps} />);
    const select = screen.getByDisplayValue("soul");
    expect(select).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "soul" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "judgment" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "karma" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "reincarnation" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "system" })).toBeInTheDocument();
  });

  it("updates input values when user types", () => {
    render(<PermissionFormModal {...defaultProps} />);
    const codenameInput = screen.getByPlaceholderText("请输入权限代码");
    const nameInput = screen.getByPlaceholderText("请输入权限名称");

    fireEvent.change(codenameInput, { target: { value: "soul.create" } });
    fireEvent.change(nameInput, { target: { value: "创建灵魂" } });

    expect(codenameInput).toHaveValue("soul.create");
    expect(nameInput).toHaveValue("创建灵魂");
  });

  it("updates category when select changes", () => {
    render(<PermissionFormModal {...defaultProps} />);
    const select = screen.getByDisplayValue("soul");

    fireEvent.change(select, { target: { value: "judgment" } });
    expect(select).toHaveValue("judgment");
  });

  it("resets form fields when modal closes and reopens", () => {
    const { rerender } = render(<PermissionFormModal {...defaultProps} isOpen={false} />);

    // Open modal with initial data
    rerender(<PermissionFormModal {...defaultProps} isOpen={true} />);
    const codenameInput = screen.getByPlaceholderText("请输入权限代码");
    fireEvent.change(codenameInput, { target: { value: "test.codename" } });

    // Close modal
    rerender(<PermissionFormModal {...defaultProps} isOpen={false} />);

    // Reopen modal
    rerender(<PermissionFormModal {...defaultProps} isOpen={true} />);
    expect(screen.getByPlaceholderText("请输入权限代码")).toHaveValue("");
  });
});
